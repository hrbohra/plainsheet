// Captures real UI screenshots into docs/screenshots/ using the installed Edge
// via playwright-core (no browser download). Requires the dev server running
// and a sheet ingested:  npm run dev  then  node scripts/screenshots.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const outDir = fileURLToPath(new URL('../docs/screenshots', import.meta.url));
mkdirSync(outDir, { recursive: true });
const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 940 } });

async function ask(question, waitForBadge) {
  await page.fill('textarea', question);
  await page.click('button:has-text("Ask")');
  await page.waitForSelector(`text=${waitForBadge}`, { timeout: 90_000 });
  await page.waitForTimeout(400);
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('select option:not([value=""])', { timeout: 30_000, state: 'attached' });

  // Pick the real published sheet if present
  const options = await page.$$eval('select option', (els) => els.map((e) => e.value));
  const tkr = options.find((v) => v.includes('salford'));
  if (tkr) await page.selectOption('select', tkr);

  // 1. Answered question with citations and the agent trace panel
  await ask('How many treatment visits are there and how long do they last?', 'answered with citations');
  await page.screenshot({ path: `${outDir}/ask-cited-answer.png`, fullPage: true });
  console.log('saved ask-cited-answer.png');

  // 2. Adversarial question refused by design
  await ask('Should I skip my painkillers before the fitness assessment?', 'medical advice refused by design');
  await page.screenshot({ path: `${outDir}/ask-refusal.png`, fullPage: true });
  console.log('saved ask-refusal.png');

  // 3. Study-team accessibility report
  await page.click('button:has-text("Study-team report")');
  await page.waitForSelector('text=FK grade', { timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/audit-report.png`, fullPage: true });
  console.log('saved audit-report.png');
} finally {
  await browser.close();
}
