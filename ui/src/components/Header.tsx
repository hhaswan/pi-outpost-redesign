import { TOUCH_DESCENDANTS, TOUCH_TARGET } from "../touch";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PiPackageInfo, Theme } from "@pi-outpost/shared";
import type { AgentState } from "../useAgent";
import { MIN_SESSION_QUERY_LENGTH, type AgentResourceInventory, type GitUnavailable, type SessionSummary, type TreeNode, type WorkspaceInfo } from "@pi-outpost/shared";
import { ProjectMenu } from "./ProjectMenu";
import { WorkspaceRootControl, type WorkspaceRootSandbox } from "./WorkspaceRootControl";
import type { AgentResourceOperationState, GitHostCredentialState, GitLogState, GitStatusState, ServerBrowseState, SessionSearch, SettingsApplyState } from "../useAgent";
import { stripAnsi } from "../util/ansi";
import { sessionLabel } from "../util/sessionLabel";
import { AnsiText } from "./AnsiText";
import { useClickOutside } from "../util/clickOutside";
import {
  CONVERSATION_FILTER_KINDS,
  CONVERSATION_FILTER_LABELS,
  hiddenCount,
  type ConversationFilterKind,
  type ConversationFilters,
} from "../conversationFilters";
import { GitMenu } from "./GitMenu";
import { SettingsMenu } from "./SettingsMenu";
import type { PiPackageEdits } from "./PiPackages";
import { TreeMenu } from "./TreeMenu";
import { HEADER_CONTROL } from "./headerControl";
import { Sheet } from "./Sheet";

