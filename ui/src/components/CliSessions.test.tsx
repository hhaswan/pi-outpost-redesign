import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { CliBridgeReply, CliBridgeSnapshot, CliBridgeSummary } from "@pi-outpost/shared";
import { CliSessions } from "./CliSessions";

const sessions: CliBridgeSummary[] = [
  { id: "owner-a", cwd: "/project/a", sessionId: "session-a", activity: "idle", inputGranted: true },
  { id: "owner-b", cwd: "/project/b", sessionId: "session-b", activity: "unreachable", inputGranted: false },
];
const snapshot: CliBridgeSnapshot = { instanceId: "owner-a", generation: "generation-7", cwd: "/project/a", sessionId: "session-a", activity: "idle", inputGranted: true, transcript: '<img src=x onerror="alert(1)">\n<script>bad()</script>', truncated: true };
function setup() {
  const onRequest = vi.fn();
  const onClose = vi.fn();
  let connected = true;
  let state: (CliBridgeReply & { loading: boolean }) | null = null;
  const view = render(<CliSessions state={state} connected={connected} onRequest={onRequest} onClose={onClose} />);
  const update = (reply: CliBridgeReply & { loading?: boolean }, online = connected) => {
    connected = online;
    state = { ...reply, loading: reply.loading ?? false };
    view.rerender(<CliSessions state={state} connected={connected} onRequest={onRequest} onClose={onClose} />);
  };
  update({ requestId: "list", sessions });
  const read = (overrides: Partial<CliBridgeSnapshot> = {}) => {
    fireEvent.click(screen.getByRole("button", { name: /Project: \/project\/a/ }));
    update({ requestId: "read", snapshot: { ...snapshot, ...overrides } });
  };
  return { ...view, update, read, onRequest, onClose };
}

