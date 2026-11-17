const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseCsv, CsvError } = require('../dashboard/formats.js');
const {
  checkCsv, checkEmail, checkFile, emailOptions, measurePost, POSTING_SCHEDULE, CONTENT_CALENDAR,
} = require('../scripts/check-output.js');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/brand.config.json'), 'utf8'));
const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
const csv = (columns, ...rows) => [columns, ...rows].map((row) => row.map(quote).join(',')).join('\n') + '\n';

const LINK = 'https://harborandpine.example.com/bean-club?utm_source=instagram&utm_medium=social&utm_campaign=winter-blend';
const goodPost = (overrides = {}) => {
  const post = {
    publish_date: '2026-11-30', publish_time: '08:00', channel: 'instagram',
    post_text: 'Winter Blend is here. Link in bio.', hashtags: '#harborandpine #winterblend #beanclub',
    link: LINK, asset_note: 'Bag beside a mug', pillar: 'Origin stories', status: 'draft', ...overrides,
  };
  return POSTING_SCHEDULE.map((column) => post[column]);
};
const goodSlot = (overrides = {}) => {
  const slot = {
    week_of: '2026-11-30', publish_date: '2026-12-01', channel: 'email', pillar: 'Brewing tips',
    title: 'Brew guide', brief: 'One recipe. One photo.', owner: 'Maya Okafor', status: 'planned', ...overrides,
  };
  return CONTENT_CALENDAR.map((column) => slot[column]);
};
const problemsFor = (text) => checkCsv(text, config).problems;

function* exampleCsvFiles(dir = path.join(ROOT, 'examples/out')) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* exampleCsvFiles(full);
    else if (entry.name.endsWith('.csv')) yield full;
  }
}

test('the CSV parser handles quoted commas, doubled quotes, line breaks and CRLF', () => {
  const rows = parseCsv('"a","b, c"\r\n"say ""hi""","line one\nline two"\r\nplain,""\r\n');
  assert.deepEqual(rows.map((row) => row.map((cell) => cell.value)), [
    ['a', 'b, c'], ['say "hi"', 'line one\nline two'], ['plain', ''],
  ]);
  assert.deepEqual(rows[2].map((cell) => cell.quoted), [false, true]);
});

test('the CSV parser rejects malformed quoting instead of guessing', () => {
  assert.throws(() => parseCsv('"never closed'), /line 1: a quoted field never closes/);
  assert.throws(() => parseCsv('"a"b,c'), /line 1: unexpected text after a closing quote/);
  assert.throws(() => parseCsv('"ok"\n"a" ,b'), /line 2: unexpected text after a closing quote/);
  assert.throws(() => parseCsv('a"b,c'), /line 1: a quote inside an unquoted field/);
  assert.throws(() => parseCsv('"x"\n"multi\nline",c"d'), (error) => error instanceof CsvError && error.line === 3);
  assert.match(checkCsv('"a"b\n', null).problems[0], /unexpected text after a closing quote/);
});

test('a well-formed posting schedule and content calendar pass', () => {
  assert.deepEqual(problemsFor(csv(POSTING_SCHEDULE, goodPost())), []);
  assert.deepEqual(problemsFor(csv(CONTENT_CALENDAR, goodSlot())), []);
});

test('posting schedule: dates, times, channels, pillars, statuses and quoting are checked', () => {
  const problems = problemsFor(csv(POSTING_SCHEDULE,
    goodPost({ publish_date: '2026-02-30', publish_time: '8:00' }),
    goodPost({ publish_date: '2026-12-01', channel: 'facebook', pillar: 'Gossip', status: 'live' })));
  assert.ok(problems.some((p) => /row 2: publish_date "2026-02-30"/.test(p)));
  assert.ok(problems.some((p) => /row 2: publish_time "8:00"/.test(p)));
  assert.ok(problems.some((p) => /row 3: channel "facebook" is not in the brand config/.test(p)));
  assert.ok(problems.some((p) => /row 3: pillar "Gossip"/.test(p)));
  assert.ok(problems.some((p) => /row 3: status "live"/.test(p)));

  const unquoted = csv(POSTING_SCHEDULE, goodPost()).replace('"draft"', 'draft');
  assert.deepEqual(problemsFor(unquoted), ['row 2: every field must be double-quoted']);
});

