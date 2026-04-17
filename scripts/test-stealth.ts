import { chromium } from 'playwright-extra';
// @ts-ignore - no types
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';

chromium.use(stealth());

(async () => {
  const ctx = await chromium.launchPersistentContext(
    path.resolve(__dirname, '../.browser-profile-stealth'),
    {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1440, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    } as any,
  );
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const r = await page.goto('https://www.bizbuysell.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  }).catch((e) => { console.log('NAV THREW:', e.message.split('\n')[0]); return null; });
  if (r) {
    console.log('status:', r.status(), 'title:', (await page.title()).slice(0, 60));
  }
  await ctx.close();
})();
