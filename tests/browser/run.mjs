// Starts the dashboard server on a free port, opens it in headless Chromium and
// runs dashboard.checks.mjs. Playwright is not a dependency of this repo, so
// install it first:
//
//   npm install --no-save playwright && npx playwright install chromium
//   npm run test:browser
import { createRequire } from 'node:module';
import checks from './dashboard.checks.mjs';

const require = createRequire(import.meta.url);
const { createServer } = require('../../dashboard/serve.js');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const { summary, results } = await checks({ page, baseUrl: `http://127.0.0.1:${server.address().port}/` });
  for (const result of results) {
    console.log(`${result.ok ? 'ok    ' : 'FAILED'} ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
  }
  console.log(summary);
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
