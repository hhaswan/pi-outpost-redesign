import { fireEvent, screen } from "@testing-library/react";

/** Tests only: the header's More menu (popover or phone sheet), opened when it is not. */
export function openMore(): HTMLElement {
  const open = screen.queryByRole("dialog", { name: "Controls" });
  if (open) return open;
  fireEvent.click(screen.getByRole("button", { name: "More controls" }));
  return screen.getByRole("dialog", { name: "Controls" });
}
