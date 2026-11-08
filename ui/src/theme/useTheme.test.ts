/**
 * Which theme wins, and why it matters who is asking.
 *
 * The rank that this file is really about: a host application names a theme on
 * every `mount()`, and a value this browser remembered from some earlier visit
 * was silently beating it. In a page that asked for light, a single past click
 * on ☾ left the widget dark for good, with nothing the host could do about it.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useTheme } from "./useTheme";

const STORAGE_KEY = "pi-outpost:theme";

beforeAll(() => {
  // jsdom ships no matchMedia, and the hook asks it what the OS prefers. "Not
  // dark" keeps every case below about precedence rather than about the OS.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function mockSystemTheme(dark = false) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return (nextDark: boolean) => {
    act(() => {
      query.matches = nextDark;
      for (const listener of listeners) listener();
    });
  };
}

function mount(configured: "light" | "dark" | "system", hostTheme?: "light" | "dark" | "system") {
  const root = document.createElement("div");
  return renderHook(() => useTheme(configured, true, root, hostTheme)).result;
}

describe("useTheme precedence", () => {
  it("takes the server's configured default when nothing else has an opinion", () => {
    expect(mount("light").current.theme).toBe("light");
  });

  it("UserPrefersDarkMode: applies stored dark to the root over the configured default", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    const { result } = renderHook(() => useTheme("light", true));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("gives the host the theme it asked for, over anything this browser remembered", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    // mount(container, { theme: "light" }) — an instruction repeated every mount
    expect(mount("dark", "light").current.theme).toBe("light");
  });

  it("keeps the host's theme when branding arrives with a different default", () => {
    // Branding lands after the first render; without an override marked, the
    // effect that adopts it would undo what the host asked for.
    const root = document.createElement("div");
    const { result, rerender } = renderHook(
      ({ configured }: { configured: "light" | "dark" }) => useTheme(configured, true, root, "light"),
      { initialProps: { configured: "system" as "light" | "dark" } },
    );

    rerender({ configured: "dark" });

    expect(result.current.theme).toBe("light");
    expect(root.dataset.theme).toBe("light");
  });

  it("still lets the reader change it afterwards, and remembers that", () => {
    const result = mount("dark", "light");

    act(() => result.current.setTheme("dark"));

    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("ignores a stored pick when the deployment turned the toggle off", () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    const root = document.createElement("div");
    const { result } = renderHook(() => useTheme("light", false, root));

    expect(result.current.theme).toBe("light");
  });
});

describe("useTheme following what changes after mount", () => {
  it("takes the theme a host page posts, and ignores any other message or value", async () => {
    const result = mount("light");
    const post = (data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", {
      data,
      origin: window.location.origin,
      source: window,
    })));
    post({ type: "something-else", theme: "dark" });
    post({ type: "pi-outpost:set-theme", theme: "purple" });
    expect(result.current.theme).toBe("light");
    post({ type: "pi-outpost:set-theme", theme: "dark" });
    expect(result.current.theme).toBe("dark");
  });

  it("SystemPreferenceFollowed: applies the OS theme to the root and follows OS changes", () => {
    const changeSystemTheme = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme("system", true));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.preference).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    changeSystemTheme(true);
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    changeSystemTheme(false);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it.each([
    ["ToggleFromLightToDark", "light", "dark"],
    ["ToggleFromDarkToLight", "dark", "light"],
  ] as const)("%s: applies the toggled theme to the root and persists it", (_scenario, initial, next) => {
    const { result } = renderHook(() => useTheme(initial, true));
    expect(document.documentElement).toHaveAttribute("data-theme", initial);
    act(() => result.current.toggle());
    expect(result.current.theme).toBe(next);
    expect(result.current.preference).toBe(next);
    expect(document.documentElement).toHaveAttribute("data-theme", next);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(next);
  });

  it("RestoreSystemTheme: restores stored System after remount using the current OS theme", () => {
    const changeSystemTheme = mockSystemTheme(false);
    const first = renderHook(() => useTheme("dark", true));
    act(() => first.result.current.setTheme("system"));
    expect(first.result.current.preference).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
    first.unmount();
    document.documentElement.removeAttribute("data-theme");
    changeSystemTheme(true);
    const restored = renderHook(() => useTheme("light", true));
    expect(restored.result.current.preference).toBe("system");
    expect(restored.result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
    changeSystemTheme(false);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it.each(["light", "dark"] as const)("ExplicitThemeStaysFixed: explicit %s resists OS changes", (explicit) => {
    const changeSystemTheme = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme("system", true));
    act(() => result.current.setTheme(explicit));
    for (const dark of [true, false, true]) {
      changeSystemTheme(dark);
      expect(result.current.preference).toBe(explicit);
      expect(result.current.theme).toBe(explicit);
      expect(document.documentElement).toHaveAttribute("data-theme", explicit);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(explicit);
    }
  });

  it.each(["light", "dark"] as const)("ChooseSystemTheme: explicit %s switches to persisted System and follows OS changes", (explicit) => {
    const changeSystemTheme = mockSystemTheme(explicit === "light");
    const { result } = renderHook(() => useTheme("system", true));
    act(() => result.current.setTheme(explicit));
    expect(document.documentElement).toHaveAttribute("data-theme", explicit);
    act(() => result.current.setTheme("system"));
    expect(result.current.preference).toBe("system");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", explicit === "light" ? "dark" : "light");
    for (const dark of [false, true]) {
      changeSystemTheme(dark);
      expect(result.current.theme).toBe(dark ? "dark" : "light");
      expect(document.documentElement).toHaveAttribute("data-theme", dark ? "dark" : "light");
      expect(result.current.preference).toBe("system");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
    }
  });
});
