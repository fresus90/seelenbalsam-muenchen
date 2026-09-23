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
   ADMIN-PANEL (/admin) – Login ohne GitHub-Account

   Decap CMS kann sich von Haus aus nur bei GitHub anmelden. Damit auch
   Personen ohne GitHub-Account Inhalte pflegen koennen, uebernimmt
   Cloudflare Access die Anmeldung (E-Mail-Einmalcode) und dieser Worker
   spricht stellvertretend mit der GitHub-API. Der GitHub-Token liegt als
   Secret im Worker und erreicht den Browser nie.

   Ablauf:
     1. /admin ist per Cloudflare Access geschuetzt -> Access setzt das
        Cookie CF_Authorization.
     2. Decap oeffnet /cms-api/auth. Dort wird das Access-Token geprueft
        und dem CMS ein Platzhalter-Token zurueckgegeben.
     3. Jeder GitHub-Aufruf des CMS laeuft ueber /cms-api/github/*. Dieser
        Worker prueft erneut das Access-Cookie und haengt den echten
        GitHub-Token an.

   Benoetigte Variablen (Cloudflare Pages -> Settings -> Variables):
     GITHUB_TOKEN           Fine-grained PAT, nur dieses Repository,
                            Berechtigung "Contents: Read and write"
     CF_ACCESS_TEAM_DOMAIN  z.B. seelenbalsam.cloudflareaccess.com
     CF_ACCESS_AUD          Application Audience (AUD) Tag der Access-App
   ═══════════════════════════════════════════════════════════════════════ */

const CMS_REPO = 'fresus90/seelenbalsam-muenchen';
const GITHUB_API = 'https://api.github.com';
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: null, fetchedAt: 0, domain: '' };

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function base64UrlToBytes(input) {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlToJSON(input) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(input)));
}

async function getAccessKeys(teamDomain) {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.domain === teamDomain && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch('https://' + teamDomain + '/cdn-cgi/access/certs');
  if (!res.ok) throw new Error('Signaturschluessel von Cloudflare Access nicht abrufbar.');
  const data = await res.json();
  if (!data || !Array.isArray(data.keys) || !data.keys.length) {
    throw new Error('Cloudflare Access hat keine Signaturschluessel geliefert.');
  }
  jwksCache = { keys: data.keys, fetchedAt: now, domain: teamDomain };
  return data.keys;
}

// Prueft das von Cloudflare Access ausgestellte JWT: Signatur, Laufzeit,
// Aussteller und Ziel-Anwendung. Erst danach gilt jemand als angemeldet.
async function verifyAccessToken(token, teamDomain, expectedAud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Access-Token hat ein unerwartetes Format.');

  const header = base64UrlToJSON(parts[0]);
  if (header.alg !== 'RS256') throw new Error('Unerwarteter Signaturalgorithmus: ' + header.alg);

  const keys = await getAccessKeys(teamDomain);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Der Signaturschluessel des Tokens ist unbekannt.');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parts[2]), signed);
  if (!valid) throw new Error('Die Signatur des Access-Tokens ist ungueltig.');

  const payload = base64UrlToJSON(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('Die Anmeldung ist abgelaufen.');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) {
    throw new Error('Das Access-Token ist noch nicht gueltig.');
  }
  if (payload.iss !== 'https://' + teamDomain) {
    throw new Error('Das Access-Token stammt von einer anderen Organisation.');
  }
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(expectedAud)) {
    throw new Error('Das Access-Token gehoert zu einer anderen Anwendung.');
  }
  return payload;
}

class CmsAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Liest das Access-Token aus Header oder Cookie und gibt die angemeldete
// Identitaet zurueck. Wirft CmsAuthError, wenn niemand angemeldet ist.
async function requireEditor(request, env) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const expectedAud = env.CF_ACCESS_AUD;
  if (!teamDomain || !expectedAud) {
    throw new CmsAuthError(500,
      'Cloudflare Access ist nicht konfiguriert: CF_ACCESS_TEAM_DOMAIN und CF_ACCESS_AUD fehlen.');
  }

  let token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }
  if (!token) {
    throw new CmsAuthError(401, 'Nicht angemeldet. Bitte /admin neu laden und einloggen.');
  }

  try {
    const payload = await verifyAccessToken(token, teamDomain, expectedAud);
    return {
      email: payload.email || 'unbekannt',
      sub: payload.sub || '',
    };
  } catch (err) {
    throw new CmsAuthError(401, err.message);
  }
}

function escapeForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function authPopupPage(bodyText, tokenOrNull) {
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
          'Dieses Fenster wurde nicht vom Admin-Panel geoeffnet. Bitte /admin aufrufen.';
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

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Anmeldung</title>
<style>
  body { font-family: system-ui, sans-serif; background: #FDF9F5; color: #3D2B1F;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
  p { max-width: 380px; line-height: 1.6; font-size: 0.95rem; }
</style>
</head>
<body>
<p id="msg">${bodyText}</p>
<script>${script}</script>
</body>
</html>`;
}

// Nur Aufrufe zu genau diesem Repository durchlassen – der Token selbst
// sollte ohnehin nur hier Schreibrechte haben, das ist die zweite Schranke.
function isAllowedGithubPath(path) {
  return path === '/repos/' + CMS_REPO || path.startsWith('/repos/' + CMS_REPO + '/');
}

async function handleCmsAuth(request, env) {
  let editor;
  try {
    editor = await requireEditor(request, env);
  } catch (err) {
    return new Response(
      authPopupPage('Anmeldung fehlgeschlagen: ' + err.message, null),
      { status: err.status || 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(
      authPopupPage('Der Server ist noch nicht fertig eingerichtet: GITHUB_TOKEN fehlt.', null),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }

  // Platzhalter-Token: Das CMS braucht irgendeinen Wert für den
  // Authorization-Header. Der echte GitHub-Token bleibt im Worker.
  return new Response(
    authPopupPage('Angemeldet als ' + editor.email + '. Dieses Fenster schliesst sich gleich.', 'cf-access-session'),
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
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
  // zeigen wir, wer sich tatsaechlich bei Access angemeldet hat.
  if (path === '/user') {
    return jsonResponse(200, {
      login: editor.email,
      name: editor.email,
      avatar_url: '',
    });
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
