import { chromium, BrowserContext } from '@playwright/test';
import path from 'path';

export const USER_DATA_DIR = path.resolve(__dirname, '../.browser-profile');

export type SessionOpts = {
  headless?: boolean;
  viewport?: { width: number; height: number };
};

export async function launchSession(opts: SessionOpts = {}): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: opts.headless ?? false,
    channel: 'chrome',
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}
