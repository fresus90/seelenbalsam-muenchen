# Seelenbalsam – Website

Website für den Kinderbewegungskurs Seelenbalsam von Tamara Möhwald in München.

## Technik-Stack

- Statische HTML/CSS/JS Website
- Hosting: Netlify (kostenlos)
- CMS: Decap CMS – Admin-Panel unter `/admin`
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
├── _data/              # Alle editierbaren Inhalte
│   ├── kurs.json       # Kurstermin, Ort, Preis, Ziele
│   ├── ueber.json      # Über Tamara, Foto
│   ├── bilder.json     # Hero-Bild, Galerie
│   ├── faq.json        # FAQ-Einträge
│   ├── kontakt.json    # Telefon, E-Mail, Instagram
│   ├── impressum.json  # Impressum-Pflichtangaben
│   └── datenschutz.json
└── images/             # Bilder (Uploads via CMS)
```

## Kontakt

Tamara Möhwald – seelenbalsam.muenchen@gmail.com
