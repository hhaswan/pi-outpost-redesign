import { useEffect, useState } from "react";
import type { SessionInfo } from "../authToken";
import { QrCode } from "./QrCode";

interface SecuritySettingsProps {
  session: SessionInfo;
  onSignOut: (everywhere: boolean) => void | Promise<void>;
  onRotateToken: (revokeOtherSessions: boolean) => Promise<{ token?: string; error?: string }>;
  onCreatePairingCode: () => Promise<{ code?: string; expiresAt?: number; error?: string }>;
}

export const HTTPS_DOCS = "https://github.com/laurentftech/pi-outpost/blob/main/docs/deployment.md#remote-transport-https-or-ssh";

const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-[11px] text-zinc-700 transition hover:-translate-y-px hover:border-zinc-400 disabled:translate-y-0 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500";

/**
 * Settings, Security: the certificate to compare and install, pairing another device,
 * the signed-in browsers, sign-out and token rotation.
 */
export function SecuritySettings({ session, onSignOut, onRotateToken, onCreatePairingCode }: SecuritySettingsProps) {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const host = window.location.host;
  const fingerprint = typeof session.ca === "object" && session.ca !== null ? session.ca.fingerprint : null;

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;
  const pairingLive = pairing !== null && secondsLeft > 0;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4" data-testid="security-settings">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Security</h3>
      {window.location.protocol === "http:" && (
        <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status" data-testid="plain-http-notice">
          Not encrypted — set up HTTPS (<a href={HTTPS_DOCS} target="_blank" rel="noopener noreferrer" className="underline">docs</a>)
        </p>
      )}
      {session.certificateDaysLeft !== undefined && session.certificateDaysLeft < 30 && (
        <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status" data-testid="certificate-expiry">
          The server certificate expires in {session.certificateDaysLeft} days. On the host, run <span className="font-mono">pi-outpost tls renew</span> and restart. Devices keep trusting the same CA.
        </p>
      )}
      {fingerprint && (
        <details className="mb-3 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
          <summary className="cursor-pointer text-xs text-zinc-700 dark:text-zinc-300">Server certificate</summary>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">SHA-256 fingerprint. Compare it with the one on the install page of a new device.</p>
          <p className="mt-1 break-all font-mono text-[11px] text-zinc-700 dark:text-zinc-300" data-testid="ca-fingerprint">{fingerprint}</p>
          <div className="mt-2 flex flex-col items-center gap-1">
            <QrCode text={`https://${host}/ca`} label="QR code of the certificate install page" size={128} />
            <a href="/ca" className="text-[11px] text-emerald-700 hover:underline dark:text-emerald-400">{`https://${host}/ca`}</a>
          </div>
        </details>
      )}
      <div className="mb-3 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-700 dark:text-zinc-300">Pair a device</span>
          <button type="button" className={smallButton} disabled={busy} onClick={() => void run(async () => {
            const answer = await onCreatePairingCode();
            if (answer.code && answer.expiresAt) {
              setNow(Date.now());
              setPairing({ code: answer.code, expiresAt: answer.expiresAt });
            } else setMessage(answer.error ?? "No code.");
          })}>
            {pairingLive ? "New code" : "Create code"}
          </button>
        </div>
        {pairing && (pairingLive ? (
          <div className="mt-2 flex flex-col items-center gap-1" data-testid="pairing-code">
            <QrCode text={`${window.location.origin}/pair#${pairing.code}`} label="QR code to pair a device" />
            <span className="font-mono text-base tracking-widest text-zinc-800 dark:text-zinc-200">{pairing.code}</span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Scan it, or type the code on the other device's sign-in screen. {secondsLeft} s left, single use.</span>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">The code expired. Create a new one.</p>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400" data-testid="session-count">
        {session.sessions === 1 ? "1 browser signed in" : `${session.sessions ?? 0} browsers signed in`}
      </p>
      <div className="mb-3 flex flex-wrap gap-1">
        <button type="button" className={smallButton} disabled={busy || session.via !== "session"} onClick={() => void run(() => Promise.resolve(onSignOut(false)))}>Sign out</button>
        <button type="button" className={smallButton} disabled={busy} onClick={() => void run(() => Promise.resolve(onSignOut(true)))}>Sign out all devices</button>
      </div>
      {session.canRotate && (
        <div className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
          <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={revokeOthers} onChange={(event) => setRevokeOthers(event.target.checked)} />
            Also sign out all other devices
          </label>
          <button type="button" className={`${smallButton} mt-2`} disabled={busy} onClick={() => void run(async () => {
            if (!window.confirm("Replace the access token? The old one stops working at once.")) return;
            const answer = await onRotateToken(revokeOthers);
            if (answer.token) setRotated(answer.token);
            else setMessage(answer.error ?? "Rotation failed.");
          })}>Rotate token</button>
          {rotated && (
            <div className="mt-2" data-testid="rotated-token">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">The new token, shown once. Store it before closing Settings.</p>
              <div className="mt-1 flex items-center gap-1">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-zinc-100 px-2 py-1 text-[11px] dark:bg-zinc-800">{rotated}</code>
                <button type="button" className={smallButton} onClick={() => void navigator.clipboard?.writeText(rotated)}>Copy</button>
              </div>
            </div>
          )}
        </div>
      )}
      {message && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400" role="alert">{message}</p>}
    </section>
  );
}
