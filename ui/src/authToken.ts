/**
 * Browser-side sign-in, as the standalone app starts.
 *
 * The browser never keeps the token: it trades it once for an HttpOnly session cookie
 * (`POST /api/login`). On load this removes what earlier versions left behind — the
 * token in `localStorage` — strips a `?token=` from the address bar without using it,
 * and takes the pairing code from a `/pair#<code>` link, clearing the fragment.
 */
const LEGACY_STORAGE_KEY = "pi-outpost:token";

export interface AuthBootstrap {
  /** The address carried a `token` parameter, which was removed and not used. */
  urlTokenIgnored: boolean;
  /** The code of a `/pair#<code>` link, to redeem; the address no longer shows it. */
  pairingCode: string | null;
}

export function bootstrapAuth(): AuthBootstrap {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage unavailable (sandboxed iframe): nothing was stored there either
  }
  let urlTokenIgnored = false;
  let pairingCode: string | null = null;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has("token")) {
      urlTokenIgnored = true;
      url.searchParams.delete("token");
      changed = true;
    }
    if (url.pathname === "/pair") {
      pairingCode = decodeURIComponent(url.hash.slice(1)) || null;
      url.pathname = "/";
      url.hash = "";
      changed = true;
    }
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // History unavailable: nothing to rewrite
  }
  return { urlTokenIgnored, pairingCode };
}

/** What `GET /api/session` says about this browser. */
export interface SessionInfo {
  signedIn: boolean;
  authRequired: boolean;
  via?: "open" | "bearer" | "session";
  sessions?: number;
  ca: { fingerprint: string } | null | boolean;
  canRotate?: boolean;
  /** Days the server's TLS certificate has left; Settings warns under 30. */
  certificateDaysLeft?: number;
}

/** A JSON POST to the server's own `/api/*`; the browser adds the cookie and the Origin. */
export async function postApi(serverUrl: string, route: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${serverUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    // An empty or non-JSON answer: the status says enough
  }
  return { status: response.status, body: parsed };
}

/** The sentence for a refused sign-in or pairing attempt. */
export function signInError(status: number, what: "token" | "code"): string {
  if (status === 401) return what === "token" ? "That token is not correct." : "That code is wrong, used or expired. Create a new one.";
  if (status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (status === 403) return "Open this page from the server's own address to sign in.";
  if (status === 0) return "The server could not be reached.";
  return `Sign-in failed (${status}).`;
}
