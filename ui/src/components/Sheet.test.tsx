import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

function Harness({ variant = "full" as const, onClose = vi.fn() }: { variant?: "full" | "bottom"; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open files</button>
      {open && (
        <Sheet variant={variant} title="Files" testId="sheet" onClose={() => { onClose(); setOpen(false); }}>
          <button type="button">First action</button>
          <input aria-label="Filter" />
        </Sheet>
      )}
    </div>
  );
}

describe("Sheet", () => {
  it("is a modal dialog named by its title", () => {
    render(<Sheet variant="full" title="Files" onClose={() => {}}>body</Sheet>);
    const dialog = screen.getByRole("dialog", { name: "Files" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("body");
  });

  it("fills the screen as a full sheet, and rises from the bottom as a bottom sheet", () => {
    const { unmount } = render(<Sheet variant="full" title="Files" onClose={() => {}}>x</Sheet>);
    expect(screen.getByRole("dialog").className).toContain("inset-0");
    expect(screen.getByRole("dialog").className).toContain("pb-[env(safe-area-inset-bottom)]");
    unmount();
    render(<Sheet variant="bottom" title="Theme" onClose={() => {}}>x</Sheet>);
    const bottom = screen.getByRole("dialog", { name: "Theme" });
    expect(bottom.className).toContain("bottom-0");
    expect(bottom.className).toContain("max-h-[85dvh]");
    expect(bottom.className).toContain("rounded-t-2xl");
    expect(bottom.className).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("has a close control of at least 44 px", () => {
    render(<Sheet variant="full" title="Files" onClose={() => {}}>x</Sheet>);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toMatch(/\bh-11\b/);
    expect(close.className).toMatch(/\bw-11\b/);
  });

  it("closes from the close button", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open files" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a back control only when asked, and calls it", () => {
    const onBack = vi.fn();
    const { rerender } = render(<Sheet variant="full" title="Files" onClose={() => {}}>x</Sheet>);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    rerender(<Sheet variant="full" title="Files" onClose={() => {}} onBack={onBack}>x</Sheet>);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open files" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves Escape alone when something inside already handled it", () => {
    const onClose = vi.fn();
    render(
      <Sheet variant="full" title="Files" onClose={onClose}>
        <input aria-label="Find" onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} />
      </Sheet>,
    );
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes a bottom sheet from its backdrop", () => {
    const onClose = vi.fn();
    render(<Harness variant="bottom" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open files" }));
    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the sheet in both directions", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open files" }));
    const close = screen.getByRole("button", { name: "Close" });
    const filter = screen.getByLabelText("Filter");

    filter.focus();
    fireEvent.keyDown(filter, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(filter);
  });

  it("locks the page scroll while open and restores it after the last sheet closes", () => {
    document.body.style.overflow = "auto";
    const first = render(<Sheet variant="full" title="Files" onClose={() => {}}>x</Sheet>);
    expect(document.body.style.overflow).toBe("hidden");
    const second = render(<Sheet variant="full" title="Viewer" onClose={() => {}}>y</Sheet>);
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("peels one layer per Escape when sheets stack", () => {
    const closeTree = vi.fn();
    const closeViewer = vi.fn();
    function Stack() {
      const [viewer, setViewer] = useState(true);
      return (
        <Sheet variant="full" title="Files" onClose={closeTree}>
          {viewer && <Sheet variant="full" title="Viewer" onBack={() => setViewer(false)} onClose={() => { closeViewer(); setViewer(false); }}>v</Sheet>}
        </Sheet>
      );
    }
    render(<Stack />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeViewer).toHaveBeenCalledTimes(1);
    expect(closeTree).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Viewer" })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeTree).toHaveBeenCalledTimes(1);
  });
});
