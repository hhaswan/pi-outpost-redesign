import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bootstrapAuth, postApi, signInError } from "./authToken";

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Put the page on a URL, as if it had been opened with these parameters. */
function openAt(url: string) {
  history.replaceState(null, "", url);
}

describe("bootstrapAuth", () => {
  it("LegacyStoredTokenRemoved: deletes the token an earlier version stored", () => {
    localStorage.setItem("pi-outpost:token", "old-secret");
    bootstrapAuth();
    expect(localStorage.getItem("pi-outpost:token")).toBeNull();
  });

  it("TokenInUrl / TokenInPageUrlIgnored: strips ?token= without storing or returning it", () => {
    openAt("/app?token=from-url&view=tree#section");
    const boot = bootstrapAuth();
    expect(boot.urlTokenIgnored).toBe(true);
    expect(JSON.stringify(boot)).not.toContain("from-url");
    expect(window.location.pathname).toBe("/app");
    expect(window.location.search).toBe("?view=tree");
    expect(window.location.hash).toBe("#section");
    expect(localStorage.length).toBe(0);
  });

  it("leaves an address without a token alone", () => {
    openAt("/app?view=tree");
    expect(bootstrapAuth()).toEqual({ urlTokenIgnored: false, pairingCode: null });
    expect(window.location.search).toBe("?view=tree");
  });

  it("PairingCodeStaysOutOfRequests: takes the code from /pair#<code> and clears the fragment", () => {
    openAt("/pair#ABCDE-FGHJK");
    expect(bootstrapAuth().pairingCode).toBe("ABCDE-FGHJK");
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("");
  });

  it("survives storage that throws (sandboxed iframe)", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    openAt("/?token=x");
    expect(bootstrapAuth().urlTokenIgnored).toBe(true);
  });
});

describe("postApi and signInError", () => {
  it("posts JSON with the cookie and reads the answer", async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify({ signedIn: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetched);
    expect(await postApi("", "/api/login", { token: "t" })).toEqual({ status: 200, body: { signedIn: true } });
    expect(fetched).toHaveBeenCalledWith("/api/login", expect.objectContaining({ method: "POST", credentials: "same-origin", body: '{"token":"t"}' }));
  });

  it("names each refusal", () => {
    expect(signInError(401, "token")).toMatch(/not correct/);
    expect(signInError(401, "code")).toMatch(/expired/);
    expect(signInError(429, "token")).toMatch(/Too many attempts/);
    expect(signInError(0, "code")).toMatch(/could not be reached/);
  });
});
