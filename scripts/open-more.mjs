/**
 * The header's More menu (`⋯`): a popover on a wide screen, the Controls sheet on a phone.
 * Every control the header does not keep in its row is in it. Opens it unless it is open,
 * and returns the panel to look for those controls in.
 */
export async function openMore(page) {
  const panel = page.getByRole('dialog', { name: 'Controls', exact: true });
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'More controls', exact: true }).click();
  await panel.waitFor();
  return panel;
}

/**
 * Leaving a conversation on screen asks first (an `alertdialog`): answer it with `button`
 * when it appears. A tab with nothing on screen is not asked, so the question is optional.
 */
export async function confirmIfAsked(page, title, button, timeout = 1500) {
  const dialog = page.getByRole('alertdialog', { name: title });
  if (await dialog.waitFor({ timeout }).then(() => true, () => false)) await dialog.getByRole('button', { name: button, exact: true }).click();
}
