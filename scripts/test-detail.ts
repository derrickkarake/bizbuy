import { launchSession } from '../scrapers/session';
import { scrapeListing } from '../scrapers/listing';

(async () => {
  const ctx = await launchSession({ headless: false });
  const d = await scrapeListing(
    ctx,
    'https://www.bizbuysell.com/business-opportunity/rapidly-growing-hvac-company-in-north-texas-turnkey-operations/2469359/',
  );
  console.log(JSON.stringify(d, null, 2));
  await ctx.close();
})();
