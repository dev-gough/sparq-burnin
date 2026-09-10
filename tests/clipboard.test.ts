import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubDom(opts: {
  clipboard?: { writeText: ReturnType<typeof vi.fn> };
  exec?: boolean;
}) {
  const el = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  };
  const execCommand = vi.fn(() => opts.exec !== false);
  vi.stubGlobal("document", {
    createElement: vi.fn(() => el),
    body,
    execCommand,
  });
  vi.stubGlobal("navigator", opts.clipboard ? { clipboard: opts.clipboard } : {});
  return { el, body, execCommand };
}

describe("copyText", () => {
  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { execCommand } = stubDom({ clipboard: { writeText } });
    await expect(copyText("shown-once")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("shown-once");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when Clipboard API rejects (HTTP lab hosts)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const { el, execCommand } = stubDom({ clipboard: { writeText } });
    await expect(copyText("shown-once")).resolves.toBe(true);
    expect(el.value).toBe("shown-once");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    stubDom({ exec: false });
    await expect(copyText("nope")).resolves.toBe(false);
  });
});
