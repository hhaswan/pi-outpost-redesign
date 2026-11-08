import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MCPManager } from "./MCPManager";
import type { McpManagementData } from "@pi-outpost/shared";

const data: McpManagementData = {
  editable: true,
  documents: [{ scope: "project", path: ".mcp.json", revision: "one", servers: { example: { url: "https://host/mcp" } } }],
  servers: [{ name: "example", status: "connected", toolCount: 2, listenState: "listening" }],
};
function setup(overrides: Partial<React.ComponentProps<typeof MCPManager>> = {}) {
  const props = { onRequest: vi.fn(), onClose: vi.fn(), onApply: vi.fn(), state: { requestId: "one", loading: false, data }, connected: true, busy: false, ...overrides };
  return { ...render(<MCPManager {...props} />), ...props };
}

describe("MCPManager", () => {
  it("loads real status and connects through a bounded operator action", () => {
    const { onRequest } = setup();
    expect(onRequest).toHaveBeenCalledWith({ action: "list" });
    expect(screen.getByText("connected · 2 tools · listening")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onRequest).toHaveBeenCalledWith({ action: "connect", name: "example" });
  });
  it("saves edited configuration with original scope and revision", () => {
    const { onRequest } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    fireEvent.change(screen.getByLabelText("Server configuration (JSON)"), { target: { value: '{"url":"https://new/mcp"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(onRequest).toHaveBeenCalledWith({ action: "save", name: "example", scope: "project", revision: "one", config: { url: "https://new/mcp" } });
  });
  it("keeps invalid JSON visible and never submits it", () => {
    const { onRequest } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    fireEvent.change(screen.getByLabelText("Server configuration (JSON)"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON");
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Server configuration (JSON)")).toHaveValue("{");
  });
  it("adds a named server and requires confirmation before removing a definition", () => {
    const { onRequest } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add server" }));
    fireEvent.change(screen.getByLabelText("Server name"), { target: { value: "new-server" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "save", name: "new-server" }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    expect(onRequest).not.toHaveBeenCalledWith(expect.objectContaining({ action: "remove" }));
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    expect(onRequest).toHaveBeenCalledWith({ action: "remove", scope: "project", name: "example", revision: "one" });
    confirm.mockRestore();
  });
  it("refuses edits during an active turn and closes using Escape", () => {
    const { onClose } = setup({ busy: true });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Add server" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("shows errors instead of success and requires explicit idle-session apply", () => {
    const onApply = vi.fn();
    setup({ onApply, state: { requestId: "two", loading: false, error: "Conflict: refresh", reloadRequired: true, data } });
    expect(screen.getByRole("alert")).toHaveTextContent("Conflict: refresh");
    expect(onApply).not.toHaveBeenCalled();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply saved configuration" }));
    expect(onApply).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
});

describe("MCP conflict recovery", () => {
  it("preserves replacement credentials through refresh and requires explicit revision reconciliation", () => {
    const onRequest = vi.fn();
    const props = { onClose: vi.fn(), onApply: vi.fn(), onRequest, connected: true, busy: false };
    const { rerender } = render(<MCPManager {...props} state={{ requestId: "one", loading: false, data }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    const draft = '{"url":"https://host/mcp","headers":{"Authorization":"replacement-secret"}}';
    fireEvent.change(screen.getByLabelText("Server configuration (JSON)"), { target: { value: draft } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    rerender(<MCPManager {...props} state={{ requestId: "refresh", loading: true, data }} />);
    const refreshed = { ...data, documents: data.documents.map((doc) => ({ ...doc, revision: "two" })) };
    rerender(<MCPManager {...props} state={{ requestId: "refresh", loading: false, data: refreshed }} />);
    expect(screen.getByLabelText("Server configuration (JSON)")).toHaveValue(draft);
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({ action: "save", revision: "one" }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Use refreshed revision" }));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({ action: "save", revision: "two" }));
    confirm.mockRestore();
  });
});
