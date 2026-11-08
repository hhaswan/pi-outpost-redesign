import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceSelection, workspaceSelectionKey, writeWorkspaceSelection } from "./workspaceSelection";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("workspace selection storage", () => {
  it("scopes by server and saves only workspace identity without URL credentials", () => {
    writeWorkspaceSelection("https://user:secret@example.test/outpost?token=secret#secret", { root: "/a", id: "side" });
    expect(workspaceSelectionKey("https://example.test/outpost")).toBe("pi-outpost:workspace:v1:https://example.test/outpost");
    expect(readWorkspaceSelection("https://example.test/outpost")).toEqual({ root: "/a", id: "side" });
    expect(readWorkspaceSelection("https://other.test/outpost")).toBeNull();
    expect(localStorage.key(0)).not.toContain("secret");
  });

  it.each(["invalid-json", "null", "[]", '{"root":4}', '{"root":""}', '{"root":"/a","id":4}'])("ignores malformed selection %s", (value) => {
    localStorage.setItem(workspaceSelectionKey(""), value);
    expect(readWorkspaceSelection("")).toBeNull();
  });

  it("tolerates blocked browser storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readWorkspaceSelection("")).toBeNull();
    expect(() => writeWorkspaceSelection("", { root: "/a" })).not.toThrow();
  });
});
