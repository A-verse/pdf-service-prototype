/**
 * Illustrative Puppeteer cleanup pattern for the design document.
 * This is not a complete renderer or production-ready application.
 * Add schema validation, tenant authorization, logging redaction, and
 * measured timeouts appropriate to the actual HTML templates.
 */
async function renderPdf(browser, html, { timeoutMs = 20_000 } = {}) {
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: timeoutMs,
    });
  } finally {
    // Always release the page even if content loading or PDF rendering fails.
    await page.close().catch(() => {});
  }
}

module.exports = { renderPdf };
