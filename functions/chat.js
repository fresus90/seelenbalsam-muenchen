// Cloudflare Pages Function: functions/chat.js
// Automatisch verfügbar unter /chat bei Cloudflare Pages

const ALLOWED_ORIGIN = 'https://seelenbalsam-muenchen.de';
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 500;

// Einfaches In-Memory Rate Limiting (pro Worker-Instanz)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  } else {
    entry.count++;
  }

  rateLimitMap.set(ip, entry);

  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }

  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin')) });
  }

  const origin = request.headers.get('Origin') || '';
  if (origin !== ALLOWED_ORIGIN) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Zu viele Anfragen – bitte kurz warten.' }), {
      status: 429,
      headers: corsHeaders(origin),
    });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key nicht konfiguriert' }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Ungültiges JSON' }), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const { messages } = body;

  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'Ungültige Anfrage' }), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }
  if (messages.length > MAX_MESSAGES) {
    return new Response(JSON.stringify({ error: 'Zu viele Nachrichten' }), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string' && msg.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(JSON.stringify({ error: 'Nachricht zu lang' }), {
        status: 400,
        headers: corsHeaders(origin),
      });
    }
  }

  // Wissensdatenbank laden – direkt aus GitHub, immer aktuell
  let wissen = {};
  try {
    const wissenUrl = 'https://raw.githubusercontent.com/fresus90/seelenbalsam-muenchen/main/_data/wissensdatenbank.json';
    const wissenRes = await fetch(wissenUrl, { cf: { cacheTtl: 300 } });
    if (wissenRes.ok) wissen = await wissenRes.json();
  } catch (e) {
    console.error('Wissensdatenbank Fehler:', e.message);
    try {
      const wissenRaw = env.WISSENSDATENBANK;
      if (wissenRaw) wissen = JSON.parse(wissenRaw);
    } catch(e2) {}
  }

  const ta = wissen.tamara || {};
  const k = wissen.kurs || {};
  const termine = wissen.termine || [];
  const kt = wissen.kontakt || {};

  const termineText = termine.length
    ? termine.map(t =>
        `- ${t.bezeichnung}: ${t.wochentag} ${t.uhrzeit}, ${t.startdatum}, ${t.ort_name} (${t.ort_adresse}), ${t.preis}`
      ).join('\n')
    : '- Donnerstags 16:00-16:45 Uhr, ab 08. Mai 2025, Bewegungsraum Villa Verte, Hans-Mielich-Str. 8 81543 Muenchen, 150 Euro';

  const SYSTEM_PROMPT = `Du bist ${ta.name || 'Tamara Moehlwald'}, ${ta.beruf || 'Kinderpaedagogin'} aus ${ta.standort || 'Muenchen'} und Gruenderin von Seelenbalsam.

Beantworte Fragen von Eltern warm, persoenlich, auf Deutsch, duze sie. Max 2-4 Saetze. Gelegentlich Emojis. Nie "Als KI".

Kurs:
- Zielgruppe: ${k.zielgruppe || 'Kinder ab 2 bis ca. 8 Jahre'}
- Philosophie: ${k.philosophie || 'Ganzheitliche Bewegung, Achtsamkeit, Selbstvertrauen'}
- Leitsatz: ${k.leitsatz || 'Ich bin genau richtig, so wie ich bin.'}
- Dauer: ${k.kursdauer || '8 Wochen, 1x pro Woche, 45 Minuten'}
- Gruppe: ${k.max_kinder || 'max. 10 Kinder'}
- Vorkenntnisse: ${k.vorkenntnisse || 'keine noetig'}

Termine:
${termineText}

Mitbringen: ${wissen.mitbringen || 'Wasserflasche und Stoppersocken'}
Anmeldung: ${wissen.anmeldung_info || 'jederzeit moeglich, per WhatsApp oder Website-Formular'}

Kontakt: ${kt.telefon || '+49 157 52129991'} (WhatsApp), ${kt.email || 'seelenbalsam.muenchen@gmail.com'}

Wenn du etwas nicht weisst: freundlich sagen und WhatsApp empfehlen. Nichts erfinden.`;

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
      console.error('Anthropic Fehler:', data);
      return new Response(JSON.stringify({ error: 'API Fehler' }), {
        status: response.status,
        headers: corsHeaders(origin),
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
      },
    });

  } catch (error) {
    console.error('Serverfehler:', error);
    return new Response(JSON.stringify({ error: 'Serverfehler' }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get('Origin')),
  });
}
