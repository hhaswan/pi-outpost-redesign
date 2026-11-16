/**
 * Touch-sized hit areas: at least 44×44 px on a coarse pointer or a phone-width
 * screen, and nothing added for a mouse on a wide screen.
 *
 * `min-height`/`min-width` rather than `height`/`width`: a minimum beats any height
 * the control already sets (`h-5`, `sm:h-7`) whatever order the stylesheet emits the
 * rules in, so the control grows its hit area without its glyph growing. Icon
 * buttons whose content is a block (an `<svg>`) also need `TOUCH_CENTER`, or the
 * glyph sits at the top left of the larger box.
 */
export const TOUCH_TARGET =
  "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 max-md:min-h-11 max-md:min-w-11";

/** Only the height: for full-width rows, whose width is already wide enough. */
export const TOUCH_ROW = "[@media(pointer:coarse)]:min-h-11 max-md:min-h-11";

/** Centres a glyph in a box that `TOUCH_TARGET` made larger than the glyph. */
export const TOUCH_CENTER = "inline-flex items-center justify-center";

/**
 * Revealed on hover where there is hover, always visible where there is none (a
 * touch screen, where a hidden control is an invisible tap target), and visible
 * whenever it has keyboard focus.
 */
export const HOVER_REVEAL =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100";

/**
 * `TOUCH_TARGET` for every button inside a panel — a menu, a dropdown, the phone's
 * Controls sheet — whose many small controls are not worth sizing one by one.
 */
export const TOUCH_DESCENDANTS =
  "[@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_button]:min-w-11 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 [@media(pointer:coarse)]:[&_[role=button]]:min-h-11 max-md:[&_[role=button]]:min-h-11";
