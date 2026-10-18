import { MAX_AGENT_AVATAR_BYTES } from "@paperclipai/shared";

/** MIME types the avatar endpoint normalizes; anything else is rejected up front. */
export const AGENT_AVATAR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AGENT_AVATAR_INPUT_ACCEPT = AGENT_AVATAR_IMAGE_TYPES.join(",");

/** Base64 length that decodes to at most MAX_AGENT_AVATAR_BYTES. */
const MAX_AGENT_AVATAR_BASE64_LENGTH = 4 * Math.ceil(MAX_AGENT_AVATAR_BYTES / 3);
/** Larger sources are downscaled through a canvas instead of being rejected. */
export const MAX_AGENT_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024;
const AVATAR_MAX_EDGE = 512;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.onload = () => {
      const result = reader.result;
      if (result && typeof result !== "string") {
        resolve(new Uint8Array(result as ArrayBuffer));
        return;
      }
      reject(new Error("Could not read the selected image."));
    };
    reader.readAsArrayBuffer(file);
  });
}

function stripDataUrlPrefix(dataUrl: string): string {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("Could not encode the selected image.");
  return dataUrl.slice(separator + 1);
}

async function renderScaledBase64(
  file: File,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<string> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot resize images. Choose an image under 512 KB.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file is not a readable image.");
  }
  try {
    const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize images. Choose an image under 512 KB.");
    context.drawImage(bitmap, 0, 0, width, height);
    return stripDataUrlPrefix(canvas.toDataURL(type, quality));
  } finally {
    bitmap.close();
  }
}

/**
 * Reads a PNG/JPEG/WebP file and returns the canonical base64 the avatar
 * endpoint expects: raw image bytes with no data URL prefix. Files already
 * under the 512 KB budget are passed through untouched; larger photos are
 * downscaled to at most 512 px so ordinary phone JPEGs upload without error.
 */
export async function prepareAgentAvatarImage(file: File): Promise<string> {
  if (!(AGENT_AVATAR_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size <= 0) throw new Error("The selected image is empty.");
  if (file.size > MAX_AGENT_AVATAR_SOURCE_BYTES) {
    throw new Error("The selected image is larger than 20 MB. Choose a smaller file.");
  }
  if (file.size <= MAX_AGENT_AVATAR_BYTES) {
    return bytesToBase64(await readFileBytes(file));
  }
  const candidates: Array<{ type: "image/png" | "image/jpeg"; quality?: number }> = [
    { type: "image/png" },
    { type: "image/jpeg", quality: 0.9 },
    { type: "image/jpeg", quality: 0.72 },
  ];
  for (const candidate of candidates) {
    const base64 = await renderScaledBase64(file, candidate.type, candidate.quality);
    if (base64.length <= MAX_AGENT_AVATAR_BASE64_LENGTH) return base64;
  }
  throw new Error("That image is still too large after resizing. Choose a smaller or simpler image.");
}
