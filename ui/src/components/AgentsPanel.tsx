import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ModelChoice, SubagentChanges, SubagentEntry, SubagentManagementData, SubagentManagementOperation, SubagentManagementReply,
  SubagentScope, SubagentSkills, SubagentSource,
} from "@pi-outpost/shared";
import { ModelPicker } from "./ModelPicker";
import { Sheet } from "./Sheet";
import { TOUCH_ROW, TOUCH_TARGET } from "../touch";

type State = (SubagentManagementReply & { loading: boolean }) | null;

const BUTTON = `inline-flex min-h-9 items-center justify-center rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 ${TOUCH_TARGET}`;
const PRIMARY = `inline-flex min-h-9 items-center justify-center rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 ${TOUCH_TARGET}`;
const DANGER = `inline-flex min-h-9 items-center justify-center rounded-full border border-red-300 px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40 ${TOUCH_TARGET}`;
const INPUT = "min-h-11 w-full min-w-0 rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 focus:outline-2 focus:outline-blue-500 dark:border-zinc-700 dark:text-zinc-100";
const CHIP = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";
const CARD = "rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800";
const CHECK_ROW = `flex items-start gap-2 rounded-xl px-2 py-1.5 text-sm ${TOUCH_ROW}`;
const SECTION_TITLE = "mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500";

export const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const NAME_RULE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SOURCE_LABEL: Record<SubagentSource, string> = { builtin: "Built-in", package: "Package", global: "Global", shared: "Shared .agents", project: "Project" };
const DISCLAIMER = "Tool and skill limits shape what this agent is offered. They are not a security sandbox: a sub-agent with bash can read any file the server can, and every sub-agent runs with this session's privileges.";

interface Draft {
  description: string;
  enabled: boolean;
  skillsMode: "all" | "none" | "selected";
  skills: string[];
  toolsMode: "default" | "custom";
  toolsAll: boolean;
  tools: string[];
  toolsExtra: string;
  model: string | null;
  thinking: string | null;
  promptMode: "replace" | "append";
  prompt: string;
}

/** The tools field split as pi-subagents reads it: built-ins (any case), the `all`/`*` wildcard, and everything else. */
function splitTools(raw: string | undefined) {
  const entries = (raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean).filter((entry) => entry !== "none");
  const all = entries.some((entry) => entry === "*" || entry.toLowerCase() === "all");
  const tools = BUILTIN_TOOLS.filter((tool) => entries.some((entry) => entry.toLowerCase() === tool));
  const extra = entries.filter((entry) => entry !== "*" && entry.toLowerCase() !== "all" && !BUILTIN_TOOLS.includes(entry.toLowerCase() as typeof BUILTIN_TOOLS[number]));
  return { all, tools, extra };
}

function draftOf(entry: SubagentEntry): Draft {
  const split = splitTools(entry.tools);
  return {
    description: entry.description,
    enabled: entry.enabled,
    skillsMode: entry.skills === true ? "all" : entry.skills === false ? "none" : "selected",
    skills: Array.isArray(entry.skills) ? entry.skills : [],
    toolsMode: entry.tools === undefined ? "default" : "custom",
    toolsAll: split.all,
    tools: split.tools,
    toolsExtra: split.extra.join(", "),
    model: entry.model ?? null,
    thinking: entry.thinking ?? null,
    promptMode: entry.promptMode,
    prompt: entry.prompt,
  };
}

const sameSkills = (a: SubagentSkills, b: SubagentSkills) => (Array.isArray(a) && Array.isArray(b) ? a.join(",") === b.join(",") : a === b);

