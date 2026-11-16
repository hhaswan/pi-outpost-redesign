import type { SessionSummary } from "@pi-outpost/shared";

const PREVIEW = 80;

function preview(text: string): string {
  const first = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return first.length > PREVIEW ? `${first.slice(0, PREVIEW - 1).trimEnd()}…` : first;
}

/**
 * A readable title for a saved session, never "(empty)" for a sub-agent's child session.
 * Generated sub-agent names (`general-purpose#57816f08`) gain the task's first line.
 */
export function sessionLabel(session: Pick<SessionSummary, "id" | "name" | "firstMessage" | "parentSession">): string {
  const name = session.name?.trim();
  const message = preview(session.firstMessage ?? "");
  const generated = name && /^([\w.-]+)#[0-9a-f]{4,}$/i.exec(name);
  if (generated && message) return `${generated[1]} · ${message}`;
  if (name) return name;
  if (message) return session.parentSession ? message : session.firstMessage;
  return session.parentSession ? `Sub-agent · ${session.id.slice(0, 8)}` : "(empty)";
}
