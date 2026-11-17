import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { SessionSummary } from "@pi-outpost/shared";
import { Header, expandedSessions } from "./Header";
import { openMore } from "./headerTesting";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    path: "/sessions/a.jsonl",
    id: "a",
    firstMessage: "how do I start?",
    modified: "2026-08-01T10:00:00.000Z",
    messageCount: 4,
    ...overrides,
  };
}

const SESSIONS = [
  session(),
  session({ path: "/sessions/b.jsonl", id: "b", name: "refactor the parser", firstMessage: "split it up", messageCount: 12 }),
];

type Props = React.ComponentProps<typeof Header>;

function setup(overrides: Partial<Props> = {}) {
  const handlers = {
    onUpdateConfig: vi.fn(),
    onSuggestAgentResourceClonePath: vi.fn(),
    onCloneAgentResourceRepository: vi.fn(),
    onEnrollAgentResourceRepository: vi.fn(),
    onRefreshAgentResourceRepositories: vi.fn(),
    onUpdateAgentResourceRepository: vi.fn(),
    onBrowseServerPath: vi.fn(),
    onCloseServerBrowser: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleOutcome: vi.fn(),
    onFilterChange: vi.fn(),
    onToggleTheme: vi.fn(),
    onNewSession: vi.fn(),
    onSwitchSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onListSessions: vi.fn(),
    onRenameSession: vi.fn(),
    onSearchSessions: vi.fn(),
    onClearSessionSearch: vi.fn(),
    onListTree: vi.fn(),
    onNavigateTree: vi.fn(),
    onForkSession: vi.fn(),
    onFetchGitLog: vi.fn(),
    onCloseGitLog: vi.fn(),
    onShowCommit: vi.fn(),
  };
  const props: Props = {
    sessions: SESSIONS,
    sessionSearch: null,
    sessionId: "a",
    tree: null,
    isStreaming: false,
    connected: true,
    workspace: null,
    workspaces: [],
    workspaceLocked: false,
    workspaceControl: "projects",
    gitSelectedPath: null,
    onSwitchWorkspace: vi.fn(),
    onOpenProject: vi.fn(),
    onCloseProject: vi.fn(),
    theme: "light",
    showThemeToggle: true,
    statuses: {},
    sidebarOpen: false,
    outcomeOpen: false,
    filters: { tools: true, reasoning: true },
    gitAvailable: false,
    gitStatus: null,
    gitUnavailable: null,
    gitLog: null,
    extensionPaths: [],
    configuredExtensionPaths: [],
    userExtensionPaths: [],
    extensionLock: false,
    sandbox: null,
    userSkillPaths: [],
    serverBrowse: null,
    settingsApply: null,
    agentResources: null,
    agentResourceOperations: { clonePath: null, preview: null, enrollment: null, refresh: null, updates: {}, skills: {}, removals: {} },
    ...handlers,
    ...overrides,
  };
  const view = render(<Header {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<Header {...props} {...next} />);
  return { ...handlers, ...view, rerenderWith };
}

const openSessions = () => fireEvent.click(screen.getByRole("button", { name: "sessions" }));
const searchBox = () => screen.getByRole("searchbox", { name: "Search sessions" });

describe("Header", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    confirmSpy.mockRestore();
  });

  describe("chrome", () => {
    it("names the π mark after the branded title, which no longer takes the row", () => {
      setup({ title: "π dev" });
      const mark = screen.getByRole("img", { name: "π dev" });
      expect(mark).toHaveAttribute("title", "π dev");
      expect(screen.queryByText("π dev")).toBeNull();
    });

    // openlore: scenario=ThePiMarkShowsTheAgentWorking spec=compact-header-controls
    it("ThePiMarkShowsTheAgentWorking: the mark moves while the agent works, unless motion is reduced", () => {
      const { rerenderWith } = setup({ isStreaming: false });
      const mark = () => screen.getByTestId("pi-mark");
      expect(mark()).not.toHaveAttribute("data-working");
      expect(mark().className).not.toContain("animate-pulse");
      rerenderWith({ isStreaming: true });
      expect(mark()).toHaveAttribute("data-working", "true");
      expect(mark().className).toContain("animate-pulse");
      expect(mark().className).toContain("motion-reduce:animate-none");
      rerenderWith({ isStreaming: false, workspace: { root: "/w", name: "w", activity: "working", needsAttention: false } });
      expect(mark()).toHaveAttribute("data-working", "true");
    });

    // openlore: scenario=TheSessionTitleIsShownInFull spec=compact-header-controls
    it("TheSessionTitleIsShownInFull: the title is whole, small, cut only by a row without room", () => {
      const name = "Refactor the parser and keep every scenario of the session-search spec covered";
      setup({ sessionName: name });
      const title = screen.getByTestId("session-title");
      expect(title).toHaveTextContent(name);
      expect(title).toHaveAttribute("title", name);
      expect(title.className).toContain("text-sm");
      expect(title.className).toContain("truncate");
      expect(title.className).not.toMatch(/max-w-/);
    });

    it("lists extension statuses verbatim in the More menu", () => {
      setup({ statuses: { omni: "OmniRoute ✓", other: "2 jobs" } });
      expect(within(screen.getByRole("banner")).queryByText("2 jobs")).toBeNull();
      const status = within(openMore()).getByRole("region", { name: "Status" });
      const list = within(status).getByRole("list", { name: "Extension statuses" });
      expect(within(list).getByText("OmniRoute ✓")).toBeInTheDocument();
      expect(within(list).getByText("2 jobs")).toBeInTheDocument();
    });

    it("renders ANSI status colours and resets while keeping the tooltip plain", () => {
      setup({ statuses: { lint: "\u001b[32;1mReady\u001b[0m plain", empty: "\u001b[31m\u001b[0m" } });
      const more = openMore();
      expect(within(more).getByText("Ready")).toHaveStyle({ color: "#16a34a", fontWeight: 600 });
      expect(within(more).getByText("plain").style.color).toBe("");
      expect(within(more).getByTitle("Ready plain")).toBeInTheDocument();
      expect(more.querySelectorAll("[data-status-text]")).toHaveLength(1);
      expect(more.textContent).not.toContain("\u001b");
    });

    // openlore: scenario=EveryControlIsOneHeight spec=components
    // openlore: scenario=TheHeaderIsOneRow spec=compact-header-controls
    it("EveryControlIsOneHeight / TheHeaderIsOneRow: the row holds project, π, title, files, + new, sessions and More, one height, never wrapping", () => {
      const { container } = setup({
        title: "π dev",
        sessionName: "A session",
        statuses: { omni: "OmniRoute ✓", other: "2 jobs" },
        gitAvailable: true,
        gitStatus: { repos: [{ repo: "", branch: "feat/a-long-branch", ahead: 0, behind: 0 }], files: {} },
        workspaceControl: "projects",
        workspace: { root: "/srv/alpha", name: "a-project-with-a-long-name", activity: "idle", needsAttention: false },
        workspaces: [{ root: "/srv/alpha", name: "a-project-with-a-long-name", activity: "idle", needsAttention: false }],
        onExportConversation: vi.fn(),
        onToggleTerminal: vi.fn(),
        onOpenAgents: vi.fn(),
        onOpenCliSessions: vi.fn(),
      } as Partial<Props>);
      const header = container.querySelector("header")!;
      expect(header.className).toContain("flex-nowrap");
      expect(header.className).not.toContain("flex-wrap ");
      const row = [...header.querySelectorAll<HTMLElement>("button")];
      expect(row.map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim())).toEqual([
        expect.stringContaining("a-project-with-a-long-name"),
        "◨ files",
        "+ new",
        "sessions",
        "More controls",
      ]);
      const order = [...header.querySelectorAll<HTMLElement>("[data-testid=pi-mark], [data-testid=session-title], button")].map((el) => el.dataset.testid ?? el.textContent?.trim());
      expect(order.slice(1, 4)).toEqual(["pi-mark", "session-title", "◨ files"]);
      const offRow = row.slice(1).filter((control) => !control.className.includes("h-7") || !control.className.includes("whitespace-nowrap")).map((control) => control.textContent);
      expect(offRow).toEqual([]);
      for (const moved of ["tree", "Outcome", "Agents", "Terminal sessions", "Settings", "Export the conversation as HTML", /^Filter/, /^Theme:/, /feat\/a-long-branch/, /terminal$/]) {
        expect(within(header).queryByRole("button", { name: moved })).toBeNull();
      }
    });

    // openlore: scenario=EverythingElseIsInTheMoreMenu spec=compact-header-controls
    it("EverythingElseIsInTheMoreMenu: grouped Conversation, Tools, View, Status and Settings", () => {
      setup({
        statuses: { omni: "OmniRoute ✓" },
        gitAvailable: true,
        gitStatus: { repos: [{ repo: "", branch: "main", ahead: 0, behind: 0 }], files: {} },
        onExportConversation: vi.fn(),
        onToggleTerminal: vi.fn(),
        onOpenAgents: vi.fn(),
        onOpenCliSessions: vi.fn(),
      } as Partial<Props>);
      const more = openMore();
      expect(screen.getByRole("button", { name: "More controls" })).toHaveAttribute("aria-expanded", "true");
      const group = (name: string) => within(more).getByRole("region", { name });
      expect([...more.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"))).toEqual(["Conversation", "Tools", "View", "Status", "Settings"]);
      for (const name of ["tree", "Outcome", "Export the conversation as HTML"]) expect(within(group("Conversation")).getByRole("button", { name })).toBeInTheDocument();
      for (const name of ["Agents", "Terminal sessions", /terminal$/, /main/]) expect(within(group("Tools")).getByRole("button", { name })).toBeInTheDocument();
      for (const name of [/^Filter/, /^Theme:/]) expect(within(group("View")).getByRole("button", { name })).toBeInTheDocument();
      expect(within(group("Status")).getByText("OmniRoute ✓")).toBeInTheDocument();
      expect(within(group("Settings")).getByRole("button", { name: "Settings" })).toHaveTextContent("Settings");
    });

    // openlore: scenario=TheMoreMenuClosesLikeAMenu spec=compact-header-controls
    it("TheMoreMenuClosesLikeAMenu: Escape, an outside click, or a control that opens something over the chat", () => {
      const onOpenAgents = vi.fn();
      setup({ onOpenAgents } as Partial<Props>);
      fireEvent.keyDown(openMore(), { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Controls" })).toBeNull();
      openMore();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("dialog", { name: "Controls" })).toBeNull();
      // A menu inside it keeps its own Escape: the More menu stays open.
      fireEvent.click(within(openMore()).getByRole("button", { name: /^Filter/ }));
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.getByRole("dialog", { name: "Controls" })).toBeInTheDocument();
      fireEvent.click(within(openMore()).getByRole("button", { name: "Agents" }));
      expect(onOpenAgents).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "Controls" })).toBeNull();
    });

    // openlore: scenario=ALongLabelIsCutNotWrapped spec=components
    it("ALongLabelIsCutNotWrapped: a project or branch too long is cut, with its full name on hover", () => {
      setup({
        gitAvailable: true,
        gitStatus: { repos: [{ repo: "", branch: "feat/a-long-branch", ahead: 0, behind: 0 }], files: {} },
        workspaceControl: "projects",
        workspace: { root: "/srv/alpha", name: "a-project-with-a-long-name", activity: "idle", needsAttention: false },
        workspaces: [{ root: "/srv/alpha", name: "a-project-with-a-long-name", activity: "idle", needsAttention: false }],
      } as Partial<Props>);
      const project = screen.getByRole("button", { name: /a-project-with-a-long-name/ });
      expect(project.title).toContain("a-project-with-a-long-name");
      expect(within(project).getByText("a-project-with-a-long-name").className).toContain("truncate");
      const branch = within(openMore()).getByRole("button", { name: /feat\/a-long-branch/ });
      expect(branch.querySelector(".truncate")?.textContent).toContain("feat/a-long-branch");
    });

    it("ChooseSystemTheme: offers Light, Dark and System with the current preference marked", () => {
      const onSetTheme = vi.fn();
      const { rerenderWith } = setup({ theme: "dark", themePreference: "dark", onSetTheme });
      fireEvent.click(within(openMore()).getByRole("button", { name: "Theme: Dark" }));
      expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
      expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "false");
      fireEvent.click(screen.getByRole("menuitemradio", { name: "System" }));
      expect(onSetTheme).toHaveBeenCalledExactlyOnceWith("system");
      expect(screen.queryByRole("menu", { name: "Theme" })).not.toBeInTheDocument();
      rerenderWith({ themePreference: "system" });
      fireEvent.click(within(openMore()).getByRole("button", { name: "Theme: System" }));
      expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "false");
    });

    it.each(["Escape", "outside click"] as const)("ThemeMenuDismissal: %s closes the theme menu without changing the preference", (dismissal) => {
      const onSetTheme = vi.fn();
      const { onToggleTheme } = setup({ theme: "dark", themePreference: "system", onSetTheme });
      const trigger = () => within(openMore()).getByRole("button", { name: "Theme: System" });
      fireEvent.click(trigger());
      const selected = screen.getByRole("menuitemradio", { name: "System" });
      expect(selected).toHaveAttribute("aria-checked", "true");
      expect(selected).toHaveFocus();
      if (dismissal === "Escape") fireEvent.keyDown(selected, { key: "Escape" });
      else fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu", { name: "Theme" })).not.toBeInTheDocument();
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
      expect(onSetTheme).not.toHaveBeenCalled();
      expect(onToggleTheme).not.toHaveBeenCalled();
      if (dismissal === "Escape") expect(trigger()).toHaveFocus();
      fireEvent.click(trigger());
      expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
      expect(onSetTheme).not.toHaveBeenCalled();
      expect(onToggleTheme).not.toHaveBeenCalled();
    });

    it("offers the theme toggle only when branding allows it", () => {
      const { rerenderWith, onToggleTheme } = setup({ theme: "light" });
      fireEvent.click(within(openMore()).getByRole("button", { name: "Theme: Light" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
      expect(onToggleTheme).toHaveBeenCalled();
      rerenderWith({ showThemeToggle: false });
      expect(within(openMore()).queryByRole("button", { name: /Theme:/ })).not.toBeInTheDocument();
    });

    it("names the theme control after the current preference", () => {
      setup({ theme: "dark" });
      expect(within(openMore()).getByRole("button", { name: "Theme: Dark" })).toBeInTheDocument();
    });

    it("shows the branch chip only when git is available", () => {
      const { rerenderWith } = setup({ gitAvailable: false });
      expect(within(openMore()).queryByRole("button", { name: /⎇/ })).not.toBeInTheDocument();
      rerenderWith({ gitAvailable: true, gitStatus: { repos: [{ repo: "", branch: "main", ahead: 0, behind: 0 }], files: {} } });
      expect(within(openMore()).getByRole("button", { name: /main/ })).toBeInTheDocument();
    });

    it("starts a new session", () => {
      const { onNewSession } = setup();
      fireEvent.click(screen.getByRole("button", { name: /new/ }));
      expect(onNewSession).toHaveBeenCalled();
    });
  });

  describe("the session menu", () => {
    it("says where a conversation open in another session is, and offers no delete for it", () => {
      const held = session({ path: "/sessions/c.jsonl", id: "c", name: "held elsewhere", liveIn: "fix typo (alpha)" });
      const { onSwitchSession } = setup({ sessions: [...SESSIONS, held] });
      openSessions();
      const row = screen.getByText("held elsewhere").closest("div.group") as HTMLElement;
      expect(within(row).getByTestId("session-live-in")).toHaveTextContent("open in fix typo (alpha)");
      expect(within(row).queryByRole("button", { name: "Delete session" })).toBeNull();
      // Still clickable: the server refuses it and says where it is open.
      fireEvent.click(within(row).getByText("held elsewhere"));
      expect(onSwitchSession).toHaveBeenCalledWith("/sessions/c.jsonl");
    });

    it("asks for the list when it opens, from a clean slate", () => {
      const { onListSessions, onClearSessionSearch } = setup();
      openSessions();
      expect(onListSessions).toHaveBeenCalled();
      expect(onClearSessionSearch).toHaveBeenCalled();
    });

    it("lists sessions by name, falling back to the first message", () => {
      setup();
      openSessions();
      expect(screen.getByText("refactor the parser")).toBeInTheDocument();
      expect(screen.getByText("how do I start?")).toBeInTheDocument();
    });

    it("marks the current session", () => {
      setup({ sessionId: "b" });
      openSessions();
      expect(screen.getByText(/· current/)).toBeInTheDocument();
      const selected = screen.getByText("refactor the parser").closest("button")!;
      expect(selected).toHaveAttribute("aria-current", "true");
      expect(selected.closest(".group")).toHaveClass("bg-blue-100", "ring-blue-600", "dark:bg-blue-950", "dark:ring-blue-400");
      expect(screen.getByText("how do I start?").closest("button")).not.toHaveAttribute("aria-current");
    });

    it("switches session and closes", () => {
      const { onSwitchSession } = setup();
      openSessions();
      fireEvent.click(screen.getByText("refactor the parser"));
      expect(onSwitchSession).toHaveBeenCalledWith("/sessions/b.jsonl");
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });

    it("says when there is nothing saved", () => {
      setup({ sessions: [] });
      openSessions();
      expect(screen.getByText("no saved sessions")).toBeInTheDocument();
    });

    it("says it is loading rather than claiming there is nothing", () => {
      setup({ sessions: null });
      openSessions();
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("closes when the pointer goes down outside", () => {
      setup();
      openSessions();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  });

  describe("parent-child sessions", () => {
    const parent = session({ name: "Parent" });
    const child = session({ path: "/sessions/child.jsonl", id: "child", name: "Child", parentSession: parent.path });
    const grandchild = session({ path: "/sessions/grandchild.jsonl", id: "grandchild", name: "Grandchild", parentSession: child.path });
    const toggleOf = (label: string, count = 1) =>
      screen.getByRole("button", { name: `${count} sub-agent${count === 1 ? "" : "s"} of ${label}` });

    beforeEach(() => expandedSessions.clear());

    it("collapses every child group on open, the current session's included, and shows the child count", () => {
      const kids = [1, 2, 3].map((n) => session({ path: `/sessions/k${n}.jsonl`, id: `k${n}`, name: `Kid ${n}`, parentSession: parent.path }));
      setup({ sessions: [parent, ...kids], sessionId: parent.id });
      openSessions();
      const toggle = toggleOf("Parent", 3);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveTextContent("▸ 3 sub-agents");
      expect(screen.queryByRole("list", { name: "Children of Parent" })).not.toBeInTheDocument();
      expect(screen.queryByText("Kid 1")).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveTextContent("▾ 3 sub-agents");
      expect(within(screen.getByRole("list", { name: "Children of Parent" })).getAllByTestId("session-subagent-tag")).toHaveLength(3);
    });

    it("remembers expanded groups across menu openings", () => {
      setup({ sessions: [parent, child] });
      openSessions();
      fireEvent.click(toggleOf("Parent"));
      fireEvent.mouseDown(document.body);
      openSessions();
      expect(toggleOf("Parent")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Child")).toBeInTheDocument();
      fireEvent.click(toggleOf("Parent"));
      fireEvent.mouseDown(document.body);
      openSessions();
      expect(toggleOf("Parent")).toHaveAttribute("aria-expanded", "false");
    });

    it("nests children across dates, toggles independently, and switches the exact child path", () => {
      const { onSwitchSession } = setup({ sessions: [grandchild, child, { ...parent, modified: "2020-01-01T00:00:00Z" }] });
      openSessions();
      const roots = screen.getByRole("list", { name: "Saved sessions" });
      expect(roots.children).toHaveLength(1);
      const toggle = toggleOf("Parent");
      fireEvent.click(toggle);
      expect(within(screen.getByRole("list", { name: "Children of Parent" })).getByText("Child")).toBeInTheDocument();
      expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();
      fireEvent.click(toggleOf("Child"));
      expect(screen.getByText("Grandchild")).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("Child")).not.toBeInTheDocument();
      expect(onSwitchSession).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      fireEvent.click(screen.getByText("Child"));
      expect(onSwitchSession).toHaveBeenCalledWith(child.path);
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });

    it("labels sub-agent child sessions readably instead of (empty), with a sub-agent tag", () => {
      setup({ sessions: [
        parent,
        session({ path: "/sessions/agent.jsonl", id: "01a1e665-d6e1", name: "general-purpose#57816f08", parentSession: parent.path,
          firstMessage: "Repo /root/pi-outpost-redesign. Fix the list\nsecond line" }),
        session({ path: "/sessions/bare.jsonl", id: "01a1e666-aaaa", parentSession: parent.path, firstMessage: "" }),
      ] });
      openSessions();
      fireEvent.click(toggleOf("Parent", 2));
      const children = within(screen.getByRole("list", { name: "Children of Parent" }));
      expect(children.getByText("general-purpose · Repo /root/pi-outpost-redesign. Fix the list")).toBeInTheDocument();
      expect(children.getByText("Sub-agent · 01a1e666")).toBeInTheDocument();
      expect(children.getAllByTestId("session-subagent-tag")).toHaveLength(2);
      expect(screen.queryByText("(empty)")).not.toBeInTheDocument();
    });

    it("keeps orphans, self references, cycles and their descendants reachable once", () => {
      setup({ sessions: [
        { ...parent, parentSession: child.path }, child, grandchild,
        session({ path: "/orphan", id: "orphan", name: "Orphan", parentSession: "/missing" }),
        session({ path: "/self", id: "self", name: "Self", parentSession: "/self" }),
      ] });
      openSessions();
      fireEvent.click(toggleOf("Child"));
      for (const name of ["Parent", "Child", "Grandchild", "Orphan", "Self"]) expect(screen.getAllByText(name)).toHaveLength(1);
    });

    it("shows filtered children without inserting unmatched parents and restores the full tree", () => {
      const { rerenderWith } = setup({ sessions: [parent, child] });
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "child" } });
      rerenderWith({ sessionSearch: { status: "loaded", query: "child", requestId: "s1", results: [{ ...child, snippet: "matched child text" }] } });
      expect(screen.queryByText("Parent")).not.toBeInTheDocument();
      expect(screen.getByText("Child")).toBeInTheDocument();
      expect(screen.getByText("matched child text")).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Saved sessions" }).children).toHaveLength(1);
      fireEvent.change(searchBox(), { target: { value: "" } });
      fireEvent.click(toggleOf("Parent"));
      expect(within(screen.getByRole("list", { name: "Children of Parent" })).getByText("Child")).toBeInTheDocument();
    });

    it("expands matching children during a search only, then returns to the remembered collapsed state", () => {
      const { rerenderWith } = setup({ sessions: [parent, child] });
      openSessions();
      expect(toggleOf("Parent")).toHaveAttribute("aria-expanded", "false");
      fireEvent.change(searchBox(), { target: { value: "match" } });
      rerenderWith({ sessionSearch: { status: "loaded", query: "match", requestId: "s2", results: [parent, child] } });
      expect(screen.getByText("Child")).toBeInTheDocument();
      expect(toggleOf("Parent")).toHaveAttribute("aria-expanded", "true");
      fireEvent.change(searchBox(), { target: { value: "" } });
      rerenderWith({ sessionSearch: null });
      expect(toggleOf("Parent")).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("Child")).not.toBeInTheDocument();
    });

    it("preserves rename, delete and current markers on nested rows when parents disappear", () => {
      const { onRenameSession, onDeleteSession, rerenderWith } = setup({ sessions: [parent, child, grandchild], sessionId: "grandchild" });
      openSessions();
      fireEvent.click(toggleOf("Parent"));
      fireEvent.click(toggleOf("Child"));
      const children = screen.getByRole("list", { name: "Children of Parent" });
      expect(within(children).getByText(/· current/)).toBeInTheDocument();
      fireEvent.click(within(children).getAllByRole("button", { name: "Rename session" })[0]);
      fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "New child" } });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Session name" }), { key: "Enter" });
      expect(onRenameSession).toHaveBeenCalledWith(child.path, "New child");
      fireEvent.click(within(children).getByRole("button", { name: "Delete session" }));
      expect(onDeleteSession).toHaveBeenCalledWith(child.path);
      rerenderWith({ sessions: [child, grandchild] });
      expect(screen.queryByText("Parent")).not.toBeInTheDocument();
      expect(screen.getByText("Grandchild")).toBeInTheDocument();
    });
  });

  describe("deleting", () => {
    it("asks before deleting", () => {
      const { onDeleteSession } = setup();
      openSessions();
      fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
      expect(confirmSpy).toHaveBeenCalled();
      expect(onDeleteSession).toHaveBeenCalledWith("/sessions/b.jsonl");
    });

    it("does nothing when the prompt is declined", () => {
      confirmSpy.mockReturnValue(false);
      const { onDeleteSession } = setup();
      openSessions();
      fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
      expect(onDeleteSession).not.toHaveBeenCalled();
    });

    it("offers no delete for the session you are in", () => {
      setup({ sessionId: "a" });
      openSessions();
      // Only the other session can be deleted
      expect(screen.getAllByRole("button", { name: "Delete session" })).toHaveLength(1);
    });
  });

  describe("renaming", () => {
    it("commits a new name on Enter", () => {
      const { onRenameSession } = setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[0]);
      const field = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(field, { target: { value: "onboarding notes" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onRenameSession).toHaveBeenCalledWith("/sessions/a.jsonl", "onboarding notes");
    });

    it("starts from the existing name", () => {
      setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[1]);
      expect(screen.getByRole("textbox", { name: "Session name" })).toHaveValue("refactor the parser");
    });

    it("clears the name when committed empty", () => {
      const { onRenameSession } = setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[1]);
      const field = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(field, { target: { value: "" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onRenameSession).toHaveBeenCalledWith("/sessions/b.jsonl", "");
    });

    it("abandons the rename on Escape", () => {
      const { onRenameSession } = setup();
      openSessions();
      fireEvent.click(screen.getAllByRole("button", { name: "Rename session" })[0]);
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Session name" }), { key: "Escape" });
      expect(onRenameSession).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: "Session name" })).not.toBeInTheDocument();
    });
  });

  it("offers CLI history like any session, without an unknown message count", () => {
    const external = session({ path: "/sessions/--project--/external.jsonl", id: "external", name: "Earlier CLI work", messageCount: undefined });
    const { onSwitchSession } = setup({ sessions: [session(), external] });
    openSessions();
    fireEvent.click(screen.getByText("Earlier CLI work"));
    expect(onSwitchSession).toHaveBeenCalledWith("/sessions/--project--/external.jsonl");
    expect(screen.queryByText(/undefined messages/)).toBeNull();
  });

  describe("searching sessions", () => {
    it("ignores a query too short to be worth a server scan", () => {
      const { onSearchSessions } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "a" } });
      act(() => void vi.advanceTimersByTime(500));
      expect(onSearchSessions).not.toHaveBeenCalled();
    });

    it("searches after a pause, not on every keystroke", () => {
      const { onSearchSessions } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      expect(onSearchSessions).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(500));
      expect(onSearchSessions).toHaveBeenCalledWith("par");
    });

    it("keeps waiting rather than calling a query a miss mid-flight", () => {
      setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.getByText("loading…")).toBeInTheDocument();
      expect(screen.queryByText("no matches")).not.toBeInTheDocument();
    });

    it("ignores results belonging to an older query", () => {
      const { rerenderWith } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      rerenderWith({ sessionSearch: { status: "loaded", query: "old", requestId: "s0", results: [] } });
      expect(screen.getByText("loading…")).toBeInTheDocument();
    });

    it("shows matches with the excerpt that explains them", () => {
      const { rerenderWith } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      const hit = session({ path: "/sessions/b.jsonl", id: "b", name: "refactor the parser", snippet: "…split the parser…" });
      rerenderWith({ sessionSearch: { status: "loaded", query: "par", requestId: "s1", results: [hit] } });
      expect(screen.getByText("…split the parser…")).toBeInTheDocument();
    });

    it("says a search found nothing, distinctly from an empty library", () => {
      const { rerenderWith } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "zzz" } });
      rerenderWith({ sessionSearch: { status: "loaded", query: "zzz", requestId: "s1", results: [] } });
      expect(screen.getByText("no matches")).toBeInTheDocument();
    });

    it("re-runs the search after a rename, since results are a server snapshot", () => {
      const { rerenderWith, onSearchSessions } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      const hit = session({ path: "/sessions/b.jsonl", id: "b", name: "refactor the parser" });
      rerenderWith({ sessionSearch: { status: "loaded", query: "par", requestId: "s1", results: [hit] } });
      act(() => void vi.advanceTimersByTime(500));
      onSearchSessions.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Rename session" }));
      const field = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(field, { target: { value: "parser work" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onSearchSessions).toHaveBeenCalledWith("par");
    });

    it("drops the search when the box is emptied", () => {
      const { onClearSessionSearch } = setup();
      openSessions();
      fireEvent.change(searchBox(), { target: { value: "par" } });
      onClearSessionSearch.mockClear();
      fireEvent.change(searchBox(), { target: { value: "" } });
      expect(onClearSessionSearch).toHaveBeenCalled();
    });
  });

  describe("conversation filters", () => {
    const trigger = () => within(openMore()).getByRole("button", { name: /^Filter/ });
    const openMenu = () => fireEvent.click(trigger());

    it("reports the kind that was toggled rather than holding the state", () => {
      const { onFilterChange, rerenderWith } = setup({ filters: { tools: true, reasoning: true } });
      openMenu();
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Tool calls/ }));
      expect(onFilterChange).toHaveBeenCalledWith("tools", false);

      // The header did not decide anything on its own: it still shows both kinds
      // until its consumer says otherwise.
      expect(screen.getByRole("menuitemcheckbox", { name: /Tool calls/ })).toHaveAttribute("aria-checked", "true");
      rerenderWith({ filters: { tools: false, reasoning: true } });
      expect(screen.getByRole("menuitemcheckbox", { name: /Tool calls/ })).toHaveAttribute("aria-checked", "false");
    });

    it("says on the closed trigger whether the conversation is filtered", () => {
      const { rerenderWith } = setup({ filters: { tools: true, reasoning: true } });
      expect(trigger()).toHaveTextContent(/^Filter$/);

      rerenderWith({ filters: { tools: false, reasoning: true } });
      expect(trigger()).toHaveTextContent(/1 hidden/);
      rerenderWith({ filters: { tools: false, reasoning: false } });
      expect(trigger()).toHaveTextContent(/2 hidden/);
    });

    it("exposes each entry as a checkbox carrying whether that kind is shown", () => {
      setup({ filters: { tools: true, reasoning: false } });
      openMenu();
      expect(screen.getByRole("menuitemcheckbox", { name: /Tool calls/ })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("menuitemcheckbox", { name: /Reasoning/ })).toHaveAttribute("aria-checked", "false");
    });

    it("closes on an outside click without changing anything", () => {
      const { onFilterChange } = setup();
      openMenu();
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(onFilterChange).not.toHaveBeenCalled();
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape without changing anything", () => {
      const { onFilterChange } = setup();
      openMenu();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(onFilterChange).not.toHaveBeenCalled();
    });
  });

  it("toggles the sidebar", () => {
    const { onToggleSidebar } = setup();
    fireEvent.click(screen.getByRole("button", { name: /files/ }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("keeps Outcome available and emphasizes review readiness", () => {
    const { onToggleOutcome, rerenderWith } = setup();
    fireEvent.click(within(openMore()).getByRole("button", { name: "Outcome" }));
    expect(onToggleOutcome).toHaveBeenCalled();
    rerenderWith({ workspace: { root: "/work", name: "work", activity: "ready-for-review", needsAttention: true } });
    expect(within(openMore()).getByRole("button", { name: /Outcome/ })).toHaveTextContent("•");
  });

  it("reports the connection state", () => {
    const { rerenderWith } = setup({ connected: true });
    expect(screen.getByTitle("connected")).toBeInTheDocument();
    rerenderWith({ connected: false });
    expect(screen.getByTitle(/disconnected|connecting/i)).toBeInTheDocument();
  });

  it("keeps the tree menu out of the way until asked", () => {
    const { onListTree } = setup();
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: "tree" })).toBeNull();
    fireEvent.click(within(openMore()).getByRole("button", { name: "tree" }));
    expect(onListTree).toHaveBeenCalled();
  });

  describe("the sandbox in Settings", () => {
    const sandbox = { root: "/projects/alpha", allowWrite: false, allowBash: false, projectRoot: "/projects/alpha", rootEditable: true };
    const project = (root: string) => ({ root, name: root.split("/").pop()!, activity: "idle" as const });
    const openSettings = () => fireEvent.click(within(openMore()).getByRole("button", { name: "Settings" }));

    it("with several projects open in the standalone app, shows the agent's permissions and no root", () => {
      // SeveralProjectsShowPermissionsOnly
      setup({ workspaceControl: "projects", sandbox, workspaces: [project("/projects/alpha"), project("/projects/beta")] });
      openSettings();
      expect(screen.getByText("Agent permissions")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Browse for sandbox root/ })).not.toBeInTheDocument();
    });

    it("with one project open, keeps the full section", () => {
      // ASingleProjectKeepsTheFullSection
      setup({ workspaceControl: "projects", sandbox, workspaces: [project("/projects/alpha")] });
      openSettings();
      expect(screen.getByRole("button", { name: /Browse for sandbox root/ })).toBeInTheDocument();
    });

    it("in a widget bound to one project, keeps the root even while the server holds others", () => {
      // AWidgetBoundToOneProjectKeepsItsRoot
      setup({ workspaceControl: "none", sandbox, workspaces: [project("/projects/alpha"), project("/projects/beta")] });
      openSettings();
      expect(screen.getByRole("button", { name: /Browse for sandbox root/ })).toBeInTheDocument();
    });
  });
});
