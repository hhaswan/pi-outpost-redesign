import type { ReactNode } from "react";

/**
 * The phone's primary surfaces: one at a time, chosen from the bottom navigation.
 * `chat` is the conversation itself; the others open over it.
 */
export type PhoneSurface = "chat" | "files" | "sessions" | "plan" | "terminal";

interface PhoneNavProps {
  active: PhoneSurface;
  onSelect: (surface: PhoneSurface) => void;
  /** Work Plan progress; absent while the session has no plan, and Plan is then disabled. */
  plan?: { done: number; total: number } | null;
  /** The terminal is enabled on this server; otherwise it has no entry. */
  terminal: boolean;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
      {children}
    </svg>
  );
}

const ICONS: Record<PhoneSurface, ReactNode> = {
  chat: (
    <Icon>
      <path d="M4 5h16v11H9l-5 4z" />
    </Icon>
  ),
  files: (
    <Icon>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  ),
  sessions: (
    <Icon>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </Icon>
  ),
  plan: (
    <Icon>
      <path d="m4 7 2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8" />
    </Icon>
  ),
  terminal: (
    <Icon>
      <path d="m5 8 4 4-4 4M12 16h7" />
    </Icon>
  ),
};

const LABELS: Record<PhoneSurface, string> = {
  chat: "Chat",
  files: "Files",
  sessions: "Sessions",
  plan: "Plan",
  terminal: "Terminal",
};

/**
 * Bottom navigation on phones: 56 px plus the safe area, every entry at least
 * 44 px. Choosing the active entry again returns to the conversation.
 */
export function PhoneNav({ active, onSelect, plan, terminal }: PhoneNavProps) {
  const surfaces: PhoneSurface[] = ["chat", "files", "sessions", "plan", ...(terminal ? (["terminal"] as const) : [])];
  return (
    <nav
      aria-label="Primary"
      data-testid="phone-nav"
      className="shrink-0 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <ul className="flex h-14 items-stretch gap-1 px-2">
        {surfaces.map((surface) => {
          const current = surface === active;
          const disabled = surface === "plan" && !plan;
          return (
            <li key={surface} className="flex min-w-0 flex-1">
              <button
                type="button"
                disabled={disabled}
                aria-current={current ? "page" : undefined}
                title={disabled ? "No Work Plan in this session" : undefined}
                onClick={() => onSelect(current && surface !== "chat" ? "chat" : surface)}
                className={`group my-1 flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 ${
                  current
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <span className="relative">
                  {ICONS[surface]}
                  {surface === "plan" && plan && (
                    <span
                      data-testid="phone-nav-plan-badge"
                      className="absolute -right-4 -top-1.5 rounded-full bg-emerald-600 px-1 text-[9px] font-semibold leading-4 text-white dark:bg-emerald-500"
                    >
                      {plan.done}/{plan.total}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{LABELS[surface]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
