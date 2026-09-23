# Admin-Panel einrichten (Login ohne GitHub-Account)

Ziel: Tamara und weitere Personen pflegen die Website unter
`https://seelenbalsam-muenchen.de/admin` – **ohne** GitHub-Account.
Die Anmeldung läuft über Cloudflare Access mit E-Mail-Einmalcode.

Die Schritte 1–4 musst du einmalig selbst ausführen. Der Code dafür ist
bereits im Projekt (`/_worker.js`, `admin/config.yml`).

---

## Wie es funktioniert

1. `/admin` ist per Cloudflare Access geschützt. Wer die Seite aufruft,
   bekommt einen Einmalcode an die hinterlegte E-Mail-Adresse.
2. Nach dem Login setzt Cloudflare ein Cookie (`CF_Authorization`).
3. Das Admin-Panel spricht nicht direkt mit GitHub, sondern mit
   `/cms-api/github/*` auf dieser Domain. Der Worker prüft dort bei
   **jeder** Anfrage die Signatur des Cookies und hängt erst dann den
   GitHub-Token an.
4. Der GitHub-Token liegt ausschließlich als Secret im Worker. Er wird
   nie an den Browser ausgeliefert.

Gespeicherte Änderungen landen direkt auf `main`; Cloudflare Pages
deployt automatisch. Nach ein bis zwei Minuten sind sie live.

---

## Schritt 1 – GitHub-Token erstellen

1. GitHub → Klick auf dein Profilbild → **Settings**
2. Ganz unten links: **Developer settings**
3. **Personal access tokens → Fine-grained tokens → Generate new token**
4. Ausfüllen:
   - **Token name:** `seelenbalsam-cms`
   - **Expiration:** 1 Jahr (Kalendereintrag zur Erneuerung anlegen!)
   - **Repository access:** *Only select repositories* →
     `fresus90/seelenbalsam-muenchen`
   - **Permissions → Repository permissions → Contents:** `Read and write`
     (alles andere auf *No access* lassen)
5. **Generate token** und den Wert kopieren – er wird nur einmal angezeigt.

> Der Token darf bewusst nur dieses eine Repository beschreiben. Selbst
> wenn etwas schiefgeht, ist der Schaden darauf begrenzt.

---

## Schritt 2 – Cloudflare Access einrichten

Im Cloudflare-Dashboard → **Zero Trust** (kostenlos bis 50 Personen).

**a) Anmeldemethode aktivieren**
- **Settings → Authentication → Login methods**
- **One-time PIN** hinzufügen, falls noch nicht vorhanden.

**b) Anwendung anlegen**
- **Access → Applications → Add an application → Self-hosted**
- **Application name:** `Seelenbalsam Admin`
- **Session Duration:** z. B. `24 hours`
- **Public hostname:**
  - Subdomain: *(leer)*
  - Domain: `seelenbalsam-muenchen.de`
  - **Path: `admin`**

> ⚠️ Trage **nur** `admin` als Pfad ein. Schütze `/cms-api` **nicht**
> zusätzlich über Access – diese Aufrufe kommen vom JavaScript des
> Admin-Panels und würden sonst auf die Login-Seite umgeleitet statt eine
> saubere Fehlermeldung zu bekommen. Der Worker prüft `/cms-api` selbst.

**c) Zugriffsregel**
- **Policy name:** `Redaktion`
- **Action:** `Allow`
- **Include → Emails** → alle Adressen eintragen, die editieren dürfen
  (z. B. Tamaras Adresse und deine).

**d) AUD-Tag notieren**
- Anwendung speichern, dann erneut öffnen → Reiter **Overview**
- **Application Audience (AUD) Tag** kopieren (lange Hex-Zeichenkette).

**e) Team-Domain notieren**
- **Settings → Custom Pages** (oder oben in der URL) zeigt deine
  Team-Domain, z. B. `seelenbalsam.cloudflareaccess.com`.
  **Ohne** `https://` notieren.

---

## Schritt 3 – Variablen im Pages-Projekt setzen

