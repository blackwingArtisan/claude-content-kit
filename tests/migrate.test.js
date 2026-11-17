const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  CURRENT_VERSION,
  migrate,
  verifyNoRecordLoss,
  UnsupportedVersionError,
  DataIntegrityError,
} = require('../dashboard/migrate.js');

const load = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const v1Fixture = () => load('tests/fixtures/dashboard-data.v1.json');
const shippedSample = () => load('dashboard/data/dashboard-data.json');
const ids = (records) => records.map((r) => r.id).sort();

test('v1 data upgrades to the current schema version', () => {
  const upgraded = migrate(v1Fixture());
  assert.equal(upgraded.schemaVersion, CURRENT_VERSION);
  assert.equal(CURRENT_VERSION, 2);
});

test('v1 upgrade keeps every record in every collection', () => {
  const v1 = v1Fixture();
  const v2 = migrate(v1);
  assert.deepEqual(ids(v2.approvals), ids(v1.approvals));
  assert.deepEqual(ids(v2.revisionRequests), ids(v1.revisions));
  assert.deepEqual(ids(v2.calendar), ids(v1.calendar));
  assert.deepEqual(ids(v2.results), ids(v1.results));
  assert.deepEqual(v2.calendar, v1.calendar, 'unchanged collections are carried over as is');
  assert.deepEqual(v2.results, v1.results);
  assert.deepEqual(v2.brandHub, v1.brandHub);
  assert.equal('revisions' in v2, false, 'old collection name is removed after the move');
});

test('v1 upgrade renames approvals[].owner to reviewer without changing values', () => {
  const v1 = v1Fixture();
  const v2 = migrate(v1);
  v1.approvals.forEach((before, i) => {
    const after = v2.approvals[i];
    assert.equal(after.reviewer, before.owner);
    assert.equal('owner' in after, false);
    const { owner, ...restBefore } = before;
    const { reviewer, ...restAfter } = after;
    assert.deepEqual(restAfter, restBefore);
  });
});

test('v1 revision notes become threads with the original note as the first message', () => {
  const v1 = v1Fixture();
  const v2 = migrate(v1);
  v1.revisions.forEach((note) => {
    const request = v2.revisionRequests.find((r) => r.id === note.id);
    assert.equal(request.contentId, note.contentId);
    assert.equal(request.status, note.resolved ? 'resolved' : 'open');
    assert.equal(request.openedBy, note.requestedBy);
    assert.equal(request.openedAt, note.requestedAt);
    assert.deepEqual(request.thread, [
      { id: `${note.id}-m1`, author: note.requestedBy, body: note.note, at: note.requestedAt },
    ]);
  });
});

test('migration never mutates the input object', () => {
  const v1 = v1Fixture();
  const snapshot = structuredClone(v1);
  migrate(v1);
  assert.deepEqual(v1, snapshot);
});

test('unknown fields are preserved through an upgrade', () => {
  const v1 = v1Fixture();
  v1.customReports = [{ id: 'x-1', name: 'Quarterly review' }];
  v1.approvals[0].campaign = 'october-single-origin';
  v1.revisions[0].priority = 'high';
  const v2 = migrate(v1);
  assert.deepEqual(v2.customReports, v1.customReports);
  assert.equal(v2.approvals[0].campaign, 'october-single-origin');
  assert.equal(v2.revisionRequests[0].priority, 'high');
});

test('already-current data is returned untouched', () => {
  const current = shippedSample();
  const snapshot = structuredClone(current);
  const result = migrate(current);
  assert.equal(result, current, 'same object, no copy or rewrite');
  assert.deepEqual(result, snapshot);
});

test('migrating twice gives the same result as migrating once', () => {
  const once = migrate(v1Fixture());
  assert.deepEqual(migrate(structuredClone(once)), once);
});

test('unknown future versions are refused and left unchanged', () => {
  const future = { ...shippedSample(), schemaVersion: CURRENT_VERSION + 1, newCollection: [{ id: 'n-1' }] };
  const snapshot = structuredClone(future);
  assert.throws(() => migrate(future), (error) => {
    assert.ok(error instanceof UnsupportedVersionError);
    assert.equal(error.version, CURRENT_VERSION + 1);
    assert.match(error.message, /Refusing to modify it/);
    return true;
  });
  assert.deepEqual(future, snapshot);
});

