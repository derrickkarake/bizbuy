/**
 * Resolve the 9 memo-sourced listings (memo-01..memo-09 in shortlist-v2.csv)
 * to their canonical BizBuySell URLs by scraping state+industry search pages
 * and fuzzy-matching on distinctive title keywords.
 *
 * Output: data/memo-url-map.json
 *
 * Rate limits are real — sleeps 6s between navigations, serial only.
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../scrapers/session';
import { scrapeSearchPage } from '../scrapers/search';

type MemoTarget = {
  memoId: string;
  // Must-match tokens (lowercased, all must appear in card title)
  keywords: string[];
  // Fallback keywords: any one must appear (used if primary miss)
  anyOf?: string[];
  searchUrls: string[]; // Try in order until a match is found
  location: string;
};

const BASE = 'https://www.bizbuysell.com';

const TARGETS: MemoTarget[] = [
  {
    memoId: 'memo-01',
    keywords: ['cleaning', 'turnkey'],
    anyOf: ['fully staffed', '300k', '$300k', 'commercial cleaning'],
    searchUrls: [`${BASE}/kansas/cleaning-businesses-for-sale/`],
    location: 'Sedgwick County, KS',
  },
  {
    memoId: 'memo-02',
    keywords: ['cleaning'],
    anyOf: ['sba', '718', '326', 'high-margin', 'high margin'],
    searchUrls: [`${BASE}/massachusetts/cleaning-businesses-for-sale/`],
    location: 'Middlesex County, MA',
  },
  {
    memoId: 'memo-03',
    keywords: ['hvac', 'oklahoma city'],
    anyOf: ['residential hvac', 'serving oklahoma'],
    searchUrls: [`${BASE}/oklahoma/hvac-businesses-for-sale/`],
    location: 'Oklahoma City, OK',
  },
  {
    memoId: 'memo-04',
    keywords: ['janitorial'],
    anyOf: ['30-year', '30 year', 'absentee', 'recurring'],
    searchUrls: [
      `${BASE}/california/cleaning-businesses-for-sale/`,
      `${BASE}/california/service-businesses-for-sale/`,
    ],
    location: 'Orange County, CA',
  },
  {
    memoId: 'memo-05',
    keywords: ['landscaping'],
    anyOf: ['recurring', '$40k down', '200k rev', '135k'],
    searchUrls: [
      `${BASE}/new-york/service-businesses-for-sale/`,
      `${BASE}/new-york-businesses-for-sale/`,
    ],
    location: 'Erie County, NY',
  },
  {
    memoId: 'memo-06',
    keywords: ['electrical'],
    anyOf: ['multi decade', 'multi-decade', 'contracting', 'respected'],
    searchUrls: [
      `${BASE}/virginia/service-businesses-for-sale/`,
      `${BASE}/virginia-businesses-for-sale/`,
    ],
    location: 'Richmond, VA',
  },
  {
    memoId: 'memo-07',
    keywords: ['plumbing'],
    anyOf: ['summit county', 'northern summit'],
    searchUrls: [`${BASE}/ohio/plumbing-businesses-for-sale/`],
    location: 'Summit County, OH',
  },
  {
    memoId: 'memo-08',
    keywords: ['pest control'],
    anyOf: ['store', 'absentee'],
    searchUrls: [`${BASE}/florida/pest-control-businesses-for-sale/`],
    location: 'Hillsborough County, FL',
  },
  {
    memoId: 'memo-09',
    keywords: ['hvac'],
    anyOf: ['recession', 'recession-proof', 'recession proof', 'high income'],
    searchUrls: [`${BASE}/texas/hvac-businesses-for-sale/`],
    location: 'Tyler, TX',
  },
];

type Match = {
  memoId: string;
  url: string | null;
  listingId: string | null;
  matchedTitle: string | null;
  matchedLocation: string | null;
  source: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function match(card: { title: string | null; location: string | null }, t: MemoTarget): boolean {
  const title = norm(card.title);
  const loc = norm(card.location);
  const hay = `${title} ${loc}`;
  const kwMatch = t.keywords.every((k) => hay.includes(norm(k)));
  if (!kwMatch) return false;
  if (t.anyOf && t.anyOf.length) {
    return t.anyOf.some((k) => hay.includes(norm(k)));
  }
  return true;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const ctx = await launchSession({ headless: false });
  const results: Match[] = [];

  try {
    for (const t of TARGETS) {
      let found: Match = {
        memoId: t.memoId,
        url: null,
        listingId: null,
        matchedTitle: null,
        matchedLocation: null,
        source: null,
      };

      for (const searchUrl of t.searchUrls) {
        console.log(`[${t.memoId}] trying ${searchUrl}`);
        let cards: Awaited<ReturnType<typeof scrapeSearchPage>> = [];
        try {
          cards = await scrapeSearchPage(ctx, searchUrl);
        } catch (e) {
          console.warn(`[${t.memoId}] scrape failed:`, (e as Error).message);
        }
        console.log(`[${t.memoId}]   ${cards.length} cards`);

        const hits = cards.filter((c) => match(c, t));
        if (hits.length) {
          const best = hits[0];
          found = {
            memoId: t.memoId,
            url: best.url,
            listingId: best.listingId,
            matchedTitle: best.title,
            matchedLocation: best.location,
            source: searchUrl,
          };
          console.log(`[${t.memoId}] MATCH: ${best.title} (${best.url})`);
          break;
        }
        await sleep(6000);
      }

      if (!found.url) console.log(`[${t.memoId}] NO MATCH`);
      results.push(found);
      await sleep(6000);
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
