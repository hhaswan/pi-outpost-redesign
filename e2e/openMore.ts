import type { Locator, Page } from "@playwright/test";

/**
 * The header's More menu (`⋯`): every control the header does not keep in its row is in
 * it, at every width. Opens it unless it is open, and returns the panel.
 */
export async function openMore(page: Page): Promise<Locator> {
  const panel = page.getByRole("dialog", { name: "Controls", exact: true });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "More controls", exact: true }).click();
  await panel.waitFor();
  return panel;
}
