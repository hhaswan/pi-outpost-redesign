import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { keyboardInset, useKeyboardInset } from "./useKeyboardInset";

type Listener = () => void;

/** A visual viewport the test moves, as iOS moves it when the keyboard opens. */
function fakeVisualViewport(height: number) {
  const listeners = new Map<string, Set<Listener>>();
  const vv = {
    height,
    offsetTop: 0,
    scale: 1,
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
  return vv;
}

const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
afterEach(() => {
  if (original) Object.defineProperty(window, "visualViewport", original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

describe("keyboardInset", () => {
  it("is the part of the layout viewport below the visual viewport", () => {
    expect(keyboardInset({ innerHeight: 844, visualViewport: { height: 500, offsetTop: 0, scale: 1 } as VisualViewport })).toBe(344);
    // iOS pans the visual viewport up as well: what is left below it is the keyboard.
    expect(keyboardInset({ innerHeight: 844, visualViewport: { height: 500, offsetTop: 44, scale: 1 } as VisualViewport })).toBe(300);
  });

  it("is 0 without a keyboard, without a visual viewport, or while pinch-zoomed", () => {
    expect(keyboardInset({ innerHeight: 844, visualViewport: { height: 844, offsetTop: 0, scale: 1 } as VisualViewport })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, visualViewport: null })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, visualViewport: { height: 400, offsetTop: 100, scale: 2 } as VisualViewport })).toBe(0);
  });
});

describe("useKeyboardInset", () => {
  it("follows the visual viewport while enabled, and stops listening when disabled", () => {
    const vv = fakeVisualViewport(window.innerHeight);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    const { result, rerender } = renderHook(({ on }) => useKeyboardInset(on), { initialProps: { on: true } });
    expect(result.current).toBe(0);
    act(() => {
      vv.height = window.innerHeight - 300;
      vv.fire("resize");
    });
    expect(result.current).toBe(300);
    rerender({ on: false });
    expect(result.current).toBe(0);
    expect(vv.count()).toBe(0);
  });

  it("adds no listener on a desktop", () => {
    const vv = fakeVisualViewport(window.innerHeight - 300);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    const { result } = renderHook(() => useKeyboardInset(false));
    expect(result.current).toBe(0);
    expect(vv.count()).toBe(0);
  });
});
