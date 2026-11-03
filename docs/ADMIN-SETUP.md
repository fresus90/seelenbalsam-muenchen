# Admin-Panel einrichten (Login mit Benutzername und Passwort)

Ziel: Tamara und weitere Personen pflegen die Website unter
`https://seelenbalsam-muenchen.de/admin` – mit Benutzername und Passwort,
**ohne** GitHub-Account.

Die Schritte 1–4 musst du einmalig selbst ausführen. Der Code dafür ist
bereits im Projekt (`/_worker.js`, `admin/config.yml`).

---

## Wie es funktioniert

1. `/admin` lädt das Admin-Panel. Ein Klick auf **Anmelden** öffnet ein
   kleines Fenster mit dem Anmeldeformular.
2. Stimmen Benutzername und Passwort, setzt der Worker ein signiertes
   Sitzungscookie (12 Stunden gültig, für JavaScript nicht lesbar).
3. Das Panel spricht nicht direkt mit GitHub, sondern mit
   `/cms-api/github/*`. Der Worker prüft dort bei **jeder** Anfrage die
   Signatur des Cookies und hängt erst dann den GitHub-Token an.
4. Der GitHub-Token liegt ausschließlich als Secret im Worker. Er wird
   nie an den Browser ausgeliefert.

Gespeicherte Änderungen landen direkt auf `main`; Cloudflare Pages
deployt automatisch. Nach ein bis zwei Minuten sind sie live.

---

## Schritt 1 – GitHub-Token erstellen

1. GitHub → Profilbild → **Settings**
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

## Schritt 2 – Zugangsdaten erzeugen

Du brauchst pro Person einen Benutzernamen und ein Passwort. Gespeichert
wird nie das Passwort selbst, sondern nur ein Hash daraus.

### Variante A – im Browser (nichts zu installieren)

Öffne die Seite **`admin/passwort.html`**:

- **Nach dem nächsten Deployment online:**
  `https://seelenbalsam-muenchen.de/admin/passwort.html`
- **Oder ohne Internet:** die Datei `admin/passwort.html` aus dem
  Repository herunterladen und doppelklicken.

Dann für jede Person:

1. Benutzernamen eingeben (z. B. `tamara`).
2. Passwort eingeben – oder das Feld leer lassen bzw. auf **Würfeln**
   klicken, dann wird ein sicheres erzeugt.
3. Auf **Hinzufügen** klicken.

Unten erscheinen die Passwörter im Klartext (**jetzt notieren und an die
Person weitergeben – danach sind sie weg**) und darunter der fertige
Text für Cloudflare. Mit **Kopieren** in die Zwischenablage.

> Die Seite rechnet alles im Browser. Passwörter und Hashes werden
> nirgendwohin geschickt und nirgends gespeichert.

### Variante B – im Terminal (wenn Node.js installiert ist)

Im Projektordner, einmal pro Person:

```
node scripts/cms-passwort.mjs tamara
```

Das Skript würfelt ein Passwort, zeigt es an und gibt eine Zeile wie
diese aus:

```
tamara:pbkdf2$210000$70tRLyZ3fCmghx3kIe_OcA$gY_piY_yjEZ0LB9wceTtAt1nqBHor9aj1oeSHQbuz_o
```

Ein eigenes Passwort vergeben geht auch:

```
node scripts/cms-passwort.mjs tamara "mein sicheres Passwort"
```

Für mehrere Personen mehrfach aufrufen und die Zeilen untereinander
sammeln.

### Das Ergebnis

In beiden Fällen bekommst du einen Block wie diesen – eine Zeile pro
Person. Genau der kommt in Schritt 3 nach Cloudflare:

```
tamara:pbkdf2$210000$70tRLyZ3fCmghx3kIe_OcA$gY_piY_yjEZ0LB9wceTtAt1n...
tim:pbkdf2$210000$Qd8xK2pLm4RtYvBnHjKl9A$Tz3mXpQ7rNvEwYsKdFgHjLpOi...
```

**Passwort vergessen?** Kein Problem – einfach eine neue Zeile für die
Person erzeugen und die alte ersetzen. Zurückrechnen lässt sich ein Hash
nicht.

---

## Schritt 3 – Variablen im Pages-Projekt setzen

Cloudflare-Dashboard → **Workers & Pages** → Projekt
`seelenbalsam-muenchen` → **Settings → Variables and Secrets** →
Umgebung **Production**:

| Name           | Typ    | Wert                                      |
|----------------|--------|-------------------------------------------|
| `GITHUB_TOKEN` | Secret | Token aus Schritt 1                       |
| `CMS_USERS`    | Secret | Die Zeilen aus Schritt 2, untereinander   |

