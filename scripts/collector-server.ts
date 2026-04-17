/**
 * Local collector. Bookmarklet POSTs the current page's URL + outerHTML here.
 * We auto-detect whether it's a listing detail page or a search-results page:
 *   - /business-opportunity/.../{id}/  → detail; parse fields, save to data/listings/<id>.json
 *   - any *-businesses-for-sale page   → search; parse card summaries, append to data/cards-collected.json
 *
 * Status page at GET / shows collected counts, recent items, and the bookmarklet.
 */
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const PORT = 4455;
const LISTINGS_DIR = path.resolve(__dirname, '../data/listings');
const RAW_DIR = path.resolve(__dirname, '../data/raw/collected');
const CARDS_FILE = path.resolve(__dirname, '../data/cards-collected.json');
fs.mkdirSync(LISTINGS_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));

// ---- helpers ----
function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\$[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function parseInt0(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}
function extractId(url: string): string | null {
  const m = url.match(/\/(\d{6,})\/?$/);
  return m?.[1] ?? null;
}
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n/g, '\n');
}

// ---- parse a detail page ----
function parseDetail(url: string, html: string) {
  const text = htmlToText(html);
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null;

  function grab(label: string, cap = 80): string | null {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)`);
    const m = text.match(re);
    return m ? m[1].trim().slice(0, cap) : null;
  }

  const descMatch = html.match(/class="[^"]*(?:businessDescription|business-description|description)[^"]*"[^>]*>([\s\S]{50,4000}?)<\/[a-z]+>/i);
  const description = descMatch
    ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
    : null;

  const locMatch = text.match(/([A-Za-z][A-Za-z .'\-]+,\s*[A-Z]{2})/);

  return {
    listingId: extractId(url),
    url,
    title,
    location: locMatch?.[1] ?? null,
    askingPrice: parseMoney(grab('Asking Price')),
    cashFlowSde: parseMoney(grab('Cash Flow')),
    grossRevenue: parseMoney(grab('Gross Revenue')),
    ebitda: parseMoney(grab('EBITDA')),
    ffe: parseMoney(grab('FF&E')),
    inventory: parseMoney(grab('Inventory')),
    established: parseInt0(grab('Established', 20)),
    employees: parseInt0(grab('Employees', 20)),
    realEstate: grab('Real Estate'),
    reasonForSelling: grab('Reason for Selling', 200),
    supportTraining: grab('(?:Support\\s*(?:&|and)\\s*Training|Training)', 300),
    description,
    fetchedAt: new Date().toISOString(),
  };
}

// ---- parse a search page (card summaries) ----
function parseSearch(url: string, html: string) {
  const cards: Array<Record<string, unknown>> = [];
  // Split on the Angular component boundaries
  const cardRe = /<app-listing-(?:diamond|showcase|standard)[\s\S]*?<\/app-listing-(?:diamond|showcase|standard)>/gi;
  const cardMatches = html.match(cardRe) ?? [];
  for (const cardHtml of cardMatches) {
    const hrefMatch = cardHtml.match(/href="(https?:\/\/[^"]*business-opportunity\/[^"]+?)"/i);
    const href = hrefMatch?.[1] ?? null;
    if (!href) continue;
    const titleMatch =
      cardHtml.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      cardHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      cardHtml.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null;
    const cardText = htmlToText(cardHtml);
    const askMatch = cardText.match(/Asking\s*Price[:\s]*\$[\d,]+/i);
    const cfMatch = cardText.match(/Cash\s*Flow[:\s]*\$[\d,]+/i);
    const locMatch = cardText.match(/([A-Za-z .'\-]+,\s*[A-Z]{2})/);
    cards.push({
      listingId: extractId(href),
      url: href,
      title,
      location: locMatch?.[1] ?? null,
      askingPrice: parseMoney(askMatch?.[0] ?? null),
      cashFlow: parseMoney(cfMatch?.[0] ?? null),
      descriptionSnippet: cardText.slice(0, 500),
      sourceUrl: url,
    });
  }
  return cards;
}

// ---- load/save cards file ----
type CardRec = { listingId: string | null; url: string; [k: string]: unknown };
let cardsCollected: CardRec[] = [];
if (fs.existsSync(CARDS_FILE)) {
  try { cardsCollected = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8')); } catch {}
}
function saveCards() {
  fs.writeFileSync(CARDS_FILE, JSON.stringify(cardsCollected, null, 2));
}

let detailCount = 0;
let searchCount = 0;
let newCardsTotal = 0;
const recent: Array<{ type: string; id: string | null; title: string | null; at: string }> = [];

app.post('/collect', (req, res) => {
  const { url, html } = req.body as { url: string; html: string };
  if (!url || !html) return res.status(400).json({ error: 'need url and html' });

  // detail page if URL matches /business-opportunity/.../{id}/
  const isDetail = /\/business-opportunity\/[^\/]+\/\d{6,}\/?$/.test(url);

  if (isDetail) {
    const detail = parseDetail(url, html);
    const id = detail.listingId ?? `u${Date.now()}`;
    fs.writeFileSync(path.join(LISTINGS_DIR, `${id}.json`), JSON.stringify(detail, null, 2));
    fs.writeFileSync(path.join(RAW_DIR, `detail-${id}.html`), html);
    detailCount++;
    recent.unshift({ type: 'detail', id: detail.listingId, title: detail.title, at: new Date().toISOString() });
    if (recent.length > 30) recent.pop();
    console.log(`[detail] ${id} · ask=${detail.askingPrice} sde=${detail.cashFlowSde} · ${(detail.title ?? '').slice(0, 60)}`);
    return res.json({ ok: true, type: 'detail', id, detail });
  }

  // otherwise treat as search page
  const cards = parseSearch(url, html);
  const existingUrls = new Set(cardsCollected.map((c) => c.url));
  const fresh = cards.filter((c) => c.url && !existingUrls.has(c.url as string));
  cardsCollected.push(...(fresh as CardRec[]));
  saveCards();
  const stampId = `s${Date.now()}`;
  fs.writeFileSync(path.join(RAW_DIR, `search-${stampId}.html`), html);
  searchCount++;
  newCardsTotal += fresh.length;
  recent.unshift({ type: 'search', id: stampId, title: `${cards.length} cards (${fresh.length} new)`, at: new Date().toISOString() });
  if (recent.length > 30) recent.pop();
  console.log(`[search] ${url} · ${cards.length} cards (${fresh.length} new, ${cardsCollected.length} total)`);
  return res.json({ ok: true, type: 'search', cards: cards.length, newCards: fresh.length, total: cardsCollected.length });
});

app.get('/', (_req, res) => {
  res.send(`<!doctype html><html><head><title>BizBuy collector</title>
<style>body{font:14px/1.5 -apple-system,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px}
.stat{display:inline-block;margin-right:2rem;padding:8px 12px;background:#f4f4f4;border-radius:6px}
.bm{display:inline-block;padding:10px 16px;background:#1746a2;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;margin:8px 0}
li{margin:.3rem 0}
.dtag{background:#e8f0ff;color:#1746a2;padding:1px 6px;border-radius:8px;font-size:11px;margin-right:4px}
.stag{background:#e8f7e8;color:#197a19;padding:1px 6px;border-radius:8px;font-size:11px;margin-right:4px}
</style>
<meta http-equiv="refresh" content="10"></head><body>
<h1>BizBuy collector</h1>
<div>
  <span class="stat">Detail pages: <b>${detailCount}</b></span>
  <span class="stat">Search pages: <b>${searchCount}</b></span>
  <span class="stat">New cards: <b>${newCardsTotal}</b></span>
  <span class="stat">Total cards stored: <b>${cardsCollected.length}</b></span>
</div>

<h3>Bookmarklet</h3>
<p>Drag this to your bookmarks bar (Cmd+Shift+B shows it):</p>
<p><a class="bm" href="javascript:(function(){fetch('http://localhost:${PORT}/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:location.href,html:document.documentElement.outerHTML})}).then(r=>r.json()).then(d=>{const n=document.createElement('div');n.textContent='\\u2713 '+d.type+' '+(d.id||d.cards+' cards, '+d.newCards+' new');n.style.cssText='position:fixed;top:10px;right:10px;background:#2a7;color:#fff;padding:10px 14px;border-radius:6px;z-index:99999;font:14px sans-serif';document.body.appendChild(n);setTimeout(()=>n.remove(),3500)}).catch(e=>alert('collect failed: '+e.message))})();">📎 BizBuy collect</a></p>
<p style="color:#666;font-size:12px">Works on both <b>listing detail</b> pages and <b>search-result</b> pages. Server auto-detects and parses either one.</p>

<h3>Recent (last ${recent.length})</h3>
<ul>${recent.map((r) => `<li>${r.at.slice(11, 19)} <span class="${r.type === 'detail' ? 'dtag' : 'stag'}">${r.type}</span> ${r.id ?? '—'} — ${r.title ?? '—'}</li>`).join('')}</ul>

<p style="color:#888;font-size:12px">Page auto-refreshes every 10s.</p>
</body></html>`);
});

app.listen(PORT, () => console.log(`[collector] listening on http://localhost:${PORT}/`));
