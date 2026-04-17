/**
 * Fallback resolver: use Google site: search to locate each memo listing's
 * canonical BizBuySell URL. The direct BizBuySell scrape got rate-limited;
 * Google doesn't care about Akamai.
 *
 * Uses a FRESH Playwright profile (not the .browser-profile dir) to avoid
 * carrying any Google login state or cookies.
 */
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

type Target = { memoId: string; query: string };

const TARGETS: Target[] = [
  { memoId: 'memo-01', query: 'Commercial Cleaning Turnkey Fully Staffed 300K Income Sedgwick' },
  { memoId: 'memo-02', query: 'SBA High-Margin Cleaning Business 718,200 Revenue 326,402 SDE' },
  { memoId: 'memo-03', query: 'Residential HVAC Serving Oklahoma City 136 maintenance agreements' },
  { memoId: 'memo-04', query: '30-Year Janitorial Company 90% Recurring Revenue Absentee Orange County' },
  { memoId: 'memo-05', query: 'Highly Recurring Landscaping 200K Rev 135K SDE 40K Down Erie' },
  { memoId: 'memo-06', query: 'Respected Multi Decade Electrical Contracting Company Richmond' },
  { memoId: 'memo-07', query: 'Successful Northern Summit County Plumbing Company' },
  { memoId: 'memo-08', query: 'Profitable Pest Control Store Absentee Operated Hillsborough' },
  { memoId: 'memo-09', query: 'High Income Recession-Proof HVAC Services Business Tyler Texas' },
];

type Match = {
  memoId: string;
  query: string;
  url: string | null;
  listingId: string | null;
  titleText: string | null;
};

function extractListingId(url: string): string | null {
  const m = url.match(/\/business-opportunity\/[^/]+\/(\d{6,})\/?/);
  return m?.[1] ?? null;
}

function cleanGoogleUrl(href: string): string {
  // Google wraps results in /url?q=...&... on some views
  try {
    if (href.startsWith('/url?')) {
      const params = new URLSearchParams(href.slice('/url?'.length));
      return params.get('q') ?? href;
    }
  } catch {}
  return href;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const profileDir = path.resolve(__dirname, '../.google-profile');
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const results: Match[] = [];

  try {
    for (const t of TARGETS) {
      const q = encodeURIComponent(`site:bizbuysell.com ${t.query}`);
      const url = `https://www.google.com/search?q=${q}&num=20`;
      console.log(`[${t.memoId}] ${t.query}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (e) {
        console.warn(`[${t.memoId}] nav failed:`, (e as Error).message);
        results.push({ memoId: t.memoId, query: t.query, url: null, listingId: null, titleText: null });
        await sleep(3000);
        continue;
      }
      await page.waitForTimeout(1500);

      const hits = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        return anchors
          .map((a) => ({ href: a.href || a.getAttribute('href') || '', text: (a.innerText || '').slice(0, 200) }))
          .filter((h) => h.href.includes('bizbuysell.com/business-opportunity/'));
      });

      const deduped = new Map<string, { href: string; text: string }>();
      for (const h of hits) {
        const clean = cleanGoogleUrl(h.href);
        if (!deduped.has(clean)) deduped.set(clean, { href: clean, text: h.text });
      }

      const first = Array.from(deduped.values())[0];
      if (first) {
        const id = extractListingId(first.href);
        results.push({
          memoId: t.memoId,
          query: t.query,
          url: first.href.split('#')[0].split('?')[0],
          listingId: id,
          titleText: first.text,
        });
        console.log(`  -> ${first.href}`);
      } else {
        results.push({ memoId: t.memoId, query: t.query, url: null, listingId: null, titleText: null });
        console.log(`  -> NO MATCH`);
      }

      await sleep(2500);
    }
  } finally {
    await ctx.close();
  }

  const outPath = path.resolve(__dirname, '../data/memo-url-map.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${outPath}`);
  console.log(`resolved ${results.filter((r) => r.url).length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
