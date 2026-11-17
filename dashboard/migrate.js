/**
 * Dashboard data migrations.
 *
 * The dashboard template (index.html) and each user's saved data are separate.
 * Saved data carries a `schemaVersion`. When a new template ships, this module
 * upgrades older data one version at a time, refuses data from a newer
 * template, and verifies that no record was dropped along the way.
 *
 * Works in the browser (exposes `window.DashboardMigrate`) and in Node
 * (`require('./migrate.js')`). Run it from the command line to check a saved
 * data file before releasing a template change:
 *
 *   node dashboard/migrate.js check path/to/saved-data.json
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DashboardMigrate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CURRENT_VERSION = 2;

  class UnsupportedVersionError extends Error {
    constructor(message, version) {
      super(message);
      this.name = 'UnsupportedVersionError';
      this.version = version;
    }
  }

  class DataIntegrityError extends Error {
    constructor(message) {
      super(message);
      this.name = 'DataIntegrityError';
    }
  }

  /**
   * Record collections by schema version. Keys are stable logical names so
   * that a renamed collection can still be compared across versions.
   */
  const COLLECTIONS = {
    1: { approvals: 'approvals', revisionRequests: 'revisions', calendar: 'calendar', results: 'results' },
    2: { approvals: 'approvals', revisionRequests: 'revisionRequests', calendar: 'calendar', results: 'results' },
  };

  /**
   * v1 -> v2
   * - approvals[].owner is renamed to approvals[].reviewer.
   * - revisions (one flat note each) become revisionRequests, each with a
   *   status and a message thread. The original note is the first message.
   * Every other field, known or not, is carried over unchanged.
   */
  function upgradeV1toV2(data) {
    if ('revisionRequests' in data) {
      throw new DataIntegrityError(
        'Schema v1 data already has a "revisionRequests" field, which the upgrade would overwrite. Nothing was saved.',
      );
    }
    const { revisions = [], ...rest } = data;
    return {
      ...rest,
      schemaVersion: 2,
      approvals: (data.approvals || []).map(({ owner, ...item }) => ({ ...item, reviewer: owner })),
      revisionRequests: revisions.map(({ note, requestedBy, requestedAt, resolved, ...item }) => ({
        ...item,
        status: resolved ? 'resolved' : 'open',
        openedBy: requestedBy,
        openedAt: requestedAt,
        thread: [{ id: `${item.id}-m1`, author: requestedBy, body: note, at: requestedAt }],
      })),
    };
  }

  const STEPS = { 1: upgradeV1toV2 };

  function readVersion(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('Dashboard data must be a JSON object.');
    }
    const version = data.schemaVersion;
    if (!Number.isInteger(version) || version < 1) {
      throw new UnsupportedVersionError(
        `Dashboard data has a missing or invalid schemaVersion (${JSON.stringify(version)}). Refusing to modify it.`,
        version,
      );
    }
    return version;
  }

  /**
   * Returns the record ids of every collection, keyed by logical name.
   * Throws DataIntegrityError unless each collection is a list (or absent) of
   * records with a unique, non-empty string id, because the record-loss guard
   * can only prove that nothing was dropped when every record is identifiable.
   */
  function recordIds(data, version) {
    const ids = {};
    for (const [logical, field] of Object.entries(COLLECTIONS[version])) {
      const records = data[field] === undefined ? [] : data[field];
      if (!Array.isArray(records)) {
        throw new DataIntegrityError(`"${field}" must be a list of records.`);
      }
      const seen = new Set();
      records.forEach((record, index) => {
        const id = record !== null && typeof record === 'object' ? record.id : undefined;
        if (typeof id !== 'string' || id === '') {
          throw new DataIntegrityError(`"${field}" record ${index + 1} has no id. Refusing to modify the data.`);
        }
        if (seen.has(id)) {
          throw new DataIntegrityError(`"${field}" has more than one record with id "${id}". Refusing to modify the data.`);
        }
        seen.add(id);
      });
      ids[logical] = [...seen];
    }
    return ids;
  }

  /**
   * Throws DataIntegrityError unless `after` holds exactly the records of
   * `before`, collection by collection: same count, and every id still there.
   */
  function verifyNoRecordLoss(before, beforeVersion, after, afterVersion) {
    const was = recordIds(before, beforeVersion);
    const now = recordIds(after, afterVersion);
    for (const logical of Object.keys(was)) {
      const remaining = new Set(now[logical]);
      const missing = was[logical].filter((id) => !remaining.has(id));
      if (missing.length || now[logical].length !== was[logical].length) {
        throw new DataIntegrityError(
          `Upgrade would change ${logical} from ${was[logical].length} to ${now[logical].length} records` +
            (missing.length ? ` (missing: ${missing.join(', ')})` : '') +
            '. Nothing was saved.',
        );
      }
    }
  }

  /**
   * Upgrade dashboard data to CURRENT_VERSION.
   * - Current data is checked and returned as is (same object, untouched).
   * - Older data is copied and upgraded; the input is never mutated.
   * - Newer or unversioned data is refused with UnsupportedVersionError.
   * - Malformed collections are refused with DataIntegrityError.
   */
  function migrate(data) {
    const from = readVersion(data);
    if (from > CURRENT_VERSION) {
      throw new UnsupportedVersionError(
        `Dashboard data is schema v${from}, but this template supports up to v${CURRENT_VERSION}. ` +
          'It was probably saved by a newer template. Refusing to modify it.',
        from,
      );
    }
    recordIds(data, from);
    if (from === CURRENT_VERSION) return data;

    let upgraded = structuredClone(data);
    for (let version = from; version < CURRENT_VERSION; version += 1) {
      const step = STEPS[version];
      if (!step) throw new UnsupportedVersionError(`No upgrade path from schema v${version}.`, version);
      upgraded = step(upgraded);
    }
    verifyNoRecordLoss(data, from, upgraded, CURRENT_VERSION);
    return upgraded;
  }

  function summarize(data) {
    const version = readVersion(data);
    if (!COLLECTIONS[version]) return { schemaVersion: version };
    const counts = {};
    for (const [logical, ids] of Object.entries(recordIds(data, version))) counts[logical] = ids.length;
    return { schemaVersion: version, ...counts };
  }

  return { CURRENT_VERSION, migrate, summarize, verifyNoRecordLoss, UnsupportedVersionError, DataIntegrityError };
});

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('node:fs');
  const { migrate, summarize } = module.exports;
  const [command, file] = process.argv.slice(2);
  if (command !== 'check' || !file) {
    console.error('Usage: node dashboard/migrate.js check <saved-data.json>');
    process.exit(2);
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = summarize(data);
    const after = summarize(migrate(data));
    console.log('before:', JSON.stringify(before));
    console.log('after: ', JSON.stringify(after));
    console.log(before.schemaVersion === after.schemaVersion ? 'OK: already current, nothing to change.' : 'OK: upgrades with no records lost.');
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exit(1);
  }
}
