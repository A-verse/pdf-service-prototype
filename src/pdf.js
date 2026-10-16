import puppeteer from "puppeteer";
import { renderDocumentHtml } from "./template.js";
import { positiveIntegerEnv } from "./config.js";

const MAX_CONCURRENT_RENDERS = positiveIntegerEnv("PDF_CONCURRENCY", 2);
let browserPromise;
let activeRenders = 0;
const waiting = [];

async function acquireRenderSlot() {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
  activeRenders++;
}

function releaseRenderSlot() {
  activeRenders--;
  waiting.shift()?.();
}

function invalidateBrowser(browser) {
  const promiseForBrowser = browserPromise;
  if (!promiseForBrowser) return;
  // Do not clear a newer browser that may have launched after this one disconnected.
  promiseForBrowser.then((current) => {
    if (current === browser && browserPromise === promiseForBrowser) {
      browserPromise = null;
    }
  }).catch(() => {
    if (browserPromise === promiseForBrowser) browserPromise = null;
  });
}

async function getBrowser() {
  if (!browserPromise) {
    const launchPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    browserPromise = launchPromise;
    launchPromise.then((browser) => {
      browser.once("disconnected", () => {
        if (browserPromise === launchPromise) browserPromise = null;
      });
    }).catch(() => {
      if (browserPromise === launchPromise) browserPromise = null;
    });
  }
  return browserPromise;
}

function isBrowserLifecycleError(error, browser) {
  return !browser?.connected || /browser.*(closed|disconnected)|target closed|connection closed|protocol error/i.test(String(error?.message || ""));
}

async function renderWithBrowser(doc, allowRecovery = true) {
  let browser;
  let page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
    await page.setContent(renderDocumentHtml(doc), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 60_000,
      margin: { top: "18mm", right: "14mm", bottom: "18mm", left: "14mm" },
    });
  } catch (error) {
    if (browser && isBrowserLifecycleError(error, browser)) {
      invalidateBrowser(browser);
      if (allowRecovery) return renderWithBrowser(doc, false);
    }
    throw error;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function renderPdf(doc) {
  await acquireRenderSlot();
  try {
    return await renderWithBrowser(doc);
  } finally {
    releaseRenderSlot();
  }
}

export async function closePdfBrowser() {
  const pendingBrowser = browserPromise;
  browserPromise = null;
  if (!pendingBrowser) return;
  try {
    const browser = await pendingBrowser;
    await browser.close();
  } catch {
    // A disconnected browser is already unusable; shutdown should continue.
  }
}
