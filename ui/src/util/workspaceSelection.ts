import type { WorkspaceInfo } from "@pi-outpost/shared";

export type WorkspaceSelection = Pick<WorkspaceInfo, "root" | "id">;

// localStorage deliberately supports reopening the browser. New tabs/refreshes
// start from the last acknowledged selection; an already mounted tab keeps its
// own selection in memory and never follows another tab's storage writes.
// Store workspace identity only, never credentials or a saved session path.
export function workspaceSelectionKey(serverUrl: string): string {
  const url = new URL(serverUrl || window.location.origin, window.location.href);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return `pi-outpost:workspace:v1:${url.href.replace(/\/$/, "")}`;
}

export function readWorkspaceSelection(serverUrl: string): WorkspaceSelection | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(workspaceSelectionKey(serverUrl)) ?? "null");
    if (!value || typeof value !== "object" || !("root" in value) || typeof value.root !== "string" || !value.root) return null;
    if ("id" in value && (typeof value.id !== "string" || !value.id)) return null;
    return { root: value.root, ...("id" in value ? { id: value.id as string } : {}) };
  } catch {
    return null;
  }
}

export function writeWorkspaceSelection(serverUrl: string, workspace: WorkspaceSelection | null): void {
  try {
    if (!workspace) {
      localStorage.removeItem(workspaceSelectionKey(serverUrl));
      return;
    }
    localStorage.setItem(workspaceSelectionKey(serverUrl), JSON.stringify({ root: workspace.root, ...(workspace.id !== undefined ? { id: workspace.id } : {}) }));
  } catch {
    // Storage can be disabled; reconnect still uses this tab's in-memory choice.
  }
}
