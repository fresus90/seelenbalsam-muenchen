const fs = require('fs');
const path = require('path');

exports.handler = async function (event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key nicht konfiguriert' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiges JSON' }) };
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages) || messages.length > 20) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Anfrage' }) };
  }

  // Wissensdatenbank laden
  let wissen = {};
  try {
    const wissenPath = path.join(__dirname, '../../_data/wissensdatenbank.json');
    wissen = JSON.parse(fs.readFileSync(wissenPath, 'utf8'));
  } catch (e) {
    console.error('Wissensdatenbank nicht geladen:', e.message);
  }

  // System-Prompt dynamisch aus Wissensdatenbank aufbauen
  const ta = wissen.tamara || {};
  const k = wissen.kurs || {};
  const termine = wissen.termine || [];
  const kt = wissen.kontakt || {};

  const termineText = termine.map(t =>
    `- ${t.bezeichnung}: ${t.wochentag} ${t.uhrzeit}, ${t.startdatum}, ${t.ort_name} (${t.ort_adresse}), ${t.preis}, Anmeldung: ${t.anmeldung}`
  ).join('\n') || 'Keine aktuellen Termine hinterlegt.';

  const SYSTEM_PROMPT = `Du bist ${ta.name || 'Tamara'}, ${ta.beruf || 'Kinderpaedagogin'} aus ${ta.standort || 'Muenchen'} und Gruenderin von "Seelenbalsam - Ganzheitliche Bewegung fuer Kinder".

Du beantwortest Fragen von Eltern auf der Seelenbalsam-Website warm, persoenlich und einfluehlsam auf Deutsch. Duze die Eltern. Halte Antworten kurz (2-4 Saetze). Nutze gelegentlich passende Emojis. Beginne nie mit "Als KI" - du bist ${ta.name || 'Tamara'}.

Ueber mich:
${ta.beschreibung || ''}

Ueber den Kurs:
- Zielgruppe: ${k.zielgruppe || ''}
- Philosophie: ${k.philosophie || ''}
- Leitsatz: "${k.leitsatz || ''}"
- Inhalte: ${k.inhalte || ''}
- Kursdauer: ${k.kursdauer || ''}
- Gruppengroesse: ${k.max_kinder || ''}
- Vorkenntnisse: ${k.vorkenntnisse || ''}

Aktuelle Termine:
${termineText}

Mitbringen:
${wissen.mitbringen || ''}

Anmeldung:
${wissen.anmeldung_info || ''}

Kontakt:
- Telefon/WhatsApp: ${kt.telefon || ''}
- E-Mail: ${kt.email || ''}
- Hinweis: ${kt.hinweis || ''}

${wissen.zusatz_infos ? 'Weitere Infos:\n' + wissen.zusatz_infos : ''}

Zitat: "${ta.zitat || ''}"

Wenn du etwas nicht weisst, sag das freundlich und empfehle eine direkte Kontaktaufnahme per WhatsApp. Erfinde keine Informationen.`;

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
      console.error('Anthropic API Fehler:', data);
      return { statusCode: response.status, body: JSON.stringify({ error: 'API Fehler' }) };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://seelenbalsam-muenchen.de',
      },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Serverfehler:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Serverfehler' }) };
  }
};
