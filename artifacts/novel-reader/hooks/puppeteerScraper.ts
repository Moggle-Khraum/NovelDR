// puppeteerScraper.ts
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

let browser: puppeteer.Browser | null = null;

/**
 * Fetches the full HTML of a page using Puppeteer (with stealth).
 * Reuses a single browser instance across calls.
 */
export async function fetchWithPuppeteer(url: string): Promise<string> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,                 // set to false to see what's happening
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    console.log('[Puppeteer] Browser launched');
  }

  const page = await browser.newPage();

  // Set a modern user agent and viewport
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 800 });

  // Navigate, wait for network to be idle (Cloudflare challenge usually resolves then)
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Additional wait: ensure the page is not showing the Cloudflare challenge
  // The stealth plugin often bypasses it, but we wait a bit more to be safe
  await page.waitForFunction(
    () => {
      // If the page contains the typical Cloudflare challenge div, wait longer
      return !document.querySelector('#cf-content, #challenge-running, .cf-browser-verification');
    },
    { timeout: 15000 }
  ).catch(() => {
    console.warn('[Puppeteer] Cloudflare challenge might still be present, continuing anyway');
  });

  const html = await page.content();
  await page.close();
  return html;
}

/**
 * Closes the Puppeteer browser (call this when your application shuts down).
 */
export async function closePuppeteerBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    console.log('[Puppeteer] Browser closed');
  }
}
