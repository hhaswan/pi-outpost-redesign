import { parseAnsi } from "../util/ansi";

/**
 * Extension text with its terminal styling honoured.
 *
 * Extension widgets and statuses are written for a terminal and arrive pre-styled — pi passes
 * the author's own escape sequences through unchanged. Printed verbatim they read
 * as `ESC[38;2;225;90;31m◆ESC[39m`; interpreted, they read as the author meant.
 */
export function AnsiText({ text, buttonLinks = false }: { text: string; buttonLinks?: boolean }) {
  const segments = parseAnsi(text);
  return (
    <>
      {segments.map((segment, index) => {
        const style = {
          ...(segment.color ? { color: segment.color } : {}),
          ...(segment.bold ? { fontWeight: 600 } : {}),
          ...(segment.dim ? { opacity: 0.7 } : {}),
          ...(segment.italic ? { fontStyle: "italic" } : {}),
          ...(segment.underline ? { textDecoration: "underline" } : {}),
        };
        if (!segment.href) return <span key={index} style={style}>{segment.text}</span>;
        // A link labelled with words ("Open authorization page") is the action: with
        // buttonLinks it becomes a full-size button; a bare URL stays an inline link.
        const labelled = !/^\s*https?:\/\//i.test(segment.text);
        return (
          <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer" style={buttonLinks && labelled ? {} : style}
            className={buttonLinks && labelled ? ANSI_BUTTON_LINK : "break-all text-emerald-700 underline hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"}>
            {segment.text}
          </a>
        );
      })}
    </>
  );
}

const ANSI_BUTTON_LINK =
  "my-1 inline-flex min-h-11 items-center rounded-full bg-zinc-900 px-4 py-2 font-sans text-sm font-medium text-zinc-100 no-underline transition-opacity hover:opacity-80 dark:bg-zinc-100 dark:text-zinc-900";
