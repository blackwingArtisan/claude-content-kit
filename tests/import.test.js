const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  importFile, mergeImport, setReviewStatus, summarize, firstMonth, headline, ImportError,
} = require('../dashboard/import.js');
const { CsvError } = require('../dashboard/formats.js');
const { build } = require('../scripts/build-sample-data.js');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SCHEDULE = 'examples/out/social/2026-11-30-winter-blend-launch/posting-schedule.csv';
const CALENDAR = 'examples/out/calendar/2026-12-content-calendar.csv';
const EMAIL = 'examples/out/email/2026-11-16-bean-club-december-newsletter.md';
const empty = () => ({ schemaVersion: 2, approvals: [], revisionRequests: [], calendar: [], results: [] });
const posts = () => importFile('posting-schedule.csv', read(SCHEDULE), { reviewer: 'Maya Okafor' });
const slots = () => importFile('calendar.csv', read(CALENDAR));

test('a posting schedule becomes one approval card and one calendar entry per post', () => {
  const imported = posts();
  assert.equal(imported.kind, 'posting schedule');
  assert.equal(imported.approvals.length, 6);
  assert.equal(imported.calendar.length, 6);
  const first = imported.approvals[0];
  assert.deepEqual(
    { id: first.id, channel: first.channel, dueDate: first.dueDate, status: first.status, reviewer: first.reviewer, publishAt: first.publishAt },
    { id: 'post-2026-11-30-instagram', channel: 'instagram', dueDate: '2026-11-29', status: 'pending', reviewer: 'Maya Okafor', publishAt: '2026-11-30T08:00' },
  );
  assert.equal(first.title, "Bean Club, you're first in line.");
  assert.ok(first.preview.includes('November 30'));
  assert.deepEqual(imported.calendar[0], {
    id: 'cal-2026-11-30-instagram', date: '2026-11-30', channel: 'instagram', title: first.title,
    pillar: imported.calendar[0].pillar, status: 'in_review', contentId: 'post-2026-11-30-instagram',
  });
});

test('a content calendar becomes calendar entries, with repeated day and channel kept apart', () => {
  const imported = slots();
  assert.equal(imported.calendar.length, 28);
  assert.equal(imported.approvals.length, 0);
  assert.deepEqual(Object.keys(imported.calendar[0]).sort(), ['brief', 'channel', 'date', 'id', 'owner', 'pillar', 'status', 'title']);
  const twice = `${read(CALENDAR)}"2026-11-30","2026-12-01","email","Brewing tips","Second email","Brief.","Maya Okafor","planned"\n`;
  const ids = importFile('c.csv', twice).calendar.filter((e) => e.date === '2026-12-01' && e.channel === 'email').map((e) => e.id);
  assert.deepEqual(ids, ['cal-2026-12-01-email', 'cal-2026-12-01-email-2']);
});

test('an email draft becomes an approval card showing its recommended subject line', () => {
  const { approvals } = importFile(path.basename(EMAIL), read(EMAIL), { reviewer: 'Maya Okafor', dueDate: '2026-11-25' });
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].id, 'email-bean-club-december-newsletter');
  assert.equal(approvals[0].title, 'Bean Club December newsletter');
  assert.match(approvals[0].preview, /^Subject: Winter Blend ships to Bean Club first, Nov 30\nPreview: /);
  assert.equal(approvals[0].dueDate, '2026-11-25');
});