/** Only what the user changed, so the server rewrites only those keys. */
export function changesOf(entry: SubagentEntry, draft: Draft): SubagentChanges {
  const changes: SubagentChanges = {};
  if (draft.description !== entry.description) changes.description = draft.description;
  if (draft.enabled !== entry.enabled) changes.enabled = draft.enabled;
  const skills: SubagentSkills = draft.skillsMode === "all" ? true : draft.skillsMode === "none" || draft.skills.length === 0 ? false : draft.skills;
  if (!sameSkills(skills, entry.skills)) changes.skills = skills;
  const tools = draft.toolsMode === "default" ? null
    : [...(draft.toolsAll ? ["all"] : BUILTIN_TOOLS.filter((tool) => draft.tools.includes(tool))), ...draft.toolsExtra.split(",").map((entry) => entry.trim()).filter(Boolean)].join(", ");
  const before = draftOf(entry);
  const toolsChanged = draft.toolsMode !== before.toolsMode || (draft.toolsMode === "custom"
    && (draft.toolsAll !== before.toolsAll || draft.tools.join() !== before.tools.join() || draft.toolsExtra.trim() !== before.toolsExtra));
  if (toolsChanged) changes.tools = tools;
  if (draft.model !== (entry.model ?? null)) changes.model = draft.model;
  if (draft.thinking !== (entry.thinking ?? null)) changes.thinking = draft.thinking as SubagentChanges["thinking"];
  if (draft.promptMode !== entry.promptMode) changes.promptMode = draft.promptMode;
  if (draft.prompt !== entry.prompt) changes.prompt = draft.prompt;
  return changes;
}

type Selection = { scope?: SubagentScope; file?: string; source: SubagentSource; name: string; path?: string };
const selectionOf = (entry: SubagentEntry): Selection => ({ ...(entry.scope ? { scope: entry.scope, file: entry.file } : {}), source: entry.source, name: entry.name, ...(entry.path ? { path: entry.path } : {}) });
function find(data: SubagentManagementData | null, selection: Selection | null): SubagentEntry | undefined {
  if (!data || !selection) return undefined;
  return data.agents.find((entry) => selection.scope
    ? entry.scope === selection.scope && entry.file === selection.file
    : entry.source === selection.source && entry.name === selection.name && entry.path === selection.path);
}

type NameForm = { mode: "create" | "duplicate" | "rename"; scope: SubagentScope; value: string; from?: SubagentEntry };

