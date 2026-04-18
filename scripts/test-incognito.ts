/**
 * Test whether a fresh (incognito-style) Chrome context can get past
 * Akamai on bizbuysell.com. The skill says this combo 403s, but the
 * user wants to re-verify — fingerprinting changes, and we also have
 * playwright-extra + stealth available now.
 *
 * Tries 4 configurations in order, reports status + page title for each:
 *   A. vanilla chromium.launch + newContext (no stealth)
 *   B. chromium.launch with --incognito flag + newContext
 *   C. playwright-extra with stealth plugin
 *   D. real-Chrome channel, launch (non-persistent) + newContext
 *
 * All headed. Serial. One URL per config to minimize noise.
 */
import { chromium as vanilla, BrowserContext, Browser } from '@playwright/test';

type Result = { config: string; url: string; status: number | null; title: string; blocked: boolean; note?: string };

const TEST_URLS = [
  'https://www.bizbuysell.com/businesses-for-sale/',
  'https://www.bizbuysell.com/business-opportunity/residential-hvac-serving-oklahoma-city/2455476/',
];

function isBlocked(status: number | null, title: string): boolean {
  if (status === null) return true;
  if (status >= 400) return true;
  if (/access denied/i.test(title)) return true;
  return false;
}

async function probe(ctx: BrowserContext, configName: string): Promise<Result[]> {
  const page = await ctx.newPage();
  const results: Result[] = [];
  for (const url of TEST_URLS) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const status = resp?.status() ?? null;
      await page.waitForTimeout(500);
      const title = await page.title();
      results.push({ config: configName, url, status, title, blocked: isBlocked(status, title) });
    } catch (e) {
      results.push({
        config: configName, url, status: null, title: '', blocked: true,
        note: (e as Error).message.split('\n')[0],
      });
    }
    await page.waitForTimeout(1500);
  }
  await page.close();
  return results;
}

async function configA(): Promise<{ ctx: BrowserContext; browser: Browser }> {
  const browser = await vanilla.launch({ headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  return { ctx, browser };
}

async function configB(): Promise<{ ctx: BrowserContext; browser: Browser }> {
  const browser = await vanilla.launch({
    headless: false,
    args: ['--incognito', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  return { ctx, browser };
}

async function configC(): Promise<{ ctx: BrowserContext; browser: Browser } | null> {
  try {
    const { chromium: extra } = await import('playwright-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    extra.use(StealthPlugin());
    const browser = await extra.launch({ headless: false }) as unknown as Browser;
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    });
    return { ctx, browser };
  } catch (e) {
    console.warn('configC skipped:', (e as Error).message);
    return null;
  }
}

async function configD(): Promise<{ ctx: BrowserContext; browser: Browser }> {
  const browser = await vanilla.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  return { ctx, browser };
}

async function main() {
  const configs: { name: string; run: () => Promise<{ ctx: BrowserContext; browser: Browser } | null> }[] = [
    { name: 'A: bundled chromium + newContext', run: configA },
    { name: 'B: bundled + --incognito flag', run: configB },
    { name: 'C: playwright-extra + stealth', run: configC },
    { name: 'D: real Chrome + newContext (non-persistent)', run: configD },
  ];

  const all: Result[] = [];
  for (const c of configs) {
    console.log(`\n=== ${c.name} ===`);
    let session;
    try {
      session = await c.run();
    } catch (e) {
      console.warn(`  launch failed: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!session) continue;
    const { ctx, browser } = session;
    const results = await probe(ctx, c.name);
    all.push(...results);
    for (const r of results) {
      const mark = r.blocked ? '❌' : '✅';
      console.log(`  ${mark} ${r.status ?? 'ERR'}  "${r.title.slice(0, 50)}"  ${r.url.replace('https://www.bizbuysell.com', '')}`);
      if (r.note) console.log(`     ${r.note}`);
    }
    await ctx.close();
    await browser.close();
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('\n--- summary ---');
  const byConfig = new Map<string, Result[]>();
  for (const r of all) {
    const list = byConfig.get(r.config) ?? [];
    list.push(r);
    byConfig.set(r.config, list);
  }
  for (const [cfg, rs] of byConfig) {
    const passed = rs.filter((r) => !r.blocked).length;
    console.log(`${cfg}: ${passed}/${rs.length} passed`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
