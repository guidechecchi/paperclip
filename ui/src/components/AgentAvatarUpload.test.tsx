// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appearanceForPalette, type AgentAppearance } from "@paperclipai/shared";
import { AgentAvatarUpload } from "./AgentAvatarUpload";

const mockSetAvatar = vi.hoisted(() => vi.fn());

vi.mock("../api/agents", () => ({
  agentsApi: { setAvatar: mockSetAvatar },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07]);
const PNG_BASE64 = btoa(String.fromCharCode(...PNG_BYTES));

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

interface TestAgent {
  id: string;
  companyId: string;
  appearance?: AgentAppearance | null;
  status?: string | null;
}

function makeAgent(overrides: Partial<TestAgent> = {}): TestAgent {
  return {
    id: "agent-1",
    companyId: "company-1",
    appearance: appearanceForPalette("deep-tide"),
    status: "active",
    ...overrides,
  };
}

function customAppearance(): AgentAppearance {
  return {
    ...appearanceForPalette("deep-tide"),
    customAvatarAssetId: "22222222-2222-4222-8222-222222222222",
  };
}

describe("AgentAvatarUpload", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockSetAvatar.mockReset();
    mockSetAvatar.mockResolvedValue({
      agentId: "agent-1",
      appearance: appearanceForPalette("deep-tide"),
      avatarUrl: "/api/assets/asset-1/content",
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderUpload(agent: TestAgent) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentAvatarUpload agent={agent} />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    return { root, invalidateSpy };
  }

  async function selectFile(name: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not rendered");
    const file = new File([PNG_BYTES], name, { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    await flushReact();
  }

  function findButton(label: string) {
    return [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(label),
    );
  }

  it("uploads the selected PNG as canonical base64 and refreshes agent projections", async () => {
    const { root, invalidateSpy } = await renderUpload(makeAgent());
    expect(container.querySelector('input[type="file"]')?.getAttribute("accept")).toBe(
      "image/png,image/jpeg,image/webp",
    );
    await selectFile("avatar.png");
    expect(mockSetAvatar).toHaveBeenCalledWith("company-1", "agent-1", PNG_BASE64);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agents"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org", "company-1"] });
    await act(async () => root.unmount());
  });

  it("offers a reset only for a custom avatar and clears it", async () => {
    const { root } = await renderUpload(makeAgent({ appearance: customAppearance() }));
    expect(container.textContent).toContain("Change avatar");
    const reset = findButton("Use default");
    expect(reset).toBeTruthy();
    await act(async () => {
      reset!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();
    expect(mockSetAvatar).toHaveBeenCalledWith("company-1", "agent-1", null);
    await act(async () => root.unmount());
  });

  it("keeps the reset hidden for the preset portrait", async () => {
    const { root } = await renderUpload(makeAgent());
    expect(findButton("Use default")).toBeUndefined();
    expect(container.textContent).toContain("Upload avatar");
    await act(async () => root.unmount());
  });

  it("surfaces the server error when the image is rejected", async () => {
    mockSetAvatar.mockRejectedValueOnce(
      new Error("Use a valid static PNG, JPEG, or WebP image with at most 16 megapixels"),
    );
    const { root } = await renderUpload(makeAgent());
    await selectFile("avatar.png");
    expect(container.textContent).toContain("Use a valid static PNG, JPEG, or WebP image");
    await act(async () => root.unmount());
  });

  it("disables the control while the agent cannot change its avatar", async () => {
    const { root } = await renderUpload(makeAgent({ status: "pending_approval" }));
    const upload = findButton("Upload avatar") as HTMLButtonElement | undefined;
    expect(upload?.disabled).toBe(true);
    expect(container.textContent).toContain("unavailable");
    await act(async () => root.unmount());
  });
});