test('posting schedule: two posts on one channel on one day are flagged', () => {
  const problems = problemsFor(csv(POSTING_SCHEDULE, goodPost(), goodPost({ publish_time: '17:30' })));
  assert.deepEqual(problems, ['row 3: a second instagram post on 2026-11-30']);
});

test('posting schedule: links need https and UTM tags for their channel', () => {
  const problems = problemsFor(csv(POSTING_SCHEDULE,
    goodPost({ link: 'http://harborandpine.example.com/?utm_source=linkedin&utm_medium=social&utm_campaign=x' }),
    goodPost({ publish_date: '2026-12-01', link: '' })));
  assert.deepEqual(problems, ['row 2: link does not use https', 'row 2: link needs utm_source=instagram']);
});

test('channel limits from the brand-voice skill are enforced', () => {
  assert.deepEqual(measurePost('instagram', 'x'.repeat(2200), '#a #b #c', '').problems, ['caption is 2210 characters; the limit is 2,200']);
  assert.deepEqual(measurePost('instagram', 'Read more at https://example.com', '#a', '').problems, [
    'has 1 hashtags; use 3 to 8',
    'has a link in the caption; Instagram captions say "link in bio" instead',
  ]);
  assert.deepEqual(measurePost('linkedin', 'word '.repeat(301), '#a #b #c #d', '').problems, [
    'is 301 words; the limit is 300', 'has 4 hashtags; use at most 3',
  ]);
  assert.deepEqual(measurePost('facebook', 'Too short.', '', '').problems, ['is 2 words; use 40 to 120']);
  const x = measurePost('x', 'y'.repeat(256), '', 'https://example.com/a-very-long-path-that-x-shortens');
  assert.equal(x.summary, '280 characters with the link, 0 hashtags');
  assert.deepEqual(x.problems, []);
  assert.deepEqual(measurePost('x', 'y'.repeat(271), '#one #two', '').problems, [
    'is 281 characters with the link; the limit is 280',
    'has 2 hashtags; use at most 1',
  ]);
});

test('characters are counted as people see them, not as UTF-16 units', () => {
  // U+1D11E takes two UTF-16 units but is one character: 6 + 2 line breaks + 8.
  const text = '92°C \u{1D11E}';
  assert.equal(text.length, 7);
  assert.match(measurePost('instagram', text, '#a #b #c', '').summary, /^16 characters/);
});

test('content calendar: week_of must be a Monday that contains the publish date', () => {
  const problems = problemsFor(csv(CONTENT_CALENDAR,
    goodSlot({ week_of: '2026-12-01' }),
    goodSlot({ publish_date: '2026-12-07' }),
    goodSlot({ title: ' ', channel: 'tiktok' })));
  assert.ok(problems.includes('row 2: week_of 2026-12-01 is not a Monday'));
  assert.ok(problems.includes('row 3: publish_date 2026-12-07 is not in the week of 2026-11-30'));
  assert.ok(problems.some((p) => /row 4: channel "tiktok"/.test(p)));
  assert.ok(problems.includes('row 4: title is empty'));
});

test('a wrong header, a short row or an empty file is reported', () => {
  assert.match(problemsFor('"date","text"\n"2026-11-30","hi"\n')[0], /unrecognized header/);
  assert.deepEqual(problemsFor(csv(POSTING_SCHEDULE, goodPost().slice(0, 8))), ['row 2: has 8 fields; expected 9']);
  assert.deepEqual(problemsFor(csv(POSTING_SCHEDULE)), ['the file has a header but no rows']);
});

