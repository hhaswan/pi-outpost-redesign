import type { WorkspaceInfo } from "@pi-outpost/shared";

export type WorkspaceSelection = Pick<WorkspaceInfo, "root" | "id">;

const TAB_KEY = "pi-outpost:workspace-tab:v1";
const TAB_STATE_KEY = "piOutpostWorkspaceTab";

// Browser-created tabs can inherit a copy of their opener's sessionStorage.
// The current history entry is not copied by window.open: pair it with a tab
// marker so a new tab discards cloned selections but a refresh keeps its own.
function ensureTabIdentity(): void {
  const stored = sessionStorage.getItem(TAB_KEY);
  const state = window.history.state;
  if (stored && state?.[TAB_STATE_KEY] === stored) return;
  if (stored) {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("pi-outpost:workspace:v2:")) sessionStorage.removeItem(key);
    }
  }
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  window.history.replaceState({ ...(state && typeof state === "object" ? state : {}), [TAB_STATE_KEY]: id }, "");
  sessionStorage.setItem(TAB_KEY, id);
}

// A workspace is a conversation, not a browser-wide preference. Keep the last
// acknowledged selection per tab across refresh and reconnect; a new tab starts
// independently. Never migrate the old shared localStorage key: doing so would
// make new tabs follow whichever project another tab selected most recently.
// Store workspace identity only, never credentials or a saved session path.
export function workspaceSelectionKey(serverUrl: string): string {
  const url = new URL(serverUrl || window.location.origin, window.location.href);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return `pi-outpost:workspace:v2:${url.href.replace(/\/$/, "")}`;
}

export function readWorkspaceSelection(serverUrl: string): WorkspaceSelection | null {
  try {
    ensureTabIdentity();
    const value: unknown = JSON.parse(sessionStorage.getItem(workspaceSelectionKey(serverUrl)) ?? "null");
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
      sessionStorage.removeItem(workspaceSelectionKey(serverUrl));
      return;
    }
    sessionStorage.setItem(workspaceSelectionKey(serverUrl), JSON.stringify({ root: workspace.root, ...(workspace.id !== undefined ? { id: workspace.id } : {}) }));
  } catch {
    // Storage can be disabled; reconnect still uses this tab's in-memory choice.
  }
}
