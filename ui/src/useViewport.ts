import { useEffect, useState } from "react";

/**
 * The layout class the interface renders for, and whether the pointer is coarse.
 *
 * One source for every component: a panel that asks `matchMedia` privately can
 * disagree with the shell about whether the screen is narrow, and the two then
 * render a layout neither was designed for.
 *
 * - `phone`: below 768 px (Tailwind `md`).
 * - `tablet`: 768–1023 px.
 * - `desktop`: 1024 px and above.
 */
export type ViewportKind = "phone" | "tablet" | "desktop";

export interface Viewport {
  kind: ViewportKind;
  coarse: boolean;
}

export const PHONE_QUERY = "(max-width: 767px)";
export const TABLET_QUERY = "(max-width: 1023px)";
export const COARSE_QUERY = "(pointer: coarse)";

const DESKTOP: Viewport = { kind: "desktop", coarse: false };

function matches(query: string): boolean | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia(query)?.matches;
}

/** Reads the viewport now. Without a window (server rendering) it is a desktop. */
export function readViewport(): Viewport {
  if (typeof window === "undefined") return DESKTOP;
  const phone = matches(PHONE_QUERY);
  const tablet = matches(TABLET_QUERY);
  const width = window.innerWidth;
  // Where matchMedia is missing, width is the only evidence there is.
  const isPhone = phone ?? width < 768;
  const isTablet = tablet ?? width < 1024;
  return {
    kind: isPhone ? "phone" : isTablet ? "tablet" : "desktop",
    coarse: matches(COARSE_QUERY) ?? false,
  };
}

function same(a: Viewport, b: Viewport): boolean {
  return a.kind === b.kind && a.coarse === b.coarse;
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(readViewport);

  useEffect(() => {
    const update = () => {
      const next = readViewport();
      setViewport((current) => (same(current, next) ? current : next));
    };
    update();
    const lists =
      typeof window.matchMedia === "function"
        ? [PHONE_QUERY, TABLET_QUERY, COARSE_QUERY].map((query) => window.matchMedia(query)).filter(Boolean)
        : [];
    for (const list of lists) list.addEventListener?.("change", update);
    // Some engines fire no media change for a zoom or a devtools resize; the
    // resize event is the backstop, and `same` keeps it from re-rendering.
    window.addEventListener("resize", update);
    return () => {
      for (const list of lists) list.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return viewport;
}
