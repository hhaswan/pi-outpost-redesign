import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ToolCard } from "./ToolCard";
import type { ChatItem } from "@pi-outpost/shared";

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("rehype-katex", () => ({ default: () => ({}) }));
vi.mock("remark-gfm", () => ({ default: () => ({}) }));
vi.mock("remark-math", () => ({ default: () => ({}) }));

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

function tool(partial: Partial<ToolItem>): ToolItem {
  return { kind: "tool", toolName: "bash", running: false, isError: false, ...partial } as ToolItem;
}

function cardRoot(container: HTMLElement): HTMLElement {
  return container.children[0] as HTMLElement;
}

describe("ToolCard collapsed extension rendering", () => {
  it("ACodemodeCardStartsCompact: hides every detail until expanded and keeps the user's choice through updates", () => {
    const item = tool({ toolName: "codemode", running: true, args: { code: "tools.read()" }, callHtml: "<b>script input</b>", outputHtml: "<b>read running</b>", outputHtmlCollapsed: "<i>read preview</i>" });
    const { container, rerender } = render(<ToolCard item={item} />);
    const root = cardRoot(container);
    expect(root).toHaveTextContent("codemode");
    expect(root).not.toHaveTextContent("script input");
    expect(root).not.toHaveTextContent("read");
    fireEvent.click(root.querySelector("button")!);
    expect(root).toHaveTextContent("script input");
    expect(root).toHaveTextContent("read running");
    rerender(<ToolCard item={{ ...item, running: false, outputHtml: "<b>read complete</b>" }} />);
    expect(root.querySelector("button")).toHaveAttribute("aria-expanded", "true");
    expect(root).toHaveTextContent("read complete");
    fireEvent.click(root.querySelector("button")!);
    expect(root).not.toHaveTextContent("read complete");
  });

  it("keeps a codemode script and raw result reachable without an extension renderer", () => {
    const { container } = render(<ToolCard item={tool({ toolName: "codemode", args: { code: "tools.read()" }, output: "result" })} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(cardRoot(container)).toHaveTextContent("tools.read()");
    expect(cardRoot(container)).toHaveTextContent("result");
  });

  it("shows the compact rendering the extension supplied while folded", () => {
    const { container } = render(
      <ToolCard
        item={tool({
          outputHtml: "<b>full body</b>",
          outputHtmlCollapsed: "<i>compact</i>",
        })}
      />,
    );

    const root = cardRoot(container);
    expect(root.children.length).toBe(2);
    expect(root).toHaveTextContent("compact");
    expect(root).not.toHaveTextContent("full body");
  });

  it("shows the full rendering once expanded", () => {
    const { container } = render(
      <ToolCard item={tool({ outputHtml: "<b>full body</b>", outputHtmlCollapsed: "<i>compact</i>" })} />,
    );

    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(cardRoot(container)).toHaveTextContent("full body");
  });

  it("stays a bare header when the extension supplied no compact rendering", () => {
    const { container } = render(<ToolCard item={tool({ outputHtml: "<b>full body</b>" })} />);

    const root = cardRoot(container);
    expect(root.children.length).toBe(1);
    expect(root.children[0].querySelector("button")).not.toBeNull();
  });
});

describe("ToolCard output is inert", () => {
  const HOSTILE = '<script>alert(1)</script><img src=x onerror="alert(2)">';

  it("never parses a tool's own output as markup", () => {
    const { container } = render(<ToolCard item={tool({ output: HOSTILE })} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toBe(HOSTILE);
  });

  it("never reaches the HTML pipeline from output alone", () => {
    const { container } = render(<ToolCard item={tool({ output: HOSTILE })} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);

    // RenderedHtml is the only innerHTML sink; it is reached from outputHtml and
    // callHtml — the extension channel — and from nothing the tool itself wrote.
    expect(container.querySelector(".rendered-ansi")).toBeNull();
  });

  it("keeps the raw output reachable behind a reveal when a presentation reshapes it", () => {
    const output = ["src/a.ts:1:hit", "src/a.ts:2:hit again"].join("\n");
    const { container } = render(<ToolCard item={tool({ toolName: "grep", args: { pattern: "hit" }, output })} />);

    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(container.querySelector("pre")).toBeNull();

    fireEvent.click(screen.getByText("raw output"));
    expect(container.querySelector("pre")?.textContent).toBe(output);
  });
});

describe("ToolCard scenario provenance", () => {
  it("A code-search tool completes: preserves the search input and complete original output", () => {
    const output = "src/a.ts:1:needle\nsrc/b.ts:2:needle\ntrailing diagnostic";
    const { container } = render(<ToolCard item={tool({ toolName: "grep", args: { pattern: "needle" }, output })} />);
    expect(cardRoot(container)).toHaveTextContent("needle");
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(screen.getByText("2 matches in 2 files")).toBeInTheDocument();
    fireEvent.click(screen.getByText("raw output"));
    expect(container.querySelector("pre")?.textContent).toBe(output);
  });

  it("A tool matches no specialized entry: preserves every character of an unknown result", () => {
    const output = "first line\n  spaces <unknown> & symbols\nlast line\n";
    const { container } = render(<ToolCard item={tool({ toolName: "unknown_tool", output })} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(container.querySelector("pre")?.textContent).toBe(output);
    expect(screen.queryByText("raw output")).not.toBeInTheDocument();
  });

  it("A structured summary becomes available: upgrades raw and keeps exact original output reachable", () => {
    const item = tool({ toolName: "custom", running: true });
    const { container, rerender } = render(<ToolCard item={item} />);
    const output = JSON.stringify({ __pi_render: { text: "Recognized summary" }, extra: "original provenance" });
    rerender(<ToolCard item={{ ...item, running: false, output }} />);
    expect(screen.getByText("Recognized summary")).toBeInTheDocument();
    expect(cardRoot(container).querySelector("button")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(container.querySelector("pre")?.textContent).toBe(output);
  });

  it("An extension rendering arrives with the output: replaces a live specialized view without closing details", () => {
    const item = tool({ args: { command: "git diff" }, running: true });
    const { container, rerender } = render(<ToolCard item={item} />);
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(screen.getByText("running…")).toBeInTheDocument();
    rerender(<ToolCard item={{ ...item, running: false, output: "original diff", outputHtml: "<b>Extension result</b>" }} />);
    expect(cardRoot(container).querySelector("button")).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector("b")?.textContent).toBe("Extension result");
    expect(screen.queryByText("running…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("raw output"));
    expect(container.querySelector("pre")?.textContent).toBe("original diff");
  });

  it("A user inspects a summarized Git diff: identifies the command and reveals its complete output", () => {
    const output = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const { container } = render(<ToolCard item={tool({ args: { command: "git diff -- a.ts" }, output })} />);
    expect(cardRoot(container)).toHaveTextContent("bash");
    expect(cardRoot(container)).toHaveTextContent("git diff -- a.ts");
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("raw output"));
    const rawReveal = screen.getByText("hide raw output").parentElement!;
    expect(rawReveal.querySelector("pre")?.textContent).toBe(output);
  });

  it("ACodemodeCardStartsCompact: stays folded through updates and starts folded again after reload", () => {
    const item = tool({ toolName: "codemode", running: true, args: { code: "tools.read()" }, callHtml: "<b>script details</b>", outputHtml: "<b>running call</b>" });
    const { container, rerender, unmount } = render(<ToolCard item={item} />);
    const done = { ...item, running: false, outputHtml: "<b>completed call</b>" };
    rerender(<ToolCard item={done} />);
    expect(cardRoot(container).querySelector("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("script details")).not.toBeInTheDocument();
    expect(screen.queryByText("completed call")).not.toBeInTheDocument();
    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(screen.getByText("completed call")).toBeInTheDocument();
    unmount();
    const restored = render(<ToolCard item={done} />);
    expect(cardRoot(restored.container).querySelector("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("script details")).not.toBeInTheDocument();
    expect(screen.queryByText("completed call")).not.toBeInTheDocument();
    fireEvent.click(cardRoot(restored.container).querySelector("button")!);
    expect(screen.getByText("script details")).toBeInTheDocument();
    expect(screen.getByText("completed call")).toBeInTheDocument();
  });
});

describe("ToolCard presentation stability", () => {
  it("does not swap renderer when the output of a running call lands", () => {
    const running = tool({ args: { command: "git diff" }, running: true });
    const { container, rerender } = render(<ToolCard item={running} />);

    fireEvent.click(cardRoot(container).querySelector("button")!);
    expect(cardRoot(container)).toHaveTextContent("running…");

    // The command was a diff; the output is an error. The card keeps the
    // presentation it already showed and falls back inside it.
    rerender(<ToolCard item={tool({ args: { command: "git diff" }, output: "fatal: not a git repository" })} />);
    expect(container.querySelector("pre")?.textContent).toBe("fatal: not a git repository");
    expect(screen.getByText("raw output")).toBeInTheDocument();
  });
});

it("A presentation names an unknown action: no unknown control is offered or dispatched", () => {
  const dispatch = vi.fn();
  const output = JSON.stringify({ actions: [{ kind: "runTool", label: "Execute injected command", command: "never execute" }] });
  const { container } = render(<ToolCard item={tool({ toolName: "unknown", output })} dispatch={dispatch} />);
  fireEvent.click(screen.getByRole("button"));
  expect(container.querySelector("pre")?.textContent).toBe(output);
  expect(screen.queryByRole("button", { name: "Execute injected command" })).toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});
