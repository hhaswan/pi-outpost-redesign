import { useEffect, useId, useRef, useState } from "react";
import type { CliBridgeOperation, CliBridgeReply, CliBridgeSnapshot, CliBridgeSummary, CliHandoffSummary, CliReservationSummary } from "@pi-outpost/shared";
import { CopyButton } from "./CopyButton";

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
  const [handoffs, setHandoffs] = useState<CliHandoffSummary[]>([]);
  const [reservations, setReservations] = useState<CliReservationSummary[]>([]);
  const [closed, setClosed] = useState<NonNullable<CliBridgeReply["closed"]>>([]);
  const [released, setReleased] = useState<CliReservationSummary | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
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
    setConfirming(null);
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
    if (active.action === "list" && state.sessions) {
      setSessions(state.sessions); setHandoffs(state.handoffs ?? []); setReservations(state.reservations ?? []); setClosed(state.closed ?? []); setListed(true);
    }
    if (active.action === "release" && state.released) {
      setReleased(state.released);
      setReservations((current) => [state.released!, ...current.filter((entry) => entry.id !== state.released!.id)]);
      setNotice("Released to the CLI. The web started a new conversation and will not reopen this one until the CLI exits.");
    }
    if (active.action === "reclaim" && state.reclaimed) setNotice("Taken back. The conversation is open in web again.");
    if (active.action === "adopt" && state.resumed) setNotice("Continued in web using the original CLI session file.");
    if (active.action === "resume" && state.resumed) {
      setSelected(null);
      setNotice("Continued in web using the original session file. Close this panel to continue the conversation.");
    }
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
          <p className="text-sm">Opt-in enrolled CLI sessions only, not all OS processes. The CLI remains the sole writer until an explicitly confirmed handoff closes it.</p>
          <p className="text-xs text-zinc-500">Observation-only by default. The CLI operator grants input with <code>/outpost-bridge allow</code>. Closing this panel does not stop the CLI.</p>
          {!connected && <p role="status">Disconnected. Activity is unknown and input is disabled.</p>}
          {!selected && (pending || state?.loading) && <p role="status">Loading CLI response…</p>}
          {!selected && (formError || state?.error) && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError || state?.error}</p>}
          {!selected && notice && <p role="status" className="text-sm">{notice}</p>}
          {listed && !sessions.length && <p className="text-sm">{handoffs.length ? "No running enrolled CLI sessions. Released sessions are listed below." : <>No enrolled CLI sessions. Start a CLI with <code>pi -e &lt;bridge-extension&gt;</code>, then refresh the list.</>}</p>}
          <section aria-label="Hand off to CLI" className="space-y-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
            <h3 className="text-sm font-semibold">Continue this web conversation in the CLI</h3>
            <p className="text-xs text-zinc-500">The web leaves this conversation for a new one and reserves the file for one CLI with the Outpost bridge. Web cannot reopen it until that CLI exits; until a CLI opens it, you can take it back below.</p>
            {confirming === "release"
              ? <div className="flex flex-wrap gap-2"><button type="button" className={`${button} border-blue-500 text-blue-700 dark:text-blue-300`} disabled={locked} onClick={() => send({ action: "release" })}>Confirm hand off</button><button type="button" className={button} onClick={() => setConfirming(null)}>Cancel</button></div>
              : <button type="button" className={button} disabled={locked} onClick={() => setConfirming("release")}>Hand off to CLI</button>}
            {released && <div className="space-y-1">
              <p className="text-xs">Run in a terminal:</p>
              <div className="flex min-w-0 items-start gap-2 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-950"><code className="min-w-0 flex-1 break-all font-mono text-xs">{released.command}</code><CopyButton text={released.command} /></div>
            </div>}
            {reservations.length > 0 && <ul className="space-y-2" aria-label="Handed off to CLI">
              {reservations.map((entry) => <li key={entry.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-300 p-3 text-sm dark:border-zinc-700">
                <span className="min-w-0 flex-1 break-all">Session: {entry.sessionId}<span className="block text-xs text-zinc-500">{entry.state === "claimed" ? "Open in a running CLI" : entry.state === "waiting" ? "Waiting for a CLI to open it" : entry.state === "stale" ? "The CLI exited; open it from Sessions or take it back" : "Releasing…"}</span></span>
                {entry.state !== "claimed" && <CopyButton text={entry.command} />}
                <button type="button" className={button} disabled={locked || entry.state === "claimed" || entry.state === "releasing"} onClick={() => send({ action: "reclaim", id: entry.id })}>Take back in web</button>
              </li>)}
            </ul>}
          </section>
          <section aria-label="Released CLI sessions" className="space-y-2">
            <h3 className="text-sm font-semibold">Continue a CLI session in web</h3>
            <p className="text-xs text-zinc-500">In an older CLI, run <code>/reload</code> first. Then run <code>/outpost-bridge handoff</code> and confirm closing it. Refresh this list after the CLI exits. Use the project's main workspace, not a side session. Only released sessions for this project appear; the original file is reused.</p>
            <ul className="space-y-2">
              {handoffs.map((handoff) => <li key={handoff.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-300 p-3 text-sm dark:border-zinc-700">
                <span className="min-w-0 flex-1 break-all">Session: {handoff.sessionId}<span className="block text-xs text-zinc-500">{handoff.state === "releasing" ? "Waiting for CLI process exit" : handoff.state === "owned" ? "Reserved by web; continuation requires the owning workspace" : "Released; ready to continue"}</span></span>
                <button type="button" className={button} disabled={locked || handoff.state === "releasing"} onClick={() => send({ action: "resume", id: handoff.id })}>Continue in web</button>
              </li>)}
            </ul>
          </section>
          {closed.length > 0 && <section aria-label="Closed CLI sessions" className="space-y-2">
            <h3 className="text-sm font-semibold">Continue a closed CLI session</h3>
            <p className="text-xs text-zinc-500">For a CLI that has already exited. The server refuses while any Pi CLI still runs in this project, but cannot see an older CLI elsewhere: confirm it is closed.</p>
            <ul className="space-y-2">
              {closed.map((entry) => <li key={entry.path} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-300 p-3 text-sm dark:border-zinc-700">
                <span className="min-w-0 flex-1 break-words">{entry.title}<span className="block text-xs text-zinc-500">{new Date(entry.modified).toLocaleString()}</span></span>
                {confirming === entry.path
                  ? <><button type="button" className={`${button} border-blue-500 text-blue-700 dark:text-blue-300`} disabled={locked} onClick={() => send({ action: "adopt", path: entry.path })}>The CLI is closed — continue</button><button type="button" className={button} onClick={() => setConfirming(null)}>Cancel</button></>
                  : <button type="button" className={button} disabled={locked} onClick={() => setConfirming(entry.path)}>Continue in web</button>}
              </li>)}
            </ul>
          </section>}
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
              if (!canEdit) return;
              if (operation.current || state?.loading) { setFormError("Checking CLI status. Try Submit again after the check finishes."); return; }
              if (!draft.trim() || draft.length > 8000 || /^\s*[/!]/.test(draft)) { setFormError("Enter plain text (1–8000 characters), without a leading / or ! command."); return; }
              send({ action: "submit", id: selected, generation: current!.generation, inputId: crypto.randomUUID(), text: draft });
            }}>
              <label className="block text-sm">Message to CLI<textarea className="mt-1 block min-h-24 w-full min-w-0 rounded-xl border border-zinc-300 bg-transparent p-3 text-sm focus:outline-2 focus:outline-blue-500 disabled:opacity-50 dark:border-zinc-700" value={draft} maxLength={8000} disabled={!canEdit} onChange={(event) => setDraft(event.target.value)} /></label>
              <p className="text-xs text-zinc-500">Plain text only. No slash commands or shell commands. {draft.length}/8000</p>
              {(pending || state?.loading) && <p role="status" className="text-sm">{operation.current?.action === "submit" ? "Sending to CLI…" : "Checking CLI status…"}</p>}
              {(formError || state?.error) && <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError || state?.error}</p>}
              {notice && <p role="status" className="text-sm">{notice}</p>}
              <button type="submit" className={button} disabled={!canEdit || !draft.trim() || operation.current?.action === "submit"}>Submit to CLI</button>
            </form>
          </div>}
        </div>
      </section>
    </div>
  );
}