test('every CSV in examples/out passes the checker', () => {
  const files = [...exampleCsvFiles()];
  assert.ok(files.length >= 2, 'examples include a posting schedule and a content calendar');
  const types = new Set();
  for (const file of files) {
    const result = checkCsv(fs.readFileSync(file, 'utf8'), config);
    assert.deepEqual(result.problems, [], path.relative(ROOT, file));
    types.add(result.type);
  }
  assert.deepEqual([...types].sort(), ['content calendar', 'posting schedule']);
});

const EMAIL = `# Bean Club December newsletter

## Subject lines

### Benefit (recommended)
Subject: Winter Blend ships to you first
Preview: Bean Club members get it November 30, a day before everyone else.

### Direct
Subject: Bean Club: Winter Blend ships Nov 30
Preview: Colombia Huila and Ethiopia Guji, roasted medium.

## Body

Start a Bean Club subscription. Subscription renews monthly; cancel anytime.

## Plain-text version

Start a Bean Club subscription. Subscription renews monthly; cancel anytime.
`;

test('an email draft in the documented format passes and reports each length', () => {
  const result = checkEmail(EMAIL, config);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.lines, [
    'subject 1: 31 characters, preview 65 characters',
    'subject 2: 36 characters, preview 49 characters',
  ]);
  assert.deepEqual(emailOptions(EMAIL)[1], {
    label: 'Direct',
    subject: 'Bean Club: Winter Blend ships Nov 30',
    preview: 'Colombia Huila and Ethiopia Guji, roasted medium.',
  });
});

test('email limits, missing previews, sections and disclosures are reported', () => {
  const long = EMAIL
    .replace('Subject: Winter Blend ships to you first', `Subject: ${'s'.repeat(51)}`)
    .replace('Preview: Colombia Huila and Ethiopia Guji, roasted medium.', `Preview: ${'p'.repeat(91)}`);
  assert.deepEqual(checkEmail(long, config).problems, [
    'subject 1 is 51 characters; the limit is 50',
    'preview 2 is 91 characters; the limit is 90',
  ]);
  const noPreview = EMAIL.replace('Preview: Bean Club members get it November 30, a day before everyone else.\n', '');
  assert.deepEqual(checkEmail(noPreview, config).problems, ['subject 1 has no "Preview: " line after it']);
  const noPlainText = EMAIL.slice(0, EMAIL.indexOf('## Plain-text version'));
  assert.deepEqual(checkEmail(noPlainText, config).problems, ['missing the "## Plain-text version" section']);
  const noDisclosure = EMAIL.replace(/ Subscription renews monthly; cancel anytime\.\n$/, '\n');
  assert.deepEqual(checkEmail(noDisclosure, config).problems, [
    '"## Plain-text version" is missing the required disclosure "Subscription renews monthly; cancel anytime."',
  ]);
  assert.deepEqual(checkEmail('## Subject lines\n\n## Body\n\n## Plain-text version\n', null).problems, [
    'no "Subject: " lines under "## Subject lines"',
  ]);
});

test('files are checked by type: markdown as an email draft, anything else as CSV', () => {
  assert.equal(checkFile('draft.md', EMAIL, config).type, 'email draft');
  assert.equal(checkFile('schedule.csv', csv(POSTING_SCHEDULE, goodPost()), config).type, 'posting schedule');
});

test('the shipped email example passes the checker', () => {
  const dir = path.join(ROOT, 'examples/out/email');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.md'));
  assert.equal(files.length, 1);
  assert.deepEqual(checkEmail(fs.readFileSync(path.join(dir, files[0]), 'utf8'), config).problems, []);
});

test('the command line refuses --config with no file, and exits 1 on a problem', () => {
  const cli = path.join(ROOT, 'scripts/check-output.js');
  const noValue = spawnSync(process.execPath, [cli, 'examples/out/email/x.md', '--config'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(noValue.status, 2);
  assert.match(noValue.stderr, /--config needs a file path/);
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'content-kit-')), 'bad.csv');
  fs.writeFileSync(bad, 'nope\n');
  const failed = spawnSync(process.execPath, [cli, bad], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /PROBLEM unrecognized header/);
});
