# BizBuySell — exploration findings

Date: 2026-04-16
Context: Reconnaissance pass before building the listing-scraper workflow.

## 1. Bot-protection bypass

BizBuySell is fronted by **Akamai Bot Manager**. Raw Playwright, WebFetch, and even headless Chromium with custom user-agent + `navigator.webdriver` patch all get a **403 Access Denied** (Reference code + `errors.edgesuite.net` link).

**What works**:
- Playwright `chromium.launchPersistentContext()` pointing at `.browser-profile/`
- `channel: 'chrome'` (uses the system's real Chrome, not bundled Chromium)
- `headless: false` — **critical**, headless mode with the same profile still 403s
- No manual warm-up was needed on the first run; cookies/state written to the persistent dir survive between runs and keep working

All scraper scripts should go through `scrapers/session.ts` which encodes these settings. Every script must set `headless: false`.

## 2. URL scheme

All three combine cleanly — no login required for search pages.

| Pattern | Example | Notes |
|---|---|---|
| All listings | `/businesses-for-sale/` | Geo auto-redirect if no state in URL |
| By industry | `/{industry-slug}-businesses-for-sale/` | e.g. `/hvac-businesses-for-sale/` |
| By state | `/{state}-businesses-for-sale/` | e.g. `/texas-businesses-for-sale/` |
| Industry × state | `/{state}/{industry-slug}-businesses-for-sale/` | e.g. `/texas/hvac-businesses-for-sale/` |
| Listing detail | `/business-opportunity/{slug}/{listing-id}/` | 7-digit numeric id |

**Confirmed industry slugs** (200 OK): `service`, `plumbing`, `hvac`, `pest-control`, `cleaning`, `building-and-construction`.
**404 (don't guess)**: `heating-cooling` (site uses `hvac`), `electrical`, `landscaping`.

→ Need to fetch the canonical industry list from BizBuySell's own "View All Industries" modal before coding the scraper.

## 3. Filter encoding — the `?q=` param

Filter state is stored in a single query param `q` that is **base64-encoded URL params**.

Example: `?q=cGZyb209MTAwMDAw` → base64-decode → `pfrom=100000` → price-min filter of $100,000.

Other params observed or inferred:
- `pfrom` / `pto` — price min/max
- `lt=30,40,80` — listing types (30=Established Business, 40=Asset Sale, 80=Real Estate — inferred from the Listing Types menu counts)

Still TODO (need more UI probes):
- cash-flow / SDE min-max param names
- gross-revenue param names
- date-added
- established-after-year
- keyword

**Implementation pattern**: build an object of params, serialize to `k=v&k=v`, base64-encode, URL-encode, append as `?q=...`. That's cleaner than clicking the UI.

## 4. Listing card DOM

Listing results render as Angular components. Encountered on an industry page:
- `<app-listing-diamond>` — featured/premium cards (first positions)
- Probable siblings: `<app-listing-showcase>`, `<app-listing-standard>` — not yet confirmed but named in script scaffolding

Each card contains an anchor with href matching `/business-opportunity/...`. The card body text includes strings like `Cash Flow: $590,000` and a `City, STATE` location line that regex-match cleanly. Title extraction by `h2/h3` did not work on diamond cards — will need a card-type-specific selector pass.

## 5. Listing detail fields

On `/business-opportunity/.../{id}/` a full listing exposes (confirmed on listing 2469359):

- Title (`h1`)
- Asking Price, Gross Revenue, EBITDA, Cash Flow (SDE), FF&E, Inventory
- Established (year), Employees, Rent, Real Estate
- Description (long-form narrative)
- Reason for Selling
- Support & Training
- Broker info
- Financing info (sometimes)

Regex-based extraction works for the obvious ones; a few (Cash Flow, FF&E, Inventory, Real Estate) need tighter selectors because the page uses a labeled-list layout that the regex overran on. DOM selector pass against the actual financials block is the right next step.

## 6. Filter UI reference (screenshots in `scripts/exploration/out/`)

- **Industries** dropdown: Restaurants & Food, Service Businesses, Retail, Automotive & Boat, Building & Construction, Health Care & Fitness, Manufacturing, Beauty & Personal Care, + "View All Industries"
- **Listing Types**: Established Businesses (3,500+), Asset Sales (3,300+), Real Estate (1,300+), Start-up Businesses (514)
- **Price Range**: two selects (Any Min / Any Max) + Apply
- **More Filters** (modal): Gross Revenue min/max, Cash Flow (SDE)/EBITDA min/max, Keyword, Date Added, Established After Year, Real Estate Listing, Listing ID (more below fold)

## 7. What lives where

```
scrapers/session.ts                   # persistent-profile Chrome launcher
scripts/warm-session.ts               # open a visible browser for manual browsing if needed
scripts/exploration/01-homepage.ts    # homepage reconnaissance
scripts/exploration/02-search-page.ts # /buy/ redirect + form-controls enumeration
scripts/exploration/03-filter-ui.ts   # filter-panel screenshots + button enumeration
scripts/exploration/04-open-filters.ts# open each filter dropdown, screenshot
scripts/exploration/05-url-patterns.ts# probe industry/state URL patterns (headed only!)
scripts/exploration/06-listing-cards-and-q.ts # card DOM + q-param decode
scripts/exploration/07-listing-detail.ts      # detail-page field extraction
data/raw/                             # untouched HTML snapshots (homepage, search, one detail)
```

## 8. Still-open work before building the scraper proper

1. Fetch the full canonical industry-slug list (from "View All Industries").
2. Decode the remaining `q=` param names (cf_from, cf_to, rev_from, rev_to, established_after, keyword, date_added).
3. Confirm `app-listing-showcase` and `app-listing-standard` exist on pages without featured inventory, and write a unified card extractor.
4. Refine detail-page selectors so Cash Flow, FF&E, Inventory, Real Estate land in the right slots.
5. Add pagination discovery — figure out how page 2+ is reached (is it `?page=2`, scroll-to-load, or something else?).
6. Decide rate-limit/politeness settings and honor `robots.txt`.
