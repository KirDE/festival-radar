import { expect, test } from '@playwright/test';
import inventory from '../../data/reviewed-logo-inventory.json' with { type: 'json' };

for (const language of ['en', 'de', 'ru']) {
  for (const failure of ['404', '503', 'decode', 'network']) {
    test(`${language}: ${failure} shows initials without a static retry`, async ({ page }) => {
      const requests = [];
      page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.includes('/logos/')) requests.push(pathname);
      });
      await page.route('**/api/logos/**', route => failure === 'network'
        ? route.abort()
        : route.fulfill({ status: failure === 'decode' ? 200 : Number(failure), contentType: 'image/png', body: 'invalid image' }));
      await page.goto(`/${language}/`);
      const logos = page.locator('.festivalLogo');
      await expect(logos).toHaveCount(52);
      await expect(logos.locator('img')).toHaveCount(0);
      await expect(logos.locator('span[role="img"]')).toHaveCount(52);
      expect(requests).toHaveLength(47);
      expect([...requests].sort()).toEqual(inventory.map(row => `/api/logos/${row.file}`).sort());
      requests.length = 0;
      await page.goto(`/${language}/festivals/rock-am-ring/`);
      const hero = page.locator('.detailHero .festivalLogo');
      await expect(hero.locator('img')).toHaveCount(0);
      await expect(hero.getByRole('img', { name: 'Rock am Ring logo fallback' })).toHaveText('Ra');
      expect(requests.every(path => /^\/api\/logos\/[a-z0-9-]+\.png$/.test(path))).toBe(true);
      expect(requests.filter(path => path === '/api/logos/rock-am-ring.png')).toHaveLength(1);
    });
  }
}
