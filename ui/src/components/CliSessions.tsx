import { useEffect, useId, useRef, useState } from "react";
import type { CliBridgeOperation, CliBridgeReply, CliBridgeSnapshot, CliBridgeSummary } from "@pi-outpost/shared";

const button = "min-h-9 rounded-full border border-zinc-300 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function CliSessions({ state, connected, onRequest, onClose }: {
  state: (CliBridgeReply & { loading: boolean }) | null;
  connected: boolean;
  onRequest: (operation: CliBridgeOperation) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const initialRequestId = useRef(state?.requestId);
  const request = useRef(onRequest);
  request.current = onRequest;
  const [sessions, setSessions] = useState<CliBridgeSummary[]>([]);
  const [listed, setListed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CliBridgeSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const operation = useRef<{ action: CliBridgeOperation["action"]; previous?: string; requestId?: string } | null>(null);
  const send = (next: CliBridgeOperation) => {
    if (operation.current || state?.loading || !connected) return;
    operation.current = { action: next.action, previous: state?.requestId };
    setPending(true);
    setFormError("");
    setNotice("");
    if (next.action !== "read") setSnapshot(null);
    request.current(next);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    operation.current = { action: "list", previous: initialRequestId.current };
    setPending(true);
    request.current({ action: "list" });
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const active = operation.current;
    if (!state || !active || state.requestId === active.previous) return;
    if (state.loading) { active.requestId = state.requestId; return; }
    if (active.requestId ? state.requestId !== active.requestId : state.requestId === active.previous) return;
    operation.current = null;
    setPending(false);
    if (state.error) {
      setSnapshot(null);
      if (active.action === "submit") setNotice("Submission outcome may be uncertain. Check the CLI transcript before sending again. No automatic retry.");
      return;
    }
    if (active.action === "list" && state.sessions) { setSessions(state.sessions); setListed(true); }
    if (active.action === "read" && state.snapshot?.instanceId === selected) setSnapshot(state.snapshot);
    if (active.action === "submit") {
      if (state.submitted) {
        setNotice("Submitted to CLI; acceptance is shown in its transcript");
        setDraft("");
      } else setNotice("Submission outcome is unknown. Check the CLI transcript before sending again. No automatic retry.");
    }
  }, [state, selected]);
  useEffect(() => {
    if (!connected) {
      if (operation.current?.action === "submit") setNotice("Submission outcome is unknown. Check the CLI transcript before sending again. No automatic retry.");
      operation.current = null;
      setPending(false);
      setSnapshot(null);
    }
  }, [connected]);

  // Refresh only an observed owner; never resend a submission or erase a draft.
  useEffect(() => {
    if (!connected || !selected || pending || state?.loading || !snapshot) return;
    const timer = window.setTimeout(() => send({ action: "read", id: selected }), 2000);
    return () => window.clearTimeout(timer);
    // send is render-local; these values describe every condition it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, selected, pending, state?.loading, state?.requestId, snapshot]);

  const locked = !connected || pending || Boolean(state?.loading);
  const owner = sessions.find((entry) => entry.id === selected);
  const current = snapshot?.instanceId === selected ? snapshot : null;
  const canEdit = connected && owner?.activity !== "unreachable" && current?.inputGranted && current.activity === "idle";
  const canInput = !locked && canEdit;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} className="flex max-h-[90dvh] w-full min-w-0 max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-800 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h2 id={titleId} className="min-w-0 flex-1 text-lg font-semibold">CLI sessions</h2>
          <button type="button" className={button} disabled={locked} onClick={() => send({ action: "list" })}>Refresh list</button>
          <button ref={closeButton} type="button" className={button} aria-label="Close CLI sessions" onClick={onClose}>Close</button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <p className="text-sm">Opt-in enrolled CLI sessions only, not all OS processes. The CLI remains the sole agent and session writer.</p>
          <p className="text-xs text-zinc-500">Observation-only by default. The CLI operator grants input with <code>/outpost-bridge allow</code>. Closing this panel does not stop the CLI.</p>
          {!connected && <p role="status">Disconnected. Activity is unknown and input is disabled.</p>}
          {(pending || state?.loading) && <p role="status">Loading CLI response…</p>}
          {(formError || state?.error) && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError || state?.error}</p>}
          {notice && <p role="status" className="text-sm">{notice}</p>}
          {listed && !sessions.length && <p className="text-sm">No enrolled CLI sessions. Start a CLI with <code>pi -e &lt;bridge-extension&gt;</code>, then refresh the list.</p>}
          <ul className="space-y-2" aria-label="Enrolled CLI sessions">
            {sessions.map((entry) => <li key={entry.id}>
              <button type="button" className="w-full min-w-0 rounded-xl border border-zinc-300 p-3 text-left text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800" aria-pressed={selected === entry.id} disabled={locked} onClick={() => {
                setSelected(entry.id); setDraft(""); send({ action: "read", id: entry.id });
              }}>
                <span className="block break-all">Project: {entry.cwd}</span>
                <span className="block break-all">Session: {entry.sessionId}</span>
                <span className="block break-all">Owner: {entry.id}</span>
                <span className="block">Activity: {!connected || entry.activity === "unreachable" ? "unknown / unreachable" : entry.activity}</span>
              </button>
            </li>)}
          </ul>
          {selected && <div className="min-w-0 space-y-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Owner snapshot</h3><button type="button" className={button} disabled={locked} onClick={() => send({ action: "read", id: selected })}>Refresh transcript</button></div>
            {current ? <>
              <p className="break-all text-xs">Session: {current.sessionId} · Activity: {current.activity}</p>
              <pre tabIndex={0} aria-label="CLI transcript" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-100 p-3 font-mono text-xs dark:bg-zinc-950">{current.transcript}</pre>
              {current.truncated && <p className="text-xs">Transcript truncated by the CLI owner.</p>}
              {!current.inputGranted && <p className="text-sm">Observation-only. Input permission has not been granted.</p>}
              {current.activity !== "idle" && <p className="text-sm">CLI is {current.activity}. Input is disabled; terminal-dialog answers are not supported.</p>}
            </> : <p className="text-sm">No current snapshot. Refresh the transcript to confirm owner activity and permission.</p>}
            <form className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              if (!canInput || operation.current) return;
              if (!draft.trim() || draft.length > 8000 || /^\s*[/!]/.test(draft)) { setFormError("Enter plain text (1–8000 characters), without a leading / or ! command."); return; }
              send({ action: "submit", id: selected, generation: current!.generation, inputId: crypto.randomUUID(), text: draft });
            }}>
              <label className="block text-sm">Message to CLI<textarea className="mt-1 block min-h-24 w-full min-w-0 rounded-xl border border-zinc-300 bg-transparent p-3 text-sm focus:outline-2 focus:outline-blue-500 disabled:opacity-50 dark:border-zinc-700" value={draft} maxLength={8000} disabled={!canEdit} onChange={(event) => setDraft(event.target.value)} /></label>
              <p className="text-xs text-zinc-500">Plain text only. No slash commands or shell commands. {draft.length}/8000</p>
              <button type="submit" className={button} disabled={!canInput || !draft.trim()}>Submit to CLI</button>
            </form>
          </div>}
        </div>
      </section>
    </div>
  );
}
