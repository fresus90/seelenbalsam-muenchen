# Seelenbalsam – Website

Website für den Kinderbewegungskurs Seelenbalsam von Tamara Möhwald in München.

## Technik-Stack

- Statische HTML/CSS/JS Website
- Hosting: Cloudflare Pages
- CMS: Decap CMS – Admin-Panel unter `/admin`
- Chat-Bot: Cloudflare Pages Function mit Anthropic Claude API
- Domain: seelenbalsam-muenchen.de

## Inhalte bearbeiten

Inhalte (Texte, Bilder, FAQ, Impressum, Datenschutz) werden über das
Admin-Panel unter `/admin` gepflegt und liegen als JSON-Dateien im Ordner `/_data`.

## Projektstruktur

```
/
├── index.html          # Haupt-Website
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
│   ├── kontakt.json    # Telefon, E-Mail, Instagram
│   ├── impressum.json  # Impressum-Pflichtangaben
│   ├── datenschutz.json
│   └── wissensdatenbank.json  # Wissen für den Chat-Bot
└── images/             # Bilder (Uploads via CMS)
```

## Cloudflare Pages Setup

1. Repository mit Cloudflare Pages verbinden
2. Build-Einstellungen: kein Build-Command nötig (statische Seite)
3. Environment Variable setzen: `ANTHROPIC_API_KEY`
4. Custom Domain `seelenbalsam-muenchen.de` konfigurieren

## Chat-Bot

Der FAQ-Chat nutzt eine Cloudflare Pages Function (`/functions/chat.js`),
die Anfragen an die Anthropic Claude API weiterleitet. Der API-Key wird
als Environment Variable in Cloudflare gespeichert und ist nie im Browser sichtbar.

Die Wissensdatenbank für den Bot wird aus `/_data/wissensdatenbank.json` geladen
und kann über das Admin-Panel gepflegt werden.

## Kontakt

Tamara Möhwald – seelenbalsam.muenchen@gmail.com
