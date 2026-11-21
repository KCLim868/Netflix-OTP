import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, extractFromEmail, extractLink, htmlToText, senderAllowed } from '../lib/extract.js';

// Shaped like Netflix's sign-in code email: code in its own cell, busy footer.
const SIGN_IN_HTML = `
<html><head><style>.x{color:red} td{font-size:12px}</style><title>Netflix</title></head>
<body>
<div style="display:none">Enter this code to sign in&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;</div>
<table>
  <tr><td><img src="https://assets.nflxext.com/logo_2024.png" alt="Netflix"></td></tr>
  <tr><td><h1>Enter this code to sign in</h1></td></tr>
  <tr><td style="font-size:40px;letter-spacing:6px;font-weight:bold">4827</td></tr>
  <tr><td>This code will expire in 15 minutes.</td></tr>
  <tr><td>Requested on November 21, 2026 at 10:42 AM from Chrome, Windows.</td></tr>
  <tr><td><a href="https://www.netflix.com/password?g=1234-5678&amp;lnktrk=EVO">Change password</a></td></tr>
  <tr><td>Questions? Call 1-866-579-7172</td></tr>
  <tr><td>Netflix Services Australia Pty Ltd, Level 1, 7 Wentworth Street, Sydney 2000</td></tr>
  <tr><td>SRC: 26718_en-AU_AU</td></tr>
  <tr><td>&copy; 2026 Netflix</td></tr>
</table>
</body></html>`;

test('finds the code in an HTML sign-in email and ignores the footer', () => {
  assert.equal(extractCode({ subject: 'Your sign-in code', html: SIGN_IN_HTML }), '4827');
});

test('finds the code in a plain-text email', () => {
  const text = 'Hi,\n\nEnter this code to sign in\n\n9031\n\nThis code will expire in 15 minutes.\n\n© 2026 Netflix';
  assert.equal(extractCode({ subject: 'Netflix: Your sign-in code', text }), '9031');
});

test('finds a code mentioned inline in a sentence', () => {
  const text = 'Your Netflix verification code is 551204. It may expire in 15 minutes.';
  assert.equal(extractCode({ subject: 'Verify', text }), '551204');
});

test('finds a code spelled out with spaces', () => {
  assert.equal(extractCode({ subject: 'Your code', text: 'Your code:\n1 2 3 4\nExpires soon.' }), '1234');
});

test('finds a code in the subject line', () => {
  assert.equal(extractCode({ subject: 'Your Netflix code: 7765', text: 'Hello' }), '7765');
});

test('returns nothing for a Netflix email without a code', () => {
  const html = `<table><tr><td>New on Netflix this week</td></tr>
    <tr><td>Season 2 arrives 28 November 2026</td></tr>
    <tr><td>Watch now</td></tr><tr><td>&copy; 2026 Netflix, Inc. 121 Albright Way, Los Gatos, CA 95032</td></tr></table>`;
  assert.equal(extractFromEmail({ subject: 'New arrivals', html }), null);
});

test('does not pick up digits from links, years, phone numbers or dates', () => {
  const text = [
    'Your sign-in code request',
    'Visit https://www.netflix.com/browse/5544 to watch.',
    'Call 1-866-579-7172 or write to help@netflix.com',
    'Sent 21/11/2026',
    '© 2026 Netflix',
  ].join('\n');
  assert.equal(extractCode({ subject: 'Sign-in', text }), null);
});

test('htmlToText keeps table cells on separate lines', () => {
  const text = htmlToText('<table><tr><td>Enter this code</td></tr><tr><td>1234</td></tr></table>');
  assert.ok(/Enter this code\s*\n\s*1234/.test(text), text);
});

test('household email returns the Netflix "Get code" link', () => {
  const html = `<p>Your temporary access code</p>
    <a href="https://www.netflix.com/account/travel/verify?nftoken=abc&amp;messageGuid=x">Get Code</a>
    <p>The link expires in 15 minutes.</p>`;
  assert.deepEqual(extractFromEmail({ subject: 'Your Netflix temporary access code', html }), {
    type: 'link',
    value: 'https://www.netflix.com/account/travel/verify?nftoken=abc&messageGuid=x',
    label: 'Get code',
  });
});

test('household update email returns the confirm link', () => {
  const html = '<a href="https://www.netflix.com/account/update-primary-location?nftoken=zz">Yes, This Was Me</a>';
  assert.equal(extractLink({ html }).label, 'Confirm household');
});

test('links that are not https://*.netflix.com are never returned', () => {
  for (const href of [
    'https://netflix.com.evil.example/account/travel/verify?x=1',
    'http://www.netflix.com/account/travel/verify?x=1',
    'https://evil-netflix.com/account/travel/verify',
    'javascript:alert(1)//netflix.com/account/travel/',
  ]) {
    assert.equal(extractLink({ html: `<a href="${href}">Get Code</a>` }), null, href);
  }
});

test('only accepts emails sent from netflix.com', () => {
  assert.equal(senderAllowed('info@account.netflix.com'), true);
  assert.equal(senderAllowed('info@netflix.com'), true);
  assert.equal(senderAllowed('info@netflix.com.evil.example'), false);
  assert.equal(senderAllowed('info@fakenetflix.com'), false);
  assert.equal(senderAllowed(''), false);
  assert.equal(senderAllowed(undefined), false);
});
