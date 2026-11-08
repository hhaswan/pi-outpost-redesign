import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { isProcessItem, ProcessGroup } from "./ProcessGroup";

const thought: ChatItem = { kind: "assistant", blocks: [{ type: "thinking", text: "private reasoning" }] };
const tool: ChatItem = { kind: "tool", toolCallId: "one", toolName: "read", args: { path: "test" }, output: "result" };

// Keep the markdown renderer out of this focused grouping test.
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));

describe("ProcessGroup", () => {
  it("groups consecutive thinking and tools while keeping detail hidden until expanded", () => {
    const { container } = render(<ProcessGroup entries={[{ item: thought, index: 0 }, { item: tool, index: 1 }]}
      showTools showReasoning highlightedIndex={null} dispatch={vi.fn()} />);
    expect(screen.getByText("Process · 1 tools · 1 thinking")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("private reasoning");
    expect(container).not.toHaveTextContent("read");
    fireEvent.click(screen.getByRole("button", { name: /Process/ }));
    expect(container).toHaveTextContent("read");
    fireEvent.click(screen.getByText("thinking"));
    expect(container).toHaveTextContent("private reasoning");
  });

  it("keeps notification transcript hidden until group expands", () => {
    const notification: ChatItem = { kind: "custom", customType: "subagent-notification", text: "<task-notification><summary>Worker finished review</summary><transcript>large transcript</transcript></task-notification>" };
    const { container } = render(<ProcessGroup entries={[{ item: notification, index: 2 }]} showTools showReasoning highlightedIndex={null} dispatch={vi.fn()} />);
    expect(container).not.toHaveTextContent("large transcript");
    fireEvent.click(screen.getByRole("button", { name: /Process/ }));
    expect(container).not.toHaveTextContent("large transcript");
    const disclosure = screen.getByRole("button", { name: "Worker finished review" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("pre")).toBeNull();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector("pre")).toHaveTextContent(notification.text);
    fireEvent.click(disclosure);
    expect(container.querySelector("pre")).toBeNull();
    expect(container).not.toHaveTextContent("large transcript");
  });

  it("opens an analysis target without reopening after the operator collapses it", () => {
    const dispatch = vi.fn();
    const { rerender } = render(<ProcessGroup entries={[{ item: tool, index: 4 }]} showTools showReasoning highlightedIndex={null} dispatch={dispatch} />);
    expect(screen.getByRole("button", { name: /Process/ })).toHaveAttribute("aria-expanded", "false");
    rerender(<ProcessGroup entries={[{ item: tool, index: 4 }]} showTools showReasoning highlightedIndex={4} dispatch={dispatch} />);
    expect(screen.getByRole("button", { name: /Process/ })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /Process/ }));
    rerender(<ProcessGroup entries={[{ item: { ...tool, output: "updated" }, index: 4 }]} showTools showReasoning highlightedIndex={4} dispatch={dispatch} />);
    expect(screen.getByRole("button", { name: /Process/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("does not absorb answer text or errors into process", () => {
    expect(isProcessItem(thought)).toBe(true);
    expect(isProcessItem(tool)).toBe(true);
    expect(isProcessItem({ kind: "custom", customType: "subagent-notification", text: "<task-notification>large transcript</task-notification>" })).toBe(true);
    expect(isProcessItem({ kind: "assistant", blocks: [{ type: "text", text: "answer" }] })).toBe(false);
    expect(isProcessItem({ ...thought, errorMessage: "failed" })).toBe(false);
  });
});
