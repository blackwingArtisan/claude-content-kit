/**
 * Turns the files Content Kit writes into dashboard records:
 *
 *   posting-schedule.csv  -> an approval card and a calendar entry per post
 *   content-calendar.csv  -> a calendar entry per slot
 *   email draft (.md)     -> an approval card for the recommended subject line
 *
 * mergeImport() folds those records into dashboard data without losing review
 * work: importing a file again updates the copy and keeps each card's review
 * status, and a post that lands on a planned calendar slot fills that slot.
 *
 * Shared by the dashboard (window.ContentKitImport) and by Node
 * (scripts/build-sample-data.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./formats.js'));
  } else {
    root.ContentKitImport = factory(root.ContentKitFormats);
  }
})(typeof self !== 'undefined' ? self : this, function (formats) {
  'use strict';

  const { parseCsv, csvType, records, emailOptions, markdownTitle, sections } = formats;

  class ImportError extends Error {
    constructor(message) { super(message); this.name = 'ImportError'; }
  }

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const POST_REVIEW = { draft: 'pending', approved: 'approved', scheduled: 'approved', published: 'approved' };
  const POST_SLOT = { draft: 'in_review', approved: 'scheduled', scheduled: 'scheduled', published: 'published' };
  const SLOT_STATUSES = ['planned', 'in_review', 'scheduled', 'published'];

  const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function dayBefore(date) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** The first sentence of a post, cut to about 60 characters at a word break. */
  function headline(text) {
    const first = String(text).trim().split(/\n/)[0].split(/(?<=[.!?])\s/)[0].trim();
    if ([...first].length <= 60) return first;
    const cut = first.slice(0, 60);
    return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60).replace(/[,;:]$/, '')}...`;
  }

  function requireFields(record, fields, row) {
    for (const field of fields) {
      if (!String(record[field] || '').trim()) throw new ImportError(`row ${row}: ${field} is empty`);
    }
    if (!DATE.test(record.publish_date)) throw new ImportError(`row ${row}: publish_date "${record.publish_date}" is not YYYY-MM-DD`);
  }

  /** Approval cards and calendar entries for the posts in a posting schedule. */
  function fromPostingSchedule(rows, { reviewer = '' } = {}) {
    const approvals = [];
    const calendar = [];
    records(rows).forEach((post, index) => {
      requireFields(post, ['channel', 'post_text'], index + 2);
      const key = `${post.publish_date}-${slug(post.channel)}`;
      const contentId = `post-${key}`;
      const title = headline(post.post_text);
      approvals.push({
        id: contentId,
        title,
        channel: post.channel,
        dueDate: dayBefore(post.publish_date),
        status: POST_REVIEW[post.status] || 'pending',
        preview: post.post_text,
        reviewer,
        publishAt: `${post.publish_date}T${post.publish_time || '00:00'}`,
      });
      calendar.push({
        id: `cal-${key}`,
        date: post.publish_date,
        channel: post.channel,
        title,
        pillar: post.pillar,
        status: POST_SLOT[post.status] || 'in_review',
        contentId,
      });
    });
    return { kind: 'posting schedule', approvals, calendar };
  }

  /** Calendar entries for the slots in a content calendar. */
  function fromContentCalendar(rows) {
    const seen = {};
    const calendar = records(rows).map((slot, index) => {
      requireFields(slot, ['channel', 'title'], index + 2);
      const key = `cal-${slot.publish_date}-${slug(slot.channel)}`;
      seen[key] = (seen[key] || 0) + 1;
      return {
        id: seen[key] > 1 ? `${key}-${seen[key]}` : key,
        date: slot.publish_date,
        channel: slot.channel,
        title: slot.title,
        pillar: slot.pillar,
        status: SLOT_STATUSES.includes(slot.status) ? slot.status : 'planned',
        brief: slot.brief,
        owner: slot.owner,
      };
    });
    return { kind: 'content calendar', approvals: [], calendar };
  }

  /** An approval card for an email draft, showing its recommended subject line. */
  function fromEmailDraft(markdown, { name = 'email', reviewer = '', dueDate = '' } = {}) {
    const [recommended] = emailOptions(markdown);
    if (!recommended) throw new ImportError('no "Subject: " line under "## Subject lines"');
    const body = sections(markdown)['## Plain-text version'] || '';
    const opening = body.replace(/```\w*/g, '').trim().split(/\n\s*\n/)[0] || '';
    const title = markdownTitle(markdown) || recommended.subject;
    return {
      kind: 'email draft',
      approvals: [{
        id: `email-${slug(name.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''))}`,
        title,
        channel: 'email',
        dueDate,
        status: 'pending',
        preview: [`Subject: ${recommended.subject}`, recommended.preview && `Preview: ${recommended.preview}`, opening]
          .filter(Boolean).join('\n'),
        reviewer,
      }],
      calendar: [],
    };
  }

  /** Reads one file by its name and contents. Throws ImportError or CsvError. */
  function importFile(name, contents, options = {}) {
    if (/\.md$/i.test(name)) return fromEmailDraft(contents, { name, ...options });
    const rows = parseCsv(contents);
    const type = csvType(rows);
    if (type === 'posting schedule') return fromPostingSchedule(rows, options);
    if (type === 'content calendar') return fromContentCalendar(rows);
    throw new ImportError('this is not a posting schedule or content calendar CSV from Content Kit (the header row does not match)');
  }

  function upsert(list, incoming, combine) {
    const next = list.map((item) => ({ ...item }));
    let added = 0;
    let updated = 0;
    for (const record of incoming) {
      const at = next.findIndex((item) => item.id === record.id);
      if (at === -1) { next.push(record); added += 1; }
      else { next[at] = combine(next[at], record); updated += 1; }
    }
    return { list: next, added, updated };
  }

  /**
   * Returns new dashboard data with the imported records folded in, plus
   * counts for a summary. Does not change `data`.
   */
  function mergeImport(data, imported) {
    const approvals = upsert(data.approvals || [], imported.approvals,
      // Keep the review: new copy, same status and reviewer.
      (existing, record) => ({ ...record, status: existing.status, reviewer: existing.reviewer || record.reviewer }));
    const fromPosts = imported.kind === 'posting schedule';
    // A drafted post fills the planned slot for its day and channel and keeps
    // the slot's title and brief; an entry a post created follows the post.
    const calendar = upsert(data.calendar || [], imported.calendar, (existing, record) => (fromPosts
      ? {
        ...existing,
        ...('brief' in existing ? {} : { title: record.title, pillar: record.pillar }),
        contentId: record.contentId,
        status: existing.status === 'planned' ? record.status : existing.status,
      }
      : { ...record, contentId: existing.contentId, status: existing.contentId ? existing.status : record.status }));
    if (fromPosts) {
      for (const card of approvals.list) {
        const slot = calendar.list.find((entry) => entry.contentId === card.id);
        if (slot && imported.approvals.some((record) => record.id === card.id)) card.title = slot.title;
      }
    }
    return {
      data: { ...data, approvals: approvals.list, calendar: calendar.list },
      counts: { approvals, calendar },
    };
  }

  /**
   * Sets a card's review status and moves the calendar entries that hold it:
   * an approved post is scheduled; any other review status keeps it in review.
   * Changes `data` in place, as the dashboard does for every action.
   */
  function setReviewStatus(data, contentId, status) {
    const card = data.approvals.find((item) => item.id === contentId);
    if (card) card.status = status;
    for (const entry of data.calendar) {
      if (entry.contentId === contentId && entry.status !== 'published') {
        entry.status = status === 'approved' ? 'scheduled' : 'in_review';
      }
    }
  }

  /** One sentence describing what an import added and updated. */
  function summarize(name, imported, counts) {
    const part = (one, many, { added, updated }) => (added + updated
      ? `${added + updated} ${added + updated === 1 ? one : many} (${added} new, ${updated} updated)` : '');
    const parts = [
      part('approval card', 'approval cards', counts.approvals),
      part('calendar entry', 'calendar entries', counts.calendar),
    ].filter(Boolean);
    return `Imported ${name}: ${parts.join(' and ') || 'nothing to add'}.`;
  }

  /** The first month (YYYY-MM) an import touches, so the calendar can open on it. */
  const firstMonth = (imported) => {
    const dates = imported.calendar.map((entry) => entry.date).filter((date) => DATE.test(date)).sort();
    return dates.length ? dates[0].slice(0, 7) : null;
  };

  return {
    ImportError, importFile, fromPostingSchedule, fromContentCalendar, fromEmailDraft,
    mergeImport, setReviewStatus, summarize, firstMonth, headline,
  };
});
