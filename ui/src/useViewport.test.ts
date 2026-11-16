import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COARSE_QUERY, PHONE_QUERY, TABLET_QUERY, readViewport, useViewport } from "./useViewport";

type Listener = () => void;

/** A matchMedia whose answers follow a mutable width and pointer, and that fires `change`. */
function installMedia(initial: { width: number; coarse?: boolean }) {
  const env = { width: initial.width, coarse: initial.coarse ?? false };
  const listeners = new Map<string, Set<Listener>>();
  const answer = (query: string) => {
    if (query === PHONE_QUERY) return env.width <= 767;
    if (query === TABLET_QUERY) return env.width <= 1023;
    if (query === COARSE_QUERY) return env.coarse;
    return false;
  };
  const matchMedia = vi.fn((query: string) => ({
    get matches() { return answer(query); },
    media: query,
    addEventListener: (_type: string, listener: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(listener);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.get(query)?.delete(listener);
    },
  }));
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    set(next: { width?: number; coarse?: boolean }) {
      if (next.width !== undefined) env.width = next.width;
      if (next.coarse !== undefined) env.coarse = next.coarse;
      for (const set of listeners.values()) for (const listener of [...set]) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useViewport", () => {
  it.each([
    [360, "phone"],
    [767, "phone"],
    [768, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1280, "desktop"],
  ] as const)("classifies %i px as %s", (width, kind) => {
    installMedia({ width });
    const { result } = renderHook(() => useViewport());
    expect(result.current.kind).toBe(kind);
  });

  it("reports a coarse pointer", () => {
    installMedia({ width: 390, coarse: true });
    const { result } = renderHook(() => useViewport());
    expect(result.current).toEqual({ kind: "phone", coarse: true });
  });

  it("follows media changes across breakpoints", () => {
    const media = installMedia({ width: 1280 });
    const { result } = renderHook(() => useViewport());
    expect(result.current.kind).toBe("desktop");

    act(() => media.set({ width: 800 }));
    expect(result.current.kind).toBe("tablet");

    act(() => media.set({ width: 390, coarse: true }));
    expect(result.current).toEqual({ kind: "phone", coarse: true });

    act(() => media.set({ width: 1100, coarse: false }));
    expect(result.current).toEqual({ kind: "desktop", coarse: false });
  });

  it("keeps the same object when a resize changes nothing, so readers do not re-render", () => {
    installMedia({ width: 1280 });
    const { result } = renderHook(() => useViewport());
    const before = result.current;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(before);
  });

  it("stops listening when unmounted", () => {
    const media = installMedia({ width: 1280 });
    const { unmount } = renderHook(() => useViewport());
    expect(media.listenerCount()).toBe(3);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("falls back to the window width where matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("innerWidth", 500);
    expect(readViewport()).toEqual({ kind: "phone", coarse: false });
    vi.stubGlobal("innerWidth", 900);
    expect(readViewport()).toEqual({ kind: "tablet", coarse: false });
    vi.stubGlobal("innerWidth", 1400);
    const { result } = renderHook(() => useViewport());
    expect(result.current).toEqual({ kind: "desktop", coarse: false });
  });
});
