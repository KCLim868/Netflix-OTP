// Runs the real IMAP code against a local fake Gmail server (hoodiecrow).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import hoodiecrow from 'hoodiecrow-imap';
import { findCode } from '../lib/mailbox.js';
import { loadConfig } from '../lib/config.js';

let server;
let config;

function email({ from = 'Netflix <info@account.netflix.com>', subject, html }) {
  return [
    `From: ${from}`,
    'To: family@gmail.com',
    `Subject: ${subject}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@netflix.com>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n');
}

const codeEmail = (code) =>
  email({
    subject: 'Your sign-in code',
    html: `<table><tr><td>Enter this code to sign in</td></tr><tr><td>${code}</td></tr><tr><td>&copy; 2026 Netflix</td></tr></table>`,
  });

const ALL_MAIL = '[Gmail]/All Mail';

before(async () => {
  const now = Date.now();
  server = hoodiecrow({
    plugins: ['SPECIAL-USE', 'IDLE'],
    storage: {
      INBOX: { messages: [] },
      '': {
        separator: '/',
        folders: {
          '[Gmail]': {
            flags: ['\\Noselect'],
            folders: {
              'All Mail': {
                'special-use': '\\All',
                messages: [
                  // An old code from yesterday must not be shown.
                  { raw: codeEmail('1111'), internaldate: new Date(now - 26 * 3600 * 1000) },
                  // A newsletter from Netflix just now: no code.
                  { raw: email({ subject: 'New this week', html: '<p>Watch now</p>' }), internaldate: new Date(now - 20_000) },
                  // A fake "Netflix" email from another domain with a code.
                  { raw: email({ from: 'Netflix <info@netflix-support.example>', subject: 'Your code', html: '<p>Code</p><p>6666</p>' }), internaldate: new Date(now - 10_000) },
                ],
              },
            },
          },
        },
      },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  config = loadConfig({
    GMAIL_USER: 'testuser',
    GMAIL_APP_PASSWORD: 'testpass',
    ACCESS_KEY: 'x',
    IMAP_HOST: '127.0.0.1',
    IMAP_PORT: String(server.address().port),
    IMAP_SECURE: 'false',
  });
});

after(() => new Promise((r) => server.close(r)));

test('returns nothing when only old, unrelated or fake emails exist', async () => {
  const result = await findCode(config, { threshold: Date.now() - 180_000 });
  assert.equal(result, null);
});

test('waits for the code email to arrive and returns it', async () => {
  const start = Date.now();
  setTimeout(() => server.appendMessage(ALL_MAIL, [], new Date(), codeEmail('4827')), 1500);
  const result = await findCode(config, { threshold: start - 1000, waitMs: 10_000 });
  assert.equal(result.type, 'code');
  assert.equal(result.value, '4827');
  assert.ok(Date.now() - start < 8000, 'found within a few seconds');
});

test('returns the newest code when Netflix resends one', async () => {
  // IMAP times are whole seconds, so make the resent email clearly the newest.
  const t = Date.now();
  server.appendMessage(ALL_MAIL, [], new Date(t + 2000), codeEmail('9001'));
  const result = await findCode(config, { threshold: t - 60_000 });
  assert.equal(result.value, '9001');

  // With `after` set to that email, only a newer one counts.
  const none = await findCode(config, { threshold: result.receivedAt + 1, waitMs: 0 });
  assert.equal(none, null);
});

test('household email returns the netflix.com link', async () => {
  const t = Date.now() + 5000; // newer than the emails added by the tests above
  server.appendMessage(
    ALL_MAIL,
    [],
    new Date(t),
    email({
      subject: 'Your Netflix temporary access code',
      html: '<a href="https://www.netflix.com/account/travel/verify?nftoken=abc">Get Code</a>',
    })
  );
  // IMAP rounds arrival times down to the second, so allow 1.5s of slack.
  const result = await findCode(config, { threshold: t - 1500 });
  assert.deepEqual(
    { type: result.type, value: result.value },
    { type: 'link', value: 'https://www.netflix.com/account/travel/verify?nftoken=abc' }
  );
});

test('stops waiting early when the phone disconnects', async () => {
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 500);
  const start = Date.now();
  const result = await findCode(config, { threshold: Date.now() + 60_000, waitMs: 20_000, signal: abort.signal });
  assert.equal(result, null);
  assert.ok(Date.now() - start < 3000);
});

test('wrong password is reported as an authentication failure', async () => {
  await assert.rejects(findCode({ ...config, pass: 'nope' }, { threshold: 0 }), (err) => err.authenticationFailed === true);
});
