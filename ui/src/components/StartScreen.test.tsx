import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RecentSession, WorkspaceInfo } from "@pi-outpost/shared";
import { StartScreen, relativeTime } from "./StartScreen";

const alpha: WorkspaceInfo = { root: "/srv/alpha", id: "/srv/alpha", name: "alpha", activity: "idle" };
const beta: WorkspaceInfo = { root: "/srv/beta", id: "/srv/beta", name: "beta", activity: "stopped" };
const side: WorkspaceInfo = { root: "/srv/alpha", id: "side-1", sideOf: "/srv/alpha", name: "alpha · side", activity: "working" };
const row = (id: string, root: string, extra: Partial<RecentSession> = {}): RecentSession => ({
  path: `/s/${id}.jsonl`, id, firstMessage: `Question ${id}`, modified: new Date(Date.now() - 3_600_000).toISOString(), root, projectName: root.split("/").pop()!, ...extra,
});

// openlore: spec=multi-project-workspaces
describe("StartScreen", () => {
  it("lists recent conversations with project, title, relative time and live status, and opens one", () => {
    const onOpenRecent = vi.fn();
    const recent = [row("b1", beta.root, { name: "Named beta", workspaceId: beta.id, activity: "working" }), row("a1", alpha.root)];
    render(<StartScreen workspaces={[alpha, beta]} recent={recent} onOpenRecent={onOpenRecent} onStartChat={vi.fn()} onOpenProject={vi.fn()} />);
    const rows = screen.getAllByTestId("start-recent-row");
    expect(rows.map((r) => r.textContent)).toEqual(["Named betabeta · 1 hour agoworking", "Question a1alpha · 1 hour ago"]);
    expect(screen.getAllByTestId("start-recent-status").map((s) => s.textContent)).toEqual(["working"]);
    fireEvent.click(rows[1]);
    expect(onOpenRecent).toHaveBeenCalledWith(recent[1]);
  });

  it("offers a chip per open project, last used first, side sessions excluded, and Open a project", () => {
    const onStartChat = vi.fn();
    const onOpenProject = vi.fn();
    render(<StartScreen workspaces={[alpha, side, beta]} recent={[row("b1", beta.root)]} onOpenRecent={vi.fn()} onStartChat={onStartChat} onOpenProject={onOpenProject} />);
    const chips = screen.getAllByTestId("start-project-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual(["beta", "alpha"]);
    fireEvent.click(chips[1]);
    expect(onStartChat).toHaveBeenCalledWith("/srv/alpha");
    fireEvent.click(screen.getByTestId("start-open-project"));
    expect(onOpenProject).toHaveBeenCalled();
  });

  it("says when recent conversations are loading or there are none", () => {
    const { rerender } = render(<StartScreen workspaces={[alpha]} recent={null} onOpenRecent={vi.fn()} onStartChat={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
    rerender(<StartScreen workspaces={[alpha]} recent={[]} onOpenRecent={vi.fn()} onStartChat={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByText("No saved conversations yet.")).toBeTruthy();
  });

  it("formats relative time", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    expect(relativeTime("2026-01-01T23:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-01-01T00:00:00Z", now)).toMatch(/yesterday|1 day ago/);
  });
});