test('missing or invalid schema versions are refused', () => {
  const { schemaVersion, ...unversioned } = v1Fixture();
  for (const bad of [unversioned, { ...unversioned, schemaVersion: '1' }, { ...unversioned, schemaVersion: 0 }, { ...unversioned, schemaVersion: 1.5 }]) {
    assert.throws(() => migrate(bad), UnsupportedVersionError);
  }
  assert.throws(() => migrate(null), TypeError);
  assert.throws(() => migrate([]), TypeError);
});

test('the record-loss guard rejects an upgrade that drops a record', () => {
  const v1 = v1Fixture();
  const broken = migrate(v1);
  broken.revisionRequests.pop();
  assert.throws(() => verifyNoRecordLoss(v1, 1, broken, 2), (error) => {
    assert.ok(error instanceof DataIntegrityError);
    assert.match(error.message, /revisionRequests from 3 to 2 records \(missing: r-203\)/);
    return true;
  });
});

test('the shipped sample data is at the current schema version', () => {
  assert.equal(shippedSample().schemaVersion, CURRENT_VERSION);
});

test('the upgraded copy shares no nested objects with the input', () => {
  const v1 = v1Fixture();
  const snapshot = structuredClone(v1);
  const v2 = migrate(v1);
  v2.calendar[0].title = 'changed';
  v2.brandHub.pillars.push('changed');
  v2.workspace.brand = 'changed';
  assert.deepEqual(v1, snapshot);
});

test('a v1 file with no revisions upgrades to an empty revisionRequests list', () => {
  const { revisions, ...v1 } = v1Fixture();
  const v2 = migrate(v1);
  assert.deepEqual(v2.revisionRequests, []);
  assert.equal(v2.approvals.length, v1.approvals.length);
});

test('a v1 file that already has a revisionRequests field is refused, not overwritten', () => {
  const v1 = { ...v1Fixture(), revisionRequests: [{ id: 'kept' }] };
  const snapshot = structuredClone(v1);
  assert.throws(() => migrate(v1), (error) => {
    assert.ok(error instanceof DataIntegrityError);
    assert.match(error.message, /would overwrite/);
    return true;
  });
  assert.deepEqual(v1, snapshot);
});

test('records without an id, or with a repeated id, are refused before any upgrade', () => {
  const noId = v1Fixture();
  delete noId.approvals[2].id;
  assert.throws(() => migrate(noId), /"approvals" record 3 has no id/);

  const repeated = v1Fixture();
  repeated.calendar[1].id = repeated.calendar[0].id;
  assert.throws(() => migrate(repeated), /more than one record with id "k-301"/);

  const notObject = v1Fixture();
  notObject.results.push(null);
  assert.throws(() => migrate(notObject), DataIntegrityError);
});

test('a collection that is not a list is refused, at any version', () => {
  assert.throws(() => migrate({ ...v1Fixture(), revisions: { id: 'r-1' } }), /"revisions" must be a list/);
  assert.throws(() => migrate({ ...shippedSample(), approvals: 'none' }), /"approvals" must be a list/);
});

test('the record-loss guard catches a swapped record even when the count is unchanged', () => {
  const v1 = v1Fixture();
  const broken = migrate(v1);
  broken.approvals[0] = { ...broken.approvals[0], id: 'c-999' };
  assert.throws(() => verifyNoRecordLoss(v1, 1, broken, 2), /approvals from 5 to 5 records \(missing: c-101\)/);
});

test('the check command reports counts before and after, and fails on a future version', () => {
  const cli = path.join(__dirname, '..', 'dashboard', 'migrate.js');
  const out = execFileSync(process.execPath, [cli, 'check', path.join(__dirname, 'fixtures', 'dashboard-data.v1.json')], { encoding: 'utf8' });
  assert.match(out, /before: \{"schemaVersion":1,"approvals":5,"revisionRequests":3,"calendar":8,"results":5\}/);
  assert.match(out, /after: +\{"schemaVersion":2,"approvals":5,"revisionRequests":3,"calendar":8,"results":5\}/);
  assert.match(out, /OK: upgrades with no records lost\./);

  const future = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'content-kit-')), 'future.json');
  fs.writeFileSync(future, JSON.stringify({ ...shippedSample(), schemaVersion: CURRENT_VERSION + 1 }));
  const failed = spawnSync(process.execPath, [cli, 'check', future], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /FAILED: Dashboard data is schema v3/);
});
