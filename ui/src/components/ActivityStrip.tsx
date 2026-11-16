import type { WorkspaceActivity } from "@pi-outpost/shared";
import type { AgentState } from "../useAgent";
import { workspaceKey } from "../util/workspaceKey";

type ActivityState = Pick<AgentState,
  "connected" | "authRequired" | "switching" | "agentStarting" | "workspace" | "workspaces" |
  "sessionId" | "sessionName" | "isStreaming" | "pendingPrompt" | "dialogQueue" | "errors"
>;

const labels: Record<WorkspaceActivity, string> = {
  stopped: "Stopped",
  starting: "Starting agent",
  idle: "Idle",
  working: "Working",
  waiting: "Waiting for you",
  "ready-for-review": "Ready for review",
};

function activityLabel(state: ActivityState): string {
  if (state.authRequired) return "Authentication required · activity unknown";
  if (!state.connected) return "Disconnected · activity unknown";
  if (state.switching) return "Switching project";
  if (state.agentStarting || state.workspace?.activity === "starting") return labels.starting;
  if (state.dialogQueue.length || state.workspace?.activity === "waiting") return labels.waiting;
  if (state.isStreaming || state.pendingPrompt || state.workspace?.activity === "working") return labels.working;
  if (state.workspace) return labels[state.workspace.activity];
  return state.sessionId ? labels.idle : "Connected · activity unknown";
}

/** Live transport/workspace state only. Transcript text is not activity telemetry. */
export function ActivityStrip({ state, onSwitchWorkspace, compact = false }: {
  state: ActivityState;
  onSwitchWorkspace?: (root: string, id?: string) => void;
  /**
   * The phone layout. The project and session are already in the header above it,
   * so they are kept for screen readers only. Wider screens show them on the same
   * one line, cut with an ellipsis.
   */
  compact?: boolean;
}) {
  const known = state.connected && !state.authRequired;
  const others = known ? state.workspaces.filter((workspace) =>
    (!state.workspace || workspaceKey(workspace) !== workspaceKey(state.workspace)) &&
    workspace.activity !== "idle" && workspace.activity !== "stopped",
  ) : [];
  const project = state.workspace?.name ?? "Current project";
  const session = state.sessionName || state.workspace?.label || state.sessionId || "Session not yet available";
  const lastError = state.errors.at(-1);

  return (
    <section aria-label="Activity" data-compact={compact || undefined} className="min-w-0 shrink-0 border-b border-zinc-200 px-3 py-1 dark:border-zinc-800">
      <div className={`mx-auto flex max-w-3xl min-w-0 items-center gap-2 whitespace-nowrap text-xs text-zinc-700 dark:text-zinc-200 ${compact ? "overflow-x-auto [scrollbar-width:none]" : ""}`}>
        <div role="status" aria-live="polite" aria-atomic="true" className={`flex items-center gap-1 ${compact ? "shrink-0 [&>p]:inline" : "min-w-0 [&>p+p]:before:content-['·_'] [&>p]:truncate"}`}>
          <p className="font-semibold">{activityLabel(state)}</p>
          {known && state.workspace?.backgroundAgents && (!state.workspace.backgroundAgents.known || state.workspace.backgroundAgents.running + state.workspace.backgroundAgents.queued > 0) && (
            <p>{state.workspace.backgroundAgents.known
              ? `Background agents: ${state.workspace.backgroundAgents.running} running · ${state.workspace.backgroundAgents.queued} queued`
              : "Background agent activity uncertain"}</p>
          )}
          <p className={compact ? "sr-only" : "min-w-0 text-zinc-600 dark:text-zinc-400"} title={compact ? undefined : `${project} · ${session}`}>
            {state.switching || !known ? "Last viewed: " : ""}{project} · {session}
          </p>
        </div>
        {others.length > 0 && (
          <div aria-label="Other project activity" className={`flex min-w-0 items-center gap-1 ${compact ? "shrink-0" : "overflow-x-auto [scrollbar-width:none]"}`}>
            <span className="shrink-0">{compact ? "Other projects / sessions:" : "· other:"}</span>
            {others.map((workspace) => {
              const identity = workspaceKey(workspace);
              const text = `${workspace.name}${workspace.label ? ` · ${workspace.label}` : ""} · ${labels[workspace.activity]}`;
              const classes = `rounded-full border border-zinc-300 px-2 text-left dark:border-zinc-700 ${compact ? "max-w-full min-h-11 shrink-0 py-1 [overflow-wrap:anywhere]" : "max-w-[16rem] shrink-0 truncate py-0.5"}`;
              return onSwitchWorkspace ? (
                <button key={identity} type="button" disabled={state.switching} title={identity}
                  aria-label={`${text} (${identity})`} onClick={() => onSwitchWorkspace(workspace.root, workspace.id)}
                  className={`${classes} hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:hover:bg-zinc-800`}>
                  {text}
                </button>
              ) : <span key={identity} title={identity} className={classes}>{text}</span>;
            })}
          </div>
        )}
        {lastError && !state.switching && (
          <p title={lastError} className="min-w-0 truncate text-amber-700 dark:text-amber-400">Last error: {lastError}</p>
        )}
      </div>
    </section>
  );
}
