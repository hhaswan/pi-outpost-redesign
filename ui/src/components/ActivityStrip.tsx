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
export function ActivityStrip({ state, onSwitchWorkspace }: {
  state: ActivityState;
  onSwitchWorkspace?: (root: string, id?: string) => void;
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
    <section aria-label="Activity" className="min-w-0 shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="mx-auto flex max-w-3xl min-w-0 flex-col gap-1 rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0">
          <p className="font-semibold">{activityLabel(state)}</p>
          <p className="break-words text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">
            {state.switching || !known ? "Last viewed: " : ""}{project} · {session}
          </p>
        </div>
        {others.length > 0 && (
          <div aria-label="Other project activity" className="flex min-w-0 flex-wrap items-center gap-1">
            <span>Other projects / sessions:</span>
            {others.map((workspace) => {
              const identity = workspaceKey(workspace);
              const text = `${workspace.name}${workspace.label ? ` · ${workspace.label}` : ""} · ${labels[workspace.activity]}`;
              const classes = "max-w-full rounded-full border border-zinc-300 px-2 py-1 text-left [overflow-wrap:anywhere] dark:border-zinc-700";
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
          <p title={lastError} className="truncate text-amber-700 dark:text-amber-400">Last error: {lastError}</p>
        )}
      </div>
    </section>
  );
}
