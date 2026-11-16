import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOVER_REVEAL, TOUCH_DESCENDANTS, TOUCH_TARGET } from "./touch";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every component source, tests excluded. */
function sources(): Array<{ file: string; text: string }> {
  const dir = path.join(here, "components");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => ({ file: name, text: fs.readFileSync(path.join(dir, name), "utf8") }))
    .concat([{ file: "App.tsx", text: fs.readFileSync(path.join(here, "App.tsx"), "utf8") }]);
}

describe("touch styles", () => {
  it("grow hit areas on a coarse pointer or a phone width, never on a fine wide screen", () => {
    for (const styles of [TOUCH_TARGET, TOUCH_DESCENDANTS]) {
      for (const token of styles.split(" ")) expect(token).toMatch(/^(\[@media\(pointer:coarse\)\]|max-md):/);
    }
    expect(TOUCH_TARGET.split(" ")).toEqual(expect.arrayContaining(["max-md:min-h-11", "max-md:min-w-11", "[@media(pointer:coarse)]:min-h-11"]));
  });

  it("gate the hover reveal on hover and keep the focus reveal", () => {
    expect(HOVER_REVEAL.split(" ")).toEqual(["[@media(hover:hover)]:opacity-0", "[@media(hover:hover)]:group-hover:opacity-100", "focus-visible:opacity-100"]);
  });

  // TouchTargetsAndNoHoverOnlyActions: no control is hidden until hover on a screen
  // that has no hover. A bare `opacity-0` beside a `group-hover:` reveal is one.
  it("leave no ungated hover-only reveal in any component", () => {
    const offenders = sources().flatMap(({ file, text }) =>
      text
        .split(/\r?\n/)
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /group-hover:(opacity|visible|block|flex)/.test(line) && /(^|[\s"'`])(opacity-0|invisible|hidden)(?=[\s"'`])/.test(line))
        .map(({ index }) => `${file}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});
