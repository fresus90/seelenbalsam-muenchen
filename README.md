# Seelenbalsam – Website

Website für den Kinderbewegungskurs Seelenbalsam von Tamara Möhwald in München.

## Technik-Stack

- Statische HTML/CSS/JS Website
- Hosting: Cloudflare Pages
- CMS: Decap CMS – Admin-Panel unter `/admin`
- Chat-Bot: Cloudflare Pages Function mit Anthropic Claude API
- Domain: seelenbalsam-muenchen.de

## Inhalte bearbeiten

Inhalte (Texte, Bilder, FAQ, Rezensionen, Impressum, Datenschutz) werden über das
Admin-Panel unter `/admin` gepflegt und liegen als JSON-Dateien im Ordner `/_data`.

Die Anmeldung läuft mit **Benutzername und Passwort** – ein GitHub-Account ist
dafür nicht nötig. Der Worker unter `/cms-api/*` prüft bei jeder Anfrage die
signierte Sitzung und spricht stellvertretend mit der GitHub-API; der
GitHub-Token bleibt serverseitig. Zugangsdaten erzeugt man unter
`/admin/passwort.html` (läuft komplett im Browser) oder mit
`node scripts/cms-passwort.mjs <name>`. Einrichtung und Fehlersuche:
[`docs/ADMIN-SETUP.md`](docs/ADMIN-SETUP.md).

## Projektstruktur

```
/
├── index.html          # Haupt-Website (Onepager)
├── impressum.html      # Impressum – eigene Seite unter /impressum
├── datenschutz.html    # Datenschutzerklärung – eigene Seite unter /datenschutz
├── legal.css           # Styling der beiden Rechtstexte-Seiten
├── _worker.js          # Cloudflare Pages Worker (aktiv: /chat und /cms-api/*)
├── docs/
│   └── ADMIN-SETUP.md  # Einrichtung des Admin-Logins
├── scripts/
│   └── cms-passwort.mjs # Erzeugt Zugangsdaten für CMS_USERS
├── README.md           # Diese Datei
├── admin/
│   ├── index.html      # Decap CMS Admin-Panel
│   └── config.yml      # CMS Feldkonfiguration
├── functions/
│   └── chat.js         # Cloudflare Pages Function (Chat-Bot API)
├── _data/              # Alle editierbaren Inhalte
│   ├── kurs.json       # Kurstermin, Ort, Preis, Ziele
│   ├── ueber.json      # Über Tamara, Foto
│   ├── bilder.json     # Hero-Bild, Galerie, Favicon
│   ├── faq.json        # FAQ-Einträge
│   ├── rezensionen.json # Rezensionen von Eltern + Link zum Bewerten
│   ├── kontakt.json    # Telefon, E-Mail, Instagram
│   ├── impressum.json  # Impressum-Pflichtangaben
│   ├── datenschutz.json
│   └── wissensdatenbank.json  # Wissen für den Chat-Bot
└── images/             # Bilder (Uploads via CMS)
```

## Cloudflare Pages Setup

1. Repository mit Cloudflare Pages verbinden
2. Build-Einstellungen: kein Build-Command nötig (statische Seite)
3. Environment Variables setzen (Production):
   - `ANTHROPIC_API_KEY` – für den Chat-Bot
   - `GITHUB_TOKEN`, `CMS_USERS` – für das Admin-Panel, siehe
     `docs/ADMIN-SETUP.md`
4. Custom Domain `seelenbalsam-muenchen.de` konfigurieren

## Chat-Bot

Der FAQ-Chat wird von `/_worker.js` beantwortet (Cloudflare Pages Advanced Mode),
das Anfragen an die Anthropic Claude API weiterleitet.

> **Achtung:** Solange `_worker.js` im Projekt-Root liegt, ignoriert Cloudflare Pages
> den Ordner `/functions` komplett. `functions/chat.js` ist damit **inaktiv** und nur
> als Fallback vorhanden – Änderungen dort haben keine Wirkung. Beide Dateien werden
> bewusst synchron gehalten; wer den System-Prompt ändert, muss beide anfassen. Der API-Key wird
als Environment Variable in Cloudflare gespeichert und ist nie im Browser sichtbar.

Die Wissensdatenbank für den Bot wird aus `/_data/wissensdatenbank.json` geladen
und kann über das Admin-Panel gepflegt werden.

## Rechtstexte

Impressum und Datenschutzerklärung sind **eigene Seiten** (`/impressum`, `/datenschutz`)
und funktionieren auch ohne JavaScript – Pflichtangaben müssen dauerhaft und direkt
verlinkbar erreichbar sein. Die Inhalte kommen weiterhin aus
`_data/impressum.json` und `_data/datenschutz.json`.

## Offene Punkte

- **Kursdatum:** `_data/kurs.json` und `_data/wissensdatenbank.json` nennen weiterhin
  »ab 08. Mai 2025«. Das sollte auf den nächsten tatsächlichen Kursstart aktualisiert werden.
- **Admin-Login:** Der Code steht, aber die einmalige Einrichtung in Cloudflare und
  GitHub fehlt noch – siehe `docs/ADMIN-SETUP.md`. Solange `GITHUB_TOKEN` und
  `CMS_USERS` nicht gesetzt sind, meldet `/admin` einen Konfigurationsfehler.

## Kontakt

Tamara Möhwald – seelenbalsam.muenchen@gmail.com
