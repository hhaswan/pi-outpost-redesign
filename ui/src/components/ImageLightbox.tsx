import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { overlayHost } from "./EnlargedView";

/**
 * Every image that can open the lightbox registers here while it is mounted.
 *
 * No provider: the triggers live in the conversation, the file viewer and markdown
 * rendered anywhere, and the app shell that would host a provider is not theirs to
 * change. A group name ("conversation", "file:<path>") plus document order decides
 * what previous/next walks through, so images of one conversation form one sequence
 * without anybody passing a list around.
 */
interface LightboxEntry {
  id: string;
  src: string;
  alt: string;
  group: string;
  element: HTMLElement | null;
}

const entries = new Map<string, LightboxEntry>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** The images of `group` in the same tree as `root`, in document order. */
function sequence(group: string, root: Node | null): LightboxEntry[] {
  const list = [...entries.values()].filter(
    (entry) => entry.group === group && entry.element !== null && entry.element.isConnected && (root === null || entry.element.getRootNode() === root),
  );
  list.sort((a, b) => {
    const position = a.element!.compareDocumentPosition(b.element!);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return list;
}

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

const SWIPE_DISTANCE = 60;
const CLICK_SLOP = 6;
const ZOOMED = 1.01;

const CONTROL =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-40";

interface ImageLightboxProps {
  group: string;
  /** Tree (document or shadow root) the opening image lives in. */
  root: Node | null;
  /** Element to portal next to and to return focus to on close. */
  opener: HTMLElement | null;
  initialId: string;
  onClose: () => void;
}

/**
 * Full-screen viewer for one image of a sequence: zoom by pinch, double tap or
 * click, wheel (centred on the cursor) and + - 0; pan once zoomed; ← → and a
 * horizontal swipe change image; Escape, ×, a click on the backdrop and a swipe
 * down close it. Focus is trapped while open and goes back to the opener after.
 */
export function ImageLightbox({ group, root, opener, initialId, onClose }: ImageLightboxProps) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const list = sequence(group, root);
  const [current, setCurrent] = useState(() => ({ id: initialId, src: entries.get(initialId)?.src ?? "" }));
  const index = list.findIndex((entry) => entry.id === current.id);
  const entry = index >= 0 ? list[index] : undefined;
  // The image under the viewer went away or became another one (session switch, branch
  // change): close rather than show what is no longer there.
  const gone = entry === undefined || entry.src !== current.src;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (gone) onCloseRef.current();
  }, [gone]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const zoomRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const zoomed = scale > ZOOMED;

  const go = useCallback(
    (delta: number) => {
      const fresh = sequence(group, root);
      const at = fresh.findIndex((item) => item.id === current.id);
      if (at < 0 || fresh.length < 2) return;
      const next = fresh[(at + delta + fresh.length) % fresh.length]!;
      scaleRef.current = 1;
      setScale(1);
      setCurrent({ id: next.id, src: next.src });
    },
    [group, root, current.id],
  );

  // Focus in on open, back to the opener on close.
  useEffect(() => {
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  // The page behind does not scroll while the viewer is up.
  useEffect(() => {
    const body = globalThis.document.body;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent) => {
      const zoom = zoomRef.current;
      let handled = true;
      switch (event.key) {
        case "Escape":
          onCloseRef.current();
          break;
        case "ArrowRight":
          go(1);
          break;
        case "ArrowLeft":
          go(-1);
          break;
        case "+":
        case "=":
          void zoom?.zoomIn();
          break;
        case "-":
        case "_":
          void zoom?.zoomOut();
          break;
        case "0":
          void zoom?.resetTransform();
          break;
        case "Tab": {
          const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
          if (focusable.length === 0) break;
          const active = (dialogRef.current?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
          const at = focusable.indexOf(active as HTMLElement);
          const next = event.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : at === focusable.length - 1 || at < 0 ? 0 : at + 1;
          focusable[next]!.focus();
          break;
        }
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [go],
  );

  // Captured on the window so the app's own Escape handlers (panels, menus) do not also fire.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    globalThis.window.addEventListener("keydown", listener, true);
    return () => globalThis.window.removeEventListener("keydown", listener, true);
  }, [onKeyDown]);

  // Swipe and backdrop-click tracking. A pinch (two pointers) or a drag is neither.
  const gesture = useRef<{ x: number; y: number; pointers: number; moved: boolean; type: string; startScale: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (gesture.current === null) {
      gesture.current = { x: event.clientX, y: event.clientY, pointers: 1, moved: false, type: event.pointerType, startScale: scaleRef.current };
    } else {
      gesture.current.pointers += 1;
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) start.moved = true;
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (!start) return;
    gesture.current = null;
    if (start.pointers > 1 || start.type === "mouse" || start.startScale > ZOOMED || scaleRef.current > ZOOMED) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
      suppressClick.current = true;
    } else if (dy > SWIPE_DISTANCE && dy > Math.abs(dx) * 1.5) {
      suppressClick.current = true;
      onCloseRef.current();
    }
  };
  const lastPointer = useRef<{ moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onStageClick = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (lastPointer.current?.moved) return;
    const rect = imageRef.current?.getBoundingClientRect();
    const onImage = rect !== undefined && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!onImage) onCloseRef.current();
  };

  const host = useRef<Element | DocumentFragment>(undefined);
  host.current = overlayHost(opener) ?? host.current;

  if (gone || entry === undefined) return null;
  const label = entry.alt.trim() !== "" ? entry.alt : `Image ${index + 1}`;
  const many = list.length > 1;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${label}`}
      data-testid="image-lightbox"
      // Portalled, yet React still bubbles its events to the opener's ancestors (a markdown
      // link around the image, the message bubble): they stop here.
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onKeyDown={stop}
      className="fixed inset-0 z-[120] flex h-[100dvh] flex-col bg-black/90 text-white backdrop-blur-sm"
    >
      <div className="flex shrink-0 items-center gap-2 px-[max(0.75rem,env(safe-area-inset-left))] pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <span data-testid="image-lightbox-counter" aria-live="polite" className="min-w-0 flex-1 truncate text-sm tabular-nums text-white/80">
          {many ? `${index + 1} / ${list.length}` : label}
        </span>
        <button type="button" aria-label="Zoom out" title="Zoom out (-)" className={CONTROL} onClick={() => void zoomRef.current?.zoomOut()}>
          −
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" className={CONTROL} onClick={() => void zoomRef.current?.zoomIn()}>
          +
        </button>
        <button type="button" aria-label="Reset zoom" title="Reset zoom (0)" className={`${CONTROL} text-sm`} onClick={() => void zoomRef.current?.resetTransform()}>
          1:1
        </button>
        <button ref={closeRef} type="button" aria-label="Close image viewer" title="Close (Esc)" className={CONTROL} onClick={() => onCloseRef.current()}>
          ✕
        </button>
      </div>
      <div
        data-testid="image-lightbox-stage"
        className="relative min-h-0 flex-1 touch-none select-none"
        onPointerDown={(event) => {
          lastPointer.current = { moved: false };
          onPointerDown(event);
        }}
        onPointerMove={(event) => {
          onPointerMove(event);
          if (gesture.current?.moved && lastPointer.current) lastPointer.current.moved = true;
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onClick={onStageClick}
      >
        <TransformWrapper
          key={current.id}
          ref={zoomRef}
          minScale={1}
          maxScale={8}
          initialScale={1}
          limitToBounds
          centerZoomedOut
          doubleClick={{ mode: "toggle", step: 1.2 }}
          // The library adds step × |deltaY| per wheel event (smooth mode). One mouse notch is
          // deltaY ≈ 100, so 0.2 jumped straight to the maximum. 0.0025 makes a notch +25 %,
          // while a trackpad's small deltas still zoom finely.
          wheel={{ step: 0.0025 }}
          panning={{ disabled: !zoomed, velocityDisabled: true }}
          onTransform={(_ref, state) => {
            scaleRef.current = state.scale;
            setScale(state.scale);
          }}
        >
          <TransformComponent
            wrapperClass="!h-full !w-full overflow-hidden"
            contentClass="!h-full !w-full origin-top-left"
            contentProps={{ "data-testid": "image-lightbox-zoom" } as React.HTMLAttributes<HTMLDivElement>}
          >
            <div className="flex h-full w-full items-center justify-center px-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)]">
              <img
                ref={imageRef}
                src={entry.src}
                alt={entry.alt}
                draggable={false}
                className="pointer-events-none max-h-full max-w-full object-contain"
              />
            </div>
          </TransformComponent>
        </TransformWrapper>
        {many && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              className={`${CONTROL} absolute left-[max(0.75rem,env(safe-area-inset-left))] top-1/2 -translate-y-1/2 bg-black/40`}
              onClick={(event) => {
                event.stopPropagation();
                go(-1);
              }}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next image"
              className={`${CONTROL} absolute right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 -translate-y-1/2 bg-black/40`}
              onClick={(event) => {
                event.stopPropagation();
                go(1);
              }}
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>,
    host.current ?? globalThis.document.body,
  );
}

interface LightboxImageProps {
  src: string | undefined;
  alt?: string;
  /** Images of one group form one previous/next sequence, in document order. */
  group: string;
  /** Accessible name of the trigger; defaults to "Open image <alt>". */
  label?: string;
  className?: string;
  /** Layout classes of the trigger wrapper, replacing the default `inline-block max-w-full`. */
  triggerClassName?: string;
  loading?: "lazy" | "eager";
  onLoad?: () => void;
}

/**
 * An image that opens the lightbox on click, Enter or Space. A span with the button
 * role rather than a <button>: markdown can put an image inside a link, and a button
 * inside an anchor is not valid HTML.
 */
export function LightboxImage({ src, alt = "", group, label, className, triggerClassName, loading, onLoad }: LightboxImageProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    if (!src) return;
    entries.set(id, { id, src, alt, group, element: triggerRef.current });
    notify();
    return () => {
      entries.delete(id);
      notify();
    };
  }, [id, src, alt, group]);

  const close = useCallback(() => setOpen(false), []);

  if (!src) return <img src={src} alt={alt} className={className} loading={loading} onLoad={onLoad} />;
  const name = label ?? (alt.trim() !== "" ? `Open image ${alt}` : "Open image");
  const activate = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={name}
        aria-haspopup="dialog"
        data-lightbox-trigger=""
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") activate(event);
        }}
        className={`${triggerClassName ?? "inline-block max-w-full"} cursor-zoom-in rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        <img src={src} alt={alt} className={className} loading={loading} onLoad={onLoad} />
      </span>
      {open && <ImageLightbox group={group} root={triggerRef.current?.getRootNode() ?? null} opener={triggerRef.current} initialId={id} onClose={close} />}
    </>
  );
}
