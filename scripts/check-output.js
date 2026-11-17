#!/usr/bin/env node
/**
 * Checks the files Content Kit writes in file-fallback mode against the
 * formats in skills/workspace-output and the channel limits in
 * skills/brand-voice, and prints the length of every post, subject line and
 * preview text.
 *
 *   node scripts/check-output.js [--config brand.config.json] <file.csv|email.md> [...]
 *
 * CSV files are recognized by their header row; markdown files are checked as
 * email drafts. Exits 1 if any file has a problem, so the content commands can
 * run it, fix what it lists, and run it again.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { POSTING_SCHEDULE, CONTENT_CALENDAR, parseCsv, csvType, sections, emailOptions } = require('../dashboard/formats.js');

const SOCIAL_CHANNELS = ['instagram', 'linkedin', 'facebook', 'x'];
const POST_STATUSES = ['draft', 'approved', 'scheduled', 'published'];
const SLOT_STATUSES = ['planned', 'in_review', 'scheduled', 'published'];
// X shortens every link to a fixed-length t.co URL.
const X_LINK_LENGTH = 23;
const SUBJECT_LIMIT = 50;
const PREVIEW_LIMIT = 90;
const EMAIL_SECTIONS = ['## Subject lines', '## Body', '## Plain-text version'];

const characters = (text) => [...text].length;
const words = (text) => (text.match(/\S+/g) || []).length;
const hashtagCount = (text) => (text.match(/#[\p{L}\p{N}_]+/gu) || []).length;

function isDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const isTime = (text) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
const weekday = (text) => new Date(`${text}T00:00:00Z`).getUTCDay();
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

/** Length of a post as each channel counts it, plus any limit it breaks. */
function measurePost(channel, text, hashtags, link) {
  const tags = hashtagCount(hashtags);
  const problems = [];
  if (channel === 'instagram') {
    const length = characters(`${text}\n\n${hashtags}`.trim());
    if (length > 2200) problems.push(`caption is ${length} characters; the limit is 2,200`);
    if (tags < 3 || tags > 8) problems.push(`has ${tags} hashtags; use 3 to 8`);
    if (/https?:\/\//.test(text)) problems.push('has a link in the caption; Instagram captions say "link in bio" instead');
    return { summary: `${length} characters, ${tags} hashtags`, problems };
  }
  if (channel === 'linkedin') {
    const count = words(text);
    if (count > 300) problems.push(`is ${count} words; the limit is 300`);
    if (tags > 3) problems.push(`has ${tags} hashtags; use at most 3`);
    return { summary: `${count} words, ${tags} hashtags`, problems };
  }
  if (channel === 'facebook') {
    const count = words(text);
    if (count < 40 || count > 120) problems.push(`is ${count} words; use 40 to 120`);
    return { summary: `${count} words, ${tags} hashtags`, problems };
  }
  if (channel === 'x') {
    const length = characters([text, hashtags].filter(Boolean).join(' ')) + (link ? 1 + X_LINK_LENGTH : 0);
    if (length > 280) problems.push(`is ${length} characters with the link; the limit is 280`);
    if (tags > 1) problems.push(`has ${tags} hashtags; use at most 1`);
    return { summary: `${length} characters with the link, ${tags} hashtags`, problems };
  }
  return { summary: '', problems };
}

function checkLink(link, channel, problems) {
  if (!link) return;
  let url;
  try { url = new URL(link); } catch { problems.push(`link "${link}" is not a valid URL`); return; }
  if (url.protocol !== 'https:') problems.push('link does not use https');
  const params = url.searchParams;
  if (params.get('utm_source') !== channel) problems.push(`link needs utm_source=${channel}`);
  if (params.get('utm_medium') !== 'social') problems.push('link needs utm_medium=social');
  if (!params.get('utm_campaign')) problems.push('link needs utm_campaign');
}

function brandChecks(config) {
  return {
    channels: config && Array.isArray(config.channels) ? config.channels.map((c) => c.name) : null,
    pillars: config && Array.isArray(config.pillars) ? config.pillars : null,
    disclosures: config && config.compliance && Array.isArray(config.compliance.requiredDisclosures)
      ? config.compliance.requiredDisclosures : [],
  };
}

function checkRows(rows, columns, checkRecord) {
  const problems = [];
  const lines = [];
  if (!rows.length) return { lines, problems: ['the file is empty'] };
  if (rows[0].map((cell) => cell.value).join(',') !== columns.join(',')) {
    return { lines, problems: [`header must be exactly: ${columns.join(',')}`] };
  }
  rows.slice(1).forEach((cells, index) => {
    const line = index + 2;
    if (cells.length === 1 && cells[0].value === '' && !cells[0].quoted) return; // trailing blank line
    if (cells.length !== columns.length) {
      problems.push(`row ${line}: has ${cells.length} fields; expected ${columns.length}`);
      return;
    }
    const rowProblems = [];
    if (cells.some((cell) => !cell.quoted)) rowProblems.push('every field must be double-quoted');
    const record = Object.fromEntries(columns.map((name, i) => [name, cells[i].value]));
    lines.push(`row ${line}: ${checkRecord(record, rowProblems)}`);
    for (const problem of rowProblems) problems.push(`row ${line}: ${problem}`);
  });
  if (!lines.length && !problems.length) problems.push('the file has a header but no rows');
  return { lines, problems };
}

/** Checks a posting-schedule.csv. Returns { lines, problems }. */
function checkPostingSchedule(rows, config) {
  const brand = brandChecks(config);
  const seen = new Set();
  return checkRows(rows, POSTING_SCHEDULE, (post, problems) => {
    if (!isDate(post.publish_date)) problems.push(`publish_date "${post.publish_date}" is not a YYYY-MM-DD date`);
    if (!isTime(post.publish_time)) problems.push(`publish_time "${post.publish_time}" is not 24-hour HH:MM`);
    if (!SOCIAL_CHANNELS.includes(post.channel)) problems.push(`channel "${post.channel}" is not one of ${SOCIAL_CHANNELS.join(', ')}`);
    else if (brand.channels && !brand.channels.includes(post.channel)) problems.push(`channel "${post.channel}" is not in the brand config`);
    if (!post.post_text.trim()) problems.push('post_text is empty');
    if (brand.pillars && !brand.pillars.includes(post.pillar)) problems.push(`pillar "${post.pillar}" is not in the brand config`);
    if (!POST_STATUSES.includes(post.status)) problems.push(`status "${post.status}" is not one of ${POST_STATUSES.join(', ')}`);
    const day = `${post.channel} ${post.publish_date}`;
    if (seen.has(day)) problems.push(`a second ${post.channel} post on ${post.publish_date}`);
    seen.add(day);
    checkLink(post.link, post.channel, problems);
    const measured = measurePost(post.channel, post.post_text, post.hashtags, post.link);
    problems.push(...measured.problems);
    return `${post.publish_date} ${post.publish_time} ${post.channel}: ${measured.summary}`;
  });
}

/** Checks a content-calendar.csv. Returns { lines, problems }. */
function checkContentCalendar(rows, config) {
  const brand = brandChecks(config);
  return checkRows(rows, CONTENT_CALENDAR, (slot, problems) => {
    if (!isDate(slot.week_of) || !isDate(slot.publish_date)) problems.push('week_of and publish_date must be YYYY-MM-DD dates');
    else {
      if (weekday(slot.week_of) !== 1) problems.push(`week_of ${slot.week_of} is not a Monday`);
      const offset = daysBetween(slot.week_of, slot.publish_date);
      if (offset < 0 || offset > 6) problems.push(`publish_date ${slot.publish_date} is not in the week of ${slot.week_of}`);
    }
    const channels = [...SOCIAL_CHANNELS, 'email'];
    if (!channels.includes(slot.channel)) problems.push(`channel "${slot.channel}" is not one of ${channels.join(', ')}`);
    else if (brand.channels && !brand.channels.includes(slot.channel)) problems.push(`channel "${slot.channel}" is not in the brand config`);
    if (brand.pillars && !brand.pillars.includes(slot.pillar)) problems.push(`pillar "${slot.pillar}" is not in the brand config`);
    for (const field of ['title', 'brief', 'owner']) if (!slot[field].trim()) problems.push(`${field} is empty`);
    if (!SLOT_STATUSES.includes(slot.status)) problems.push(`status "${slot.status}" is not one of ${SLOT_STATUSES.join(', ')}`);
    return `${slot.publish_date} ${slot.channel}: ${slot.title}`;
  });
}

/** Detects the CSV type from its header and checks it. */
function checkCsv(text, config) {
  let rows;
  try { rows = parseCsv(text); } catch (error) { return { type: 'unreadable CSV', lines: [], problems: [error.message] }; }
  const type = csvType(rows);
  if (type === 'posting schedule') return { type, ...checkPostingSchedule(rows, config) };
  if (type === 'content calendar') return { type, ...checkContentCalendar(rows, config) };
  return {
    type: 'unknown',
    lines: [],
    problems: [`unrecognized header. Expected a posting schedule (${POSTING_SCHEDULE.join(',')}) or a content calendar (${CONTENT_CALENDAR.join(',')})`],
  };
}

/** Checks an email draft written by /content-kit:email-draft. Returns { lines, problems }. */
function checkEmail(markdown, config) {
  const problems = [];
  const lines = [];
  const found = sections(markdown);
  for (const heading of EMAIL_SECTIONS) if (!(heading in found)) problems.push(`missing the "${heading}" section`);
  const options = emailOptions(markdown);
  if ('## Subject lines' in found && !options.length) problems.push('no "Subject: " lines under "## Subject lines"');
  options.forEach(({ subject, preview }, index) => {
    const n = index + 1;
    const subjectLength = characters(subject);
    if (subjectLength > SUBJECT_LIMIT) problems.push(`subject ${n} is ${subjectLength} characters; the limit is ${SUBJECT_LIMIT}`);
    if (preview === null) {
      problems.push(`subject ${n} has no "Preview: " line after it`);
      lines.push(`subject ${n}: ${subjectLength} characters`);
      return;
    }
    const previewLength = characters(preview);
    if (previewLength > PREVIEW_LIMIT) problems.push(`preview ${n} is ${previewLength} characters; the limit is ${PREVIEW_LIMIT}`);
    lines.push(`subject ${n}: ${subjectLength} characters, preview ${previewLength} characters`);
  });
  for (const disclosure of brandChecks(config).disclosures) {
    for (const heading of ['## Body', '## Plain-text version']) {
      if (heading in found && !found[heading].includes(disclosure)) problems.push(`"${heading}" is missing the required disclosure "${disclosure}"`);
    }
  }
  return { lines, problems };
}

/** Checks one output file by its extension. */
function checkFile(file, text, config) {
  if (path.extname(file) === '.md') return { type: 'email draft', ...checkEmail(text, config) };
  return checkCsv(text, config);
}

module.exports = {
  checkCsv, checkEmail, checkFile, checkPostingSchedule, checkContentCalendar, emailOptions, measurePost,
  POSTING_SCHEDULE, CONTENT_CALENDAR, SUBJECT_LIMIT, PREVIEW_LIMIT,
};

if (require.main === module) {
  const usage = 'Usage: node scripts/check-output.js [--config brand.config.json] <file.csv|email.md> [...]';
  const args = process.argv.slice(2);
  let config = null;
  const configAt = args.indexOf('--config');
  if (configAt !== -1) {
    const [, file] = args.splice(configAt, 2);
    if (!file) { console.error(`--config needs a file path.\n${usage}`); process.exit(2); }
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { console.error(`Could not read the brand config ${file}: ${error.message}`); process.exit(2); }
  }
  if (!args.length) {
    console.error(usage);
    process.exit(2);
  }
  let failed = false;
  for (const file of args) {
    let result;
    try { result = checkFile(file, fs.readFileSync(file, 'utf8'), config); }
    catch (error) { result = { type: 'unreadable', lines: [], problems: [error.message] }; }
    console.log(`${file} (${result.type})`);
    for (const line of result.lines) console.log(`  ${line}`);
    for (const problem of result.problems) console.log(`  PROBLEM ${problem}`);
    console.log(result.problems.length ? `  ${result.problems.length} problem(s)` : '  OK');
    failed = failed || result.problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
