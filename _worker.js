// _worker.js – Cloudflare Pages Advanced Mode

const ALLOWED_ORIGINS = [
  'https://seelenbalsam-muenchen.de',
  'https://www.seelenbalsam-muenchen.de',
  'https://seelenbalsam-muenchen.pages.dev',
];
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 500;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitMap = new Map();

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 1; entry.resetAt = now + RATE_LIMIT_WINDOW_MS; }
  else { entry.count++; }
  rateLimitMap.set(ip, entry);
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap) { if (now > val.resetAt) rateLimitMap.delete(key); }
  }
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

async function handleChat(request, env) {
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Zu viele Anfragen – bitte kurz warten.' }), {
      status: 429, headers: corsHeaders(origin),
    });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key nicht konfiguriert' }), {
      status: 500, headers: corsHeaders(origin),
    });
  }

  let body;
  try { body = await request.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'Ungültiges JSON' }), { status: 400, headers: corsHeaders(origin) });
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    return new Response(JSON.stringify({ error: 'Ungültige Anfrage' }), { status: 400, headers: corsHeaders(origin) });
  }
  for (const msg of messages) {
    if (typeof msg.content === 'string' && msg.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(JSON.stringify({ error: 'Nachricht zu lang' }), { status: 400, headers: corsHeaders(origin) });
    }
  }

  // Wissensdatenbank von GitHub laden
  let wissen = {};
  try {
    const wissenUrl = 'https://raw.githubusercontent.com/fresus90/seelenbalsam-muenchen/main/_data/wissensdatenbank.json';
    const wissenRes = await fetch(wissenUrl, { cf: { cacheTtl: 300 } });
    if (wissenRes.ok) wissen = await wissenRes.json();
  } catch (e) {
    try { const r = env.WISSENSDATENBANK; if (r) wissen = JSON.parse(r); } catch(e2) {}
  }

  const ta = wissen.tamara || {};
  const k = wissen.kurs || {};
  const termine = wissen.termine || [];
  const kt = wissen.kontakt || {};

  const termineText = termine.length
    ? termine.map(t => `- ${t.bezeichnung}: ${t.wochentag} ${t.uhrzeit}, ${t.startdatum}, ${t.ort_name} (${t.ort_adresse}), ${t.preis}`).join('\n')
    : '- Donnerstags 16:00-16:45 Uhr, ab 08. Mai 2025, Bewegungsraum Villa Verte, Hans-Mielich-Str. 8 81543 München, 180 Euro';

  const SYSTEM_PROMPT = `Du bist ${ta.name || 'Tamara Möhwald'}, ${ta.beruf || 'Kinderpädagogin'} aus ${ta.standort || 'München'} und Gründerin von Seelenbalsam.

Beantworte Fragen von Eltern warm, persönlich, auf Deutsch, duze sie. Max 2-4 Sätze. Gelegentlich Emojis. Nie "Als KI".

Kurs:
- Zielgruppe: ${k.zielgruppe || 'Kinder ab 2 bis ca. 8 Jahre'}
- Philosophie: ${k.philosophie || 'Ganzheitliche Bewegung, Achtsamkeit, Selbstvertrauen'}
- Leitsatz: ${k.leitsatz || 'Ich bin genau richtig, so wie ich bin.'}
- Dauer: ${k.kursdauer || '8 Wochen, 1x pro Woche, 45 Minuten'}
- Gruppe: ${k.max_kinder || 'max. 10 Kinder'}
- Vorkenntnisse: ${k.vorkenntnisse || 'keine nötig'}
- Teilnahme: ${k.teilnahme || 'Die Kinder nehmen ohne Eltern am Kurs teil. Tamara holt sie an der Tür des Kursraumes ab und bringt sie danach wieder zurück.'}

Termine:
${termineText}

Mitbringen: ${wissen.mitbringen || 'Wasserflasche und Stoppersocken'}
Anmeldung: ${wissen.anmeldung_info || 'jederzeit möglich, per WhatsApp oder Website-Formular'}
Rezensionen: ${wissen.rezensionen || 'Eltern können über den Bereich Rezensionen auf der Website, per WhatsApp oder per E-Mail eine Rezension schreiben.'}
Kontakt: ${kt.telefon || '+49 157 52129991'} (WhatsApp), ${kt.email || 'seelenbalsam.muenchen@gmail.com'}

Wenn du etwas nicht weißt: freundlich sagen und WhatsApp empfehlen. Nichts erfinden.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: SYSTEM_PROMPT,
        messages: messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'API Fehler' }), { status: response.status, headers: corsHeaders(origin) });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Serverfehler' }), { status: 500, headers: corsHeaders(origin) });
  }
}


/* ═══════════════════════════════════════════════════════════════════════
   ADMIN-PANEL (/admin) – Login mit Benutzername und Passwort

   Decap CMS kann sich von Haus aus nur bei GitHub anmelden. Damit auch
   Personen ohne GitHub-Account Inhalte pflegen koennen, meldet man sich
   hier mit Benutzername und Passwort an; dieser Worker spricht
   stellvertretend mit der GitHub-API.

   Ablauf:
     1. /admin laedt das Admin-Panel. Beim Klick auf "Anmelden" oeffnet
        sich /cms-api/auth mit dem Anmeldeformular.
     2. Stimmen die Zugangsdaten, setzt der Worker ein signiertes,
        HttpOnly-Sitzungscookie und meldet das Panel an.
     3. Jeder GitHub-Aufruf des Panels laeuft ueber /cms-api/github/*.
        Dort wird die Signatur des Cookies erneut geprueft und erst dann
        der echte GitHub-Token angehaengt.

   Benoetigte Variablen (Cloudflare Pages -> Settings -> Variables):
     GITHUB_TOKEN   Secret. Fine-grained PAT, nur dieses Repository,
                    Berechtigung "Contents: Read and write".
     CMS_USERS      Secret. Zugangsdaten, eine Person pro Zeile:
                      tamara:pbkdf2$100000$<salt>$<hash>
                    Hashes erzeugt `node scripts/cms-passwort.mjs`.
                    Ein Klartext-Passwort wird auch akzeptiert, ist aber
                    nur als schneller Einstieg gedacht.

   Optional:
     CMS_SESSION_SECRET  Secret zum Signieren der Sitzungen. Fehlt es,
                         wird der GITHUB_TOKEN dafuer verwendet; ein
                         Tausch des Tokens meldet dann alle ab.
   ═══════════════════════════════════════════════════════════════════════ */

const CMS_REPO = 'fresus90/seelenbalsam-muenchen';
const GITHUB_API = 'https://api.github.com';
const SESSION_COOKIE = 'sb_cms_session';
const SESSION_MAX_AGE_S = 12 * 60 * 60;
// Cloudflare Workers laesst hoechstens 100000 Runden zu. Mehr quittiert die
// Laufzeit mit "iteration counts above 100000 are not supported".
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_MAX_ITERATIONS = 100000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const loginAttempts = new Map();
let sessionKeyCache = { secret: '', key: null };

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function htmlResponse(status, body, extraHeaders) {
  return new Response(body, {
    status,
    headers: Object.assign(
      { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
      extraHeaders || {}
    ),
  });
}

function base64UrlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input) {
  let s = String(input).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Vergleich ohne frueher Abbruch – verhindert, dass sich ein Passwort
// ueber die Antwortzeit Zeichen fuer Zeichen erraten laesst.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/* ── Zugangsdaten ───────────────────────────────────────────────────── */

// Akzeptiert JSON ({"tamara":"geheim"}) oder je Zeile "benutzer:geheimnis".
// Beim Zeilenformat zaehlt nur der erste Doppelpunkt, damit Passwoerter
// selbst Doppelpunkte enthalten duerfen.
function parseCmsUsers(raw) {
  const users = new Map();
  if (!raw) return users;
  const text = String(raw).trim();
  if (!text) return users;

  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      for (const [name, secret] of Object.entries(obj)) {
        if (typeof secret === 'string' && name) users.set(name.trim().toLowerCase(), secret);
      }
      return users;
    } catch (e) {
      return users;
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#')) continue;
    const sep = entry.indexOf(':');
    if (sep <= 0) continue;
    const name = entry.slice(0, sep).trim().toLowerCase();
    const secret = entry.slice(sep + 1).trim();
    if (name && secret) users.set(name, secret);
  }
  return users;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

// Prueft das Passwort gegen den gespeicherten Wert. Unterstuetzt
// "pbkdf2$<runden>$<salt>$<hash>" und – als Einstiegshilfe – Klartext.
async function passwordMatches(password, stored) {
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 1000) return false;
    if (iterations > PBKDF2_MAX_ITERATIONS) {
      throw new CmsAuthError(500,
        'Die hinterlegten Zugangsdaten wurden mit ' + iterations + ' Runden erzeugt, ' +
        'Cloudflare erlaubt hoechstens ' + PBKDF2_MAX_ITERATIONS + '. Bitte die Zugangsdaten ' +
        'unter /admin/passwort.html neu erzeugen und CMS_USERS ersetzen.');
    }
    let salt, expected;
    try {
      salt = base64UrlDecode(parts[2]);
      expected = base64UrlDecode(parts[3]);
    } catch (e) {
      return false;
    }
    const actual = await pbkdf2(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  }
  const enc = new TextEncoder();
  return constantTimeEqual(enc.encode(password), enc.encode(stored));
}

async function checkCredentials(env, username, password) {
  const users = parseCmsUsers(env.CMS_USERS);
  if (!users.size) throw new CmsAuthError(500, 'Es sind noch keine Zugangsdaten hinterlegt (CMS_USERS fehlt).');

  const name = String(username || '').trim().toLowerCase();
  const stored = users.get(name);

  // Auch ohne Treffer rechnen, damit sich aus der Antwortzeit nicht
  // ablesen laesst, ob es den Benutzernamen gibt.
  if (!stored) {
    await passwordMatches(String(password || ''), 'pbkdf2$' + PBKDF2_ITERATIONS + '$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    return null;
  }
  const ok = await passwordMatches(String(password || ''), stored);
  return ok ? name : null;
}

/* ── Sitzung ────────────────────────────────────────────────────────── */

async function getSessionKey(env) {
  const secret = env.CMS_SESSION_SECRET || env.GITHUB_TOKEN || '';
  if (!secret) throw new CmsAuthError(500, 'Weder CMS_SESSION_SECRET noch GITHUB_TOKEN ist gesetzt.');
  if (sessionKeyCache.key && sessionKeyCache.secret === secret) return sessionKeyCache.key;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('sb-cms-session:' + secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
  sessionKeyCache = { secret, key };
  return key;
}

async function createSession(env, username) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    u: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S,
  })));
  const key = await getSessionKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return payload + '.' + base64UrlEncode(sig);
}

async function readSessionToken(env, token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  let sig;
  try { sig = base64UrlDecode(token.slice(dot + 1)); } catch (e) { return null; }

  const key = await getSessionKey(env);
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payload));
  if (!valid) return null;

  let data;
  try { data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))); } catch (e) { return null; }
  if (!data || typeof data.u !== 'string') return null;
  if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;

  // Wer inzwischen aus CMS_USERS entfernt wurde, kommt auch mit einem
  // noch gueltigen Cookie nicht mehr hinein.
  if (!parseCmsUsers(env.CMS_USERS).has(data.u)) return null;

  return { user: data.u };
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookieHeader(token, maxAge) {
  return SESSION_COOKIE + '=' + token +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

class CmsAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function requireEditor(request, env) {
  const session = await readSessionToken(env, readCookie(request, SESSION_COOKIE));
  if (!session) throw new CmsAuthError(401, 'Nicht angemeldet. Bitte /admin neu laden und einloggen.');
  return session;
}

/* ── Anmeldeversuche begrenzen ──────────────────────────────────────── */

function loginBlocked(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) return false;
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function noteFailedLogin(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
  if (loginAttempts.size > 1000) {
    for (const [key, val] of loginAttempts) if (now > val.resetAt) loginAttempts.delete(key);
  }
}

/* ── Seiten ─────────────────────────────────────────────────────────── */

const CMS_PAGE_STYLE = `
  :root { --terracotta:#C4906A; --dark:#3D2B1F; --taupe:#B09A88; --warm:#FDF9F5; }
  * { box-sizing: border-box; }
  body { font-family: 'Jost', system-ui, sans-serif; background: var(--warm); color: var(--dark);
         display:flex; align-items:center; justify-content:center; min-height:100vh;
         margin:0; padding:24px; }
  .box { width:100%; max-width:340px; text-align:center; }
  h1 { font-family:'Cormorant Garamond', Georgia, serif; font-weight:400; font-size:1.5rem;
       letter-spacing:.04em; margin:0 0 4px; }
  .sub { color:var(--taupe); font-size:.8rem; margin:0 0 26px; }
  label { display:block; text-align:left; font-size:.68rem; letter-spacing:.12em;
          text-transform:uppercase; color:var(--taupe); margin:0 0 6px; }
  input { width:100%; padding:12px 14px; margin-bottom:16px; font-size:.95rem; font-family:inherit;
          border:1px solid #e0d2c2; border-radius:10px; background:#fff; color:var(--dark); }
  input:focus { outline:none; border-color:var(--terracotta); }
  button { width:100%; padding:13px; border:none; border-radius:30px; background:var(--terracotta);
           color:#fff; font-family:inherit; font-size:.75rem; letter-spacing:.12em;
           text-transform:uppercase; cursor:pointer; }
  button:hover { background:#6B4F3A; }
  .err { background:rgba(196,144,106,.12); border-left:3px solid var(--terracotta);
         border-radius:0 8px 8px 0; padding:10px 14px; margin-bottom:18px;
         font-size:.82rem; text-align:left; line-height:1.5; }
  .msg { font-size:.9rem; line-height:1.6; color:var(--taupe); }
`;

function loginPage(errorText, username, status) {
  return htmlResponse(status || 200, `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Anmelden · Seelenbalsam</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>${CMS_PAGE_STYLE}</style>
</head>
<body>
<div class="box">
  <h1>Seelenbalsam</h1>
  <p class="sub">Anmeldung zur Inhaltspflege</p>
  ${errorText ? '<div class="err">' + escapeHTML(errorText) + '</div>' : ''}
  <form method="POST" action="/cms-api/auth" autocomplete="on">
    <label for="u">Benutzername</label>
    <input id="u" name="username" type="text" autocomplete="username"
           autocapitalize="none" spellcheck="false" required value="${escapeHTML(username || '')}">
    <label for="p">Passwort</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Anmelden</button>
  </form>
</div>
<script>
  (function () {
    var u = document.getElementById('u');
    var p = document.getElementById('p');
    (u && !u.value ? u : p).focus();
  })();
</script>
</body>
</html>`);
}

// Fuehrt den postMessage-Handshake, den Decap von einem OAuth-Anbieter
// erwartet. Uebergeben wird nur ein Platzhalter – der echte GitHub-Token
// bleibt im Worker.
function authPopupPage(bodyText, tokenOrNull, extraHeaders, status) {
  const script = tokenOrNull === null ? '' : `
    (function () {
      var provider = 'github';
      var token = ${escapeForScript(tokenOrNull)};
      var done = false;

      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        if (event.data !== 'authorizing:' + provider) return;
        done = true;
        window.removeEventListener('message', onMessage, false);
        window.opener.postMessage(
          'authorization:' + provider + ':success:' + JSON.stringify({ token: token, provider: provider }),
          event.origin
        );
        setTimeout(function () { window.close(); }, 200);
      }

      if (!window.opener) {
        document.getElementById('msg').textContent =
          'Die Anmeldung hat geklappt. Bitte dieses Fenster schliessen und /admin neu laden.';
        return;
      }

      window.addEventListener('message', onMessage, false);

      // Das Admin-Panel registriert seinen Listener u.U. erst kurz nach dem
      // Oeffnen dieses Fensters – deshalb den Handshake mehrfach anbieten.
      var tries = 0;
      var timer = setInterval(function () {
        if (done || tries++ > 40) { clearInterval(timer); return; }
        window.opener.postMessage('authorizing:' + provider, window.location.origin);
      }, 150);
      window.opener.postMessage('authorizing:' + provider, window.location.origin);
    })();`;

  return htmlResponse(status || 200, `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Anmeldung · Seelenbalsam</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>${CMS_PAGE_STYLE}</style>
</head>
<body>
<div class="box">
  <h1>Seelenbalsam</h1>
  <p class="msg" id="msg">${escapeHTML(bodyText)}</p>
</div>
<script>${script}</script>
</body>
</html>`, extraHeaders);
}

/* ── Endpunkte ──────────────────────────────────────────────────────── */

async function handleCmsAuth(request, env) {
  if (!env.GITHUB_TOKEN) {
    return loginPage('Der Server ist noch nicht fertig eingerichtet: GITHUB_TOKEN fehlt.', '', 500);
  }

  if (request.method === 'GET') {
    let session = null;
    try { session = await readSessionToken(env, readCookie(request, SESSION_COOKIE)); } catch (e) { session = null; }
    if (session) {
      return authPopupPage('Angemeldet als ' + session.user + '. Dieses Fenster schliesst sich gleich.', 'cms-session');
    }
    return loginPage('', '');
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET, POST' } });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (loginBlocked(ip)) {
    return loginPage('Zu viele Fehlversuche. Bitte in 15 Minuten noch einmal probieren.', '', 429);
  }

  let form;
  try { form = await request.formData(); }
  catch (e) { return loginPage('Die Eingaben konnten nicht gelesen werden.', '', 400); }

  const username = form.get('username') || '';
  const password = form.get('password') || '';

  let user;
  try {
    user = await checkCredentials(env, username, password);
  } catch (err) {
    return loginPage(err.message, String(username), err.status || 500);
  }

  if (!user) {
    noteFailedLogin(ip);
    return loginPage('Benutzername oder Passwort stimmt nicht.', String(username), 401);
  }

  loginAttempts.delete(ip);
  const token = await createSession(env, user);
  return authPopupPage(
    'Angemeldet als ' + user + '. Dieses Fenster schliesst sich gleich.',
    'cms-session',
    { 'Set-Cookie': sessionCookieHeader(token, SESSION_MAX_AGE_S) }
  );
}

function handleCmsLogout() {
  return jsonResponse(200, { ok: true });
}

// Nur Aufrufe zu genau diesem Repository durchlassen – der Token selbst
// sollte ohnehin nur hier Schreibrechte haben, das ist die zweite Schranke.
function isAllowedGithubPath(path) {
  return path === '/repos/' + CMS_REPO || path.startsWith('/repos/' + CMS_REPO + '/');
}

async function handleCmsGithub(request, env, url) {
  let editor;
  try {
    editor = await requireEditor(request, env);
  } catch (err) {
    return jsonResponse(err.status || 401, { message: err.message });
  }
  if (!env.GITHUB_TOKEN) {
    return jsonResponse(500, { message: 'GITHUB_TOKEN ist im Worker nicht hinterlegt.' });
  }

  const path = url.pathname.slice('/cms-api/github'.length) || '/';

  // Das CMS fragt die angemeldete Person ab. Statt des Token-Besitzers
  // zeigen wir, wer sich tatsaechlich angemeldet hat.
  if (path === '/user') {
    return jsonResponse(200, { login: editor.user, name: editor.user, avatar_url: '' });
  }

  if (!isAllowedGithubPath(path)) {
    return jsonResponse(403, { message: 'Dieser Pfad ist nicht freigegeben: ' + path });
  }

  const headers = new Headers({
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': request.headers.get('Accept') || 'application/vnd.github+json',
    'User-Agent': 'seelenbalsam-cms',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  const method = request.method;
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  const upstream = await fetch(GITHUB_API + path + url.search, { method, headers, body });

  // Decap prueft ueber dieses Feld, ob geschrieben werden darf. Bei einem
  // fine-grained Token meldet GitHub das nicht immer zuverlaessig, deshalb
  // setzen wir es anhand der tatsaechlichen Antwort.
  if (path === '/repos/' + CMS_REPO && upstream.ok) {
    const repo = await upstream.json();
    repo.permissions = Object.assign({ admin: false, pull: true }, repo.permissions, { push: true });
    return jsonResponse(200, repo);
  }

  const out = new Headers();
  const passthrough = ['content-type', 'etag', 'link', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
  for (const name of passthrough) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('Cache-Control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

async function handleCmsApi(request, env, url) {
  if (url.pathname === '/cms-api/auth') return handleCmsAuth(request, env);
  if (url.pathname === '/cms-api/logout') {
    const res = handleCmsLogout();
    res.headers.set('Set-Cookie', sessionCookieHeader('', 0));
    return res;
  }
  if (url.pathname === '/cms-api/github' || url.pathname.startsWith('/cms-api/github/')) {
    return handleCmsGithub(request, env, url);
  }
  return jsonResponse(404, { message: 'Unbekannter CMS-Endpunkt.' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/chat') {
      return handleChat(request, env);
    }
    if (url.pathname.startsWith('/cms-api/')) {
      return handleCmsApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};
