// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_AVATAR_BYTES } from "@paperclipai/shared";
import { MAX_AGENT_AVATAR_SOURCE_BYTES, prepareAgentAvatarImage } from "./agent-avatar-image";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

function sampleFile(type = "image/png", name = "avatar.png") {
  return new File([PNG_BYTES], name, { type });
}

function oversizedFile(type = "image/png") {
  return new File([new Uint8Array(MAX_AGENT_AVATAR_BYTES + 1024)], "big.png", { type });
}

describe("prepareAgentAvatarImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects unsupported file types before reading anything", async () => {
    await expect(prepareAgentAvatarImage(sampleFile("image/gif", "avatar.gif"))).rejects.toThrow(
      "PNG, JPEG, or WebP",
    );
  });

  it("rejects empty files", async () => {
    await expect(prepareAgentAvatarImage(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow(
      "empty",
    );
  });

  it("passes small images through as canonical base64 with no data URL prefix", async () => {
    const base64 = await prepareAgentAvatarImage(sampleFile());
    expect(base64).toBe(btoa(String.fromCharCode(...PNG_BYTES)));
    expect(base64).not.toContain("data:");
    expect(base64).not.toContain("\n");
  });

  it("downscales oversized images through the canvas instead of rejecting them", async () => {
    const drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 90, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,QUJD");

    await expect(prepareAgentAvatarImage(oversizedFile())).resolves.toBe("QUJD");
    expect(drawImage).toHaveBeenCalledTimes(1);
    // Scaled to the 512 px edge budget without enlarging the short side.
    const [bitmap, , , width, height] = drawImage.mock.calls[0] as [unknown, number, number, number, number];
    expect(bitmap).toBeTruthy();
    expect(width).toBe(512);
    expect(height).toBe(29);
  });

  it("reports a friendly error when the browser cannot resize", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(prepareAgentAvatarImage(oversizedFile())).rejects.toThrow("cannot resize");
  });

  it("rejects source files above the sanity limit", async () => {
    const huge = new File([new Uint8Array(MAX_AGENT_AVATAR_SOURCE_BYTES + 1)], "huge.png", {
      type: "image/png",
    });
    await expect(prepareAgentAvatarImage(huge)).rejects.toThrow("larger than 20 MB");
  });
});
