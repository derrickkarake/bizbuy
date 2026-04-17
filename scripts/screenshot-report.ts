/**
 * Take a screenshot of the local report so we can eyeball layout before pushing.
 */
import { chromium } from '@playwright/test';
import path from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const out = path.resolve(__dirname, '../data/report-preview.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log(`wrote ${out}`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
