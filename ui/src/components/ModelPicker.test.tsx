import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelPicker } from "./ModelPicker";

const models = [
  { provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", reasoning: true },
  { provider: "openai", id: "org/gpt-5", name: "GPT Five", reasoning: true },
];

function setup(overrides: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
  const props = { model: "anthropic/claude-opus-5", models, disabled: false, onSetModel: vi.fn(), ...overrides };
  const view = render(<ModelPicker {...props} />);
  const trigger = screen.getByRole("button", { name: "Model" });
  return { ...view, props, trigger, open: () => fireEvent.click(trigger) };
}

describe("ModelPicker", () => {
  it("SearchModelsCaseInsensitively", () => {
    const { open } = setup();
    open();
    const search = screen.getByRole("combobox", { name: "Search models" });
    expect(search).toHaveFocus();
    for (const query of ["OPENAI", "GPT-5", "gPt FiVe"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option")).toHaveTextContent("openai/org/gpt-5");
    }
    fireEvent.change(search, { target: { value: "  " } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "anthropic/claude-opus-5" })).toHaveAttribute("aria-selected", "true");
  });

  it("SelectModelWithKeyboard", () => {
    const { trigger, props } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "openai/org/gpt-5" }).id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "anthropic/claude-opus-5" }).id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onSetModel).toHaveBeenCalledExactlyOnceWith("openai", "org/gpt-5");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();
    // Selection is not optimistic: the server still owns the current model.
    expect(trigger).toHaveTextContent(props.model);
  });

  it("SelectModelWithPointer", () => {
    const { open, trigger, props } = setup();
    open();
    fireEvent.click(screen.getByRole("option", { name: "openai/org/gpt-5" }));
    expect(props.onSetModel).toHaveBeenCalledExactlyOnceWith("openai", "org/gpt-5");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("SelectModelWithTouchOnIosSafari: the search blurs before the tap's click arrives", () => {
    const { open, props } = setup();
    open();
    const option = screen.getByRole("option", { name: "openai/org/gpt-5" });
    // iOS Safari: pointerdown's preventDefault does not keep focus; the input blurs with no
    // relatedTarget, then the click follows. The pick must survive that blur.
    fireEvent.pointerDown(option, { pointerType: "touch" });
    fireEvent.blur(screen.getByRole("combobox", { name: "Search models" }), { relatedTarget: null });
    fireEvent.click(option);
    expect(props.onSetModel).toHaveBeenCalledExactlyOnceWith("openai", "org/gpt-5");
  });

  it("TouchScreenDoesNotRaiseKeyboard: the search is not focused on a coarse pointer", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)", media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      const { open } = setup();
      open();
      expect(screen.getByRole("combobox", { name: "Search models" })).not.toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("BlurOutsideStillCloses", () => {
    const { open, trigger } = setup();
    open();
    fireEvent.blur(screen.getByRole("combobox", { name: "Search models" }), { relatedTarget: null });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("DismissModelSearch", () => {
    const { open, trigger, props } = setup();
    open();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "openai" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("listbox")).toBeNull();
    open();
    expect(screen.getByRole("combobox")).toHaveValue("");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    open();
    fireEvent.blur(screen.getByRole("combobox"), { relatedTarget: document.body });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(props.onSetModel).not.toHaveBeenCalled();
  });

  it("EmptyModelSearch", () => {
    const { open, props } = setup();
    open();
    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No models found.");
    expect(search).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onSetModel).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "claude" } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("StreamingDisablesModelSelection", () => {
    const { open, trigger, props, rerender } = setup();
    open();
    rerender(<ModelPicker {...props} disabled />);
    expect(trigger).toBeDisabled();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(<ModelPicker {...props} />);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(props.onSetModel).not.toHaveBeenCalled();
  });

  it("UnlistedCurrentModelRemainsVisible", () => {
    const { open, trigger } = setup({ model: "local/unlisted", models: [] });
    expect(trigger).toHaveTextContent("local/unlisted");
    open();
    expect(screen.getByText("Current: local/unlisted (not listed)")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("No models found.");
  });

  it("keeps active selection valid when the available models change", () => {
    const { open, props, rerender } = setup();
    open();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    rerender(<ModelPicker {...props} models={[models[0]]} />);
    const search = screen.getByRole("combobox");
    expect(search).toHaveAttribute("aria-activedescendant", screen.getByRole("option").id);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onSetModel).toHaveBeenCalledExactlyOnceWith("anthropic", "claude-opus-5");
  });

  it("NarrowModelPicker: uses bounded popover width and 44px controls",  () => {
    const { open, trigger } = setup();
    expect(trigger).toHaveClass("min-h-11", "truncate", "max-w-full");
    open();
    const search = screen.getByRole("combobox");
    expect(search).toHaveClass("min-h-11");
    expect(search.parentElement).toHaveClass("max-w-[calc(100vw-2rem)]");
    expect(screen.getByRole("listbox")).toHaveClass("max-h-60", "overflow-y-auto");
    for (const option of screen.getAllByRole("option")) expect(option).toHaveClass("min-h-11", "break-all");
  });
});
