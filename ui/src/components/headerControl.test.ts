import { describe, expect, it } from "vitest";
import { HEADER_CONTROL, HEADER_CONTROL_SHRINKS } from "./headerControl";

describe("shared header control styles", () => {
  it.each([
    ["fixed", HEADER_CONTROL],
    ["shrinking", HEADER_CONTROL_SHRINKS],
  ])("keeps %s controls rounded, touch-sized on mobile and compact on desktop", (_name, styles) => {
    const classes = styles.split(" ");
    expect(classes).toEqual(expect.arrayContaining([
      "rounded-full", "h-11", "sm:h-7", "whitespace-nowrap",
      "focus-visible:ring-2", "focus-visible:ring-blue-500", "focus-visible:ring-offset-2",
      "dark:focus-visible:ring-offset-zinc-900",
    ]));
    expect(classes).not.toContain("rounded-md");
    expect(classes).not.toContain("h-7");
  });

  it("preserves fixed and shrinkable width contracts", () => {
    expect(HEADER_CONTROL.split(" ")).toContain("shrink-0");
    expect(HEADER_CONTROL_SHRINKS.split(" ")).toContain("min-w-0");
  });
});
