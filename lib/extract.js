// Pulls a Netflix sign-in code (or, for household emails, the "Get code" link)
// out of a parsed email. Pure functions only, so they are easy to test.

const KEYWORD = /\b(code|codes|otp|passcode|pin|verification|verify|sign[\s-]?in|log[\s-]?in|access|código|codigo|kode|kod)\b/i;
const NOISE = /©|copyright|\bsrc\b|\binc\b|los gatos|albright|winchester|\b(ca|ny)\s+\d{5}\b|b\.v\.|\bltd\b|\bpty\b|unsubscribe/i;
const MONTH_NAME = '(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)';
const DATE = new RegExp(`\\b\\d{1,2}\\s+${MONTH_NAME}\\b|\\b${MONTH_NAME}\\.?\\s+\\d{1,2}\\b`, 'i');
const LABEL = /\b(code|otp|passcode|pin)\b\s*(is|:|-)?\s*$/i;
const MIN_SCORE = 5;

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, ent) => {
    const key = ent.toLowerCase();
    if (key.startsWith('#x')) return safeChar(parseInt(key.slice(2), 16), m);
    if (key.startsWith('#')) return safeChar(parseInt(key.slice(1), 10), m);
    return ENTITIES[key] ?? m;
  });
}

function safeChar(code, fallback) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

// Turns email HTML into text that keeps each table cell / block on its own line,
// so a code shown in its own cell ends up on its own line.
export function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|tr|td|th|li|ul|ol|h[1-6]|table|tbody|thead|center|section|header|footer)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

function cleanText(text) {
  return (text || '')
    .replace(/[​-‏­͏⁠﻿]/g, '') // invisible preheader padding
    .replace(/ /g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ') // digits inside links are never the code
    .replace(/<[^>\s]+@[^>\s]+>|\S+@\S+\.\S+/g, ' '); // nor inside email addresses
}

// Returns every 4–8 digit number in the text with a score of how likely it is the code.
export function scoreCandidates(text, { subjectHasKeyword = false } = {}) {
  const lines = cleanText(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  const candidates = [];
  lines.forEach((line, i) => {
    const context = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
    const found = [];

    // A code spelled out with spaces on its own line, e.g. "1 2 3 4".
    if (/^(\d ){3,7}\d$/.test(line)) found.push({ value: line.replace(/ /g, ''), alone: true, labelled: false });

    // Not part of a longer token, a date (21/11/2026), a price or a phone number.
    for (const m of line.matchAll(/(?<![\w.,/-])\d{4,8}(?!\w|[.,:/-]\d)/g)) {
      found.push({
        value: m[0],
        alone: line.replace(/[.:!]$/, '') === m[0],
        labelled: LABEL.test(line.slice(0, m.index)), // "…code is 1234", "Code: 1234"
      });
    }

    for (const { value, alone, labelled } of found) {
      let score = 0;
      if (alone) score += 4;
      if (labelled) score += 2;
      if (KEYWORD.test(context)) score += 3;
      else if (subjectHasKeyword && alone) score += 1;
      if (value.length === 4) score += 2;
      else if (value.length === 6) score += 1;
      if (/^(19|20)\d\d$/.test(value)) score -= 3; // looks like a year
      if (NOISE.test(line) || DATE.test(line)) score -= 5;
      candidates.push({ value, score, line: i });
    }
  });
  return candidates;
}

export function extractCode({ subject = '', text = '', html = '' } = {}) {
  const subjectHasKeyword = KEYWORD.test(subject);
  const sources = [subject, text, htmlToText(html)];
  let best = null;
  for (const source of sources) {
    for (const c of scoreCandidates(source, { subjectHasKeyword })) {
      if (c.score >= MIN_SCORE && (!best || c.score > best.score)) best = c;
    }
  }
  return best ? best.value : null;
}

// Household emails ("temporary access code", "update your Netflix Household")
// contain a button link instead of the code itself. Only trust netflix.com links.
const LINK_PATTERNS = [
  { re: /\/account\/travel\//i, label: 'Get code' },
  { re: /update-primary-location|\/household/i, label: 'Confirm household' },
];

export function extractLink({ text = '', html = '' } = {}, allowedDomain = 'netflix.com') {
  const urls = [];
  for (const m of (html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) urls.push(decodeEntities(m[1]));
  for (const m of (text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) urls.push(m[0]);

  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') continue;
    if (host !== allowedDomain && !host.endsWith('.' + allowedDomain)) continue;
    const match = LINK_PATTERNS.find((p) => p.re.test(url.pathname));
    if (match) return { url: url.toString(), label: match.label };
  }
  return null;
}

// What the app shows for one email: a code, a link, or nothing.
export function extractFromEmail(email, allowedDomain) {
  const code = extractCode(email);
  if (code) return { type: 'code', value: code };
  const link = extractLink(email, allowedDomain);
  if (link) return { type: 'link', value: link.url, label: link.label };
  return null;
}

export function senderAllowed(address, allowedDomain = 'netflix.com') {
  const domain = String(address || '').toLowerCase().split('@')[1];
  if (!domain) return false;
  return domain === allowedDomain || domain.endsWith('.' + allowedDomain);
}
