import { useEffect, useState } from "react";

/**
 * How much of the layout viewport an on-screen keyboard covers, in CSS pixels.
 *
 * Android Chrome honours `interactive-widget=resizes-content`: the layout viewport
 * itself shrinks above the keyboard, so this reads 0 and nothing needs to move. iOS
 * Safari ignores it and only shrinks (and pans) the *visual* viewport, leaving the
 * composer at the bottom of a layout viewport the keyboard now hides. The gap
 * between the layout viewport's bottom and the visual viewport's bottom is the
 * keyboard; the shell pads itself by that much.
 *
 * A pinch-zoomed page also has a smaller visual viewport, which is not a keyboard:
 * any scale other than 1 reads 0.
 */
export function keyboardInset(win: Pick<Window, "innerHeight" | "visualViewport">): number {
  const vv = win.visualViewport;
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return 0;
  const inset = win.innerHeight - (vv.height + vv.offsetTop);
  return inset > 1 ? Math.round(inset) : 0;
}

/** `keyboardInset`, kept current while `enabled`; 0 otherwise (desktop: no listener at all). */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!enabled || !vv) {
      setInset(0);
      return;
    }
    const update = () => setInset(keyboardInset(window));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return inset;
}
