import type { RecentSession, WorkspaceInfo } from "@pi-outpost/shared";
import { sessionLabel } from "../util/sessionLabel";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "just now";
}

interface Props {
  workspaces: WorkspaceInfo[];
  recent: RecentSession[] | null;
  onOpenRecent: (session: RecentSession) => void;
  onStartChat: (root: string) => void;
  onOpenProject: () => void;
}

/**
 * What a new tab shows instead of whichever conversation it connected to: the newest
 * conversations across open projects, and where to start a new one.
 */
export function StartScreen({ workspaces, recent, onOpenRecent, onStartChat, onOpenProject }: Props) {
  const projects = workspaces.filter((workspace) => !workspace.sideOf);
  // Last used first: by each project's newest conversation listed, then the server's order.
  const rank = (root: string) => {
    const at = recent?.findIndex((session) => session.root === root) ?? -1;
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const chips = projects.map((project, index) => ({ project, index })).sort((a, b) => rank(a.project.root) - rank(b.project.root) || a.index - b.index);
  return (
    <div data-testid="start-screen" className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-6 md:py-12">
      <section aria-labelledby="start-recent">
        <h2 id="start-recent" className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Recent</h2>
        {recent === null ? (
          <p className="text-sm text-zinc-500" role="status">Loading recent conversations…</p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No saved conversations yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recent.map((session) => (
              <li key={session.path}>
                <button
                  type="button"
                  data-testid="start-recent-row"
                  onClick={() => onOpenRecent(session)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-2.5 text-left transition hover:-translate-y-px hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-800 dark:text-zinc-200">{sessionLabel(session)}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {session.projectName} · {relativeTime(session.modified)}
                    </span>
                  </span>
                  {(session.activity === "working" || session.activity === "idle") && (
                    <span
                      data-testid="start-recent-status"
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${session.activity === "working" ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}
                    >
                      {session.activity}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="start-new">
        <h2 id="start-new" className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Start a new chat in</h2>
        <div className="flex flex-wrap gap-2">
          {chips.map(({ project }) => (
            <button
              key={project.root}
              type="button"
              data-testid="start-project-chip"
              title={project.root}
              onClick={() => onStartChat(project.root)}
              className="min-h-11 max-w-full truncate rounded-full border border-zinc-200 px-4 text-sm text-zinc-800 transition hover:-translate-y-px hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {project.name}
            </button>
          ))}
          <button
            type="button"
            data-testid="start-open-project"
            onClick={onOpenProject}
            className="min-h-11 rounded-full border border-dashed border-zinc-300 px-4 text-sm text-zinc-600 transition hover:-translate-y-px hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Open a project…
          </button>
        </div>
      </section>
    </div>
  );
}
