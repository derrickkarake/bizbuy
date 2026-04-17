import { launchSession } from '../scrapers/session';

(async () => {
  const ctx = await launchSession({ headless: false });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const urls = [
    'https://www.bizbuysell.com/',
    'https://www.bizbuysell.com/texas/hvac-businesses-for-sale/',
    'https://www.bizbuysell.com/business-opportunity/rapidly-growing-hvac-company-in-north-texas-turnkey-operations/2469359/',
  ];
  for (const u of urls) {
    try {
      const r = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const t = await page.title();
      console.log(`${r?.status()} "${t.slice(0, 60)}"  ${u}`);
    } catch (e) {
      console.log(`THREW  ${(e as Error).message.split('\n')[0].slice(0, 80)}  ${u}`);
    }
  }
  await ctx.close();
})();