export function AgentsPanel({ state, models, connected, phone, onRequest, onClose }: {
  state: State;
  models: ModelChoice[];
  connected: boolean;
  phone: boolean;
  onRequest: (operation: SubagentManagementOperation) => void;
  onClose: () => void;
}) {
  const request = useRef(onRequest);
  request.current = onRequest;
  const [data, setData] = useState<SubagentManagementData | null>(state?.data ?? null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<{ base: SubagentEntry; value: Draft } | null>(null);
  const [nameForm, setNameForm] = useState<NameForm | null>(null);
  const [filter, setFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [runPrompt, setRunPrompt] = useState("");
  const [runResult, setRunResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ op: SubagentManagementOperation; previous?: string; requestId?: string } | null>(null);
  const initial = useRef(state?.requestId);

  const send = (op: SubagentManagementOperation) => {
    if (pending.current || !connected) return;
    pending.current = { op, previous: state?.requestId ?? initial.current };
    setBusy(true);
    setError("");
    setNotice("");
    if (op.action !== "spawn") setRunResult(null);
    request.current(op);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => { if (connected) sendRef.current({ action: "list" }); }, [connected]);

  const entry = find(data, selection);

  // Settle the request this panel sent; a reset (session replaced, reconnect) leaves its outcome unknown.
  useEffect(() => {
    const active = pending.current;
    if (!active) return;
    if (!state) {
      pending.current = null;
      setBusy(false);
      if (active.op.action !== "list") setNotice("The connection reset before the reply; the list is refreshed. Check the agent before retrying.");
      if (connected) sendRef.current({ action: "list" });
      return;
    }
    if (state.requestId === active.previous) return;
    if (state.loading) { active.requestId = state.requestId; return; }
    if (active.requestId && state.requestId !== active.requestId) return;
    pending.current = null;
    setBusy(false);
    if (state.data) setData(state.data);
    const op = active.op;
    if (op.action === "spawn") {
      setRunResult(state.error ? { ok: false, text: state.error } : { ok: true, text: `Started as ${state.spawnedId}` });
      return;
    }
    if (state.error) {
      setError(state.error);
      if (state.conflict) setConflict(true);
      return;
    }
    if (state.message && op.action !== "list") setNotice(state.message);
    if (op.action === "create" || op.action === "duplicate") { setNameForm(null); setSelection({ scope: op.scope, file: op.name, source: op.scope, name: op.name }); setDraft(null); }
    if (op.action === "rename") { setNameForm(null); setSelection({ scope: op.scope, file: op.to, source: op.scope, name: op.to }); setDraft(null); }
    if (op.action === "delete") { setSelection(null); setDraft(null); }
    if (op.action === "save") { setDraft(null); setConflict(false); }
  }, [state, connected]);

  // A writable agent's draft follows the file until the user edits it.
  useEffect(() => {
    if (!entry?.scope) { if (draft) setDraft(null); return; }
    const dirty = draft && Object.keys(changesOf(draft.base, draft.value)).length > 0;
    if (!draft || draft.base.scope !== entry.scope || draft.base.file !== entry.file || (!dirty && draft.base.hash !== entry.hash)) setDraft({ base: entry, value: draftOf(entry) });
  }, [entry, draft]);

  const dirty = Boolean(draft && Object.keys(changesOf(draft.base, draft.value)).length > 0);
  const locked = !connected || busy;
  const back = () => {
    if (dirty && !window.confirm("Discard unsaved changes to this agent?")) return;
    setSelection(null); setDraft(null); setConflict(false); setError(""); setNotice(""); setRunResult(null); setNameForm(null);
  };
  const close = () => {
    if (dirty && !window.confirm("Discard unsaved changes to this agent?")) return;
    onClose();
  };

  const agents = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (data?.agents ?? []).filter((agent) => !query || `${agent.name} ${agent.description}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, filter]);

  const nameTaken = (scope: SubagentScope, name: string) => Boolean(data?.agents.some((agent) => agent.scope === scope && agent.file === name));
  const startCopy = (from: SubagentEntry, scope: SubagentScope) => {
    const value = nameTaken(scope, from.name) || !NAME_RULE.test(from.name) ? `${from.name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "")}-copy` : from.name;
    setNameForm({ mode: "duplicate", scope, value, from });
  };
  const submitName = () => {
    if (!nameForm) return;
    const name = nameForm.value.trim();
    if (!NAME_RULE.test(name)) { setError("Names use letters, digits, '.', '_' or '-', start with a letter or digit, at most 128 characters."); return; }
    if (nameForm.mode === "create") send({ action: "create", scope: nameForm.scope, name });
    else if (nameForm.mode === "duplicate" && nameForm.from) send({ action: "duplicate", from: { source: nameForm.from.source, name: nameForm.from.name }, scope: nameForm.scope, name });
    else if (nameForm.mode === "rename" && entry?.scope && entry.file && entry.hash) send({ action: "rename", scope: entry.scope, name: entry.file, to: name, hash: entry.hash });
  };

  const status = (
    <div className="space-y-2" aria-live="polite">
      {!connected && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Disconnected. Reconnect to manage agents.</p>}
      {busy && <p role="status" className="text-sm text-zinc-500">Working…</p>}
      {error && <div role="alert" className="break-words rounded-2xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
        {error}
        {conflict && entry && <button type="button" className={`${BUTTON} ml-2 mt-2`} onClick={() => { setDraft({ base: entry, value: draftOf(entry) }); setConflict(false); setError(""); }}>Reload from disk</button>}
      </div>}
      {notice && <p role="status" className="break-words text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    </div>
  );

  const nameFormView = nameForm && (
    <form className={`${CARD} space-y-3`} onSubmit={(event) => { event.preventDefault(); submitName(); }}>
      <p className="text-sm font-medium">{nameForm.mode === "create" ? "New agent" : nameForm.mode === "rename" ? `Rename ${entry?.file}` : `Copy ${nameForm.from?.name}`}</p>
      {nameForm.mode !== "rename" && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Scope</legend>
          {(["global", "project"] as const).map((scope) => (
            <label key={scope} className={`${CHECK_ROW} items-center`}>
              <input type="radio" name="agent-scope" checked={nameForm.scope === scope} onChange={() => setNameForm({ ...nameForm, scope })} />
              {scope === "global" ? "Global (all projects)" : "This project"}
            </label>
          ))}
        </fieldset>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-zinc-500">Name (file name and agent type)</span>
        <input aria-label="Agent name" autoFocus className={INPUT} value={nameForm.value} spellCheck={false} autoCapitalize="none" onChange={(event) => setNameForm({ ...nameForm, value: event.target.value })} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={locked}>{nameForm.mode === "create" ? "Create" : nameForm.mode === "rename" ? "Rename agent" : "Copy"}</button>
        <button type="button" className={BUTTON} onClick={() => { setNameForm(null); setError(""); }}>Cancel</button>
      </div>
    </form>
  );

  const chips = (agent: SubagentEntry) => (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${CHIP} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>{SOURCE_LABEL[agent.source]}{agent.packageName ? ` · ${agent.packageName}` : ""}</span>
      {!agent.enabled && <span className={`${CHIP} bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300`}>Disabled</span>}
      {agent.overrides && <span className={`${CHIP} bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300`}>Overrides {SOURCE_LABEL[agent.overrides].toLowerCase()}</span>}
      {agent.overriddenBy && <span className={`${CHIP} bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`}>Overridden by {SOURCE_LABEL[agent.overriddenBy].toLowerCase()}</span>}
      {agent.error && <span className={`${CHIP} bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300`}>Not loaded</span>}
    </div>
  );

  const list = (
    <div className="space-y-4">
      {data?.loaded === false && <p role="status" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">pi-subagents is not loaded in this project. Agent files can still be edited; Run is unavailable.</p>}
      {status}
      {nameForm?.mode !== "rename" && nameFormView}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Filter agents" placeholder="Filter agents…" className={`${INPUT} flex-1 basis-48`} value={filter} onChange={(event) => setFilter(event.target.value)} />
        <button type="button" className={PRIMARY} disabled={locked} onClick={() => { setError(""); setNameForm({ mode: "create", scope: "global", value: "" }); }}>+ New agent</button>
      </div>
      {!data && <p className="text-sm text-zinc-500">Loading agents…</p>}
      {data && agents.length === 0 && <p className="py-4 text-sm text-zinc-500">No agents{filter ? " match" : ""}. pi-subagents' built-in agents appear when the package is configured.</p>}
      <ul className="space-y-3" aria-label="Agents">
        {agents.map((agent) => (
          <li key={agent.path ?? `${agent.source}:${agent.name}`} className={`${CARD} ${agent.active ? "" : "opacity-70"}`} data-testid="agent-card">
            <div className="flex items-start gap-3">
              {agent.color && <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />}
              <div className="min-w-0 flex-1 space-y-1.5">
                <h3 className="break-all text-sm font-semibold text-zinc-900 dark:text-zinc-100">{agent.name}{agent.file && agent.file !== agent.name ? <span className="ml-1 font-normal text-zinc-500">({agent.file}.md)</span> : null}</h3>
                {chips(agent)}
                <p className="line-clamp-2 break-words text-xs text-zinc-600 dark:text-zinc-400">{agent.description}</p>
                {agent.path && <p className="break-all text-[11px] text-zinc-400">{agent.path}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BUTTON} aria-label={`${agent.scope ? "Edit" : "View"} ${agent.name} (${SOURCE_LABEL[agent.source]})`} onClick={() => { setError(""); setNotice(""); setSelection(selectionOf(agent)); }}>{agent.scope ? "Edit" : "View"}</button>
              {agent.scope && agent.file && agent.hash && (
                <button type="button" className={BUTTON} disabled={locked} aria-label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`} onClick={() => send({ action: "save", scope: agent.scope!, name: agent.file!, hash: agent.hash!, changes: { enabled: !agent.enabled } })}>{agent.enabled ? "Disable" : "Enable"}</button>
              )}
              {!agent.scope && !agent.error && (["global", "project"] as const).map((scope) => (
                <button key={scope} type="button" className={BUTTON} disabled={locked} onClick={() => startCopy(agent, scope)}>Copy to {scope}</button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, value: { ...current.value, ...patch } } : current));

  const detail = entry && (() => {
    const value = draft?.value;
    const editable = Boolean(entry.scope && value);
    const attached = value ? value.skills : Array.isArray(entry.skills) ? entry.skills : [];
    const known = new Set((data?.skills ?? []).map((skill) => skill.name));
    const skillRows = [
      ...(data?.skills ?? []),
      ...attached.filter((name) => !known.has(name)).map((name) => ({ name, available: false, reason: "Not found: no skill with this name in any sub-agent skill root", missing: true })),
    ].filter((skill) => !skillFilter.trim() || skill.name.toLowerCase().includes(skillFilter.trim().toLowerCase()));
    const field = (label: string, control: ReactNode) => <div className="space-y-1"><span className="block text-xs text-zinc-500">{label}</span>{control}</div>;
    const canRun = Boolean(data?.canRun) && entry.enabled && entry.active && !entry.error;
    const runReason = !data?.canRun ? data?.runUnavailableReason : entry.error ? "pi-subagents does not load this file" : !entry.active ? `Overridden by the ${SOURCE_LABEL[entry.overriddenBy!].toLowerCase()} agent of the same name; run that one` : !entry.enabled ? "Enable the agent to run it" : undefined;
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          {chips(entry)}
          {entry.path && <p className="break-all text-xs text-zinc-500">{entry.path}</p>}
          {entry.error && <p className="text-sm text-red-700 dark:text-red-300">{entry.error}</p>}
        </div>
        {status}
        <div className="flex flex-wrap gap-2">
          {entry.scope && entry.file && entry.hash && <>
            <button type="button" className={BUTTON} disabled={locked || dirty} onClick={() => setNameForm({ mode: "rename", scope: entry.scope!, value: entry.file! })}>Rename</button>
            <button type="button" className={DANGER} disabled={locked} onClick={() => {
              if (window.confirm(`Delete ${entry.file}.md from ${entry.scope === "global" ? "global agents" : "this project"}? This cannot be undone.`)) send({ action: "delete", scope: entry.scope!, name: entry.file!, hash: entry.hash! });
            }}>Delete</button>
          </>}
          {!entry.error && (["global", "project"] as const).filter((scope) => scope !== entry.scope).map((scope) => (
            <button key={scope} type="button" className={BUTTON} disabled={locked} onClick={() => startCopy(entry, scope)}>Copy to {scope}</button>
          ))}
        </div>
        {nameFormView}

        {editable && value ? (
          <form className="space-y-5" onSubmit={(event) => {
            event.preventDefault();
            if (!draft || !entry.scope || !entry.file || !draft.base.hash) return;
            const changes = changesOf(draft.base, draft.value);
            if (Object.keys(changes).length) send({ action: "save", scope: entry.scope, name: entry.file, hash: draft.base.hash, changes });
          }}>
            <section className={`${CARD} space-y-3`}>
              {field("Description", <input aria-label="Description" className={INPUT} value={value.description} onChange={(event) => set({ description: event.target.value })} />)}
              <label className={`${CHECK_ROW} items-center`}><input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> Enabled</label>
            </section>

            <section className={CARD} aria-labelledby="agent-skills-title">
              <h4 id="agent-skills-title" className={SECTION_TITLE}>Skills</h4>
              <fieldset className="flex flex-wrap gap-x-3">
                <legend className="sr-only">Skills mode</legend>
                {([["all", "All skills"], ["none", "No skills"], ["selected", "Only selected"]] as const).map(([mode, label]) => (
                  <label key={mode} className={`${CHECK_ROW} items-center`}><input type="radio" name="skills-mode" checked={value.skillsMode === mode} onChange={() => set({ skillsMode: mode })} /> {label}</label>
                ))}
              </fieldset>
              <input aria-label="Search skills" placeholder="Search skills…" className={`${INPUT} my-2`} value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)} />
              <ul className="max-h-72 space-y-0.5 overflow-y-auto" aria-label="Skills">
                {skillRows.map((skill) => {
                  const effective = value.skillsMode === "all" ? (data?.skills ?? []).filter((one) => one.available).map((one) => one.name) : value.skillsMode === "none" ? [] : value.skills;
                  const checked = effective.includes(skill.name);
                  // Ticking from All or None switches to a selection that starts from what is shown.
                  const selectable = skill.available || checked;
                  const note = "missing" in skill ? skill.reason : !skill.available ? skill.reason : skill.projectOnly && entry.scope === "global" ? "Project skill: resolves only in projects that contain it" : undefined;
                  return (
                    <li key={skill.name}>
                      <label className={`${CHECK_ROW} ${selectable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : "text-zinc-400"}`}>
                        <input type="checkbox" className="mt-1" checked={checked} disabled={!selectable} onChange={(event) => set({ skillsMode: "selected", skills: event.target.checked ? [...effective, skill.name] : effective.filter((name) => name !== skill.name) })} />
                        <span className="min-w-0"><span className="break-all">{skill.name}</span>{note && <span className={`block text-xs ${"missing" in skill ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{note}</span>}</span>
                      </label>
                    </li>
                  );
                })}
                {skillRows.length === 0 && <li className="px-2 py-1 text-sm text-zinc-500">No skills found.</li>}
              </ul>
            </section>

            <section className={CARD} aria-labelledby="agent-tools-title">
              <h4 id="agent-tools-title" className={SECTION_TITLE}>Tools</h4>
              <fieldset className="flex flex-wrap gap-x-3">
                <legend className="sr-only">Tools mode</legend>
                <label className={`${CHECK_ROW} items-center`}><input type="radio" name="tools-mode" checked={value.toolsMode === "default"} onChange={() => set({ toolsMode: "default" })} /> Default (all built-in tools)</label>
                <label className={`${CHECK_ROW} items-center`}><input type="radio" name="tools-mode" checked={value.toolsMode === "custom"} onChange={() => set({ toolsMode: "custom" })} /> Allow-list</label>
              </fieldset>
              {value.toolsMode === "custom" && <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-x-3">
                  <label className={`${CHECK_ROW} items-center`}><input type="checkbox" checked={value.toolsAll} onChange={(event) => set({ toolsAll: event.target.checked })} /> all built-ins</label>
                  {BUILTIN_TOOLS.map((tool) => (
                    <label key={tool} className={`${CHECK_ROW} items-center font-mono ${value.toolsAll ? "text-zinc-400" : ""}`}>
                      <input type="checkbox" disabled={value.toolsAll} checked={value.toolsAll || value.tools.includes(tool)} onChange={(event) => set({ tools: event.target.checked ? [...value.tools, tool] : value.tools.filter((name) => name !== tool) })} /> {tool}
                    </label>
                  ))}
                </div>
                {field("Other entries, comma-separated (ext:…, mcp__…)", <input aria-label="Other tool entries" className={`${INPUT} font-mono`} spellCheck={false} autoCapitalize="none" value={value.toolsExtra} onChange={(event) => set({ toolsExtra: event.target.value })} />)}
              </div>}
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">{DISCLAIMER}</p>
            </section>

            <section className={`${CARD} space-y-3`} aria-label="Model and prompt">
              {field("Model", <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={BUTTON} aria-pressed={value.model === null} onClick={() => set({ model: null })}>Inherit</button>
                <ModelPicker model={value.model ?? ""} placeholder="Choose a model…" models={models} disabled={locked} onSetModel={(provider, id) => set({ model: `${provider}/${id}` })} />
              </div>)}
              <div className="grid gap-3 sm:grid-cols-2">
                {field("Thinking", <select aria-label="Thinking" className={INPUT} value={value.thinking ?? ""} onChange={(event) => set({ thinking: event.target.value || null })}>
                  <option value="">Inherit</option>
                  {THINKING.map((level) => <option key={level} value={level}>{level}</option>)}
                  {value.thinking && !THINKING.includes(value.thinking as typeof THINKING[number]) && <option value={value.thinking}>{value.thinking}</option>}
                </select>)}
                {field("Prompt mode", <select aria-label="Prompt mode" className={INPUT} value={value.promptMode} onChange={(event) => set({ promptMode: event.target.value as Draft["promptMode"] })}>
                  <option value="replace">replace (this prompt only)</option>
                  <option value="append">append (after the parent's prompt)</option>
                </select>)}
              </div>
              {field("System prompt", <textarea aria-label="System prompt" rows={phone ? 8 : 12} className={`${INPUT} font-mono text-xs leading-relaxed`} value={value.prompt} onChange={(event) => set({ prompt: event.target.value })} />)}
            </section>

            {entry.otherFields.length > 0 && <section className={CARD}>
              <h4 className={SECTION_TITLE}>Other settings (kept as they are)</h4>
              <dl className="space-y-1 font-mono text-xs">{entry.otherFields.map((other) => <div key={other.key} className="break-all"><dt className="inline text-zinc-500">{other.key}: </dt><dd className="inline">{other.value}</dd></div>)}</dl>
            </section>}

            <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 bg-white/95 px-1 py-2 backdrop-blur dark:bg-zinc-900/95">
              <button type="submit" className={PRIMARY} disabled={locked || !dirty}>Save</button>
              <button type="button" className={BUTTON} disabled={!dirty} onClick={() => draft && setDraft({ base: draft.base, value: draftOf(draft.base) })}>Revert</button>
              {dirty && <span className="text-xs text-zinc-500">Unsaved changes</span>}
            </div>
          </form>
        ) : (
          <section className={`${CARD} space-y-2 text-sm`}>
            <p className="text-xs text-zinc-500">{entry.source === "package" || entry.source === "builtin" ? "Read-only: copy it to global or this project to change it. A copy with the same name overrides it." : "Read-only here: this file is outside the two writable agent folders."}</p>
            <p className="break-words">{entry.description}</p>
            <p className="font-mono text-xs">skills: {entry.skills === true ? "all" : entry.skills === false ? "none" : entry.skills.join(", ")}</p>
            <p className="font-mono text-xs">tools: {entry.tools ?? "default"}</p>
            {entry.model && <p className="font-mono text-xs">model: {entry.model}</p>}
            {entry.prompt && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-950">{entry.prompt}</pre>}
            <p className="text-xs leading-relaxed text-zinc-500">{DISCLAIMER}</p>
          </section>
        )}

        <section className={`${CARD} space-y-2`} aria-labelledby="agent-run-title">
          <h4 id="agent-run-title" className={SECTION_TITLE}>Run in this project</h4>
          {runReason && <p className="text-sm text-zinc-500" role="note">{runReason}</p>}
          <textarea aria-label="Run prompt" rows={3} className={INPUT} placeholder="What should the agent do?" value={runPrompt} disabled={!canRun} onChange={(event) => setRunPrompt(event.target.value)} />
          <button type="button" className={PRIMARY} disabled={!canRun || locked || !runPrompt.trim() || dirty} onClick={() => send({ action: "spawn", type: entry.name, prompt: runPrompt })}>Run</button>
          {dirty && canRun && <span className="ml-2 text-xs text-zinc-500">Save first: Run uses the file on disk.</span>}
          {runResult && <p role={runResult.ok ? "status" : "alert"} className={`break-words text-sm ${runResult.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{runResult.text}</p>}
        </section>
      </div>
    );
  })();

  const body = <div className="p-4 text-zinc-800 sm:p-5 dark:text-zinc-200">{entry ? detail : list}</div>;
  const title = entry ? entry.name : "Agents";
  const refresh = <button type="button" className={BUTTON} disabled={locked} onClick={() => send({ action: "list" })}>Refresh</button>;

  if (phone) {
    return <Sheet variant="full" title={title} testId="agents-sheet" closeLabel="Close agents" onClose={close} {...(entry ? { onBack: back, backLabel: "All agents" } : {})} actions={refresh}>{body}</Sheet>;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agents-title" data-testid="agents-dialog" onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {entry && <button type="button" className={BUTTON} aria-label="All agents" onClick={back}>‹ All agents</button>}
          <h2 id="agents-title" className="min-w-0 flex-1 truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {refresh}
          <button type="button" autoFocus className={BUTTON} aria-label="Close agents" onClick={close}>✕</button>
        </header>
        <div className="min-h-0 overflow-y-auto">{body}</div>
      </section>
    </div>
  );
}
