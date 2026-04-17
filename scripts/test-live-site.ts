import { chromium } from '@playwright/test';
import path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const url = 'https://derrickkarake.github.io/bizbuy/';
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  console.log('status:', resp?.status(), 'url:', page.url());
  console.log('title:', await page.title());
  const h1 = await page.locator('h1').first().innerText().catch(() => '(none)');
  console.log('h1:', h1);
  const rowCount = await page.locator('#topTable tbody tr').count();
  console.log('top table rows:', rowCount);
  const out = path.resolve(__dirname, 'live-site.png');
  await page.screenshot({ path: out, fullPage: false });
  console.log('screenshot:', out);
  await browser.close();
})();
