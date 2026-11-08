import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ActivityStrip } from "./ActivityStrip";

afterEach(cleanup);
type State = ComponentProps<typeof ActivityStrip>["state"];
const base: State = {
  connected: true, authRequired: false, switching: false, agentStarting: false,
  workspace: { root: "/project", name: "Project", activity: "idle" }, workspaces: [],
  sessionId: "session-1", sessionName: "Review changes", isStreaming: false,
  pendingPrompt: null, dialogQueue: [], errors: [],
};

function status() { return screen.getByRole("status").textContent; }

describe("ActivityStrip", () => {
  it("Live transitions follow precedence", () => {
    const { rerender } = render(<ActivityStrip state={base} />);
    expect(status()).toContain("Idle");
    expect(status()).toContain("Project · Review changes");
    const update = (patch: Partial<State>) => rerender(<ActivityStrip state={{ ...base, ...patch }} />);
    update({ pendingPrompt: { text: "Run" } });
    expect(status()).toContain("Working");
    update({ isStreaming: true });
    expect(status()).toContain("Working");
    update({ isStreaming: true, dialogQueue: [{ id: "question" } as State["dialogQueue"][number]] });
    expect(status()).toContain("Waiting for you");
    update({ agentStarting: true, isStreaming: true });
    expect(status()).toContain("Starting agent");
    update({ switching: true, agentStarting: true });
    expect(status()).toContain("Switching project");
    expect(status()).toContain("Last viewed:");
    update({});
    expect(status()).toContain("Idle");
  });

  it.each([
    ["working", "Working"], ["waiting", "Waiting for you"],
    ["starting", "Starting agent"], ["ready-for-review", "Ready for review"], ["stopped", "Stopped"],
  ] as const)("Authoritative workspace activity: %s", (activity, label) => {
    render(<ActivityStrip state={{ ...base, workspace: { ...base.workspace!, activity } }} />);
    expect(status()).toContain(label);
  });

  it("Disconnected and authentication states never claim idle or live background work", () => {
    const state = { ...base, connected: false, isStreaming: true, switching: true,
      workspaces: [{ root: "/other", name: "Other", activity: "working" as const }] };
    const { rerender } = render(<ActivityStrip state={state} />);
    expect(status()).toContain("Disconnected · activity unknown");
    expect(status()).not.toContain("Idle");
    expect(screen.queryByLabelText("Other project activity")).toBeNull();
    rerender(<ActivityStrip state={{ ...state, authRequired: true }} />);
    expect(status()).toContain("Authentication required · activity unknown");
    rerender(<ActivityStrip state={{ ...base, workspace: null, sessionId: "" }} />);
    expect(status()).toContain("Connected · activity unknown");
    rerender(<ActivityStrip state={{ ...base, workspace: null }} />);
    expect(status()).toContain("Idle");
  });

  it("Historical errors do not replace current activity", () => {
    const { rerender } = render(<ActivityStrip state={{ ...base, errors: ["old", "previous failure"], isStreaming: true }} />);
    expect(status()).toContain("Working");
    expect(screen.getByText("Last error: previous failure")).toBeTruthy();
    expect(status()).not.toContain("failure");
    rerender(<ActivityStrip state={{ ...base, errors: ["previous failure"] }} />);
    expect(status()).toContain("Idle");
    rerender(<ActivityStrip state={{ ...base, switching: true, errors: ["previous failure"] }} />);
    expect(screen.queryByText("Last error: previous failure")).toBeNull();
  });

  it("Other workspace identity remains distinct for same-root side sessions", () => {
    const onSwitchWorkspace = vi.fn();
    const workspaces: State["workspaces"] = [
      { ...base.workspace!, activity: "working" },
      { root: "/project", id: "side-1", name: "Project", label: "Checks", activity: "waiting" },
      { root: "/other", name: "Other", activity: "ready-for-review" },
      { root: "/idle", name: "Quiet", activity: "idle" },
      { root: "/stopped", name: "Stopped project", activity: "stopped" },
    ];
    const { rerender } = render(<ActivityStrip state={{ ...base, workspaces }} onSwitchWorkspace={onSwitchWorkspace} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Project · Checks · Waiting for you (side-1)" }));
    expect(onSwitchWorkspace).toHaveBeenCalledWith("/project", "side-1");
    fireEvent.click(screen.getByRole("button", { name: "Other · Ready for review (/other)" }));
    expect(onSwitchWorkspace).toHaveBeenLastCalledWith("/other", undefined);
    rerender(<ActivityStrip state={{ ...base, workspaces, switching: true }} onSwitchWorkspace={onSwitchWorkspace} />);
    expect(screen.getAllByRole("button").every((button: HTMLElement) => (button as HTMLButtonElement).disabled)).toBe(true);
    rerender(<ActivityStrip state={{ ...base, workspaces }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Project · Checks · Waiting for you")).toBeTruthy();
    rerender(<ActivityStrip state={{ ...base, workspaces: [] }} />);
    expect(screen.queryByLabelText("Other project activity")).toBeNull();
  });

  it("Context falls back to side-session label then session identity", () => {
    const { rerender } = render(<ActivityStrip state={{ ...base, sessionName: null, workspace: { ...base.workspace!, label: "Side review" } }} />);
    expect(status()).toContain("Side review");
    rerender(<ActivityStrip state={{ ...base, sessionName: null }} />);
    expect(status()).toContain("session-1");
    rerender(<ActivityStrip state={{ ...base, sessionName: null, sessionId: "" }} />);
    expect(status()).toContain("Session not yet available");
  });
});
