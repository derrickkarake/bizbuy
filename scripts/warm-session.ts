/**
 * One-time warm-up: opens bizbuysell in the persistent profile.
 * Browse normally (search, scroll, click a listing or two) so Akamai
 * marks the profile as human. Close the browser when done — cookies
 * and storage persist in .browser-profile/ for later scripts.
 */
import { launchSession } from '../scrapers/session';

(async () => {
  const context = await launchSession({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('https://www.bizbuysell.com/', { waitUntil: 'domcontentloaded' });
  console.log('\n[warm-session] Browse normally. Close the window when done.\n');
  await context.waitForEvent('close', { timeout: 0 });
})();
