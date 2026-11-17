import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { SubagentEntry, SubagentManagementData, SubagentManagementReply } from "@pi-outpost/shared";
import { AgentsPanel } from "./AgentsPanel";

const agent = (overrides: Partial<SubagentEntry>): SubagentEntry => ({
  name: "x", source: "global", active: true, enabled: true, description: "", skills: true, promptMode: "replace", prompt: "", otherFields: [], ...overrides,
});
const base = (): SubagentManagementData => ({
  agents: [
    agent({ name: "reviewer", source: "package", packageName: "fake-pkg", active: false, overriddenBy: "project", description: "package reviewer", path: "/pkg/agents/reviewer.md" }),
    agent({ name: "reviewer", source: "global", scope: "global", file: "reviewer", hash: "g1", active: false, overriddenBy: "project", path: "/a/agents/reviewer.md" }),
    agent({ name: "reviewer", source: "project", scope: "project", file: "reviewer", hash: "p1", overrides: "global", path: "/p/.pi/agents/reviewer.md" }),
    agent({ name: "writer", source: "global", scope: "global", file: "writer", hash: "w1", tools: "read, mcp:github/*", skills: ["gone"], otherFields: [{ key: "memory", value: "project" }], path: "/a/agents/writer.md" }),
  ],
  skills: [
    { name: "alpha", available: true, path: "/a/skills/alpha/SKILL.md" },
    { name: "beta", available: true, path: "/a/skills/beta/SKILL.md" },
    { name: "local", available: true, projectOnly: true },
    { name: "outside", available: false, reason: "Not available to sub-agents (outside sub-agent skill roots or behind a symlink)" },
  ],
  dirs: { global: "/a/agents", project: "/p/.pi/agents" },
  loaded: true,
  canRun: true,
});

function setup(data: SubagentManagementData = base()) {
  const onRequest = vi.fn();
  const onClose = vi.fn();
  let sequence = 0;
  let current: (SubagentManagementReply & { loading: boolean }) | null = { requestId: "initial", loading: false, data };
  const props = () => ({ state: current, models: [{ provider: "anthropic", id: "claude-sonnet-4-6", name: "Sonnet", reasoning: true }], connected: true, phone: false, onRequest, onClose });
  const view = render(<AgentsPanel {...props()} />);
  /** The server's answer to the last request: loading, then the reply. */
  const reply = (answer: Omit<SubagentManagementReply, "requestId">) => {
    const requestId = `r${++sequence}`;
    current = { requestId, loading: true, data: current?.data };
    view.rerender(<AgentsPanel {...props()} />);
    current = { ...answer, requestId, loading: false, data: answer.data ?? current.data };
    view.rerender(<AgentsPanel {...props()} />);
  };
  reply({ data });
  const last = () => onRequest.mock.calls.at(-1)?.[0];
  return { onRequest, onClose, reply, last };
}

const open = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

