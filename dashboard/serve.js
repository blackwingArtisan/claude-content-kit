// Serves the dashboard folder on http://127.0.0.1:4173 (no dependencies).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * The real path of the file a URL path names, or null if it is missing, not
 * a regular file, or (after following symlinks) outside the served folder.
 */
function resolveFile(root, urlPath) {
  const requested = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  let real;
  try {
    real = fs.realpathSync(requested);
    if (!fs.statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real.startsWith(root + path.sep) ? real : null;
}

/** An HTTP server for the files in `root` (default: this folder). Read-only. */
function createServer({ root = __dirname } = {}) {
  const realRoot = fs.realpathSync(root);
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    const file = resolveFile(realRoot, urlPath);
    if (!file) return send(res, 404, 'Not found');
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      if (res.headersSent) res.destroy();
      else send(res, 500, 'Could not read the file');
    });
    stream.on('open', () => {
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        stream.destroy();
        res.end();
      } else {
        stream.pipe(res);
      }
    });
  });
}

/** Starts the server on this machine only (127.0.0.1). */
function start(port = Number(process.env.PORT) || 4173, options) {
  const server = createServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

module.exports = { createServer, start, HOST };

if (require.main === module) {
  start().then(
    (server) => console.log(`Dashboard running at http://${HOST}:${server.address().port}`),
    (error) => { console.error(`Could not start the dashboard: ${error.message}`); process.exit(1); },
  );
}
