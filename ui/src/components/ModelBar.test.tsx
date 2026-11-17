import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ModelBar } from "./ModelBar";
import { THINKING_LEVELS } from "@pi-outpost/shared";
import type { SessionUsage } from "../util/sessionUsage";

const NOTHING: SessionUsage = {
  cost: 0,
  unpriced: 0,
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
};

function renderBar(sessionUsage: SessionUsage, onToggleAnalysis = () => {}) {
  return render(
    <ModelBar
      model="anthropic/claude-opus-5"
      models={[{ provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", reasoning: true }]}
      thinkingLevel="off"
      modelSupportsReasoning={false}
      isStreaming={false}
      contextUsage={null}
      sessionUsage={sessionUsage}
      analysisOpen={false}
      onToggleAnalysis={onToggleAnalysis}
      isCompacting={false}
      onSetModel={() => {}}
      onSetThinking={() => {}}
      onCompact={() => {}}
    />,
  );
}

describe("ModelBar usage indicator", () => {
  it("claims nothing when no turn has reported figures", () => {
    renderBar(NOTHING);
    expect(screen.queryByText(/tok/)).toBeNull();
  });

  it("shows the cost alone once a turn reports one, the tokens in its title", () => {
    renderBar({ ...NOTHING, turns: 1, totalTokens: 12_400, cost: 0.42, input: 10_000, output: 2_400 });
    expect(screen.queryByText("12k tok")).toBeNull();
    expect(screen.getByText("$0.42")).toBeTruthy();
    expect(screen.getByTitle(/1 turn/).getAttribute("title")).toContain("input 10,000");
  });

  it("shows tokens and no amount against a provider that prices nothing", () => {
    // The self-hosted case: counters exist, no price does. Tokens must still show.
    renderBar({ ...NOTHING, turns: 3, unpriced: 3, totalTokens: 50_000 });
    expect(screen.getByText("50k tok")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("SmallAmountsStayLegible: shows a fraction of a cent without claiming zero", () => {
    renderBar({ ...NOTHING, turns: 1, totalTokens: 100, cost: 0.0004 });
    expect(screen.getByText("$0.0004")).toBeVisible();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("marks an amount that covers only some of the turns", () => {
    renderBar({ ...NOTHING, turns: 4, unpriced: 2, totalTokens: 9_000, cost: 0.1 });
    expect(screen.getByText(/\$0\.10\*/)).toBeTruthy();
  });

  it("puts the breakdown in the title", () => {
    renderBar({ ...NOTHING, turns: 2, totalTokens: 100, input: 60, output: 30, cacheRead: 8, cacheWrite: 2 });
    const title = screen.getByTitle(/2 turns/);
    expect(title.getAttribute("title")).toContain("input 60");
    expect(title.getAttribute("title")).toContain("cache write 2");
  });

  it("reflects a completed turn without a reload", () => {
    const { rerender } = renderBar({ ...NOTHING, turns: 1, totalTokens: 1_000, cost: 0.01 });
    expect(screen.getByText("$0.01")).toBeTruthy();

    rerender(
      <ModelBar
        model="anthropic/claude-opus-5"
        models={[{ provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", reasoning: true }]}
        thinkingLevel="off"
        modelSupportsReasoning={false}
        isStreaming={false}
        contextUsage={null}
        sessionUsage={{ ...NOTHING, turns: 2, totalTokens: 3_000, cost: 0.03 }}
        analysisOpen={false}
        onToggleAnalysis={() => {}}
        isCompacting={false}
        onSetModel={() => {}}
        onSetThinking={() => {}}
        onCompact={() => {}}
      />,
    );
    expect(screen.getByText("$0.03")).toBeTruthy();
  });

  it("opens the session analysis when the figure is clicked", () => {
    const onToggleAnalysis = vi.fn();
    renderBar({ ...NOTHING, turns: 1, totalTokens: 1_000, cost: 0.01 }, onToggleAnalysis);
    fireEvent.click(screen.getByTitle(/1 turn/));
    expect(onToggleAnalysis).toHaveBeenCalledOnce();
  });
});

describe("ModelBar controls", () => {
  function renderFull(overrides: Partial<React.ComponentProps<typeof ModelBar>> = {}) {
    const props = {
      model: "anthropic/claude-opus-5",
      models: [
        { provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", reasoning: true },
        { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
      ],
      thinkingLevel: "off",
      modelSupportsReasoning: true,
      isStreaming: false,
      contextUsage: null,
      sessionUsage: NOTHING,
      analysisOpen: false,
      onToggleAnalysis: vi.fn(),
      isCompacting: false,
      onSetModel: vi.fn(),
      onSetThinking: vi.fn(),
      onCompact: vi.fn(),
      ...overrides,
    };
    render(<ModelBar {...props} />);
    return props;
  }

  // openlore: scenario=TheModelBarIsOneRow spec=compact-header-controls
  it("TheModelBarIsOneRow: one row without hiding security, context or usage controls", () => {
    const props = renderFull({
      model: `local/${"long-model-name-".repeat(12)}`,
      shellConfinement: { state: "checking", runner: "sandbox" },
      shellGrants: { hosts: ["example.com"], directories: [] },
      contextUsage: { tokens: 45_000, contextWindow: 200_000, percent: 22.5 },
      sessionUsage: { ...NOTHING, turns: 1, totalTokens: 12_400, cost: 0.42 },
    });
    const model = screen.getByRole("button", { name: "Model" });
    expect(model.parentElement?.parentElement).toHaveClass("min-w-0", "flex-nowrap");
    expect(model.parentElement?.parentElement).not.toHaveClass("flex-wrap");
    expect(model.parentElement).toHaveClass("min-w-0", "w-full", "max-w-full", "sm:w-auto", "sm:max-w-64");
    expect(model).toHaveTextContent(props.model);
    const confinement = screen.getByTestId("shell-confinement");
    expect(confinement).toBeVisible();
    expect(confinement).toHaveAttribute("data-grants", "1");
    // A lock badge: its words for screen readers, its details in the tooltip.
    expect(confinement.parentElement).toHaveClass("shrink-0", "[&>span]:rounded-full", "[&>span]:min-w-7");
    expect(within(confinement).getByText(/shell checking confinement/)).toHaveClass("sr-only");
    expect(confinement.getAttribute("title")).toContain("being checked");
    const context = screen.getByRole("button", { name: "23%" });
    const usage = screen.getByTitle(/1 turn.*click for the session analysis/);
    expect(usage).toHaveTextContent(/^\$0\.42$/);
    for (const control of [model, screen.getByTitle("thinking level"), context, usage]) {
      expect(control).toBeVisible();
      expect(control).toHaveClass("min-h-11", "rounded-full", "focus-visible:ring-2");
    }
    for (const control of [screen.getByTitle("thinking level"), context, usage]) {
      expect(control).toHaveClass("sm:min-h-0");
    }
    fireEvent.click(context);
    expect(props.onCompact).toHaveBeenCalledOnce();
    fireEvent.click(usage);
    expect(props.onToggleAnalysis).toHaveBeenCalledOnce();
  });

  it("switches to the model the user picked, provider and id apart", () => {
    const props = renderFull();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "openai/gpt-5" }));
    expect(props.onSetModel).toHaveBeenCalledWith("openai", "gpt-5");
  });

  it("keeps a model the server reports but does not list", () => {
    // The picker must not silently show someone else's model.
    renderFull({ model: "local/qwen3" });
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("local/qwen3");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByText("Current: local/qwen3 (not listed)")).toBeVisible();
  });

  it("hides the thinking control for a model that cannot reason", () => {
    renderFull({ modelSupportsReasoning: false });
    expect(screen.queryByTitle("thinking level")).toBeNull();
  });

  it("sets the thinking level from the slider", () => {
    const props = renderFull();
    fireEvent.click(screen.getByTitle("thinking level"));
    fireEvent.change(screen.getByLabelText("Thinking level"), { target: { value: "2" } });
    expect(props.onSetThinking).toHaveBeenCalledWith(THINKING_LEVELS[2]);
  });

  it("offers only the levels the model accepts, gap and all", () => {
    const props = renderFull({ thinkingLevel: "medium", thinkingLevels: ["off", "low", "medium", "xhigh"] });
    fireEvent.click(screen.getByTitle("thinking level"));
    const slider = screen.getByLabelText("Thinking level") as HTMLInputElement;
    expect(slider.max).toBe("3"); // four stops: off, low, medium, xhigh — no high
    expect(slider.value).toBe("2"); // current "medium" sits at index 2 of the supplied list
    fireEvent.change(slider, { target: { value: "3" } });
    expect(props.onSetThinking).toHaveBeenCalledWith("xhigh"); // the last stop, reached without passing "high"
  });

  it("renders at the first stop when the current level is not one the model accepts", () => {
    renderFull({ thinkingLevel: "high", thinkingLevels: ["off", "low", "medium", "xhigh"] });
    fireEvent.click(screen.getByTitle("thinking level"));
    expect((screen.getByLabelText("Thinking level") as HTMLInputElement).value).toBe("0");
    // ...while still naming the level the session actually holds: the server settles
    // that on a model change, and until it does the control must not claim otherwise.
    expect(screen.getByTitle("thinking level").textContent).toContain("high");
  });

  it("states the single level a model accepts instead of an immovable slider", () => {
    // A one-stop range cannot be dragged anywhere, which reads as a broken control
    // rather than as a fact about the model.
    renderFull({ thinkingLevel: "off", thinkingLevels: ["off"] });
    fireEvent.click(screen.getByTitle("thinking level"));
    expect(screen.queryByLabelText("Thinking level")).toBeNull();
    expect(screen.getByText(/accepts/).textContent).toContain("off");
  });

  it("falls back to the full set when no accepted-levels list is supplied", () => {
    renderFull({ thinkingLevel: "off" });
    fireEvent.click(screen.getByTitle("thinking level"));
    const slider = screen.getByLabelText("Thinking level") as HTMLInputElement;
    expect(slider.max).toBe(String(THINKING_LEVELS.length - 1));
  });

  it("closes the thinking popover on Escape", () => {
    renderFull();
    fireEvent.click(screen.getByTitle("thinking level"));
    expect(screen.getByLabelText("Thinking level")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Thinking level")).toBeNull();
  });

  it("locks the controls that would race a running turn", () => {
    renderFull({ isStreaming: true });
    expect(screen.getByRole("button", { name: "Model" })).toBeDisabled();
    expect(screen.getByTitle("thinking level")).toBeDisabled();
  });

  it("reports how full the context is, and what compaction would act on", () => {
    renderFull({ contextUsage: { tokens: 45_000, contextWindow: 200_000, percent: 22.5 } });
    const button = screen.getByRole("button", { name: "23%" });
    expect(button).toHaveAttribute("title", `${(45_000).toLocaleString()} / ${(200_000).toLocaleString()} tokens — click to compact`);
    expect(button.textContent).toContain("23%");
  });

  it("says nothing about a context it cannot measure", () => {
    renderFull({ contextUsage: { tokens: null, contextWindow: 200_000, percent: null } });
    expect(screen.getByText("context")).toBeTruthy();
  });

  it("compacts on request, and not while already compacting", () => {
    const props = renderFull({ isCompacting: true });
    const button = screen.getByText("compacting…").closest("button") as HTMLButtonElement;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onCompact).not.toHaveBeenCalled();
  });

  it("leaves the figure inert for a host that renders no analysis", () => {
    render(
      <ModelBar
        model="anthropic/claude-opus-5"
        models={[{ provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", reasoning: true }]}
        thinkingLevel="off"
        modelSupportsReasoning={false}
        isStreaming={false}
        contextUsage={null}
        sessionUsage={{ ...NOTHING, turns: 1, totalTokens: 1_000 }}
        isCompacting={false}
        onSetModel={() => {}}
        onSetThinking={() => {}}
        onCompact={() => {}}
      />,
    );
    expect(screen.getByTitle(/1 turn/).tagName).toBe("SPAN");
  });
});
