import { useEffect, useRef, useState } from "react";
import type { McpConfigDocument, McpConfigScope, McpManagementOperation, McpManagementReply } from "@pi-outpost/shared";

const button = "min-h-9 rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";
const input = "w-full min-w-0 rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-sm focus:outline-2 focus:outline-blue-500 dark:border-zinc-700";
type State = (McpManagementReply & { loading: boolean }) | null;

export function MCPManager({ onClose, onRequest, state, busy, connected, onApply }: {
  onClose: () => void;
  onRequest: (operation: McpManagementOperation) => void;
  state: State;
  busy: boolean;
  connected: boolean;
  onApply: () => void;
}) {
  const request = useRef(onRequest);
  request.current = onRequest;
  const closeButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<{ scope: McpConfigScope; name: string; config: string; revision: string; existing: boolean } | null>(null);
  const [formError, setFormError] = useState("");
  const submitted = useRef<string | null>(null);
  const lastOperation = useRef<McpManagementOperation["action"]>("list");
  const send = (operation: McpManagementOperation) => { lastOperation.current = operation.action; request.current(operation); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    request.current({ action: "list" });
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (state?.loading) submitted.current = lastOperation.current === "save" ? state.requestId : null;
    else if (submitted.current === state?.requestId && state && !state.error) { setEditing(null); submitted.current = null; }
  }, [state]);
  const locked = !connected || busy || state?.loading || !state?.data?.editable;
  const documents = state?.data?.documents ?? [];
  const edit = (doc: McpConfigDocument, name = "") => {
    setFormError("");
    setEditing({ scope: doc.scope, name, config: JSON.stringify(name ? doc.servers[name] : { url: "https://example.com/mcp" }, null, 2), revision: doc.revision, existing: Boolean(name) });
  };
  const names = [...new Set([...(state?.data?.servers.map((server) => server.name) ?? []), ...documents.flatMap((doc) => Object.keys(doc.servers))])].sort();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="mcp-title" onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 id="mcp-title" className="min-w-0 flex-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">MCP servers</h2>
          <button type="button" className={button} disabled={!connected || state?.loading} onClick={() => send({ action: "list" })}>Refresh</button>
          <button ref={closeButton} type="button" className={button} aria-label="Close MCP manager" onClick={onClose}>✕</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5 text-zinc-800 dark:text-zinc-200">
          <p className="mb-4 text-xs leading-relaxed text-zinc-500">Live status comes from this session's MCP gateway. Configuration changes are saved to disk; apply them only when this session is idle. Secrets stay masked unless replaced.</p>
          {(!connected || busy) && <p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-300">{!connected ? "Disconnected. Reconnect before managing MCP servers." : "Session is working. Configuration and connection changes are disabled."}</p>}
          {state?.loading && <p role="status" className="mb-3 text-sm">Loading MCP servers…</p>}
          {(state?.error || formError) && <p role="alert" className="mb-3 break-words rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError || state?.error}</p>}
          {state?.message && <p role="status" className="mb-3 text-sm">{state.message}</p>}
          {state?.data?.statusError && <p role="status" className="mb-3 break-words text-sm text-amber-700 dark:text-amber-300">{state.data.statusError}</p>}
          {state?.data && !state.data.editable && <p className="mb-3 text-sm">MCP changes are locked by this server's security policy.</p>}
          <div className="space-y-2">
            {names.map((name) => {
              const live = state?.data?.servers.find((server) => server.name === name);
              const sources = documents.filter((doc) => Object.hasOwn(doc.servers, name));
              return <article key={name} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><h3 className="break-all text-sm font-medium">{name}</h3><p className="text-xs text-zinc-500">{live ? `${live.status} · ${live.toolCount} tools${live.listenState ? ` · ${live.listenState}` : ""}` : "Saved configuration; not loaded in this session"}</p></div>
                  <button className={button} type="button" disabled={locked || !live} onClick={() => send({ action: "connect", name })}>Connect</button>
                </div>
                {sources.map((doc) => <div key={doc.scope} className="mt-2 flex flex-wrap items-center gap-2">
                  <span title={doc.path} className="min-w-0 flex-1 break-all text-xs text-zinc-500">{doc.scope}</span>
                  <button type="button" className={button} disabled={locked} onClick={() => edit(doc, name)}>Edit {doc.scope}</button>
                  <button type="button" className={button} disabled={locked} onClick={() => {
                    if (window.confirm(`Remove ${name} from ${doc.scope}? Other definitions of this name remain. The running connection is unchanged until you apply configuration.`)) send({ action: "remove", name, scope: doc.scope, revision: doc.revision });
                  }}>Remove {doc.scope}</button>
                </div>)}
              </article>;
            })}
          </div>
          {state?.data && !names.length && <p className="py-4 text-sm text-zinc-500">No MCP servers configured.</p>}
          {!editing && <button type="button" className={`${button} mt-4`} disabled={locked} onClick={() => { const doc = documents.find((entry) => entry.scope === "project"); if (doc) edit(doc); }}>+ Add server</button>}
          {editing && <form className="mt-4 space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700" onSubmit={(event) => {
            event.preventDefault();
            try {
              const config: unknown = JSON.parse(editing.config);
              if (typeof config !== "object" || !config || Array.isArray(config)) throw new Error("Configuration must be a JSON object");
              if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(editing.name)) throw new Error("Use a server name containing letters, numbers, dots, underscores or hyphens");
              if (!editing.existing && documents.some((doc) => doc.scope === editing.scope && Object.hasOwn(doc.servers, editing.name))) throw new Error("This server name already exists in this scope; use Edit instead");
              setFormError(""); send({ action: "save", scope: editing.scope, name: editing.name, revision: editing.revision, config: config as Record<string, unknown>, ...(!editing.existing ? { create: true } : {}) });
            } catch (error) { setFormError(error instanceof SyntaxError ? "Invalid JSON configuration" : error instanceof Error ? error.message : "Invalid configuration"); }
          }}>
            <label className="block space-y-1 text-xs"><span>Server name</span><input aria-label="Server name" className={input} value={editing.name} disabled={editing.existing || locked} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label className="block space-y-1 text-xs"><span>Configuration scope</span><select aria-label="Configuration scope" className={input} value={editing.scope} disabled={editing.existing || locked} onChange={(event) => {
              const doc = documents.find((entry) => entry.scope === event.target.value);
              if (doc) setEditing({ ...editing, scope: doc.scope, revision: doc.revision });
            }}>{documents.map((doc) => <option key={doc.scope} value={doc.scope}>{doc.scope}</option>)}</select></label>
            <label className="block space-y-1 text-xs"><span>Server configuration (JSON)</span><textarea aria-label="Server configuration (JSON)" className={`${input} min-h-40 font-mono text-xs`} spellCheck={false} value={editing.config} disabled={locked} onChange={(event) => setEditing({ ...editing, config: event.target.value })} /></label>
            <p className="text-xs text-zinc-500">Use {`{"url":"https://host/mcp"}`} or {`{"command":"executable","args":[]}`}. Only configure servers you trust. A command runs as the server account when connected.</p>
            {documents.find((doc) => doc.scope === editing.scope)?.revision !== editing.revision && <div className="space-y-2 text-xs text-amber-700 dark:text-amber-300">
              <p>Configuration changed. Your draft is preserved. Review it against the refreshed configuration before retrying.</p>
              <button type="button" className={button} disabled={locked} onClick={() => {
                const doc = documents.find((entry) => entry.scope === editing.scope);
                if (doc && window.confirm("Use the refreshed revision for this draft? Masked fields will retain values from the latest configuration. Review replacements before saving.")) setEditing({ ...editing, revision: doc.revision });
              }}>Use refreshed revision</button>
            </div>}
            <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={locked}>Save configuration</button><button type="button" className={button} onClick={() => setEditing(null)}>Cancel</button></div>
          </form>}
          {state?.reloadRequired && <button type="button" className={`${button} mt-4`} disabled={locked} onClick={() => {
            if (window.confirm("Restart this idle Pi session to apply saved MCP configuration? This does not restart the systemd service.")) onApply();
          }}>Apply saved configuration</button>}
        </div>
      </section>
    </div>
  );
}