test('files that are not Content Kit output are refused with a reason', () => {
  assert.throws(() => importFile('people.csv', '"name"\n"Ana"\n'), ImportError);
  assert.throws(() => importFile('bad.csv', read(SCHEDULE).replace('"08:00"', '"08:00"x')), CsvError);
  assert.throws(() => importFile('blank.csv', read(SCHEDULE).replace(/("2026-11-30","08:00","instagram",)"[^"]*"/, '$1""')), /row 2: post_text is empty/);
  assert.throws(() => importFile('date.csv', read(SCHEDULE).replace('"2026-11-30"', '"Nov 30"')), /publish_date "Nov 30"/);
  assert.throws(() => importFile('note.md', '# Notes\n\nNo subject lines here.\n'), /no "Subject: " line/);
});

test('a drafted post fills the planned calendar slot for its day and channel', () => {
  const planned = mergeImport(empty(), slots()).data;
  const { data, counts } = mergeImport(planned, posts());
  assert.equal(counts.calendar.added, 3);
  assert.equal(counts.calendar.updated, 3);
  const slot = data.calendar.find((e) => e.id === 'cal-2026-12-01-instagram');
  assert.equal(slot.title, 'Two origins, one cup');
  assert.equal(slot.contentId, 'post-2026-12-01-instagram');
  assert.equal(slot.status, 'in_review');
  assert.ok(slot.brief, 'the planned brief is kept');
  assert.equal(data.approvals.find((a) => a.id === 'post-2026-12-01-instagram').title, 'Two origins, one cup');
  assert.equal(data.calendar.length, 31);
});

test('importing again updates the copy, keeps review status and adds nothing', () => {
  const first = mergeImport(empty(), posts()).data;
  setReviewStatus(first, 'post-2026-12-03-instagram', 'approved');
  const edited = importFile('posting-schedule.csv', read(SCHEDULE).replace('Two origins, one bag.', 'Two origins, one winter bag.'));
  const before = JSON.stringify(first);
  const { data, counts } = mergeImport(first, edited);
  assert.equal(JSON.stringify(first), before, 'the input is not changed');
  assert.deepEqual([counts.approvals.added, counts.approvals.updated], [0, 6]);
  const card = data.approvals.find((a) => a.id === 'post-2026-12-03-instagram');
  assert.equal(card.status, 'approved');
  assert.equal(card.reviewer, 'Maya Okafor');
  assert.match(card.preview, /one winter bag/);
  assert.equal(card.title, 'Two origins, one winter bag.');
  assert.equal(data.calendar.find((e) => e.contentId === card.id).title, card.title, 'an entry a post created follows its title');
  assert.equal(data.calendar.find((e) => e.contentId === card.id).status, 'scheduled');
});

test('setReviewStatus moves linked calendar entries but never un-publishes one', () => {
  const data = mergeImport(empty(), posts()).data;
  setReviewStatus(data, 'post-2026-11-30-instagram', 'approved');
  assert.equal(data.calendar.find((e) => e.contentId === 'post-2026-11-30-instagram').status, 'scheduled');
  setReviewStatus(data, 'post-2026-11-30-instagram', 'changes_requested');
  assert.equal(data.calendar.find((e) => e.contentId === 'post-2026-11-30-instagram').status, 'in_review');
  data.calendar.find((e) => e.contentId === 'post-2026-11-30-instagram').status = 'published';
  setReviewStatus(data, 'post-2026-11-30-instagram', 'pending');
  assert.equal(data.calendar.find((e) => e.contentId === 'post-2026-11-30-instagram').status, 'published');
});

test('summaries and the first month describe what an import did', () => {
  const imported = posts();
  const { counts } = mergeImport(mergeImport(empty(), slots()).data, imported);
  assert.equal(summarize('posting-schedule.csv', imported, counts),
    'Imported posting-schedule.csv: 6 approval cards (6 new, 0 updated) and 6 calendar entries (3 new, 3 updated).');
  assert.equal(firstMonth(imported), '2026-11');
  assert.equal(firstMonth(slots()), '2026-12');
  assert.equal(headline('Short one. Then more.'), 'Short one.');
  assert.equal(headline(`${'word '.repeat(20)}end.`), `${'word '.repeat(12).trim()}...`);
});

test('the sample dashboard data is built from examples/out and is up to date', () => {
  assert.equal(read('dashboard/data/dashboard-data.json'), `${JSON.stringify(build(), null, 2)}\n`,
    'run: npm run build-sample');
});

test('the sample data agrees with the brand config and with itself', () => {
  const data = JSON.parse(read('dashboard/data/dashboard-data.json'));
  const config = JSON.parse(read('examples/brand.config.json'));
  const channels = config.channels.map((c) => c.name);
  for (const record of [...data.approvals, ...data.calendar, ...data.results]) {
    assert.ok(channels.includes(record.channel), `${record.id} uses ${record.channel}`);
  }
  for (const entry of data.calendar) assert.ok(config.pillars.includes(entry.pillar), `${entry.id} pillar ${entry.pillar}`);
  for (const card of data.approvals) {
    const open = data.revisionRequests.some((r) => r.contentId === card.id && r.status === 'open');
    assert.equal(card.status === 'changes_requested', open, `${card.id} is ${card.status} with${open ? '' : 'out'} an open request`);
  }
  for (const request of data.revisionRequests) {
    assert.ok(data.approvals.some((a) => a.id === request.contentId), `${request.id} points at a card`);
  }
  const dates = [...data.approvals.map((a) => a.dueDate), ...data.calendar.map((e) => e.date)];
  assert.ok(dates.every((d) => /^2026-1[12]-/.test(d)), 'every date is in November or December 2026');
});
