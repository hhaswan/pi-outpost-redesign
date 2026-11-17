import { useState, type FormEvent } from "react";

/** Resolves to the reason a sign-in was refused, or null once it succeeded. */
type Attempt = (value: string) => Promise<string | null> | string | null | void;

/**
 * The sign-in screen, shown when the server refuses this browser (no session, an expired
 * one, or a WebSocket closed with 4401). The token is exchanged once for a session cookie
 * and never stored; a pairing code from a signed-in device does the same without it.
 */
export function TokenGate({
  title,
  onSubmit,
  onSubmitCode,
  caAvailable = false,
  urlTokenIgnored = false,
  pairingError = null,
}: {
  title?: string;
  onSubmit: Attempt;
  onSubmitCode?: Attempt;
  /** The server serves its CA certificate on /ca: offer the install page. */
  caAvailable?: boolean;
  /** The address carried a `?token=`, which was removed without being used. */
  urlTokenIgnored?: boolean;
  /** A pairing link that could not be redeemed. */
  pairingError?: string | null;
}) {
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(pairingError);

  // One attempt at a time: a double submit would spend two of the minute's tries.
  async function attempt(event: FormEvent, value: string, submit: Attempt | undefined) {
    event.preventDefault();
    if (busy || !value.trim() || !submit) return;
    setBusy(true);
    setError(null);
    try {
      const refused = await submit(value.trim());
      if (typeof refused === "string") setError(refused);
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-full border border-zinc-300 bg-white px-4 py-2 font-mono text-sm outline-none transition-colors focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-emerald-500";
  const button =
    "w-full rounded-full border border-emerald-400 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:-translate-y-px hover:border-emerald-500 hover:bg-emerald-50 disabled:translate-y-0 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40";

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800" data-testid="sign-in">
        <div className="mb-1 text-center text-3xl">{title ?? "π"}</div>
        <h1 className="mb-5 text-center text-sm text-zinc-500 dark:text-zinc-400">Sign in to this server.</h1>
        {urlTokenIgnored && (
          <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
            Links with <code>?token=</code> no longer sign in. The token was removed from the address and not used.
          </p>
        )}
        <form onSubmit={(event) => void attempt(event, token, onSubmit)}>
          <label htmlFor="pi-outpost-token" className="mb-1 block px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Access token
          </label>
          <input
            id="pi-outpost-token"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="paste the token…"
            className={`mb-3 ${field}`}
          />
          <button type="submit" disabled={busy || !token.trim()} className={button}>
            Connect
          </button>
        </form>
        {onSubmitCode && (
          <form className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800" onSubmit={(event) => void attempt(event, code, onSubmitCode)}>
            <label htmlFor="pi-outpost-pairing-code" className="mb-1 block px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Pairing code
            </label>
            <input
              id="pi-outpost-pairing-code"
              name="code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXXX-XXXXX"
              className={`mb-3 ${field}`}
            />
            <button type="submit" disabled={busy || !code.trim()} className={button}>
              Pair this device
            </button>
          </form>
        )}
        {error && (
          <p className="mt-4 text-center text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Ask the operator for the token, or create a pairing code in Settings on a signed-in device.
        </p>
        {caAvailable && (
          <p className="mt-2 text-center text-xs">
            <a href="/ca" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
              Install this server's certificate
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
