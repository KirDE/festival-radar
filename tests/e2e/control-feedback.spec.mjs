import { expect, test } from '@playwright/test';

async function expectFeedback(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  const background = () => locator.evaluate(el => getComputedStyle(el).backgroundColor);
  const normal = await background();
  await locator.hover();
  await expect.poll(background).not.toBe(normal);
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await locator.focus();
  await expect.poll(background).not.toBe(normal);
  await locator.evaluate(el => el.blur());
}

for (const locale of ['en', 'de', 'ru']) {
  test(`clear all filters preserves the plan and survives reload (${locale})`, async ({ page }) => {
    const preserved = { favoriteFestivals: ['synthetic-fest'], favoriteArtists: ['sample-artist'], attendance: { 'synthetic-fest': 'going' }, playlistFestivals: ['synthetic-fest'] };
    await page.addInitScript(value => {
      if (!localStorage.getItem('festival-radar-planner-v1')) localStorage.setItem('festival-radar-planner-v1', JSON.stringify(value));
    }, preserved);
    await page.goto(`/${locale}/`);
    await expect(page.locator('.search')).toHaveAttribute('data-ready', 'true');
    const cards = await page.locator('.festivalCard').count();
    expect(cards).toBeGreaterThan(0);
    const selects = page.locator('.filterBar select');
    for (let i = 0; i < 5; i++) {
      const select = selects.nth(i);
      const value = await select.locator('option').nth(1).getAttribute('value');
      await select.selectOption(value);
    }
    for (const toggle of await page.locator('.filterBar .toggle').all()) await toggle.click();
    await page.locator('.search input').fill('no-such-festival-reset-test');
    await expect(page.locator('.festivalCard')).toHaveCount(0);
    const reset = page.locator('.clearFilters');
    await expect(reset).toHaveText({ en: 'Clear all', de: 'Alles zurücksetzen', ru: 'Очистить всё' }[locale]);
    await expectFeedback(page, reset);
    await reset.click();
    await expect(page.locator('.festivalCard')).toHaveCount(cards);
    await expect(page.locator('.search input')).toHaveValue('');
    for (let i = 0; i < 5; i++) await expect(selects.nth(i)).toHaveValue(i === 3 ? 'berlin' : 'all');
    for (const checkbox of await page.locator('.filterBar input[type=checkbox]').all()) await expect(checkbox).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('festival-radar-planner-v1')).savedFilters)).toEqual({ query: '', country: 'all', month: 'all', announcedOnly: false, ticketsOnly: false });
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('festival-radar-planner-v1')));
    for (const key of Object.keys(preserved)) expect(state[key]).toEqual(preserved[key]);
    await page.reload();
    await expect(page.locator('.search')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.festivalCard')).toHaveCount(cards);
  });

  for (const width of [375, 1440]) {
    test(`framed controls and cards have hover and keyboard feedback (${locale}, ${width})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/${locale}/`);
      await expect(page.locator('.search')).toHaveAttribute('data-ready', 'true');
      for (const select of await page.locator('select').all()) await expectFeedback(page, select);
      const card = page.locator('.festivalCard').first();
      await page.mouse.move(0, 0);
      const normal = await card.evaluate(el => getComputedStyle(el).backgroundColor);
      await card.locator('a').hover();
      await expect.poll(() => card.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normal);
      await expectFeedback(page, card.locator('button'));
      await card.locator('button').click();
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement?.blur());
      await expectFeedback(page, card.locator('button'));
      await page.locator('.accountButton').click();
      for (const button of await page.locator('.accountPopover button:visible:not(:disabled)').all()) await expectFeedback(page, button);
      await page.goto(`/${locale}/festivals/${process.env.FEEDBACK_FESTIVAL_SLUG || "synthetic-fest"}/`);
      for (const selector of ['.localActions select', '.favoriteButton', '.lineupSort select', '.recommendations a', '.actionGrid > a', '.headlinerGrid a', '.lineupGrid a', '.planningActions a']) {
        for (const control of await page.locator(selector).all()) await expectFeedback(page, control);
      }
      expect(await page.locator('.recommendations a').count()).toBeGreaterThan(0);
      const geometry = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
      expect(geometry.document).toBeLessThanOrEqual(geometry.width);
    });
  }
}

for (const locale of ['en', 'de', 'ru']) {
  test(`footer language picker aligns without overflow (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    for (const width of [320, 375, 700, 850, 1100, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.siteFooter').scrollIntoViewIfNeeded();
      const metrics = await page.locator('.siteFooter').evaluate(footer => {
        const boxes = [...footer.children].map(el => el.getBoundingClientRect());
        const picker = footer.querySelector('.languagePicker').getBoundingClientRect();
        return { left: picker.left, firstLeft: boxes[0].left, centers: boxes.map(b => b.top + b.height / 2), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(metrics.overflow).toBe(false);
      if (width <= 700) expect(Math.abs(metrics.left - metrics.firstLeft)).toBeLessThan(1);
      if (width === 1440) expect(Math.max(...metrics.centers) - Math.min(...metrics.centers)).toBeLessThan(1);
    }
  });
}