Cloudflare-Dashboard → **Workers & Pages** → Projekt
`seelenbalsam-muenchen` → **Settings → Variables and Secrets** →
Umgebung **Production**:

| Name                    | Typ    | Wert                                        |
|-------------------------|--------|---------------------------------------------|
| `GITHUB_TOKEN`          | Secret | Token aus Schritt 1                         |
| `CF_ACCESS_TEAM_DOMAIN` | Text   | z. B. `seelenbalsam.cloudflareaccess.com`   |
| `CF_ACCESS_AUD`         | Text   | AUD-Tag aus Schritt 2d                      |

`GITHUB_TOKEN` unbedingt als **Secret** (verschlüsselt) anlegen, nicht als
einfachen Text. `ANTHROPIC_API_KEY` für den Chat-Bot bleibt unverändert.

---

## Schritt 4 – Neu deployen und testen

Variablen greifen erst nach einem neuen Deployment:
**Deployments → letztes Deployment → Retry deployment**.

Dann testen:

1. `https://seelenbalsam-muenchen.de/admin` aufrufen
   → Cloudflare fragt nach der E-Mail-Adresse, schickt einen Code.
2. Nach dem Login öffnet sich kurz ein Fenster „Angemeldet als …“
   und schließt sich wieder.
3. Das Admin-Panel zeigt links die Bereiche (Kurs & Termine, Über Tamara,
   FAQ, Rezensionen …).
4. Probe: unter **Kurs & Termine** etwas ändern → **Publish**.
   Nach ein bis zwei Minuten steht die Änderung auf der Website.
5. Mit einer **nicht** freigegebenen E-Mail-Adresse testen – der Login
   muss abgelehnt werden.

---

## Personen hinzufügen oder entfernen

Zero Trust → **Access → Applications → Seelenbalsam Admin → Policies →
Redaktion** → E-Mail-Adresse ergänzen oder streichen. Wirkt sofort, ohne
Deployment. Wer entfernt wird, kommt nach Ablauf der Session nicht mehr
hinein.

Unter **Access → Logs** siehst du, wer sich wann angemeldet hat.

---

## Was zu beachten ist

- **Alle Änderungen werden unter einem GitHub-Konto committet** (dem
  Besitzer des Tokens). Im Git-Verlauf steht also nicht, *welche*
  Redakteurin editiert hat. Wer wann angemeldet war, steht in den
  Access-Logs.
- **Wer durch Access kommt, darf alle Inhalte dieses Repositories
  ändern.** Es gibt keine feineren Rollen. Entsprechend sparsam
  freigeben.
- **Token-Ablauf:** Läuft der Token aus, meldet das Admin-Panel
  Speicherfehler. Dann Schritt 1 wiederholen und `GITHUB_TOKEN` in
  Cloudflare aktualisieren.
- **Session abgelaufen:** Erscheinen beim Speichern plötzlich
  401-Fehler, reicht ein Neuladen von `/admin`.
- **Abmelden:** Button unten rechts im Admin-Panel. Er beendet auch die
  Cloudflare-Access-Sitzung – wichtig auf fremden oder geteilten Geräten.

---

## Wenn etwas nicht funktioniert

| Symptom | Ursache und Lösung |
|---|---|
| „Cloudflare Access ist nicht konfiguriert“ | `CF_ACCESS_TEAM_DOMAIN` oder `CF_ACCESS_AUD` fehlt. Schritt 3, danach neu deployen. |
| „GITHUB_TOKEN ist im Worker nicht hinterlegt“ | Secret fehlt oder das Deployment ist älter als die Variable. Retry deployment. |
| „Das Access-Token gehört zu einer anderen Anwendung“ | Falscher AUD-Tag. Schritt 2d prüfen. |
| „Das Access-Token stammt von einer anderen Organisation“ | Falsche Team-Domain – ohne `https://` und ohne Schrägstrich eintragen. |
| Login-Fenster bleibt offen und tut nichts | Popup-Blocker. Popups für die Domain erlauben. |
| Das Panel lädt, zeigt aber keine Bereiche | `admin/config.yml` ist nicht erreichbar oder fehlerhaft. Browser-Konsole prüfen. |
