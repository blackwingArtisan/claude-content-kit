// Browser checks for the dashboard. Run them with `npm run test:browser`, which
// starts the dashboard server and a headless Chromium (see run.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');
const v1 = read('tests/fixtures/dashboard-data.v1.json');
const sample = JSON.parse(read('dashboard/data/dashboard-data.json'));
const schedule = read('examples/out/social/2026-11-30-winter-blend-launch/posting-schedule.csv');
const calendarCsv = read('examples/out/calendar/2026-12-content-calendar.csv');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-kit-browser-'));
const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };

/** Runs every check against `page` and returns { summary, results }; never throws. */
export default async ({ page, baseUrl }) => {
  const results = [];
  const errors = [];
  const nativeDialogs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // The dashboard asks in the page; a browser dialog would be a regression.
  page.on('dialog', (d) => { nativeDialogs.push(d.message()); d.dismiss(); });
  const check = async (name, fn) => {
    try { const detail = await fn(); results.push({ ok: true, name, detail: detail ?? '' }); }
    catch (e) { results.push({ ok: false, name, detail: String(e.message || e).slice(0, 300) }); }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('content-kit.dashboard') || 'null'));
  const storedText = () => page.evaluate(() => localStorage.getItem('content-kit.dashboard'));
  const notice = () => page.locator('#notice').innerText();
  const status = () => page.locator('#status-line').innerText();
  const tab = (name) => page.getByRole('tab', { name: new RegExp('^' + name) }).click();
  const card = (title) => page.locator('#panel-approvals article').filter({ has: page.locator('h3', { hasText: title }) });
  const pillOf = (title) => card(title).locator('.pill').innerText();
  const thread = (text) => page.locator('#panel-revisions article', { hasText: text });
  const monthTitle = () => page.locator('#panel-calendar h2').innerText();
  const waitForNotice = (text) => page.waitForFunction((t) => document.getElementById('notice').innerText.includes(t), text);
  const download = async (click) => {
    const [file] = await Promise.all([page.waitForEvent('download'), click()]);
    return { name: file.suggestedFilename(), body: fs.readFileSync(await file.path(), 'utf8') };
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#panel-approvals article');

  await check('every tab shows its own panel', async () => {
    const expected = {
      'Approvals': 'Bean Club December newsletter',
      'Revision requests': 'Opened by',
      'Brand hub': 'Phrases we avoid',
      'Results': 'Engagement rate',
      'Content calendar': 'November 2026',
    };
    for (const [name, textInPanel] of Object.entries(expected)) {
      await tab(name);
      const visible = page.locator('[role="tabpanel"]:not([hidden])');
      expect(await visible.count() === 1, `one visible panel for ${name}`);
      expect((await visible.innerText()).toLowerCase().includes(textInPanel.toLowerCase()), `${name} shows "${textInPanel}"`);
    }
    return '5 of 5 tabs';
  });

  await check('the sample matches the brand: no channel outside the config, open requests hold their cards', async () => {
    const channels = new Set([...sample.approvals, ...sample.calendar, ...sample.results].map((r) => r.channel));
    expect([...channels].every((c) => ['instagram', 'linkedin', 'email'].includes(c)), [...channels].join(','));
    for (const request of sample.revisionRequests.filter((r) => r.status === 'open')) {
      const held = sample.approvals.find((a) => a.id === request.contentId);
      expect(held && held.status === 'changes_requested', `${request.id} is open but ${request.contentId} is ${held && held.status}`);
    }
    return `channels: ${[...channels].sort().join(', ')}`;
  });

  await tab('Approvals');

  await check('Approve moves a post to Approved, updates the count and schedules its calendar entry', async () => {
    const before = await page.locator('#count-approvals').innerText();
    await card('Two origins, one bag.').getByRole('button', { name: 'Approve' }).click();
    expect(await pillOf('Two origins, one bag.') === 'Approved', 'pill reads Approved');
    const after = await page.locator('#count-approvals').innerText();
    expect(Number(after) === Number(before) - 1, `count ${before} -> ${after}`);
    const slot = (await stored()).calendar.find((e) => e.contentId === 'post-2026-12-03-instagram');
    expect(slot && slot.status === 'scheduled', `calendar entry is ${slot && slot.status}`);
    return `count ${before} -> ${after}; calendar entry scheduled`;
  });

  await check('Request changes opens a thread on the Revision requests tab', async () => {
    const c = card('Bean Club December newsletter');
    await c.getByRole('button', { name: 'Request changes' }).click();
    await c.locator('textarea').fill('Add the send date before this goes to the list.');
    await c.getByRole('button', { name: 'Send request' }).click();
    expect(await pillOf('Bean Club December newsletter') === 'Changes requested', 'status changed');
    expect(await page.locator('#count-revisions').innerText() === '3', 'open requests 2 -> 3');
    await tab('Revision requests');
    expect(await thread('Add the send date').count() === 1, 'new thread visible');
    return 'open requests 2 -> 3';
  });

  await check('Reply, Mark resolved and Reopen work, and move the card with them', async () => {
    await page.selectOption('#viewer', 'Theo Lindqvist');
    await thread('Add the send date').locator('textarea').fill('Sending on November 25.');
    await thread('Add the send date').getByRole('button', { name: 'Reply' }).click();
    const msgs = await thread('Add the send date').locator('.msg').allInnerTexts();
    expect(msgs.length === 2 && msgs[1].includes('Theo Lindqvist') && msgs[1].includes('November 25'), 'reply appended by the viewer');
    await thread('Add the send date').getByRole('button', { name: 'Mark resolved' }).click();
    expect(await thread('Add the send date').locator('.pill').innerText() === 'Resolved', 'resolved');
    expect(await pillOf('Bean Club December newsletter') === 'Pending', 'resolving the last request sends the card back to Pending');
    await thread('Add the send date').getByRole('button', { name: 'Reopen' }).click();
    expect(await thread('Add the send date').locator('.pill').innerText() === 'Open', 'reopened');
    expect(await pillOf('Bean Club December newsletter') === 'Changes requested', 'reopening holds the card again');
    return '2 messages; resolve -> Pending; reopen -> Changes requested';
  });

  await check('user text is shown as text, never run as HTML', async () => {
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    await thread('Add the send date').locator('textarea').fill(payload);
    await thread('Add the send date').getByRole('button', { name: 'Reply' }).click();
    await page.waitForTimeout(300);
    const injected = await page.evaluate(() => ({ flag: window.__xss, imgs: document.querySelectorAll('main img, main script').length }));
    const shown = await page.locator('#panel-revisions').innerText();
    expect(injected.flag === undefined && injected.imgs === 0, `injected ${JSON.stringify(injected)}`);
    expect(shown.includes('<img src=x onerror='), 'payload shown literally');
    return 'payload rendered literally, no element created';
  });

  await check('changes survive a reload', async () => {
    await page.reload();
    await page.waitForSelector('#panel-approvals article', { state: 'attached' });
    const line = await status();
    expect(line.startsWith('Data: saved in this browser'), line);
    expect(await pillOf('Two origins, one bag.') === 'Approved', 'approval kept');
    const r = (await stored()).revisionRequests.find((x) => x.thread[0].body.startsWith('Add the send date'));
    expect(r && r.thread.length === 3, 'thread with 3 messages kept');
    const selected = await page.locator('[role="tab"][aria-selected="true"]').innerText();
    expect(selected.startsWith('Revision requests'), `last tab restored (got ${selected})`);
    return `status "${line.split(' · ')[0]}", tab remembered: ${selected.replace(/\d+$/, '')}`;
  });

  await check('Export downloads the saved data as versioned JSON', async () => {
    const file = await download(() => page.click('#export-btn'));
    const body = JSON.parse(file.body);
    expect(file.name === 'dashboard-data-v2.json', file.name);
    expect(body.schemaVersion === 2 && body.approvals.find((a) => a.id === 'post-2026-12-03-instagram').status === 'approved', 'export has the approval');
    return file.name;
  });

  await check('importing posting-schedule.csv updates the copy, keeps review status and keeps the label', async () => {
    const edited = schedule.replace('Two origins, one bag.', 'Two origins, one bag, one winter.');
    await page.setInputFiles('#import-file', write('posting-schedule.csv', edited));
    await waitForNotice('Imported posting-schedule.csv');
    const n = await notice();
    expect(n === 'Imported posting-schedule.csv: 6 approval cards (0 new, 6 updated) and 6 calendar entries (0 new, 6 updated).', n);
    await tab('Approvals');
    expect(await pillOf('one winter') === 'Approved', 'review status kept on re-import');
    expect(await pillOf('Winter Blend goes on sale today') === 'Changes requested', 'open request still holds its card');
    const line = await status();
    expect(line.startsWith('Data: imported from posting-schedule.csv · saved in this browser'), line);
    await tab('Content calendar');
    expect(await monthTitle() === 'November 2026', 'calendar opens on the first imported month');
    return `${n} | ${line.split(' · updated')[0]}`;
  });

  await check('a Content Kit CSV with bad quoting, or any other CSV, is refused and nothing changes', async () => {
    const before = await storedText();
    await page.setInputFiles('#import-file', write('bad-quotes.csv', schedule.replace('"08:00"', '"08:00"x')));
    await waitForNotice('Could not import bad-quotes.csv');
    const quoting = await notice();
    expect(/unexpected text after a closing quote/.test(quoting) && /Nothing was changed/.test(quoting), quoting);
    await page.setInputFiles('#import-file', write('contacts.csv', '"name","email"\n"Ana","ana@example.com"\n'));
    await waitForNotice('Could not import contacts.csv');
    expect(await storedText() === before, 'storage unchanged');
    return quoting;
  });

  await check('importing a content calendar CSV and an email draft adds them to the board', async () => {
    const cleared = JSON.parse(JSON.stringify(sample));
    cleared.calendar = [];
    cleared.approvals = cleared.approvals.filter((a) => a.channel !== 'email');
    await page.setInputFiles('#import-file', write('board.json', JSON.stringify(cleared)));
    await page.waitForFunction(() => document.getElementById('status-line').innerText.startsWith('Data: imported from board.json'));
    await page.setInputFiles('#import-file', write('2026-12-content-calendar.csv', calendarCsv));
    await waitForNotice('Imported 2026-12-content-calendar.csv');
    const n = await notice();
    expect(n === 'Imported 2026-12-content-calendar.csv: 28 calendar entries (28 new, 0 updated).', n);
    await tab('Content calendar');
    expect(await monthTitle() === 'December 2026', `calendar moved to the imported month (${await monthTitle()})`);
    const december = await page.locator('#panel-calendar .month .slot').count();
    await page.setInputFiles('#import-file', write('2026-11-16-bean-club-december-newsletter.md', read('examples/out/email/2026-11-16-bean-club-december-newsletter.md')));
    await waitForNotice('Imported 2026-11-16-bean-club-december-newsletter.md: 1 approval card (1 new, 0 updated).');
    await tab('Approvals');
    const preview = await card('Bean Club December newsletter').locator('.preview').innerText();
    expect(preview.startsWith('Subject: Winter Blend ships to Bean Club first, Nov 30'), preview.slice(0, 80));
    return `${december} December slots; email card shows its recommended subject`;
  });

  await check('importing v1 data upgrades it, keeps every record and resets the calendar month', async () => {
    await tab('Content calendar');
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.setInputFiles('#import-file', write('old-v1.json', v1));
    await waitForNotice('upgraded');
    const n = await notice();
    expect(n.includes('Data upgraded from schema v1 to v2. All records were kept.'), n);
    const s = await stored();
    expect(s.schemaVersion === 2 && s.approvals.length === 5 && s.revisionRequests.length === 3 && s.approvals[0].reviewer, 'stored as v2 with all records');
    expect((await page.locator('#footer').innerText()).includes('loaded data is schema v2'), 'footer v2');
    expect(await monthTitle() === 'October 2026', `calendar reset to the data's first month (${await monthTitle()})`);
    return `${n} Calendar: October 2026.`;
  });

  await check('a future-version file is refused with a clear message and nothing changes', async () => {
    const before = await storedText();
    await page.setInputFiles('#import-file', write('future.json', JSON.stringify({ ...sample, schemaVersion: 3 })));
    await waitForNotice('v3');
    const n = await notice();
    expect(/schema v3, but this template supports up to v2/.test(n) && /Nothing was changed/.test(n), n);
    expect(await storedText() === before, 'storage unchanged');
    expect(await page.locator('#panel-approvals article').count() === 5, 'previous data still shown');
    return n;
  });

  await check('a file with a broken record is refused and the current data stays', async () => {
    const broken = JSON.parse(JSON.stringify(sample));
    delete broken.approvals[0].id;
    await page.setInputFiles('#import-file', write('broken.json', JSON.stringify(broken)));
    await waitForNotice('no id');
    await page.setInputFiles('#import-file', write('not-json.json', '{ nope'));
    await waitForNotice('Could not read not-json.json');
    expect(await page.locator('#panel-approvals article').count() === 5, 'still showing data');
    return 'missing id refused; invalid JSON refused';
  });

  await check('hostile values in an imported file are shown as text or dropped', async () => {
    const hostile = JSON.parse(JSON.stringify(sample));
    hostile.workspace.brand = '<b id="injected">Brand</b>';
    hostile.approvals[0].title = '<img src=x onerror="window.__xss=3">';
    hostile.approvals[0].channel = '<svg onload="window.__xss=4">';
    hostile.brandHub.assets[0].url = 'javascript:window.__xss=5';
    hostile.brandHub.colors[0].hex = 'red;background-image:url(https://example.com/x.png)';
    hostile.revisionRequests[0].thread[0].body = '<script>window.__xss=6</script>';
    await page.setInputFiles('#import-file', write('hostile.json', JSON.stringify(hostile)));
    await page.waitForFunction(() => document.getElementById('brand-name').innerText.includes('<b'));
    const state = await page.evaluate(() => ({
      flag: window.__xss,
      elements: document.querySelectorAll('#injected, main img, main svg, main script').length,
      href: document.querySelector('#panel-brand a').getAttribute('href'),
      swatch: document.querySelector('#panel-brand .swatch i').getAttribute('style'),
    }));
    expect(state.flag === undefined && state.elements === 0, JSON.stringify(state));
    expect(state.href === '#', `javascript: link kept as ${state.href}`);
    expect(state.swatch === 'background:transparent', `color style ${state.swatch}`);
    await page.setInputFiles('#import-file', write('clean.json', JSON.stringify(sample)));
    await page.waitForFunction(() => document.getElementById('brand-name').innerText === 'Harbor & Pine Coffee');
    return 'HTML shown as text; javascript: link and CSS color dropped';
  });

  await check('channel names are labelled properly', async () => {
    await tab('Approvals');
    const labels = await page.locator('#panel-approvals .chan').allInnerTexts();
    expect(['Instagram', 'LinkedIn', 'Email'].every((l) => labels.includes(l)), labels.join(','));
    return [...new Set(labels)].join(', ');
  });

  await check('v1 data already saved in the browser upgrades on load', async () => {
    await page.evaluate((raw) => localStorage.setItem('content-kit.dashboard', raw), v1);
    await page.reload();
    await waitForNotice('upgraded');
    const s = await stored();
    expect(s.schemaVersion === 2 && !('revisions' in s), 'saved copy rewritten as v2');
    return await notice();
  });

  await check('saved data that cannot be loaded is left untouched, and Export downloads it exactly as saved', async () => {
    const future = JSON.stringify({ ...sample, schemaVersion: 3 });
    for (const raw of [future, '{ "schemaVersion": 2, "approvals": [ truncated']) {
      await page.evaluate((r) => localStorage.setItem('content-kit.dashboard', r), raw);
      await page.reload();
      await waitForNotice('could not be loaded');
      expect(await storedText() === raw, 'storage untouched');
      expect(await status() === 'No data loaded', await status());
      const file = await download(() => page.click('#export-btn'));
      expect(file.name === 'dashboard-data-as-saved.json' && file.body === raw, `exported ${file.name}, ${file.body.length} of ${raw.length} characters`);
    }
    return 'future version and broken JSON both kept and exported byte for byte';
  });

  await check('Reset asks in the page, can export first, and only replaces on Replace', async () => {
    const raw = await storedText();
    await page.click('#reset-btn');
    const dialog = page.locator('dialog#confirm');
    await dialog.waitFor({ state: 'visible' });
    const focused = await page.evaluate(() => document.activeElement.id);
    expect(focused === 'confirm-cancel', `focus starts on Cancel (got ${focused})`);
    const file = await download(() => dialog.getByRole('button', { name: 'Export it first' }).click());
    expect(file.body === raw, 'export from the dialog is the saved copy');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await storedText() === raw, 'Cancel keeps the saved data');
    await page.click('#reset-btn');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await storedText() === raw, 'Escape keeps the saved data');
    await page.click('#reset-btn');
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await page.waitForFunction(() => document.getElementById('status-line').innerText.startsWith('Data: sample data'));
    expect(await stored() === null, 'saved copy removed');
    expect(await page.locator('#panel-approvals article').count() === sample.approvals.length, 'sample shown');
    expect(nativeDialogs.length === 0, `browser dialogs opened: ${nativeDialogs.join(' | ')}`);
    return 'Export it first, Cancel and Escape keep the data; Replace resets; no browser dialogs';
  });

  await check('arrow keys, Home and End move between tabs with a visible focus ring', async () => {
    await tab('Approvals');
    await page.getByRole('tab', { name: /^Approvals/ }).focus();
    const selected = () => page.evaluate(() => ({ sel: document.querySelector('[role="tab"][aria-selected="true"]').id, focus: document.activeElement.id }));
    await page.keyboard.press('ArrowRight');
    let s = await selected(); expect(s.sel === 'tab-revisions' && s.focus === 'tab-revisions', JSON.stringify(s));
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    s = await selected(); expect(s.sel === 'tab-calendar' && s.focus === 'tab-calendar', 'ArrowLeft wraps to the last tab');
    await page.keyboard.press('Home');
    s = await selected(); expect(s.sel === 'tab-approvals', 'Home');
    await page.keyboard.press('End');
    s = await selected(); expect(s.sel === 'tab-calendar', 'End');
    const ring = await page.evaluate(() => { const st = getComputedStyle(document.activeElement); return `${st.outlineStyle} ${st.outlineWidth}`; });
    expect(ring.startsWith('solid'), `outline ${ring}`);
    const tabIndexes = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.tabIndex));
    expect(tabIndexes.filter((t) => t === 0).length === 1, 'only the selected tab is in the tab order');
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => document.activeElement.getAttribute('role'));
    expect(next === 'tabpanel', `Tab from the tab list goes into the panel (got ${next})`);
    return `outline ${ring}; Tab moves into the panel`;
  });

  await check('keyboard focus stays in place after an action re-renders the panel', async () => {
    await tab('Content calendar');
    await page.getByRole('button', { name: 'Next month' }).focus();
    await page.keyboard.press('Enter');
    let f = await page.evaluate(() => document.activeElement.dataset.focus);
    expect(f === 'next-month', `after Next month focus is on ${f}`);
    expect(await monthTitle() === 'December 2026', 'moved to December');
    await tab('Approvals');
    await card('From Huila and Guji to our roaster').getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');
    f = await page.evaluate(() => document.activeElement.dataset.record);
    expect(f === 'post-2026-12-03-linkedin', `after Approve focus is on card ${f}`);
    return 'Next month keeps focus; Approve focuses its card';
  });

  await check('390px mobile layout: every tab fully visible, no sideways scroll, calendar becomes a list', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const clipped = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
      .filter((t) => { const r = t.getBoundingClientRect(); return r.left < 0 || r.right > document.documentElement.clientWidth; })
      .map((t) => t.id));
    expect(clipped.length === 0, `tabs cut off: ${clipped.join(', ')}`);
    for (const name of ['Approvals', 'Revision requests', 'Brand hub', 'Results', 'Content calendar']) {
      await tab(name);
      const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(w.scroll <= w.client, `${name}: page is ${w.scroll}px wide in a ${w.client}px window`);
    }
    const layout = await page.evaluate(() => ({
      month: getComputedStyle(document.querySelector('.month')).display,
      agenda: getComputedStyle(document.querySelector('.agenda')).display,
      items: document.querySelectorAll('.agenda .card').length,
    }));
    const december = sample.calendar.filter((e) => e.date.startsWith('2026-12')).length;
    expect(layout.month === 'none' && layout.agenda !== 'none' && layout.items === december, JSON.stringify(layout));
    return `5 tabs fit 390px; agenda lists ${layout.items} December entries`;
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  results.push({ ok: errors.length === 0, name: 'no console errors or uncaught exceptions (favicon included)', detail: errors.join(' | ').slice(0, 300) });
  const passed = results.filter((r) => r.ok).length;
  return { summary: `${passed} of ${results.length} checks passed`, results };
};
