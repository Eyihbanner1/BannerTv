/**
 * The phone page, served by the Worker. The TV's QR code opens it with the
 * code in the fragment (`#code=ABC123`), and the add-from-settings flow adds
 * `&configure=<addon settings URL>`. A fragment never reaches a server, and
 * the page clears it from the address bar once read.
 */

import { CODE_ALPHABET, CODE_LENGTH } from './rules';

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#7B4DFF" d="M25.64 14 83.64 50 25.64 86Z"/><path fill="#C9B5FF" d="M25.64 14 83.64 50 45.64 50Z"/><path fill="#4B23C8" d="M25.64 14 45.64 50 25.64 86Z"/></svg>`;

const HTML = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>Send an addon to BannerTV</title>
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body>
<main>
  <header class="brand"><img src="/logo.svg" alt="" width="36" height="36"><span>Banner<b>TV</b></span></header>
  <h1>Send an addon to your TV</h1>
  <p class="lead">Paste an addon's address here and it appears on your TV, ready to add.</p>
  <form id="send" novalidate>
    <p id="code-shown" class="code-shown" hidden>TV code <strong id="code-value"></strong></p>
    <div id="code-row" class="field">
      <label for="code">Code on your TV</label>
      <input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8">
    </div>
    <div id="configure" class="steps" hidden>
      <p>1. Open the addon's settings, choose what you want, then copy the install link it gives you.</p>
      <a id="configure-link" class="button secondary" target="_blank" rel="noopener noreferrer">Open addon settings</a>
      <p>2. Paste the link below.</p>
    </div>
    <div class="field">
      <label for="url">Addon address</label>
      <input id="url" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/manifest.json">
    </div>
    <button id="submit" class="button" type="submit">Send to TV</button>
    <p id="status" class="status" role="status" aria-live="polite"></p>
  </form>
  <p class="small">BannerTV's server holds the address in memory only, never on disk, and forgets it 30 seconds after your TV picks it up, or after ten minutes. It is never logged.</p>
</main>
</body>
</html>
`;

const CSS = `*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#0B0815;color:#F1EDFF;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px 40px}
.brand{display:flex;align-items:center;font-weight:700;font-size:20px;margin-bottom:24px}
.brand img{margin-right:10px}
.brand b{color:#A98BFF}
h1{font-size:26px;line-height:1.2;margin:0 0 8px}
.lead,.small{color:#B9B0D6}
.small{font-size:14px;color:#9A90BD;margin-top:32px}
.field{margin-top:20px}
label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:12px;border:2px solid #261C42;background:#120E20;color:#F1EDFF;font:inherit;font-size:17px}
input:focus{outline:none;border-color:#C9B5FF}
#code{text-transform:uppercase;letter-spacing:4px;font-weight:700}
.code-shown{margin:20px 0 0;color:#B9B0D6}
.code-shown strong{color:#F1EDFF;letter-spacing:3px;margin-left:6px}
.steps{margin-top:20px;padding:16px;border-radius:16px;background:#1B1430}
.steps p{margin:0 0 12px}
.steps p:last-child{margin:12px 0 0}
.button{overflow-wrap:anywhere}
.button{display:block;width:100%;margin-top:24px;padding:14px;border:0;border-radius:999px;background:#6A3BF0;color:#fff;font:inherit;font-weight:700;font-size:17px;text-align:center;text-decoration:none;cursor:pointer}
.button:focus{outline:3px solid #C9B5FF;outline-offset:2px}
.button:disabled{opacity:.6}
.button.secondary{margin-top:0;background:#261C42}
.status{min-height:24px;margin:16px 0 0}
.status.error{color:#FFB4C0}
.status.done{color:#A98BFF;font-weight:600}
`;

const JS = `'use strict';
(function () {
  var ALPHABET = '${CODE_ALPHABET}';
  var LENGTH = ${CODE_LENGTH};
  var MESSAGES = {
    'invalid-url': "That doesn't look like an addon address. It should start with https:// or stremio://.",
    'too-long': 'That address is too long to send to the TV.',
    expired: 'That code has run out or was mistyped. Open Add an addon on your TV for a new one.',
    'already-sent': 'Your TV already has an address from this code. Scan the new code on your TV to send another.',
    offline: "Couldn't reach BannerTV. Check your connection and try again.",
    other: 'Something went wrong. Try again.'
  };
  MESSAGES['not-found'] = MESSAGES.expired;

  function $(id) { return document.getElementById(id); }
  function readCode(value) {
    var code = String(value || '').toUpperCase().replace(/[\\s-]/g, '');
    if (code.length !== LENGTH) return '';
    for (var i = 0; i < code.length; i++) if (ALPHABET.indexOf(code[i]) === -1) return '';
    return code;
  }
  function show(text, kind) {
    $('status').textContent = text;
    $('status').className = 'status' + (kind ? ' ' + kind : '');
  }

  var params = new URLSearchParams(location.hash.slice(1));
  var linked = readCode(params.get('code'));
  var configure = params.get('configure') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);

  if (linked) {
    $('code').value = linked;
    $('code-row').hidden = true;
    $('code-value').textContent = linked;
    $('code-shown').hidden = false;
  }
  // The settings step shows only with a TV's code, which keeps it off a plain
  // visit. That is no safeguard: anyone can link here with any address in the
  // fragment, so the button names the site it opens.
  var configureHost = '';
  if (linked && /^https?:\\/\\//i.test(configure)) {
    try { configureHost = new URL(configure).host; } catch (error) { configureHost = ''; }
  }
  if (configureHost) {
    $('configure-link').href = configure;
    $('configure-link').textContent = 'Open settings on ' + configureHost;
    $('configure').hidden = false;
  }

  $('send').addEventListener('submit', function (event) {
    event.preventDefault();
    var code = readCode($('code').value);
    var url = $('url').value.trim();
    if (!code) { show('Enter the six-character code shown on your TV.', 'error'); $('code').focus(); return; }
    if (!url) { show('Paste the addon address first.', 'error'); $('url').focus(); return; }
    $('submit').disabled = true;
    show('Sending…');
    fetch('/api/sessions/' + code, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (response.ok) {
          $('url').value = '';
          show('Sent. Check your TV: the address is waiting there for you to add.', 'done');
        } else {
          show(MESSAGES[body.error] || MESSAGES.other, 'error');
        }
      });
    }, function () {
      show(MESSAGES.offline, 'error');
    }).then(function () {
      $('submit').disabled = false;
    });
  });
})();
`;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'public, max-age=300',
};

export const PAGE_FILES: Record<string, { body: string; headers: Record<string, string> }> = {
  '/': {
    body: HTML,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      // form-action 'none' also stops the form posting the address in a URL if the script fails.
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  },
  '/app.css': {
    body: CSS,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/css; charset=utf-8' },
  },
  '/app.js': {
    body: JS,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/javascript; charset=utf-8' },
  },
  '/logo.svg': { body: LOGO, headers: { ...SECURITY_HEADERS, 'Content-Type': 'image/svg+xml' } },
};
