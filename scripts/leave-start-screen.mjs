/**
 * A new browser tab opens on the start screen. For probes about something else:
 * continue the conversation live in the project the tab connected to — what a new
 * tab showed before the start screen existed — or start one there when none is saved.
 */
export async function leaveStartScreen(page) {
  const start = page.getByTestId('start-screen');
  await start.waitFor({ timeout: 30000 });
  const rows = page.getByTestId('start-recent-row');
  await rows.first().or(page.getByText('No saved conversations yet.')).waitFor({ timeout: 30000 });
  const live = rows.filter({ has: page.getByTestId('start-recent-status') });
  if (await live.count()) await live.first().click();
  else await page.getByTestId('start-project-chip').first().click();
  await start.waitFor({ state: 'detached', timeout: 30000 });
}
