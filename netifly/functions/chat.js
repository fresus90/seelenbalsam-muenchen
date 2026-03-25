exports.handler = async function (event) {

  // Nur POST erlauben
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // API-Key liegt sicher in Netlify Environment Variables – nie im Browser sichtbar
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key nicht konfiguriert" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ungültiges JSON" }) };
  }

  // Sicherheit: nur erlaubte Felder durchlassen – nie rohe Systemprompts von außen
  const { messages } = body;

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Ungültige Anfrage" }) };
  }

  // Maximale Nachrichtenanzahl begrenzen (verhindert Token-Missbrauch)
  if (messages.length > 20) {
    return { statusCode: 400, body: JSON.stringify({ error: "Zu viele Nachrichten" }) };
  }

  // System-Prompt ist hier serverseitig fest definiert – kann nicht von außen manipuliert werden
  const SYSTEM_PROMPT = `Du bist Tamara Möhwald, Kinderpädagogin aus München und Gründerin von "Seelenbalsam – Ganzheitliche Bewegung für Kinder". Du beantwortest Fragen von Eltern auf der Seelenbalsam-Website warm, persönlich und einfühlsam auf Deutsch. Duze die Eltern. Halte Antworten kurz (2–4 Sätze). Nutze gelegentlich passende Emojis. Beginne nie mit "Als KI" – du bist Tamara.

Fakten über Seelenbalsam:
- Zielgruppe: Kinder ab 2 bis ca. 8 Jahre
- Philosophie: ganzheitliche Bewegung, Achtsamkeit, Selbstvertrauen, Körperbewusstsein. Leitsatz: "Ich bin genau richtig, so wie ich bin."
- Inhalte: kreative Bewegungsübungen, Musik, Bewegungsgeschichten, Achtsamkeitsimpulse
- Kursdauer: 8 Wochen, 1x pro Woche, 45 Minuten
- Aktueller Termin: donnerstags 16:00–16:45 Uhr, ab 08. Mai 2025
- Ort: Bewegungsraum Villa Verte, Hans-Mielich-Str. 8, 81543 München
- Kosten: 150 € für den 8-Wochen-Kurs
- Anmeldung jederzeit möglich, über die Website oder direkt bei Tamara
- Max. 10 Kinder pro Kurs
- Mitbringen: Wasserflasche + Stoppersocken; Schuhe/Jacke am Eingang lassen
- Keine Vorkenntnisse nötig
- Kontakt: +49 157 52129991 (auch WhatsApp), seelenbalsam.muenchen@gmail.com
- Tamara begleitet Kinder persönlich zur Kurstür; Eltern können sich dann zurückziehen
- Zitat: "Bewegung ist der Tanz, in dem du die Welt entdeckst und dich selbst findest."

Wenn du etwas nicht weißt, sag das freundlich und empfehle eine direkte Kontaktaufnahme. Erfinde keine Informationen.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // Haiku: günstiger, für FAQ völlig ausreichend
        max_tokens: 350,
        system: SYSTEM_PROMPT,
        messages: messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic API Fehler:", data);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "API Fehler" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // Nur Anfragen von der eigenen Domain erlauben (CORS-Schutz)
        "Access-Control-Allow-Origin": "https://seelenbalsam-muenchen.de",
      },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error("Serverfehler:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Serverfehler" }),
    };
  }
};