describe("AgentsPanel", () => {
  // openlore: scenario=ProjectOverridesGlobal spec=subagent-manager
  // openlore: scenario=ReadOnlySourcesCannotBeEdited spec=subagent-manager
  it("cards show source, override state, and read-only sources offer only View and Copy", () => {
    const { onRequest } = setup();
    expect(onRequest).toHaveBeenCalledWith({ action: "list" });
    const cards = screen.getAllByTestId("agent-card");
    const [pkg, global, project] = cards;
    expect(within(project).getByText("Overrides global")).toBeInTheDocument();
    expect(within(global).getByText("Overridden by project")).toBeInTheDocument();
    expect(within(pkg).getByText("Package · fake-pkg")).toBeInTheDocument();
    expect(within(pkg).queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(within(pkg).queryByRole("button", { name: /Disable/ })).toBeNull();
    expect(within(pkg).getByRole("button", { name: "Copy to global" })).toBeInTheDocument();
    open("View reviewer (Package)");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText(/Read-only: copy it/)).toBeInTheDocument();
  });

  // openlore: scenario=SubagentsNotLoaded spec=subagent-manager
  it("states that pi-subagents is not loaded and offers no Run", () => {
    setup({ ...base(), loaded: false, canRun: false, runUnavailableReason: "pi-subagents is not loaded in this project" });
    expect(screen.getByText(/pi-subagents is not loaded in this project\. Agent files can still be edited/)).toBeInTheDocument();
    open("Edit writer (Global)");
    expect(screen.getByRole("note")).toHaveTextContent("pi-subagents is not loaded");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  // openlore: scenario=AttachTwoSkills spec=subagent-manager
  // openlore: scenario=UnreachableSkillDisabled spec=subagent-manager
  // openlore: scenario=MissingAttachedSkillFlagged spec=subagent-manager
  it("attaches selected skills, disables unreachable ones and flags a missing attached one", () => {
    const { last } = setup();
    open("Edit writer (Global)");
    const skills = screen.getByRole("list", { name: "Skills" });
    expect(within(skills).getByLabelText(/outside/)).toBeDisabled();
    expect(within(skills).getByText(/outside sub-agent skill roots/)).toBeInTheDocument();
    expect(within(skills).getByText(/Not found/)).toBeInTheDocument();
    expect(within(skills).getByText(/resolves only in projects that contain it/)).toBeInTheDocument();
    fireEvent.click(within(skills).getByLabelText(/gone/));
    fireEvent.click(within(skills).getByLabelText(/^alpha/));
    fireEvent.click(within(skills).getByLabelText(/^beta/));
    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "alp" } });
    expect(within(skills).queryByLabelText(/^beta/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last()).toEqual({ action: "save", scope: "global", name: "writer", hash: "w1", changes: { skills: ["alpha", "beta"] } });
  });

  // openlore: scenario=DetachAllWritesFalse spec=subagent-manager
  // openlore: scenario=InheritRemovesKey spec=subagent-manager
  it("an empty selection saves skills false and All skills saves inherit", () => {
    const { last, reply } = setup();
    open("Edit writer (Global)");
    fireEvent.click(screen.getByLabelText(/gone/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().changes).toEqual({ skills: false });
    act(() => reply({ message: "Saved writer" }));
    expect(screen.getByText("Saved writer")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("All skills"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().changes).toEqual({ skills: true });
  });

  it("ticking a box from All skills starts a selection from what was shown", () => {
    const data = base();
    data.agents[3] = { ...data.agents[3], skills: true };
    const { last } = setup(data);
    open("Edit writer (Global)");
    expect(screen.getByLabelText(/^alpha/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/^beta/));
    expect(screen.getByLabelText("Only selected")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().changes).toEqual({ skills: ["alpha", "local"] });
  });

  // openlore: scenario=ToolsAllowListWritten spec=subagent-manager
  // openlore: scenario=SandboxDisclaimerShown spec=subagent-manager
  it("ticking a built-in tool keeps the other entries, and the editor states it is not a sandbox", () => {
    const { last } = setup();
    open("Edit writer (Global)");
    expect(screen.getByText(/not a security sandbox/)).toBeInTheDocument();
    expect(screen.getByLabelText("Other tool entries")).toHaveValue("mcp:github/*");
    fireEvent.click(screen.getByLabelText("grep"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().changes).toEqual({ tools: "read, grep, mcp:github/*" });
  });

  it("model, thinking, prompt mode and prompt are saved as changes; inherit sends null", () => {
    const { last } = setup();
    open("Edit writer (Global)");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: /claude-sonnet-4-6/ }));
    fireEvent.change(screen.getByLabelText("Thinking"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Prompt mode"), { target: { value: "append" } });
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Be brief." } });
    expect(screen.getByText("memory:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last().changes).toEqual({ model: "anthropic/claude-sonnet-4-6", thinking: "high", promptMode: "append", prompt: "Be brief." });
  });

  // openlore: scenario=DisableWritesEnabledFalse spec=subagent-manager
  it("the card toggle disables with the file's hash", () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Disable writer" }));
    expect(last()).toEqual({ action: "save", scope: "global", name: "writer", hash: "w1", changes: { enabled: false } });
  });

  // openlore: scenario=ExternalEditConflict spec=subagent-manager
  it("a conflict keeps the edit, says so, and reloads from disk on request; double Save sends once", () => {
    const { onRequest, reply, last } = setup();
    open("Edit writer (Global)");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "mine" } });
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onRequest.mock.calls.filter(([op]) => op.action === "save")).toHaveLength(1);
    const changed = base();
    changed.agents[3] = { ...changed.agents[3], hash: "w2", description: "edited elsewhere" };
    act(() => reply({ error: "The agent file changed on disk since it was loaded; reload it before saving again", conflict: true, data: changed }));
    expect(screen.getByRole("alert")).toHaveTextContent("changed on disk");
    expect(screen.getByLabelText("Description")).toHaveValue("mine");
    fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
    expect(screen.getByLabelText("Description")).toHaveValue("edited elsewhere");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "mine again" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(last()).toMatchObject({ action: "save", hash: "w2", changes: { description: "mine again" } });
  });

  // openlore: scenario=RunSpawnsInCurrentProject spec=subagent-manager
  it("runs an enabled active agent and shows the returned id", () => {
    const { reply, last } = setup();
    open("Edit reviewer (Project)");
    fireEvent.change(screen.getByLabelText("Run prompt"), { target: { value: "check README" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(last()).toEqual({ action: "spawn", type: "reviewer", prompt: "check README" });
    act(() => reply({ spawnedId: "agent-7", message: "Started" }));
    expect(screen.getByText("Started as agent-7")).toBeInTheDocument();
  });

  // openlore: scenario=RunUnavailableOnRpcRuntime spec=subagent-manager
  it("Run is unavailable with the reason on the rpc runtime", () => {
    setup({ ...base(), loaded: undefined, canRun: false, runUnavailableReason: "Run needs the embedded agent runtime; this project uses rpc" });
    open("Edit reviewer (Project)");
    expect(screen.getByRole("note")).toHaveTextContent("this project uses rpc");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("creates, copies with a chosen name, renames and deletes only after confirmation", () => {
    const { last, reply } = setup();
    open("+ New agent");
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "../bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Names use letters");
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "helper" } });
    fireEvent.click(screen.getByLabelText("This project"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(last()).toEqual({ action: "create", scope: "project", name: "helper" });
    act(() => reply({ message: "Created helper" }));
    fireEvent.click(within(screen.getAllByTestId("agent-card")[0]).getByRole("button", { name: "Copy to global" }));
    expect(screen.getByLabelText("Agent name")).toHaveValue("reviewer-copy");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(last()).toEqual({ action: "duplicate", from: { source: "package", name: "reviewer" }, scope: "global", name: "reviewer-copy" });
    act(() => reply({ message: "Copied" }));
    open("Edit writer (Global)");
    open("Rename");
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "author" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename agent" }));
    expect(last()).toEqual({ action: "rename", scope: "global", name: "writer", to: "author", hash: "w1" });
    act(() => reply({ error: "An agent named author already exists in this scope" }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open("Delete");
    expect(last().action).toBe("rename");
    confirm.mockReturnValue(true);
    open("Delete");
    expect(last()).toEqual({ action: "delete", scope: "global", name: "writer", hash: "w1" });
    confirm.mockRestore();
  });
});
