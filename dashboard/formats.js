/**
 * Readers for the files Content Kit writes: a strict RFC 4180 CSV parser, the
 * two CSV layouts, and the sections of an email draft. Shared by the dashboard
 * (window.ContentKitFormats) and by Node (scripts/check-output.js and
 * scripts/build-sample-data.js), so both read the files the same way.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ContentKitFormats = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POSTING_SCHEDULE = ['publish_date', 'publish_time', 'channel', 'post_text', 'hashtags', 'link', 'asset_note', 'pillar', 'status'];
  const CONTENT_CALENDAR = ['week_of', 'publish_date', 'channel', 'pillar', 'title', 'brief', 'owner', 'status'];

  class CsvError extends Error {
    constructor(message, line) {
      super(`line ${line}: ${message}`);
      this.name = 'CsvError';
      this.line = line;
    }
  }

  /**
   * Parses RFC 4180 CSV into rows of { value, quoted } cells, so callers can
   * check the "every field double-quoted" rule. Accepts quoted commas, quotes
   * written as "", line breaks inside quoted fields and CRLF line endings.
   * Throws CsvError on a quote inside an unquoted field, text after a closing
   * quote, or a quoted field that never closes.
   */
  function parseCsv(text) {
    const source = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    let line = 1;
    let i = 0;

    const endField = () => { row.push({ value, quoted }); value = ''; quoted = false; };
    const endRow = () => { endField(); rows.push(row); row = []; };

    while (i < source.length) {
      const char = source[i];
      if (char === '"' && value === '' && !quoted) {
        quoted = true;
        const start = line;
        i += 1;
        for (;;) {
          if (i >= source.length) throw new CsvError('a quoted field never closes (a closing " is missing)', start);
          if (source[i] === '"') {
            if (source[i + 1] === '"') { value += '"'; i += 2; continue; }
            i += 1;
            break;
          }
          if (source[i] === '\n') line += 1;
          value += source[i];
          i += 1;
        }
        const next = source[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new CsvError('unexpected text after a closing quote', line);
        }
      } else if (char === '"') {
        throw new CsvError('a quote inside an unquoted field (quote the whole field and write " as "")', line);
      } else if (char === ',') {
        endField();
        i += 1;
      } else if (char === '\n' || char === '\r') {
        i += char === '\r' && source[i + 1] === '\n' ? 2 : 1;
        endRow();
        line += 1;
      } else {
        value += char;
        i += 1;
      }
    }
    if (value !== '' || quoted || row.length) endRow();
    return rows;
  }

  const headerOf = (rows) => (rows.length ? rows[0].map((cell) => cell.value).join(',') : '');

  /** 'posting schedule', 'content calendar' or null, from the header row. */
  function csvType(rows) {
    const header = headerOf(rows);
    if (header === POSTING_SCHEDULE.join(',')) return 'posting schedule';
    if (header === CONTENT_CALENDAR.join(',')) return 'content calendar';
    return null;
  }

  /** Data rows as plain objects keyed by column name. Skips blank lines. */
  function records(rows) {
    const columns = rows[0].map((cell) => cell.value);
    return rows.slice(1)
      .filter((cells) => !(cells.length === 1 && cells[0].value === '' && !cells[0].quoted))
      .map((cells) => Object.fromEntries(columns.map((name, i) => [name, cells[i] ? cells[i].value : ''])));
  }

  /** The text under each `## ` heading of a markdown file, keyed by heading. */
  function sections(markdown) {
    const found = {};
    let current = null;
    for (const line of markdown.split(/\r?\n/)) {
      if (/^## /.test(line)) { current = line.trim(); found[current] = ''; }
      else if (current) found[current] += `${line}\n`;
    }
    return found;
  }

  /**
   * The subject and preview lines of an email draft, in order:
   * [{ label, subject, preview }]. A subject with no preview gets preview: null.
   */
  function emailOptions(markdown) {
    const options = [];
    let label = '';
    for (const line of (sections(markdown)['## Subject lines'] || '').split('\n')) {
      const heading = line.match(/^### (.*)$/);
      const subject = line.match(/^Subject: (.*)$/);
      const preview = line.match(/^Preview: (.*)$/);
      if (heading) label = heading[1].trim();
      else if (subject) options.push({ label, subject: subject[1].trim(), preview: null });
      else if (preview && options.length && options[options.length - 1].preview === null) {
        options[options.length - 1].preview = preview[1].trim();
      }
    }
    return options;
  }

  /** The `# ` title of a markdown file, or ''. */
  const markdownTitle = (markdown) => ((markdown.match(/^# (.+)$/m) || [])[1] || '').trim();

  return { POSTING_SCHEDULE, CONTENT_CALENDAR, CsvError, parseCsv, csvType, records, sections, emailOptions, markdownTitle };
});