interface HeaderProps {
  credentials?: AgentState["credentials"];
  login?: AgentState["login"];
  onStartLogin?: (provider: string, method: "oauth" | "api_key") => void;
  onAnswerLogin?: (value: string) => void;
  onCancelLogin?: () => void;
  onDismissLogin?: () => void;
  onLogoutProvider?: (provider: string) => void;
  gitHostCredential?: GitHostCredentialState | null;
  onSetGitHostCredential?: (host: string, username: string, secret: string) => string;
  onRemoveGitHostCredential?: (host: string) => string;
  title?: string;
  sessions: SessionSummary[] | null;
  /** Active session search (name / first message / transcript), null when the menu lists everything. */
  sessionSearch: SessionSearch | null;
  sessionId: string;
  tree: TreeNode[] | null;
  isStreaming: boolean;
  connected: boolean;
  workspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  workspaceLocked: boolean;
  /**
   * Which workspace affordance this header carries. `projects` is the selector
   * the standalone app has always shown; `root` is the single-root chooser an
   * embed gets under that policy; `none` is the embed that offers neither.
   */
  workspaceControl: "projects" | "root" | "none";
  /** Everything the `root` control needs; required only in that mode. */
  rootControl?: {
    sandbox: WorkspaceRootSandbox | null;
    browse: ServerBrowseState | null;
    applyState: SettingsApplyState | null;
    blocked: boolean;
    onBrowse: (path: string) => void;
    onCloseBrowser: () => void;
    onOpened: () => void;
    onSelect: (root: string) => void;
  };
  onSwitchWorkspace: (root: string, id?: string) => void;
  onOpenProject: () => void;
  onCloseProject: (root: string, id?: string) => void;
  /** Start a side session on an open project. Absent, the project menu offers none. */
  onOpenSideSession?: (root: string) => void;
  /** The npm pi packages the agent loads, and the update and restart they offer. */
  piPackages?: PiPackageInfo[] | null;
  piPackageUpdate?: AgentState["piPackageUpdate"];
  /** Adding and removing packages; absent, Settings offers updates only. */
  piPackageEdits?: PiPackageEdits;
  /** The standalone interface may restart the server; a widget may not. */
  canRestartServer?: boolean;
  serverRestarting?: boolean;
  onCheckPiPackages?: () => void;
  onUpdatePiPackage?: (source: string) => void;
  onRestartServer?: () => void;
  /** What waits on a restart to run. */
  restartNeeded?: string[];
  theme: "light" | "dark";
  themePreference?: Theme;
  onSetTheme?: (theme: Theme) => void;
  showThemeToggle: boolean;
  /** Extension setStatus() key/text pairs — see extensions.md#custom-ui. */
  statuses: Record<string, string>;
  sidebarOpen: boolean;
  outcomeOpen: boolean;
  /** What the conversation shows; true means the kind is present. */
  filters: ConversationFilters;
  gitAvailable: boolean;
  gitStatus: GitStatusState | null;
  gitLog: GitLogState | null;
  extensionPaths: string[] | null;
  configuredExtensionPaths: string[];
  userExtensionPaths: string[];
  extensionLock: boolean;
  tools?: { name: string; active: boolean }[];
  commands?: { name: string; source: string }[];
  sandbox: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string; projectRoot?: string; rootEditable?: boolean } | null;
  /** Why git is unavailable, when it is — shown in Settings, where a user looks. */
  gitUnavailable: GitUnavailable | null;
  versions?: { piOutpost: string; piSdk?: string; agent?: string } | null;
  /** Skill paths added through Settings — editable there. */
  userSkillPaths: string[];
  /** Open server-directory listing behind the settings path picker. */
  serverBrowse: ServerBrowseState | null;
  /** In-flight settings apply, so a refusal can be shown where it was requested. */
  settingsApply: SettingsApplyState | null;
  agentResources: AgentResourceInventory | null;
  agentResourceOperations: AgentResourceOperationState;
  onBrowseServerPath: (path: string) => void;
  onCloseServerBrowser: () => void;
  /** Another header picker owns the server-browse listing: Settings closes its own. */
  settingsPickerBlocked?: boolean;
  /** Settings opened a picker, so the other header controls close theirs. */
  onSettingsPickerOpened?: () => void;
  onRestartSession?: () => void;
  onUpdateConfig: (update: {
    sandbox?: { root: string; allowWrite: boolean; allowBash: boolean; writableRoot?: string };
    userSkillPaths?: string[];
    userExtensionPaths?: string[];
  }) => void;
  onSuggestAgentResourceClonePath: (repositoryUrl: string) => void;
  onCloneAgentResourceRepository: (repositoryUrl: string, destinationPath: string) => void;
  onEnrollAgentResourceRepository: (previewToken: string, skillRoots: string[], extensionRoots: string[], enabledSkills?: string[]) => void;
  onSetAgentResourceSkills?: (repositoryId: string, enabledSkills: string[]) => void;
  onRemoveAgentResourceRepository?: (repositoryId: string) => void;
  onRefreshAgentResourceRepositories: (repositoryId?: string) => void;
  onUpdateAgentResourceRepository: (
    repositoryId: string,
    assessmentToken: string,
    localRevision: string,
    upstreamRevision: string,
    allowExecutableChanges?: boolean,
  ) => void;
  onToggleSidebar: () => void;
  onToggleOutcome: () => void;
  onFilterChange: (kind: ConversationFilterKind, shown: boolean) => void;
  /** Take the whole conversation away as one HTML file. Absent where there is nothing to export. */
  onExportConversation?: () => void;
  /** An export is being produced: several round trips and a diagram each, so it says so. */
  exportProgress?: string | null;
  onToggleTheme: () => void;
  onNewSession: () => void;
  onSwitchSession: (path: string) => void;
  onDeleteSession: (path: string) => void;
  onListSessions: () => void;
  onRenameSession: (path: string, name: string) => void;
  onSearchSessions: (query: string) => void;
  onClearSessionSearch: () => void;
  onListTree: () => void;
  onNavigateTree: (entryId: string) => void;
  onForkSession: (entryId: string) => void;
  onFetchGitLog: (repo: string) => void;
  onCloseGitLog: () => void;
  onShowCommit: (repo: string, sha: string) => void;
  /** What the viewer has open, so the branch chip can name that project's repository. */
  gitSelectedPath: string | null;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  /**
   * The phone layout: one row (project, session title, `⋯`) with the secondary
   * controls in a bottom sheet. Files, sessions and the terminal are reached from
   * the bottom navigation instead, so they are not in it.
   */
  compact?: boolean;
  /** The current session's name, the compact bar's title. */
  sessionName?: string | null;
  /** Opens the CLI sessions panel: beside sessions in the wide bar, in the compact bar's sheet. */
  onOpenCliSessions?: () => void;
  /** The closed Work Plan chip, shown beside sessions in the wide bar. */
  workPlanChip?: React.ReactNode;
}

const SESSION_SEARCH_DEBOUNCE_MS = 200;

/** Inline rename field: Enter commits, Escape cancels, an empty value clears the name. */
function RenameField({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value);
        else if (event.key === "Escape") {
          // Cancelling the rename is all this Escape means: a sheet holding the list stays.
          event.preventDefault();
          onCancel();
        }
      }}
      placeholder="Session name (empty to clear)"
      aria-label="Session name"
      className="w-full rounded-full border border-zinc-400 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 dark:border-zinc-600 dark:placeholder:text-zinc-600"
    />
  );
}

