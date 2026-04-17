/**
 * Test which access strategy works right now:
 *  (a) original persistent profile (had successful cookies yesterday)
 *  (b) fresh persistent profile
 *  (c) CDP-attach to a user-running Chrome with --remote-debugging-port
 */
import { chromium } from '@playwright/test';
import path from 'path';

async function tryProfile(name: string, dir: string) {
  console.log(`\n=== ${name} (${dir}) ===`);
  try {
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1440, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const r = await page.goto('https://www.bizbuysell.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch((e) => {
      console.log(`  NAV THREW: ${e.message.split('\n')[0]}`);
      return null;
    });
    if (r) {
      console.log(`  status: ${r.status()}   title: "${(await page.title()).slice(0, 50)}"`);
    }
    await ctx.close();
  } catch (e) {
    console.log(`  OUTER THREW: ${(e as Error).message.split('\n')[0]}`);
  }
}

async function tryCDP() {
  console.log('\n=== CDP attach to localhost:9222 ===');
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222').catch((e) => {
      console.log(`  connect failed: ${e.message}`);
      return null;
    });
    if (!browser) return;
    const contexts = browser.contexts();
    console.log(`  contexts: ${contexts.length}`);
    if (contexts.length === 0) { await browser.close(); return; }
    const page = contexts[0].pages()[0] ?? await contexts[0].newPage();
    const r = await page.goto('https://www.bizbuysell.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch((e) => { console.log(`  nav threw: ${e.message}`); return null; });
    if (r) console.log(`  status: ${r.status()}  title: "${(await page.title()).slice(0,50)}"`);
    await browser.close();
  } catch (e) {
    console.log(`  OUTER THREW: ${(e as Error).message.split('\n')[0]}`);
  }
}

(async () => {
  await tryProfile('original profile', path.resolve(__dirname, '../.browser-profile'));
  await tryProfile('fresh profile', path.resolve(__dirname, '../.browser-profile-fresh'));
  await tryCDP();
})();
