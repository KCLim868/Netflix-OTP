// Logs into the mailbox over IMAP and looks for the newest Netflix code email.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { extractFromEmail, senderAllowed } from './extract.js';

const POLL_MS = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_BYTES = 2 * 1024 * 1024;

/**
 * Finds the newest Netflix email received at or after `threshold` (ms) that
 * contains a code or household link. Keeps checking for up to `waitMs`
 * before giving up, so one call covers the few seconds it takes the email to arrive.
 * Resolves to { type, value, label?, receivedAt } or null.
 */
export async function findCode(config, { threshold, waitMs = 0, signal } = {}) {
  const deadline = Date.now() + waitMs;
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
  client.on('error', () => {}); // errors also reject the pending command; don't crash on the event

  await client.connect();
  try {
    const path = config.mailbox || (await allMailPath(client));
    // Read-only, so reading the email never marks it as read in Gmail.
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const checked = new Map(); // uid -> extraction result, so each email is downloaded once
      for (;;) {
        const found = await newestCode(client, config, threshold, checked);
        if (found) return found;
        const left = deadline - Date.now();
        if (left <= 0 || signal?.aborted) return null;
        await sleep(Math.min(POLL_MS, left), signal);
        if (signal?.aborted) return null;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Gmail filters can skip the inbox, so search "All Mail" when the server has one.
async function allMailPath(client) {
  const boxes = await client.list();
  return boxes.find((b) => b.specialUse === '\\All')?.path || 'INBOX';
}

async function newestCode(client, config, threshold, checked) {
  const uids = await client.search(
    {
      since: new Date(threshold - DAY_MS), // IMAP only searches by day; exact time is checked below
      from: config.senderDomain.split('.')[0],
    },
    { uid: true }
  );
  if (!uids || !uids.length) return null;

  const messages = await client.fetchAll(
    uids.slice(-15),
    { uid: true, internalDate: true, envelope: true },
    { uid: true }
  );

  const fresh = messages
    .map((m) => ({
      uid: m.uid,
      receivedAt: new Date(m.internalDate).getTime(),
      from: m.envelope?.from?.[0]?.address,
    }))
    .filter((m) => m.receivedAt >= threshold && senderAllowed(m.from, config.senderDomain))
    .sort((a, b) => b.receivedAt - a.receivedAt);

  for (const m of fresh) {
    if (!checked.has(m.uid)) checked.set(m.uid, await readEmail(client, m.uid, config.senderDomain));
    const result = checked.get(m.uid);
    if (result) return { ...result, receivedAt: m.receivedAt };
  }
  return null;
}

async function readEmail(client, uid, senderDomain) {
  const msg = await client.fetchOne(String(uid), { source: { maxLength: MAX_EMAIL_BYTES } }, { uid: true });
  if (!msg || !msg.source) return null;
  const parsed = await simpleParser(msg.source);
  return extractFromEmail(
    { subject: parsed.subject || '', text: parsed.text || '', html: parsed.html || '' },
    senderDomain
  );
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
