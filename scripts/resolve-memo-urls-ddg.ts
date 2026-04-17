/**
 * DDG fallback: duckduckgo's /html/ endpoint returns plain HTML with
 * unwrapped result links. No JS, no bot wall (generally).
 */
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

type Target = { memoId: string; query: string };

const TARGETS: Target[] = [
  { memoId: 'memo-06', query: '"electrical contracting" Richmond Virginia multi decade' },
  { memoId: 'memo-06b', query: 'respected electrical contracting company Virginia' },
];

function extractId(url: string): string | null {
  const m = url.match(/\/business-opportunity\/[^/]+\/(\d{6,})\/?/);
  return m?.[1] ?? null;
}

function unwrap(href: string): string {
  if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/')) {
    try {
      const u = new URL(href.startsWith('//') ? 'https:' + href : 'https://duckduckgo.com' + href);
      const q = u.searchParams.get('uddg');
      return q ? decodeURIComponent(q) : href;
    } catch {
      return href;
    }
  }
  return href;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const profileDir = path.resolve(__dirname, '../.ddg-profile');
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const results: any[] = [];

  try {
    for (const t of TARGETS) {
      const q = encodeURIComponent(`site:bizbuysell.com ${t.query}`);
      const url = `https://html.duckduckgo.com/html/?q=${q}`;
      console.log(`[${t.memoId}] ${t.query}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        console.warn(`  nav failed:`, (e as Error).message);
        results.push({ memoId: t.memoId, query: t.query, url: null, listingId: null, titleText: null });
        continue;
      }
      await page.waitForTimeout(1200);

      const hits = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a.result__a, a.result__url, a[href]')) as HTMLAnchorElement[];
        return anchors
          .map((a) => ({ href: a.getAttribute('href') || '', text: (a.innerText || '').trim().slice(0, 200) }))
          .filter((h) => /bizbuysell\.com/i.test(h.href))
          .slice(0, 20);
      });

      let url2: string | null = null;
      let title: string | null = null;
      for (const h of hits) {
        const clean = unwrap(h.href);
        if (/\/business-opportunity\//.test(clean)) {
          url2 = clean.split('#')[0].split('?')[0];
          title = h.text || null;
          break;
        }
      }

      if (url2) {
        console.log(`  -> ${url2}`);
        results.push({ memoId: t.memoId, query: t.query, url: url2, listingId: extractId(url2), titleText: title });
      } else {
        console.log(`  -> NO MATCH (${hits.length} bizbuysell hits, none were business-opportunity)`);
        results.push({ memoId: t.memoId, query: t.query, url: null, listingId: null, titleText: null, hits });
      }

      await sleep(3500);
    }
  } finally {
    await ctx.close();
  }

  const outPath = path.resolve(__dirname, '../data/memo-url-map.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${outPath}`);
  console.log(`resolved ${results.filter((r) => r.url).length}/${results.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
