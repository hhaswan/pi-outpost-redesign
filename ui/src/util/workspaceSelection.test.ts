import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceSelection, workspaceSelectionKey, writeWorkspaceSelection } from "./workspaceSelection";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("workspace selection storage", () => {
  it("scopes by server and saves only workspace identity without URL credentials", () => {
    writeWorkspaceSelection("https://user:secret@example.test/outpost?token=secret#secret", { root: "/a", id: "side" });
    expect(workspaceSelectionKey("https://example.test/outpost")).toBe("pi-outpost:workspace:v2:https://example.test/outpost");
    expect(readWorkspaceSelection("https://example.test/outpost")).toEqual({ root: "/a", id: "side" });
    expect(readWorkspaceSelection("https://other.test/outpost")).toBeNull();
    expect(sessionStorage.key(0)).not.toContain("secret");
    expect(localStorage.length).toBe(0);
  });

  it.each(["invalid-json", "null", "[]", '{"root":4}', '{"root":""}', '{"root":"/a","id":4}'])("ignores malformed selection %s", (value) => {
    sessionStorage.setItem(workspaceSelectionKey(""), value);
    expect(readWorkspaceSelection("")).toBeNull();
  });

  it("discards inherited selections when a new tab copied its opener's sessionStorage", () => {
    writeWorkspaceSelection("http://localhost:3000", { root: "/a", id: "side" });
    expect(readWorkspaceSelection("http://localhost:3000")).toEqual({ root: "/a", id: "side" });
    // New browser tab inherits sessionStorage but starts with a fresh history entry.
    history.replaceState(null, "");
    expect(readWorkspaceSelection("http://localhost:3000")).toBeNull();
    expect(sessionStorage.getItem(workspaceSelectionKey("http://localhost:3000"))).toBeNull();
  });

  it("does not restore the old browser-wide workspace into a new tab", () => {
    localStorage.setItem("pi-outpost:workspace:v1:http://localhost:3000", JSON.stringify({ root: "/a", id: "side" }));
    expect(readWorkspaceSelection("http://localhost:3000")).toBeNull();
  });

  it("keeps per-tab identity on a non-secure LAN origin without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", { randomUUID: undefined });
    writeWorkspaceSelection("http://192.168.0.2:3141", { root: "/a", id: "side" });
    expect(readWorkspaceSelection("http://192.168.0.2:3141")).toEqual({ root: "/a", id: "side" });
    expect(readWorkspaceSelection("http://192.168.0.2:3141")).toEqual({ root: "/a", id: "side" });
  });

  it("tolerates blocked browser storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readWorkspaceSelection("")).toBeNull();
    expect(() => writeWorkspaceSelection("", { root: "/a" })).not.toThrow();
  });
});
