// All settings come from environment variables (see .env.example).

export function loadConfig(env = process.env) {
  const num = (value, fallback) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
  };
  return {
    user: (env.GMAIL_USER || '').trim(),
    // Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of it.
    pass: (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
    accessKey: (env.ACCESS_KEY || '').trim(),
    host: env.IMAP_HOST || 'imap.gmail.com',
    port: num(env.IMAP_PORT, 993),
    secure: env.IMAP_SECURE ? env.IMAP_SECURE !== 'false' : true,
    mailbox: env.MAILBOX || '', // empty = Gmail "All Mail" (falls back to INBOX)
    senderDomain: (env.SENDER_DOMAIN || 'netflix.com').toLowerCase(),
    lookbackMs: num(env.LOOKBACK_SECONDS, 180) * 1000,
  };
}

export function missingSettings(config) {
  const missing = [];
  if (!config.user) missing.push('GMAIL_USER');
  if (!config.pass) missing.push('GMAIL_APP_PASSWORD');
  if (!config.accessKey) missing.push('ACCESS_KEY');
  return missing;
}