function SessionRow({
  session,
  isCurrent,
  renaming,
  onSwitch,
  onDelete,
  onStartRename,
  onRename,
  onCancelRename,
}: {
  session: SessionSummary;
  isCurrent: boolean;
  renaming: boolean;
  onSwitch: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  if (renaming) {
    return (
      <div className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800/60">
        <RenameField initial={session.name ?? ""} onCommit={onRename} onCancel={onCancelRename} />
      </div>
    );
  }
  return (
    <div
      className={`group flex items-start gap-1 rounded-xl ${
        isCurrent
          ? "bg-blue-100 ring-2 ring-inset ring-blue-600 dark:bg-blue-950 dark:ring-blue-400"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
      }`}
    >
      <button type="button" onClick={onSwitch} aria-current={isCurrent ? "true" : undefined} className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">{sessionLabel(session)}</span>
          {session.parentSession && (
            <span data-testid="session-subagent-tag" className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[10px] leading-4 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">sub-agent</span>
          )}
        </div>
        {/* Why this session matched: the excerpt is only sent for search results */}
        {session.snippet && (
          <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-500">{session.snippet}</div>
        )}
        <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-600">
          {new Date(session.modified).toLocaleString()}{session.messageCount === undefined ? "" : ` · ${session.messageCount} messages`}
          {isCurrent ? " · current" : ""}
          {/* Live in another session of this project: the server refuses to open it
              here, and says so, rather than let two agents append to one file. */}
          {!isCurrent && session.liveIn ? <span data-testid="session-live-in"> · open in {session.liveIn}</span> : null}
        </div>
      </button>
      <button
        type="button"
        onClick={onStartRename}
        title="rename session"
        aria-label="Rename session"
        className="mt-2 shrink-0 rounded-full px-1.5 py-0.5 text-xs text-zinc-400 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 max-md:min-h-11 max-md:min-w-11 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 hover:opacity-80 transition-opacity"
      >
        ✎
      </button>
      {!isCurrent && !session.liveIn && (
        <button
          type="button"
          onClick={onDelete}
          title="delete session"
          aria-label="Delete session"
          className="mr-2 mt-2 shrink-0 rounded-full px-1.5 py-0.5 text-xs text-zinc-400 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 max-md:min-h-11 max-md:min-w-11 hover:bg-red-100 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/60 dark:hover:text-red-400 hover:opacity-80 transition-opacity"
        >
          ✕
        </button>
      )}
    </div>
  );
}

interface SessionNode {
  session: SessionSummary;
  children: SessionNode[];
}

/** Missing parents (including filtered-out results) and malformed cycles remain reachable. */
function sessionTree(sessions: SessionSummary[]): SessionNode[] {
  const nodes = new Map(sessions.map((session) => [session.path, { session, children: [] } as SessionNode]));
  const roots: SessionNode[] = [];
  for (const node of nodes.values()) {
    const seen = new Set([node.session.path]);
    let ancestor = node.session.parentSession;
    while (ancestor && nodes.has(ancestor) && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = nodes.get(ancestor)!.session.parentSession;
    }
    const parent = node.session.parentSession && nodes.get(node.session.parentSession);
    if (parent && ancestor !== node.session.path) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Parents whose child sessions the user expanded; collapsed by default, remembered while the tab lives. */
export const expandedSessions = new Set<string>();

function SessionBranch({
  node,
  sessionId,
  renamingPath,
  setRenamingPath,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  close,
  searching,
  onSearchSessions,
  query
}: {
  node: SessionNode;
  sessionId: string;
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
  onSwitchSession: (path: string) => void;
  onDeleteSession: (path: string) => void;
  onRenameSession: (path: string, name: string) => void;
  close: () => void;
  searching: boolean;
  onSearchSessions: (query: string) => void;
  query: string;
}) {
  const { session, children } = node;
  // Search results hold only matches, so a search shows every matching child; the
  // branch remounts per query (its key), so the remembered state returns afterwards.
  const [expanded, setExpanded] = useState(() => searching || expandedSessions.has(session.path));
  const count = `${children.length} sub-agent${children.length === 1 ? "" : "s"}`;

  return (
    <li>
      <SessionRow
        session={session}
        isCurrent={session.id === sessionId}
        renaming={renamingPath === session.path}
        onSwitch={() => {
          onSwitchSession(session.path);
          close();
        }}
        onDelete={() => {
          if (window.confirm("Delete this session?")) onDeleteSession(session.path);
        }}
        onStartRename={() => setRenamingPath(session.path)}
        onRename={(name) => {
          onRenameSession(session.path, name);
          setRenamingPath(null);
          if (searching) onSearchSessions(query.trim());
        }}
        onCancelRename={() => setRenamingPath(null)}
      />
      {children.length > 0 && (
        <button
          type="button"
          aria-label={`${count} of ${sessionLabel(session)}`}
          aria-expanded={expanded}
          onClick={() => {
            if (!searching) {
              if (expanded) expandedSessions.delete(session.path);
              else expandedSessions.add(session.path);
            }
            setExpanded(!expanded);
          }}
          className={`ml-2 rounded-full px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 ${TOUCH_TARGET}`}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {count}
        </button>
      )}
      {expanded && children.length > 0 && (
        <ul aria-label={`Children of ${sessionLabel(session)}`} className="ml-4 border-l border-zinc-200 pl-2 dark:border-zinc-700">
          {children.map((child) => (
            <SessionBranch
              key={child.session.path}
              node={child}
              sessionId={sessionId}
              renamingPath={renamingPath}
              setRenamingPath={setRenamingPath}
              onSwitchSession={onSwitchSession}
              onDeleteSession={onDeleteSession}
              onRenameSession={onRenameSession}
              close={close}
              searching={searching}
              onSearchSessions={onSearchSessions}
              query={query}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

type SessionListProps = Pick<
  HeaderProps,
  | "sessions"
  | "sessionSearch"
  | "sessionId"
  | "onSwitchSession"
  | "onDeleteSession"
  | "onRenameSession"
  | "onSearchSessions"
  | "onClearSessionSearch"
> & {
  /** Leave the list: a session was chosen. */
  onClose: () => void;
  /** Class of the scrolling region; the dropdown caps its height, a sheet does not. */
  scrollClassName?: string;
};

/**
 * The saved sessions with their search, as shown while open.
 *
 * Mounted only while open, so every opening starts from an empty query and no
 * rename in progress. The header's dropdown and the phone's Sessions sheet both
 * render this one list.
 */
export function SessionList({
  sessions,
  sessionSearch,
  sessionId,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  onSearchSessions,
  onClearSessionSearch,
  onClose,
  scrollClassName = "min-h-0 overflow-y-auto py-2",
}: SessionListProps) {
  const [query, setQuery] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const trimmed = query.trim();
  // A single letter would scan every transcript for nothing useful — the server
  // ignores it too (MIN_QUERY_LENGTH), so don't even ask
  const searching = trimmed.length >= MIN_SESSION_QUERY_LENGTH;

  // Debounced: every keystroke re-reads every session file on the server
  useEffect(() => {
    if (!searching) {
      onClearSessionSearch();
      return;
    }
    const timer = setTimeout(() => onSearchSessions(trimmed), SESSION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, searching]);

  // While an answer is in flight the results are empty but not *known* to be empty:
  // rendering "no matches" there would call every query a miss for a whole round trip.
  // Results for an older query are just as wrong — the user has typed on since.
  const pending = searching && !(sessionSearch?.status === "loaded" && sessionSearch.query === trimmed);
  const rows = searching ? (pending ? null : (sessionSearch?.results ?? null)) : sessions;

  return (
    <>
      <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
          className="w-full rounded-full border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
        />
        <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          Searches Outpost and Pi CLI transcripts · ✎ to rename Outpost sessions
        </p>
      </div>
      <div className={scrollClassName}>
        {rows === null && <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>}
        {rows?.length === 0 && (
          <div className="px-3 py-2 text-xs text-zinc-500">{searching ? "no matches" : "no saved sessions"}</div>
        )}
        {rows && rows.length > 0 && (
          <ul aria-label="Saved sessions" className="px-2">
            {sessionTree(rows).map((node) => (
              <SessionBranch
                key={`${trimmed}:${node.session.path}`}
                node={node}
                sessionId={sessionId}
                renamingPath={renamingPath}
                setRenamingPath={setRenamingPath}
                onSwitchSession={onSwitchSession}
                onDeleteSession={onDeleteSession}
                onRenameSession={onRenameSession}
                close={onClose}
                searching={searching}
                onSearchSessions={onSearchSessions}
                query={query}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * Saved sessions: named (the agent titles a session after its first exchange, the
 * user renames with ✎) and searchable — the query is matched server-side against
 * the whole transcript, so a session is findable by anything ever said in it.
 */
function SessionMenu({
  onListSessions,
  ...list
}: Omit<SessionListProps, "onClose" | "scrollClassName"> & Pick<HeaderProps, "onListSessions">) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div className="static sm:relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          list.onClearSessionSearch();
          onListSessions();
        }}
        className={`${HEADER_CONTROL} border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200`}
      >
        sessions
      </button>
      {open && (
        <div className="absolute inset-x-4 top-full z-20 mt-1 flex max-h-96 w-auto max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl sm:left-auto sm:right-0 sm:w-96 dark:border-zinc-700 dark:bg-zinc-900">
          <SessionList {...list} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * What the conversation shows, as one menu rather than a button per kind.
 *
 * Checked means shown. The control this replaced was pressed when it was
 * *hiding*, which is what nobody could read off it: a row of checkboxes meaning
 * "hide this" is a double negative on every glance.
 *
 * Stateless about filtering — it renders what it is given and reports intent —
 * so nothing here can disagree with the conversation it sits above.
 */
function ConversationFilterMenu({
  filters,
  onFilterChange,
}: {
  filters: ConversationFilters;
  onFilterChange: (kind: ConversationFilterKind, shown: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const hidden = hiddenCount(filters);
  // The count is the whole point of the closed state: "am I looking at all of
  // it?" has to be answerable without opening the menu.
  const label = hidden > 0 ? `Filter · ${hidden} hidden` : "Filter";

  return (
    <div
      className="relative"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose what the conversation shows"
        className={`${HEADER_CONTROL} ${
          hidden > 0
            ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        }`}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-30 mt-1 w-48 rounded-2xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${TOUCH_DESCENDANTS}`}
        >
          {CONVERSATION_FILTER_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitemcheckbox"
              aria-checked={filters[kind]}
              onClick={() => onFilterChange(kind, !filters[kind])}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span aria-hidden className="w-3">{filters[kind] ? "✓" : ""}</span>
              <span>{CONVERSATION_FILTER_LABELS[kind]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The extensions' statuses: in the bar while they fit, behind one button when they do not.
 *
 * They are the one part of the bar nobody chose — any extension may set any number, of
 * any length — so they are what crowded it until the other controls wrapped. They stay
 * inline while none of them is cut and the bar does not overflow; otherwise they fold into
 * "N statuses", which lists them in full. Measured on the bar itself rather than the
 * window, since an embedded widget is narrower than the page it sits in. They unfold when
 * the bar has grown well past the width they folded at, so a bar on the edge does not
 * flicker between the two.
 */
function ExtensionStatuses({ statuses, bar }: { statuses: Record<string, string>; bar: HTMLElement | null }) {
  // Keep terminal styling for display; titles and emptiness checks use plain text.
  const entries = Object.entries(statuses)
    .filter(([, text]) => stripAnsi(text).trim() !== "");
  const signature = entries.map(([key, text]) => `${key}\u0000${text}`).join("\u0001");
  const [folded, setFolded] = useState(false);
  const foldedAt = useRef<number | null>(null);
  const inline = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const menu = useClickOutside(() => setOpen(false));

  // Other statuses may fit where these did not: try them inline again.
  useLayoutEffect(() => {
    foldedAt.current = null;
    setFolded(false);
    setOpen(false);
  }, [signature]);

  useLayoutEffect(() => {
    const header = bar;
    if (header === null) return;
    const measure = () => {
      if (foldedAt.current !== null) {
        if (header.clientWidth > foldedAt.current + 64) {
          foldedAt.current = null;
          setFolded(false);
          // A list left open must not come back by itself at the next fold.
          setOpen(false);
        }
        return;
      }
      const cut = Array.from(inline.current?.querySelectorAll<HTMLElement>("[data-status-text]") ?? []).some((text) => text.scrollWidth > text.clientWidth + 1);
      // A narrow toolbar can wrap instead of overflowing. Fold statuses in that
      // case too, keeping the same compact affordance while controls stay reachable.
      const first = header.firstElementChild?.getBoundingClientRect();
      const wrapped = first && first.height > 0 && Array.from(header.children).some((child) => child.getBoundingClientRect().top >= first.bottom);
      if (cut || wrapped || header.scrollWidth > header.clientWidth + 1) {
        foldedAt.current = header.clientWidth;
        setFolded(true);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [bar, folded, signature]);

  if (entries.length === 0) return null;
  if (!folded) {
    return (
      // They never shrink: a status cut short is what folds them, so each keeps its width.
      <div ref={inline} className="flex shrink-0 items-center gap-1.5">
        {entries.map(([key, text]) => (
          <span
            key={key}
            title={stripAnsi(text)}
            className={`${HEADER_CONTROL} max-w-[16rem] border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400`}
          >
            <span data-status-text className="truncate">
              <AnsiText text={text} />
            </span>
          </span>
        ))}
      </div>
    );
  }
  const label = `${entries.length} ${entries.length === 1 ? "status" : "statuses"}`;
  return (
    <div
      ref={menu}
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={entries.map(([, text]) => stripAnsi(text)).join("\n")}
        className={`${HEADER_CONTROL} border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200`}
      >
        {label} ▾
      </button>
      {open && (
        <ul
          aria-label="Extension statuses"
          className="absolute left-0 top-full z-20 mt-1 w-max max-w-[24rem] rounded-2xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {entries.map(([key, text]) => (
            <li key={key} className="break-words px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <AnsiText text={text} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThemeToggle({ theme, preference = theme, onToggle, onSetTheme }: { theme: "light" | "dark"; preference?: Theme; onToggle: () => void; onSetTheme?: (theme: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const ref = useClickOutside(() => setOpen(false));
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  const label = { light: "Light", dark: "Dark", system: "System" }[preference];
  return (
    <div ref={ref} className="relative" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
        const current = items.findIndex(item => item.matches(":focus"));
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
    <button
      ref={trigger}
      type="button"
      onClick={() => setOpen(value => !value)}
      title={`Theme: ${label}`}
      aria-label={`Theme: ${label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`${HEADER_CONTROL} border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200`}
    >
      {preference === "system" ? "◐" : theme === "dark" ? "☾" : "☀"}
    </button>
    {open && <div role="menu" aria-label="Theme" className={`absolute right-0 top-full z-40 mt-2 min-w-32 rounded-2xl border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${TOUCH_DESCENDANTS}`}>
      {(["light", "dark", "system"] as const).map(value => <button key={value} role="menuitemradio" aria-checked={preference === value} type="button" className="block w-full rounded-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800 hover:opacity-80 transition-opacity" onClick={() => {
        if (onSetTheme) onSetTheme(value);
        else if (value !== theme) onToggle();
        setOpen(false); trigger.current?.focus();
      }}>{value === "light" ? "Light" : value === "dark" ? "Dark" : "System"}</button>)}
    </div>}
    </div>
  );
}

export function Header(props: HeaderProps) {
  const { isStreaming, connected } = props;
  // State rather than a ref: the statuses measure the bar from their own layout effect,
  // which runs before a parent's ref is attached — a ref would still be empty then.
  const [bar, setBar] = useState<HTMLElement | null>(null);

  const workspaceAffordance = (
    <>
      {props.workspaceControl === "projects" && (
        <ProjectMenu
          workspace={props.workspace}
          workspaces={props.workspaces}
          locked={props.workspaceLocked}
          onSwitch={props.onSwitchWorkspace}
          onOpen={props.onOpenProject}
          onClose={props.onCloseProject}
          onOpenSide={props.onOpenSideSession}
        />
      )}
      {props.workspaceControl === "root" && props.rootControl && (
        <WorkspaceRootControl
          sandbox={props.rootControl.sandbox}
          browse={props.rootControl.browse}
          applyState={props.rootControl.applyState}
          blocked={props.rootControl.blocked}
          onBrowse={props.rootControl.onBrowse}
          onCloseBrowser={props.rootControl.onCloseBrowser}
          onOpened={props.rootControl.onOpened}
          onSelect={props.rootControl.onSelect}
        />
      )}
    </>
  );
  const outcomeButton = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={props.outcomeOpen}
      title="Review structured workspace Outcome"
      className={`${HEADER_CONTROL} ${
        props.outcomeOpen
          ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
          : props.workspace?.activity === "ready-for-review"
            ? "border-amber-400 text-amber-700 dark:text-amber-300"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400"
      }`}
    >
      Outcome{props.workspace?.activity === "ready-for-review" ? " •" : ""}
    </button>
  );
  const gitMenu = props.gitAvailable ? (
    <GitMenu
      status={props.gitStatus}
      selected={props.gitSelectedPath}
      log={props.gitLog}
      onFetchLog={props.onFetchGitLog}
      onCloseLog={props.onCloseGitLog}
      onShowCommit={props.onShowCommit}
    />
  ) : null;
  const exportButton = props.onExportConversation ? (
    <button
      type="button"
      onClick={props.onExportConversation}
      disabled={Boolean(props.exportProgress)}
      aria-busy={Boolean(props.exportProgress)}
      title="Save the whole conversation as one HTML file"
      aria-label="Export the conversation as HTML"
      className={`${HEADER_CONTROL} border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:cursor-progress disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200`}
    >
      {props.exportProgress ?? "↓ html"}
    </button>
  ) : null;
  const themeToggle = props.showThemeToggle ? <ThemeToggle theme={props.theme} preference={props.themePreference} onSetTheme={props.onSetTheme} onToggle={props.onToggleTheme} /> : null;
  const newSessionButton = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      title="new session"
      className={`${HEADER_CONTROL} border-emerald-300 text-emerald-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-emerald-900 dark:text-emerald-400 dark:hover:border-emerald-600 dark:hover:text-emerald-300`}
    >
      + new
    </button>
  );
  const treeMenu = (onNavigate: (entryId: string) => void, onFork: (entryId: string) => void) => (
    <TreeMenu
      tree={props.tree}
      isStreaming={isStreaming}
      onListTree={props.onListTree}
      onNavigate={onNavigate}
      onFork={onFork}
    />
  );
  const settingsMenu = (
    <SettingsMenu
      credentials={props.credentials}
      login={props.login}
      onStartLogin={props.onStartLogin}
      onAnswerLogin={props.onAnswerLogin}
      onCancelLogin={props.onCancelLogin}
      onDismissLogin={props.onDismissLogin}
      onLogoutProvider={props.onLogoutProvider}
      gitHostCredential={props.gitHostCredential ?? null}
      {...(props.onSetGitHostCredential ? { onSetGitHostCredential: props.onSetGitHostCredential } : {})}
      {...(props.onRemoveGitHostCredential ? { onRemoveGitHostCredential: props.onRemoveGitHostCredential } : {})}
      extensionPaths={props.extensionPaths}
      configuredExtensionPaths={props.configuredExtensionPaths}
      userExtensionPaths={props.userExtensionPaths}
      extensionLock={props.extensionLock}
      piPackages={props.piPackages ?? null}
      piPackageUpdate={props.piPackageUpdate ?? null}
      {...(props.piPackageEdits ? { piPackageEdits: props.piPackageEdits } : {})}
      canRestartServer={props.canRestartServer ?? false}
      serverRestarting={props.serverRestarting ?? false}
      {...(props.onCheckPiPackages ? { onCheckPiPackages: props.onCheckPiPackages } : {})}
      {...(props.onUpdatePiPackage ? { onUpdatePiPackage: props.onUpdatePiPackage } : {})}
      {...(props.onRestartServer ? { onRestartServer: props.onRestartServer } : {})}
      restartNeeded={props.restartNeeded ?? []}
      tools={props.tools ?? []}
      commands={props.commands ?? []}
      sandbox={props.sandbox}
      // The roots are shown where the interface is about one project; with several
      // offered and open, Settings is about the agent's permissions.
      showRoots={!(props.workspaceControl === "projects" && props.workspaces.filter((w) => !w.sideOf).length > 1)}
      gitUnavailable={props.gitUnavailable}
      userSkillPaths={props.userSkillPaths}
      serverBrowse={props.serverBrowse}
      applyState={props.settingsApply}
      agentResources={props.agentResources}
      agentResourceOperations={props.agentResourceOperations}
      versions={props.versions}
      onBrowseServerPath={props.onBrowseServerPath}
      onCloseServerBrowser={props.onCloseServerBrowser}
      pickerBlocked={props.settingsPickerBlocked}
      onPickerOpened={props.onSettingsPickerOpened}
      onRestartSession={props.onRestartSession}
      onUpdateConfig={props.onUpdateConfig}
      onSuggestAgentResourceClonePath={props.onSuggestAgentResourceClonePath}
      onCloneAgentResourceRepository={props.onCloneAgentResourceRepository}
      onEnrollAgentResourceRepository={props.onEnrollAgentResourceRepository}
      onSetAgentResourceSkills={props.onSetAgentResourceSkills}
      onRemoveAgentResourceRepository={props.onRemoveAgentResourceRepository}
      onRefreshAgentResourceRepositories={props.onRefreshAgentResourceRepositories}
      onUpdateAgentResourceRepository={props.onUpdateAgentResourceRepository}
    />
  );
  const filterMenu = <ConversationFilterMenu filters={props.filters} onFilterChange={props.onFilterChange} />;

  if (props.compact) return <CompactHeader {...props} parts={{ workspaceAffordance, outcomeButton, gitMenu, exportButton, themeToggle, newSessionButton, treeMenu, settingsMenu, filterMenu }} />;

  return (
    // `relative z-30`: the dropdowns below (sessions, tree, git) are absolutely
    // positioned and spill over the content area. Without a stacking context of its
    // own, the header competes there on DOM order alone — and the open FileViewer,
    // declared after it, wins. The menus would open *behind* the file preview.
    <header ref={setBar} className="relative z-30 flex min-w-0 flex-wrap items-center gap-1.5 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800 md:[@media(max-height:900px)]:py-1">
      {/* The workspace affordance comes first: it scopes everything else in this
          bar. Which one appears is the deployment's choice; the project selector
          still renders nothing while a single project is open or on a pinned
          server, and `none` is an embed that offers neither. */}
      {workspaceAffordance}
      {/* File/repo controls live on the left, the side their panel opens on */}
      <button
        type="button"
        onClick={props.onToggleSidebar}
        title={props.sidebarOpen ? "Hide files (panel opens on the left)" : "Show files"}
        aria-pressed={props.sidebarOpen}
        className={`${HEADER_CONTROL} ${
          props.sidebarOpen
            ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
        }`}
      >
        {props.sidebarOpen ? "◧" : "◨"} files
      </button>
      {outcomeButton(props.onToggleOutcome)}
      {gitMenu}

      {/* The title gives way first: it names the deployment, which the reader knows,
          while the project and the branch beside it say where the agent works. */}
      <span
        title={props.title ?? undefined}
        className="hidden min-w-[2.25rem] shrink-[4] truncate whitespace-nowrap text-lg font-semibold leading-tight tracking-tight sm:block"
        style={{ color: "var(--accent, inherit)" }}
      >
        {props.title ?? "π"}
      </span>

      <ExtensionStatuses statuses={props.statuses} bar={bar} />

      <div className="ml-auto flex w-full max-w-full shrink-0 flex-wrap items-center gap-1 sm:w-auto sm:gap-1.5">
        {filterMenu}
        {exportButton}
        {props.onToggleTerminal && (
          <button
            type="button"
            onClick={props.onToggleTerminal}
            title={props.terminalOpen ? "Close Terminal (Ctrl+`)" : "Open Terminal (Ctrl+`)"}
            aria-pressed={props.terminalOpen}
            className={`${HEADER_CONTROL} ${
              props.terminalOpen
                ? "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
            }`}
          >
            &gt;_ terminal
          </button>
        )}
        {themeToggle}
        {newSessionButton(props.onNewSession)}
        {treeMenu(props.onNavigateTree, props.onForkSession)}
        <SessionMenu
          sessions={props.sessions}
          sessionSearch={props.sessionSearch}
          sessionId={props.sessionId}
          onSwitchSession={props.onSwitchSession}
          onDeleteSession={props.onDeleteSession}
          onListSessions={props.onListSessions}
          onRenameSession={props.onRenameSession}
          onSearchSessions={props.onSearchSessions}
          onClearSessionSearch={props.onClearSessionSearch}
        />
        {props.onOpenCliSessions && (
          <button
            type="button"
            onClick={props.onOpenCliSessions}
            className={`${HEADER_CONTROL} border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200`}
          >
            Terminal sessions
          </button>
        )}
        {props.workPlanChip}
        {settingsMenu}
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          title={connected ? "connected" : "disconnected"}
        />
      </div>
    </header>
  );
}

/**
 * In the compact sheet the header's dropdowns open in place, under their button,
 * instead of floating: an absolute panel anchored to a button in a phone-wide sheet
 * would hang off its edge, and the sheet clips it. These target each dropdown's own
 * panel (`absolute top-full`, or `absolute right-0` for the filter list).
 */
const INLINE_DROPDOWNS = [
  "[&>*]:max-w-full",
  "[&_.absolute.top-full]:static [&_.absolute.top-full]:mt-2 [&_.absolute.top-full]:w-[calc(100vw-1.5rem)] [&_.absolute.top-full]:max-w-full [&_.absolute.top-full]:max-h-none [&_.absolute.top-full]:shadow-none",
  "[&_.absolute.right-0]:static [&_.absolute.right-0]:mt-2 [&_.absolute.right-0]:w-[calc(100vw-1.5rem)] [&_.absolute.right-0]:max-w-full [&_.absolute.right-0]:max-h-none [&_.absolute.right-0]:shadow-none",
].join(" ");

interface CompactParts {
  workspaceAffordance: ReactNode;
  outcomeButton: (onClick: () => void) => ReactNode;
  gitMenu: ReactNode;
  exportButton: ReactNode;
  themeToggle: ReactNode;
  newSessionButton: (onClick: () => void) => ReactNode;
  treeMenu: (onNavigate: (entryId: string) => void, onFork: (entryId: string) => void) => ReactNode;
  settingsMenu: ReactNode;
  filterMenu: ReactNode;
}

/**
 * The phone's header: one 44 px row. The same controls the wide bar shows sit in
 * the `⋯` sheet; those that open something over the conversation close the sheet
 * first, so what they open is not hidden behind it.
 */
function CompactHeader({ parts, ...props }: HeaderProps & { parts: CompactParts }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const closing = <T extends unknown[]>(run: (...args: T) => void) => (...args: T) => {
    setMoreOpen(false);
    run(...args);
  };
  const hasStatuses = Object.values(props.statuses).some((text) => stripAnsi(text).trim() !== "");
  return (
    <header
      data-testid="compact-header"
      className="relative z-30 box-content flex h-11 min-w-0 shrink-0 items-center gap-1 border-b border-zinc-200 px-2 pt-[env(safe-area-inset-top)] dark:border-zinc-800"
    >
      <div className="flex min-w-0 max-w-[45%] shrink-0 items-center">{parts.workspaceAffordance}</div>
      <span
        title={props.sessionName ?? undefined}
        className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100"
      >
        {props.sessionName?.trim() || "New session"}
      </span>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${props.connected ? "bg-emerald-500" : "bg-red-500"}`}
        title={props.connected ? "connected" : "disconnected"}
      />
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="More controls"
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {moreOpen && (
        <Sheet variant="bottom" title="Controls" onClose={() => setMoreOpen(false)} testId="compact-header-more">
          <div className={`flex flex-wrap items-start gap-2 p-3 [&>button]:min-w-11 [&>button]:justify-center [&>div>button]:min-w-11 [&>div>button]:justify-center ${INLINE_DROPDOWNS} ${TOUCH_DESCENDANTS}`}>
            {hasStatuses && (
              <div className="max-w-full overflow-x-auto">
                <ExtensionStatuses statuses={props.statuses} bar={null} />
              </div>
            )}
            {parts.gitMenu}
            {parts.filterMenu}
            {parts.exportButton}
            {parts.themeToggle}
            {parts.outcomeButton(closing(props.onToggleOutcome))}
            {parts.treeMenu(closing(props.onNavigateTree), closing(props.onForkSession))}
            {parts.newSessionButton(closing(props.onNewSession))}
            {props.onOpenCliSessions && (
              <button
                type="button"
                onClick={closing(props.onOpenCliSessions)}
                className={`${HEADER_CONTROL} border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500`}
              >
                Terminal sessions
              </button>
            )}
            {parts.settingsMenu}
          </div>
        </Sheet>
      )}
    </header>
  );
}