Beide unbedingt als **Secret** (verschlüsselt) anlegen, nicht als
einfachen Text. `ANTHROPIC_API_KEY` für den Chat-Bot bleibt unverändert.

Optional: `CMS_SESSION_SECRET` (Secret, beliebige lange Zufallszeichen)
zum Signieren der Sitzungen. Fehlt die Variable, wird dafür der
`GITHUB_TOKEN` verwendet – dann meldet ein Tausch des Tokens alle ab.

---

## Schritt 4 – Neu deployen und testen

Variablen greifen erst nach einem neuen Deployment:
**Deployments → letztes Deployment → Retry deployment**.

Dann testen:

1. `https://seelenbalsam-muenchen.de/admin` aufrufen → **Anmelden** klicken.
2. Im Fenster Benutzername und Passwort eingeben.
3. Das Fenster schließt sich, das Panel zeigt links die Bereiche
   (Kurs & Termine, Über Tamara, FAQ, Rezensionen …).
4. Probe: unter **Kurs & Termine** etwas ändern → **Publish**.
   Nach ein bis zwei Minuten steht die Änderung auf der Website.
5. Mit einem falschen Passwort testen – die Anmeldung muss scheitern.

> **Falls du früher eine Cloudflare-Access-Anwendung für `/admin`
> angelegt hast:** Die bitte löschen (Zero Trust → Access → Applications),
> sonst wirst du vor dem Panel zusätzlich nach einem E-Mail-Code gefragt.
> Access wird für den Passwort-Login nicht mehr gebraucht. Die Variablen
> `CF_ACCESS_TEAM_DOMAIN` und `CF_ACCESS_AUD` kannst du löschen.

---

## Personen hinzufügen oder entfernen

Schritt 2 für die neue Person ausführen, die Zeile zu `CMS_USERS`
hinzufügen (oder die alte Zeile löschen), speichern und neu deployen.

Wer entfernt wird, ist **sofort** draußen – auch mit noch gültigem
Cookie, denn der Worker prüft bei jeder Anfrage, ob der Benutzername noch
in `CMS_USERS` steht.

**Passwort ändern:** Schritt 2 für dieselbe Person erneut ausführen und
die Zeile ersetzen.

---

## Was zu beachten ist

- **Alle Änderungen werden unter einem GitHub-Konto committet** (dem
  Besitzer des Tokens). Im Git-Verlauf steht also nicht, *welche*
  Redakteurin editiert hat.
- **Wer sich anmelden kann, darf alle Inhalte dieses Repositories
  ändern.** Es gibt keine feineren Rollen. Entsprechend sparsam
  Zugänge vergeben.
- **Passwörter nicht per unverschlüsseltem Kanal weitergeben.**
- **Nach 10 Fehlversuchen** ist die Anmeldung von dieser Internet-Adresse
  aus 15 Minuten gesperrt.
- **Sitzung läuft nach 12 Stunden ab**; dann einfach neu anmelden.
- **Token-Ablauf:** Läuft der GitHub-Token aus, meldet das Panel
  Speicherfehler. Dann Schritt 1 wiederholen und `GITHUB_TOKEN`
  aktualisieren.
- **Abmelden:** Button unten rechts im Admin-Panel. Wichtig auf fremden
  oder geteilten Geräten.

---

## Wenn etwas nicht funktioniert

| Symptom | Ursache und Lösung |
|---|---|
| „Es sind noch keine Zugangsdaten hinterlegt“ | `CMS_USERS` fehlt oder ist leer. Schritt 3, danach neu deployen. |
| „Der Server ist noch nicht fertig eingerichtet: GITHUB_TOKEN fehlt“ | Secret fehlt oder das Deployment ist älter als die Variable. Retry deployment. |
| „Benutzername oder Passwort stimmt nicht“ trotz richtiger Eingabe | Beim Kopieren der Zeile nach Cloudflare ist etwas verrutscht (Leerzeichen, Zeilenumbruch mitten im Hash). Schritt 2 wiederholen und sauber einfügen. |
| „Zu viele Fehlversuche“ | 15 Minuten warten oder von einem anderen Anschluss probieren. |
| Es wird zusätzlich ein E-Mail-Code verlangt | Es existiert noch eine alte Cloudflare-Access-Anwendung für `/admin`. Löschen, siehe Hinweis bei Schritt 4. |
| Das Anmeldefenster öffnet sich nicht | Popup-Blocker. Popups für die Domain erlauben. |
| Das Panel lädt, zeigt aber keine Bereiche | `admin/config.yml` ist nicht erreichbar oder fehlerhaft. Browser-Konsole prüfen. |
| Beim Speichern plötzlich 401 | Sitzung abgelaufen. `/admin` neu laden und erneut anmelden. |
