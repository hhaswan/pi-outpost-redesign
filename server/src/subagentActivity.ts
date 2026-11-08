import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

type Activity = { running: number; queued: number; known: boolean };
type Activation = { snapshot: Activity; dispose: (notify?: boolean) => void };

// This registry exposes snapshots only; each ledger belongs to one extension bus.
const activations = new Map<string, Activation>();
const HISTORY_LIMIT = 1024;

/** `known` describes this activation's scoped ledger, not support for every subagent producer. */
export function getSubagentActivity(sessionId: string): Activity {
  return { ...(activations.get(sessionId)?.snapshot ?? { running: 0, queued: 0, known: false }) };
}

/** An activated but uncertain ledger must never authorize automatic teardown. */
export function hasActiveOrUncertainSubagents(sessionId: string): boolean {
  const activity = activations.get(sessionId)?.snapshot;
  return activity !== undefined && (!activity.known || activity.running + activity.queued > 0);
}

/** Observe explicitly detached, top-level Agent calls on this runtime's private event bus. */
export function createSubagentActivityExtension(sessionId: string, onChange: () => void): ExtensionFactory {
  return (pi) => {
    activations.get(sessionId)?.dispose(false);
    const active = new Map<string, "running" | "queued">();
    const started = new Set<string>();
    const terminal = new Set<string>();
    const unsubscribe: Array<() => void> = [];
    let known = true;
    let historyLost = false;
    let disposed = false;
    const activation: Activation = {
      snapshot: { running: 0, queued: 0, known: true },
      dispose(notify = true) {
        if (disposed) return;
        disposed = true;
        for (const off of unsubscribe) off();
        active.clear();
        started.clear();
        terminal.clear();
        if (activations.get(sessionId) !== activation) return;
        activations.delete(sessionId);
        const previous = activation.snapshot;
        if (notify && (previous.running || previous.queued || previous.known)) onChange();
      },
    };
    // Construction is silent: the host's runtime may not yet have been assigned.
    activations.set(sessionId, activation);
    const current = () => !disposed && activations.get(sessionId) === activation;
    const publish = () => {
      let running = 0;
      let queued = 0;
      for (const state of active.values()) {
        if (state === "running") running++;
        else queued++;
      }
      const previous = activation.snapshot;
      activation.snapshot = { running, queued, known };
      if (running !== previous.running || queued !== previous.queued || known !== previous.known) onChange();
    };
    const remember = (set: Set<string>, id: string) => {
      set.add(id);
      if (set.size > HISTORY_LIMIT) {
        set.delete(set.values().next().value!);
        // Once ordering evidence is evicted, no later event can restore certainty.
        historyLost = true;
        known = false;
      }
    };
    const observe = (channel: string, handle: (id: string, data: Record<string, unknown>) => void) => {
      unsubscribe.push(pi.events.on(channel, (data) => {
        if (!current()) return;
        if (!data || typeof data !== "object" || Array.isArray(data)
          || !("id" in data) || typeof data.id !== "string" || !data.id.trim()) {
          known = false;
        } else {
          handle(data.id, data as Record<string, unknown>);
        }
        publish();
      }));
    };
    observe("subagents:started", (id) => {
      if (terminal.has(id)) known = false;
      if (active.has(id)) active.set(id, "running");
      else remember(started, id);
    });
    observe("subagents:created", (id, data) => {
      if (data.isBackground === false) return;
      if (data.isBackground !== true) {
        known = false;
        return;
      }
      if (active.has(id)) return;
      // Resume emits started before created when immediate, but created before
      // started when queued. Without run generations, a late created and a queued
      // resume are indistinguishable. Never revive a terminal run on created alone.
      if (terminal.has(id)) {
        known = false;
        if (!started.has(id)) return;
      }
      if (historyLost && !started.has(id)) return;
      active.set(id, started.has(id) ? "running" : "queued");
      started.delete(id);
      terminal.delete(id);
    });
    const finish = (statuses: string[]) => (id: string, data: Record<string, unknown>) => {
      if (data.status !== undefined && (typeof data.status !== "string" || !statuses.includes(data.status))) {
        known = false;
        return;
      }
      active.delete(id);
      started.delete(id);
      remember(terminal, id);
    };
    observe("subagents:completed", finish(["completed", "steered"]));
    observe("subagents:failed", finish(["error", "stopped", "aborted"]));
    unsubscribe.push(pi.events.on("subagents:disposed", (data) => {
      if (!current()) return;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        known = false;
        publish();
        return;
      }
      activation.dispose();
    }));
    unsubscribe.push(pi.on("session_shutdown", () => activation.dispose()));
  };
}
