// dsh-smart-model — Host half.
// Serves a tiny heartbeat log route so the client half can report what it
// sees at runtime. Every path is defensive: a host route may never reject,
// because an unhandled rejection ends the whole app.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOG_PATH = 'C:\\Users\\adminstrator\\Documents\\deepseek-harness\\default-workspace\\dsh-smart-model\\heartbeat.log';

function logLine(obj) {
  try {
    mkdirSync(join(LOG_PATH, '..'), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n', 'utf8');
  } catch { /* the log may never break the app */ }
}

function readBody(req, limit = 65536) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    try {
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          resolve(null);
          req.destroy?.();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function sendJson(res, status, payload) {
  try {
    if (res.writableEnded === true || res.destroyed === true) return;
    let body = '';
    try {
      body = JSON.stringify(payload);
    } catch {
      body = '{"status":"error"}';
    }
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  } catch { /* the answer may never break the app */ }
}

export const name = 'dsh-smart-model';
export const inject = ['webServer'];

export function apply(ctx) {
  logLine({ ev: 'host-apply', canGet: typeof ctx?.get === 'function' });
  if (typeof ctx?.get !== 'function') return;
  let server = null;
  try {
    server = ctx.get('webServer');
  } catch (error) {
    logLine({ ev: 'host-no-webserver', error: String(error?.message ?? error) });
    return;
  }
  if (server === null || server === undefined || typeof server.register !== 'function') {
    logLine({ ev: 'host-no-webserver-register' });
    return;
  }
  let dispose = null;
  try {
    dispose = server.register({
      kind: 'exact',
      path: '/dsh-smart-model/log',
      handler: async (req, res) => {
        try {
          const method = String(req?.method ?? 'GET').toUpperCase();
          if (method !== 'POST') return sendJson(res, 405, { status: 'method' });
          const body = await readBody(req);
          if (body === null) return sendJson(res, 400, { status: 'body' });
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch { /* not json */ }
          if (parsed === null || typeof parsed !== 'object') return sendJson(res, 400, { status: 'body' });
          logLine(parsed);
          sendJson(res, 200, { status: 'ok' });
        } catch (error) {
          logLine({ ev: 'host-route-error', error: String(error?.message ?? error) });
          sendJson(res, 500, { status: 'error' });
        }
      },
    });
  } catch (error) {
    logLine({ ev: 'host-register-error', error: String(error?.message ?? error) });
  }
  if (typeof ctx.effect === 'function' && typeof dispose === 'function') {
    ctx.effect(() => () => {
      try {
        dispose();
      } catch { /* gone */ }
    });
  }
  logLine({ ev: 'host-route-ready' });
}
