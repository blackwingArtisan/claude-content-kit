const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer, start, HOST } = require('../dashboard/serve.js');

// Raw requests, so paths like /../ reach the server without client-side normalizing.
function get(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: rawPath, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the dashboard server', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  t.after(() => server.close());

  await t.test('serves the template, the migration script and the sample data', async () => {
    const page = await get(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.type, /^text\/html/);
    assert.match(page.body, /<script src="migrate.js"><\/script>/);
    assert.match((await get(port, '/migrate.js')).type, /^text\/javascript/);
    const data = await get(port, '/data/dashboard-data.json');
    assert.equal(JSON.parse(data.body).schemaVersion, 2);
  });

  await t.test('does not serve files outside the dashboard folder', async () => {
    for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/LICENSE', '/data/../../README.md']) {
      assert.equal((await get(port, p)).status, 404, p);
    }
  });

  await t.test('answers a malformed URL with 400 and keeps running', async () => {
    assert.equal((await get(port, '/%E0%A4%A')).status, 400);
    assert.equal((await get(port, '/')).status, 200);
  });

  await t.test('returns 404 for a missing file or a folder, and 405 for other methods', async () => {
    assert.equal((await get(port, '/nope.html')).status, 404);
    assert.equal((await get(port, '/data')).status, 404);
    assert.equal((await get(port, '/', 'POST')).status, 405);
  });
});

test('the server listens on 127.0.0.1 only', async (t) => {
  const server = await start(0);
  t.after(() => server.close());
  assert.equal(HOST, '127.0.0.1');
  assert.equal(server.address().address, '127.0.0.1');
});

test('symlinks are followed only while they stay inside the folder', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'content-kit-serve-'));
  const root = path.join(base, 'site');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(base, 'secret.txt'), 'outside');
  fs.writeFileSync(path.join(root, 'index.html'), '<p>inside</p>');
  fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'escape.txt'));
  fs.symlinkSync(base, path.join(root, 'up'));
  fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'alias.html'));
  const server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  t.after(() => { server.close(); fs.rmSync(base, { recursive: true, force: true }); });

  assert.equal((await get(port, '/escape.txt')).status, 404);
  assert.equal((await get(port, '/up/secret.txt')).status, 404);
  const alias = await get(port, '/alias.html');
  assert.equal(alias.status, 200);
  assert.equal(alias.body, '<p>inside</p>');
});

test('a file that cannot be read gets a 500, and the server keeps running', { skip: process.getuid && process.getuid() === 0 ? 'root can read any file' : false }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-kit-serve-'));
  fs.writeFileSync(path.join(root, 'index.html'), 'ok');
  fs.writeFileSync(path.join(root, 'locked.json'), '{}');
  fs.chmodSync(path.join(root, 'locked.json'), 0o000);
  const server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const locked = await get(port, '/locked.json');
  assert.equal(locked.status, 500);
  assert.equal(locked.body, 'Could not read the file');
  assert.equal((await get(port, '/')).status, 200);
  assert.equal((await get(port, '/', 'HEAD')).status, 200);
});
