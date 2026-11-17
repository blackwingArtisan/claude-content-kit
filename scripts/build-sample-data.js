#!/usr/bin/env node
/**
 * Builds dashboard/data/dashboard-data.json from the real plugin output in
 * examples/out, so the sample dashboard shows the same campaign the commands
 * wrote. It imports the files exactly as the dashboard's Import button does
 * (dashboard/import.js), then adds the review activity in
 * dashboard/data/sample-activity.json: approvals, revision requests and
 * last month's results.
 *
 *   node scripts/build-sample-data.js          write the sample data
 *   node scripts/build-sample-data.js --check  exit 1 if the file is out of date
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CURRENT_VERSION } = require('../dashboard/migrate.js');
const { importFile, mergeImport, setReviewStatus } = require('../dashboard/import.js');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'dashboard/data/dashboard-data.json');
const EXAMPLES = path.join(ROOT, 'examples/out');

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exampleFiles = (dir, ext) => fs.readdirSync(path.join(EXAMPLES, dir), { recursive: true })
  .filter((file) => file.endsWith(ext)).sort().map((file) => path.join('examples/out', dir, file));

function build() {
  const config = JSON.parse(read('examples/brand.config.json'));
  const activity = JSON.parse(read('dashboard/data/sample-activity.json'));
  let data = {
    schemaVersion: CURRENT_VERSION,
    workspace: { brand: config.brand.name, updatedAt: activity.updatedAt },
    brandHub: {
      tagline: config.brand.tagline,
      voice: config.voice.adjectives,
      pillars: config.pillars,
      colors: activity.brandHub.colors,
      approvedPhrases: activity.brandHub.approvedPhrases,
      bannedPhrases: [...new Set([...config.compliance.bannedClaims, 'artisanal', 'elevate'])],
      assets: activity.brandHub.assets,
    },
    approvals: [],
    revisionRequests: [],
    calendar: [],
    results: activity.results,
  };
  // The calendar first, so drafted posts fill its planned slots.
  const files = [
    ...exampleFiles('calendar', '.csv'),
    ...exampleFiles('social', '.csv'),
    ...exampleFiles('email', '.md'),
  ];
  for (const file of files) {
    const imported = importFile(path.basename(file), read(file), {
      reviewer: config.approvals.approver,
      dueDate: activity.emailDueDate,
    });
    data = mergeImport(data, imported).data;
  }
  for (const [contentId, status] of Object.entries(activity.reviews)) setReviewStatus(data, contentId, status);
  for (const request of activity.revisionRequests) {
    data.revisionRequests.push(request);
    if (request.status === 'open') setReviewStatus(data, request.contentId, 'changes_requested');
  }
  return data;
}

module.exports = { build, OUTPUT };

if (require.main === module) {
  const text = `${JSON.stringify(build(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (current !== text) {
      console.error(`${path.relative(ROOT, OUTPUT)} is out of date. Run: npm run build-sample`);
      process.exit(1);
    }
    console.log(`${path.relative(ROOT, OUTPUT)} is up to date.`);
  } else {
    fs.writeFileSync(OUTPUT, text);
    console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
  }
}
