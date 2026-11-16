import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { overlayHost } from "./EnlargedView";

/**
 * A surface that takes the screen on a phone: full screen, or a sheet rising from
 * the bottom edge.
 *
 * Mounted means open — the caller renders it conditionally. While open it owns
 * the keyboard: Tab cycles inside it, Escape closes it, and the page under it
 * does not scroll. Closing returns focus to whatever had it before.
 *
 * Sheets stack (the file viewer pushed over the file tree). Only the topmost one
 * answers Escape and traps focus, so one Escape peels one layer, and the body
 * stays locked until the last one closes.
 */
export type SheetVariant = "full" | "bottom";

export interface SheetProps {
  variant: SheetVariant;
  title: ReactNode;
  onClose: () => void;
  /** Shows a back control in the bar. A pushed sheet returns to the one under it. */
  onBack?: () => void;
  /** Controls placed in the bar between the title and the close button. */
  actions?: ReactNode;
  children: ReactNode;
  closeLabel?: string;
  backLabel?: string;
  testId?: string;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** Open sheets, oldest first. Only the last one answers keys. */
const stack: symbol[] = [];
let scrollLocks = 0;
let savedOverflow = "";

function lockScroll() {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

function activeElementIn(node: Node | null): Element | null {
  const root = node?.getRootNode() as Document | ShadowRoot | undefined;
  return root?.activeElement ?? document.activeElement;
}

const BAR_BUTTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

export function Sheet({
  variant,
  title,
  onClose,
  onBack,
  actions,
  children,
  closeLabel = "Close",
  backLabel = "Back",
  testId,
}: SheetProps) {
  const titleId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | DocumentFragment>();
  const [token] = useState(() => Symbol("sheet"));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Which tree the app lives in (document or a widget's shadow root) is known
  // only once the anchor is mounted; resolved before paint, so nothing flashes.
  useLayoutEffect(() => {
    setHost(overlayHost(anchorRef.current) ?? document.body);
  }, []);

  useEffect(() => {
    const opener = activeElementIn(anchorRef.current);
    stack.push(token);
    lockScroll();
    return () => {
      const index = stack.indexOf(token);
      if (index !== -1) stack.splice(index, 1);
      unlockScroll();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [token]);

  // Focus moves in once the panel exists (the portal mounts a render later).
  useEffect(() => {
    if (!host) return;
    const panel = panelRef.current;
    if (panel && !panel.contains(activeElementIn(panel))) panel.focus();
  }, [host]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (stack[stack.length - 1] !== token) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [token]);

  const trapTab = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab" || stack[stack.length - 1] !== token) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden],[inert]"));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = activeElementIn(panel);
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [token],
  );

  const bottom = variant === "bottom";
  const sheet = (
    <div className="fixed inset-0 z-[100]" data-testid={testId}>
      {bottom && (
        <div aria-hidden="true" data-testid={testId ? `${testId}-backdrop` : undefined} onClick={() => onCloseRef.current()} className="absolute inset-0 bg-black/40" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={
          bottom
            ? "absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none dark:bg-zinc-900"
            : "absolute inset-0 flex flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] focus:outline-none dark:bg-zinc-950"
        }
      >
        {bottom && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" />}
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-zinc-200 px-1 dark:border-zinc-800">
          {onBack && (
            <button type="button" onClick={onBack} aria-label={backLabel} className={BAR_BUTTON}>
              <span aria-hidden="true">‹</span>
            </button>
          )}
          <h2 id={titleId} className={`min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100 ${onBack ? "" : "pl-3"}`}>
            {title}
          </h2>
          {actions}
          <button type="button" onClick={() => onCloseRef.current()} aria-label={closeLabel} className={BAR_BUTTON}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );

  return (
    <>
      <span ref={anchorRef} hidden />
      {host && createPortal(sheet, host)}
    </>
  );
}