describe("CliSessions", () => {
  it("EnrolledCliDiscovery: lists project, session, owner and unknown activity; reads only the selected owner", () => {
    const { onRequest, read } = setup();
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({ action: "list" });
    expect(screen.getByText("Session: session-a")).toBeInTheDocument();
    expect(screen.getByText("Owner: owner-b")).toBeInTheDocument();
    expect(screen.getByText("Activity: unknown / unreachable")).toBeInTheDocument();
    read();
    expect(onRequest).toHaveBeenLastCalledWith({ action: "read", id: "owner-a" });
  });
  it("ObserveAndReconnect: renders inert bounded text and manually refreshes list and transcript", () => {
    const { read, update, onRequest, container } = setup();
    read();
    expect(screen.getByLabelText("CLI transcript").textContent).toBe(snapshot.transcript);
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByText("Transcript truncated by the CLI owner.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh transcript" }));
    expect(onRequest).toHaveBeenLastCalledWith({ action: "read", id: "owner-a" });
    update({ requestId: "refresh", snapshot: { ...snapshot, transcript: "New owner text" } });
    expect(screen.getByLabelText("CLI transcript")).toHaveTextContent("New owner text");
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    expect(onRequest).toHaveBeenLastCalledWith({ action: "list" });
  });
  it("never displays another owner's stale snapshot", () => {
    const { read, update } = setup();
    read();
    fireEvent.click(screen.getByRole("button", { name: /Project: \/project\/b/ }));
    update({ requestId: "other", snapshot });
    expect(screen.queryByLabelText("CLI transcript")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit to CLI" })).toBeDisabled();
  });
  it.each([
    { inputGranted: false }, { activity: "waiting" as const },
  ])("RefuseUnsafeInput: disables input for %j", (overrides) => {
    const { read } = setup();
    read(overrides);
    expect(screen.getByLabelText("Message to CLI")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit to CLI" })).toBeDisabled();
    expect(screen.getByText("/outpost-bridge revoke")).toBeInTheDocument();
  });
  // openlore: scenario=BusyCliQueuesWebPromptAsFollowUp spec=shared-cli-web-sessions
  it("BusyCliQueuesWebPromptAsFollowUp: a working CLI accepts a message, said to wait for the turn", () => {
    const { read } = setup();
    read({ activity: "working" });
    expect(screen.getByLabelText("Message to CLI")).not.toBeDisabled();
    expect(screen.getByText("CLI is working. A message waits until its turn ends.")).toBeInTheDocument();
    expect(screen.queryByText(/allow/)).not.toBeInTheDocument();
  });
  it("UnreachableOwner: disables input when disconnected and does not restore stale permission on reconnect", () => {
    const { read, update } = setup();
    read();
    update({ requestId: "read", snapshot }, false);
    expect(screen.getByLabelText("Message to CLI")).toBeDisabled();
    expect(screen.getAllByText("Activity: unknown / unreachable")).toHaveLength(2);
    update({ requestId: "read", snapshot }, true);
    expect(screen.getByLabelText("Message to CLI")).toBeDisabled();
  });
  it("GrantAndSubmit: sends exact generation, unique inputId and text once, acknowledging submission only", () => {
    const { read, update, onRequest } = setup();
    read();
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    fireEvent.change(screen.getByLabelText("Message to CLI"), { target: { value: "  hello CLI\nkeep spacing  " } });
    const submit = screen.getByRole("button", { name: "Submit to CLI" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onRequest).toHaveBeenCalledTimes(3);
    expect(onRequest).toHaveBeenLastCalledWith({ action: "submit", id: "owner-a", generation: "generation-7", inputId: "11111111-1111-4111-8111-111111111111", text: "  hello CLI\nkeep spacing  " });
    update({ requestId: "send", loading: true });
    expect(screen.getByText("Sending to CLI…")).toBeInTheDocument();
    update({ requestId: "send", submitted: true });
    expect(screen.getByText("Submitted to CLI; acceptance is shown in its transcript")).toBeInTheDocument();
    expect(screen.getByLabelText("Message to CLI")).toHaveValue("");
    expect(submit).toBeDisabled();
    uuid.mockRestore();
  });
  it("preserves refused drafts and never retries uncertain submissions automatically", () => {
    const { read, update, onRequest } = setup();
    read();
    fireEvent.change(screen.getByLabelText("Message to CLI"), { target: { value: "preserve me" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit to CLI" }));
    update({ requestId: "send", error: "Input permission refused" });
    expect(screen.getByRole("alert")).toHaveTextContent("Input permission refused");
    expect(screen.getByLabelText("Message to CLI")).toHaveValue("preserve me");
    expect(screen.getByText(/No automatic retry/)).toBeInTheDocument();
    expect(onRequest).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Submit to CLI" })).toBeDisabled();
  });
  it.each([" /command", "\n!shell", "x".repeat(8001)])("refuses command-shaped or oversized text (%#)", (text) => {
    const { read, onRequest } = setup();
    read();
    fireEvent.change(screen.getByLabelText("Message to CLI"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Submit to CLI" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter plain text");
    expect(onRequest).toHaveBeenCalledTimes(2);
  });
  it("shows explicit empty enrollment guidance", () => {
    const { update } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    update({ requestId: "empty", sessions: [] });
    expect(screen.getByText("pi -e <bridge-extension>")).toBeInTheDocument();
    expect(screen.getByText(/not all OS processes/)).toBeInTheDocument();
  });
  it("focuses close, traps Tab in both directions, handles Escape and restores focus", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { onClose, unmount } = setup();
    const close = screen.getByRole("button", { name: "Close CLI sessions" });
    expect(close).toHaveFocus();
    const first = screen.getByRole("button", { name: "Refresh list" });
    const last = screen.getByRole("button", { name: /Project: \/project\/b/ });
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

it("refreshes owner permission while preserving a nonempty draft", () => {
  vi.useFakeTimers();
  try {
    const { read, update, onRequest, unmount } = setup();
    read();
    fireEvent.change(screen.getByLabelText("Message to CLI"), { target: { value: "unsent draft" } });
    act(() => vi.advanceTimersByTime(2000));
    expect(onRequest).toHaveBeenLastCalledWith({ action: "read", id: "owner-a" });
    expect(screen.getByLabelText("Message to CLI")).toHaveValue("unsent draft");
    expect(screen.getByLabelText("Message to CLI")).not.toBeDisabled();
    expect(screen.getByText("Checking CLI status…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit to CLI" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Checking CLI status. Try Submit again");
    expect(onRequest).toHaveBeenCalledTimes(3); // list, selected owner, refresh; never a silent submit
    update({ requestId: "refresh-owner", snapshot: { ...snapshot, inputGranted: false } });
    expect(screen.getByLabelText("Message to CLI")).toHaveValue("unsent draft");
    expect(screen.getByLabelText("Message to CLI")).toBeDisabled();
    unmount();
  } finally { vi.useRealTimers(); }
});
