// GET /api/code — the only endpoint. Works as a Vercel function and in server.js.
//
// Query:  since  server time (ms) when "I've requested" was pressed; omitted on the first call
//         after  only return a code newer than this (ms), used to watch for a resent code
//         wait   seconds to keep checking before answering (0–25)
// Header: Authorization: Bearer <ACCESS_KEY>
// Answer: { since, now, result: { type: 'code' | 'link', value, label?, receivedAt } | null }

import { createHash, timingSafeEqual } from 'node:crypto';
import { loadConfig, missingSettings } from './config.js';
import { findCode as imapFindCode } from './mailbox.js';

const MAX_WAIT_S = 25;
const MAX_SINCE_AGE_MS = 60 * 60 * 1000;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export function createHandler({
  config = loadConfig(),
  findCode = (opts) => imapFindCode(config, opts),
  now = Date.now,
} = {}) {
  const failures = new Map(); // ip -> { count, resetAt }

  return async function handler(req, res) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

    const missing = missingSettings(config);
    if (missing.length) {
      return send(res, 500, { error: `Server is missing settings: ${missing.join(', ')}` });
    }

    const ip = clientIp(req);
    const record = failures.get(ip);
    if (record && record.resetAt < now()) failures.delete(ip);
    if (failures.get(ip)?.count >= FAIL_LIMIT) {
      return send(res, 429, { error: 'Too many wrong keys. Try again later.' });
    }
    if (!keyMatches(bearer(req), config.accessKey)) {
      if (failures.size > 1000) failures.clear(); // keep memory bounded
      const r = failures.get(ip) || { count: 0, resetAt: now() + FAIL_WINDOW_MS };
      r.count += 1;
      failures.set(ip, r);
      return send(res, 401, { error: 'Wrong family key' });
    }
    failures.delete(ip);

    const query = new URL(req.url, 'http://localhost').searchParams;
    const t = now();
    let since = Number(query.get('since'));
    if (!Number.isFinite(since) || since > t + 60_000 || since < t - MAX_SINCE_AGE_MS) since = t;
    const after = Number(query.get('after')) || 0;
    const waitS = Math.min(Math.max(Number(query.get('wait')) || 0, 0), MAX_WAIT_S);
    const threshold = Math.max(since - config.lookbackMs, after + 1);

    // Stop checking the mailbox if the phone goes away mid-wait.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    try {
      const result = await findCode({ threshold, waitMs: waitS * 1000, signal: abort.signal });
      return send(res, 200, { since, now: now(), result: result || null });
    } catch (err) {
      if (err && err.authenticationFailed) {
        return send(res, 502, {
          error: 'Gmail refused the login. Check GMAIL_USER and GMAIL_APP_PASSWORD.',
        });
      }
      console.error('Mailbox check failed:', err && (err.responseText || err.message || err));
      return send(res, 502, { error: 'Could not check email. Trying again…' });
    }
  };
}

function send(res, status, body) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function clientIp(req) {
  // Vercel sets x-forwarded-for itself; elsewhere it could be faked, so use the socket.
  if (process.env.VERCEL) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}
