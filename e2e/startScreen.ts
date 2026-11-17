import type { Page } from "@playwright/test";

/**
 * A new tab of the standalone app opens on the start screen. Specs about something
 * else continue what a new tab showed before it existed: the conversation live in
 * the project the tab connected to, or a new one there when none is saved.
 */
export async function leaveStartScreen(page: Page): Promise<void> {
  const start = page.getByTestId("start-screen");
  await start.waitFor({ timeout: 15_000 });
  const rows = page.getByTestId("start-recent-row");
  await rows.first().or(page.getByText("No saved conversations yet.")).waitFor({ timeout: 15_000 });
  const live = rows.filter({ has: page.getByTestId("start-recent-status") });
  if (await live.count()) await live.first().click();
  else await page.getByTestId("start-project-chip").first().click();
  await start.waitFor({ state: "detached", timeout: 15_000 });
}
