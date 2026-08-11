#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const url = process.argv[2] || 'http://localhost:8765';
  const outDir = process.argv[3] || 'review/iteration-1';
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(outDir, 'hero.png') });

  await page.evaluate(() =>
    window.scrollTo(0, document.body.scrollHeight * 0.33)
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'mid.png') });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outDir, 'full.png'),
    fullPage: true,
  });

  await browser.close();
  console.log(
    JSON.stringify({ outDir, shots: ['hero.png', 'mid.png', 'full.png'] })
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
