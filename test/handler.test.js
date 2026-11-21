import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../lib/handler.js';
import { loadConfig } from '../lib/config.js';

const NOW = 1_800_000_000_000;
const config = loadConfig({
  GMAIL_USER: 'family@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
  ACCESS_KEY: 'purple-tiger-river',
  LOOKBACK_SECONDS: '180',
});

async function serve(options) {
  const calls = [];
  const handler = createHandler({
    config,
    now: () => NOW,
    findCode: async (opts) => {
      calls.push(opts);
      return options.result ?? null;
    },
    ...options,
  });
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, key = 'purple-tiger-river') =>
    fetch(base + path, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  return { get, calls, close: () => new Promise((r) => server.close(r)) };
}

test('app password spaces are removed', () => {
  assert.equal(config.pass, 'abcdefghijklmnop');
});

test('rejects requests without the right family key', async () => {
  const app = await serve({});
  try {
    assert.equal((await app.get('/api/code', null)).status, 401);
    assert.equal((await app.get('/api/code', 'wrong')).status, 401);
    assert.equal(app.calls.length, 0);
  } finally {
    await app.close();
  }
});

test('blocks a device after too many wrong keys', async () => {
  const app = await serve({});
  try {
    for (let i = 0; i < 10; i++) await app.get('/api/code', 'guess' + i);
    assert.equal((await app.get('/api/code', 'purple-tiger-river')).status, 429);
  } finally {
    await app.close();
  }
});

test('reports missing settings', async () => {
  const app = await serve({ config: loadConfig({}) });
  try {
    const res = await app.get('/api/code');
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /GMAIL_USER, GMAIL_APP_PASSWORD, ACCESS_KEY/);
  } finally {
    await app.close();
  }
});

test('first call: uses server time and looks back a few minutes', async () => {
  const app = await serve({ result: { type: 'code', value: '4827', receivedAt: NOW - 5000 } });
  try {
    const res = await app.get('/api/code?wait=20');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), {
      since: NOW,
      now: NOW,
      result: { type: 'code', value: '4827', receivedAt: NOW - 5000 },
    });
    assert.equal(app.calls[0].threshold, NOW - 180_000);
    assert.equal(app.calls[0].waitMs, 20_000);
  } finally {
    await app.close();
  }
});

test('later calls keep the tap time, only want newer codes, and cap the wait', async () => {
  const app = await serve({});
  try {
    const since = NOW - 30_000;
    const after = NOW - 10_000;
    const body = await (await app.get(`/api/code?since=${since}&after=${after}&wait=999`)).json();
    assert.equal(body.since, since);
    assert.equal(body.result, null);
    assert.equal(app.calls[0].threshold, after + 1);
    assert.equal(app.calls[0].waitMs, 25_000);
  } finally {
    await app.close();
  }
});

test('ignores a tap time that is too old or in the future', async () => {
  const app = await serve({});
  try {
    for (const since of [NOW - 2 * 60 * 60 * 1000, NOW + 10 * 60 * 1000, 'abc']) {
      const body = await (await app.get(`/api/code?since=${since}`)).json();
      assert.equal(body.since, NOW);
    }
  } finally {
    await app.close();
  }
});

test('explains a Gmail login failure', async () => {
  const app = await serve({
    findCode: async () => {
      const err = new Error('Authentication failed');
      err.authenticationFailed = true;
      throw err;
    },
  });
  try {
    const res = await app.get('/api/code');
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /GMAIL_APP_PASSWORD/);
  } finally {
    await app.close();
  }
});
