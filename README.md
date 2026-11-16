# Empfangs-Kiosk (iPad) für Einlegesohlen & Fotostudio

Kostenlose Kiosk-Web-App für ein iPad am Eingang (1. Stock). Interessierte wählen Sprache und Dienst, geben ihren Nachnamen und die Personenzahl ein und fragen **jetzt** an oder buchen einen **freien Termin für heute**. Das Team bekommt eine japanische Nachricht in Google Chat. Gebuchte Termine landen im Google-Kalender des jeweiligen Raums.

- **Frontend:** statische Dateien auf GitHub Pages (Vanilla JS, kein Build-Schritt)
- **Backend:** Google Apps Script als Web-App, liest und schreibt die Raumkalender und meldet sich per Webhook in Google Chat
- **Kosten:** 0 €, kein eigener Server, kein Mac, kein Apple-Developer-Account
- **Sprachen:** 日本語, English, 한국어, Deutsch
- **Dienste:** 👟 Einlegesohlen, 📸 Fotostudio (weitere über `config.js`)

## Ablauf

1. **Sprache** wählen
2. **Dienst** wählen (wird übersprungen, wenn nur ein Dienst aktiv ist)
3. **Nachname + Personenzahl**, dann
   - **„Jetzt anfragen“**: nur Chat-Nachricht, kein Kalendereintrag. Das Team entscheidet vor Ort.
   - **„Für später anfragen“**: Die freien Zeiten von heute erscheinen (aus dem Kalender berechnet). Wer die Personenzahl ändert, bekommt die Slots neu geladen. Ein Tipp auf eine Zeit bucht sie.
   - Erlaubt ein Dienst nur „später“, gibt es keinen „Jetzt“-Button, und die Zeiten erscheinen sofort.
4. **Bestätigung**, nach 10 s zurück zum Start. Nach 45 s Inaktivität geht es ebenfalls zurück zum Start, und alles wird gelöscht.

## Projektstruktur

```
index.html             Eine Seite mit vier Screens (Sprache, Dienst, Anfrage/Slots, Bestätigung)
style.css              Layout für Hoch- und Querformat
config.js              ⚙️ Konfiguration – auch als „Config.gs“ im Apps-Script-Projekt!
logic.js               Slot-Berechnung, Prüfungen, Texte – auch als „Logic.gs“ im Apps-Script-Projekt!
i18n.js                Alle UI-Texte (ja/en/ko/de)
app.js                 UI-Steuerung: Screens, Timer, Sendesperre, API-Zugriff, Dry-Run
manifest.webmanifest   Für „Zum Home-Bildschirm“
icons/                 App-Icons
apps-script/Code.gs          Backend (Chat-Texte als Konstanten ganz oben)
apps-script/appsscript.json  Zeitzone Asia/Tokyo, Berechtigungen
tests/run-tests.js     Tests für Slot-Berechnung, Prüfungen und Backend
```

**Wichtig:** `config.js` und `logic.js` werden **von Frontend und Backend gemeinsam** genutzt. So gibt es Dienste, Öffnungszeiten, Dauern und die Slot-Berechnung nur einmal, und das Backend verlässt sich nie auf Werte aus dem Browser. Wer eine der beiden Dateien ändert, muss sie **auf GitHub und in Apps Script** aktualisieren und in Apps Script eine neue Version bereitstellen.

## Wie die freien Zeiten berechnet werden

- **Dauer** = `baseMinutes + extraMinutesPerPerson × (Personen − 1)`
  - Einlegesohlen: 45 / 60 / 75 / 90 / 105 Minuten für 1–5 Personen
  - Fotostudio: immer 30 Minuten (`extraMinutesPerPerson: 0`, änderbar)
- **Öffnungsblöcke** (beide Räume): 09:00–12:00 und 13:00–18:00. Kein Slot ragt in die Mittagspause oder über 18:00 hinaus.
- Pro Block: freie Intervalle = Block minus alle Termine im Raumkalender minus die Zeit bis „jetzt + 15 Minuten“.
- In jedem freien Intervall werden Slots **direkt hintereinander** gelegt. Der erste beginnt auf dem nächsten 15-Minuten-Raster (aufgerundet). Ein Slot muss komplett ins Intervall passen.
- Höchstens **8 Slots**, nur für **heute**, Zeitzone **Asia/Tokyo**.

Beispiel (Einlegesohlen, 1 Person, 10:20 Uhr, gebucht sind 14:00–15:15):
`10:45–11:30` · `13:00–13:45` · `15:15–16:00` · `16:00–16:45` · `16:45–17:30`
(11:30 fehlt, weil der Slot sonst bis 12:15 in die Mittagspause ginge. 13:45 fehlt, weil er sonst in die Buchung um 14:00 ragen würde.)

**Ganztägige Termine** im Raumkalender sperren den ganzen Tag, z. B. „geschlossen“. Jeder andere Termin (auch „Pause“, „Wartung“) blockiert genau seine Zeit.

## So sehen die Nachrichten aus

| Fall | Google-Chat-Nachricht |
|---|---|
| Jetzt, Japanisch | 🔔 お客様がいらっしゃいました｜👟 インソール｜山田様（2名） |
| Jetzt, Deutsch | 🔔 お客様がいらっしゃいました｜📸 フォトスタジオ｜Müller様（1名）<br>🇩🇪 ドイツ語の同行が必要です |
| Jetzt, Englisch | … + 🇬🇧 英語の同行が必要です |
| Jetzt, Koreanisch | … + 🇰🇷 韓国語のお客様（対応可能） |
| Später | 🕒 ご予約｜👟 インソール｜14:00–14:45｜Müller様（1名）<br>+ ggf. Sprachzeile wie oben |

Ob eine Begleitung nötig ist, bestimmt `escortLanguages` des Dienstes (Standard `["en","de"]`). Für andere Sprachen erscheint nur eine Info-Zeile, für Japanisch keine.

**Kalendertermin** bei „Später“: Titel `Müller様（2名）DE`, Beschreibung `言語: ドイツ語（DE）` / `同行: 必要`.

Alle Texte stehen als Konstante `CHAT_TEXT` oben in `apps-script/Code.gs`. Die Kopie `chatTextPreview` in `config.js` dient nur der Dry-Run-Vorschau. Bei Änderungen beide anpassen (ein Test prüft, dass sie gleich sind).

---

## Schritt-für-Schritt-Anleitung

### a) Google-Chat-Space und Webhook einrichten

> Voraussetzung: ein **Google-Workspace-Konto** (Firma/Organisation). Private Gmail-Konten haben in Google Chat keine Webhooks. Fehlt der Menüpunkt, muss der Workspace-Admin Webhooks erlauben.

1. In Google Chat einen Space anlegen, z. B. „Empfang 1F“. Das Team hinzufügen und Benachrichtigungen einschalten (Chat-App auf dem Handy).
2. Oben auf den Space-Namen → **Apps und Integrationen** → **Webhooks** → **Webhook hinzufügen** → Name `Kiosk 1. Stock` → **Speichern**.
3. Die URL kopieren (`https://chat.googleapis.com/v1/spaces/...`) und **geheim halten**.
4. Optional: Soll ein Dienst in einen anderen Space posten, dort einen zweiten Webhook anlegen (siehe `WEBHOOK_URL_STUDIO` unten).

### b) Zwei Raumkalender anlegen und freigeben

Mit **demselben Konto**, mit dem du später das Apps Script bereitstellst:

1. <https://calendar.google.com> → links bei „Weitere Kalender“ **+** → **Neuen Kalender erstellen**
   - Name `Raum Einlegesohlen`, Zeitzone **(GMT+09:00) Japan-Zeit** → **Kalender erstellen**
   - Dasselbe für `Raum Fotostudio`
2. Für jeden Kalender: Kalender anklicken → **Einstellungen und Freigabe**
   - **Für bestimmte Personen freigeben** → Teammitglieder hinzufügen mit **„Änderungen an Terminen vornehmen“**, damit das Team Termine sehen, verschieben und löschen kann.
   - **Nicht** öffentlich freigeben (die Termine enthalten Namen).
   - Weiter unten unter **Kalender integrieren** die **Kalender-ID** kopieren (sieht aus wie `abc123…@group.calendar.google.com`).

### c) Apps Script anlegen und als Web-App bereitstellen

1. <https://script.google.com> → **Neues Projekt**, umbenennen in z. B. „Empfang-Kiosk“.
2. **Manifest sichtbar machen:** ⚙️ **Projekteinstellungen** → Haken bei **„Manifestdatei ‚appsscript.json‘ im Editor anzeigen“**.
3. **Dateien anlegen** (Editor `< >`, bei „Dateien“ auf **+ → Skript**):

   | Datei im Apps-Script-Editor | Inhalt kopieren aus |
   |---|---|
   | `Code.gs` (vorhanden, Inhalt ersetzen) | `apps-script/Code.gs` |
   | `Config.gs` (neu, Name ohne `.gs` eingeben: `Config`) | `config.js` |
   | `Logic.gs` (neu: `Logic`) | `logic.js` |
   | `appsscript.json` (Inhalt ersetzen) | `apps-script/appsscript.json` |

   Speichern (💾). Die Reihenfolge der Dateien ist egal.
4. **Script Properties:** ⚙️ **Projekteinstellungen** → **Skripteigenschaften** → hinzufügen:

   | Eigenschaft | Wert |
   |---|---|
   | `WEBHOOK_URL` | Webhook-URL aus a) |
   | `CAL_ID_INSOLE` | Kalender-ID „Raum Einlegesohlen“ |
   | `CAL_ID_STUDIO` | Kalender-ID „Raum Fotostudio“ |
   | `WEBHOOK_URL_INSOLE` / `WEBHOOK_URL_STUDIO` | *optional*, überschreibt `WEBHOOK_URL` für diesen Dienst |

5. **Testen und Berechtigungen bestätigen:** Im Editor oben im Funktions-Dropdown nacheinander ausführen:
   - `testWebhook`: Beim ersten Mal fragt Google nach Berechtigungen (**Kalender** und **externe Dienste**) → **Berechtigungen überprüfen** → Konto → ggf. „Erweitert“ → „Zu Empfang-Kiosk wechseln (unsicher)“ → **Zulassen**. Das ist normal bei eigenen Skripten. Danach erscheint 【テスト】… im Chat.
   - `testSlots`: Im **Ausführungsprotokoll** stehen die freien Slots beider Räume. Das bestätigt den Kalenderzugriff.
   - optional `testBooking`: Bucht den ersten freien Slot mit dem Namen „Test“ (echter Termin + Chat-Nachricht). Danach den Termin im Kalender wieder löschen.
6. **Bereitstellen:** **Bereitstellen** → **Neue Bereitstellung** → Typ **Web-App**
   - **Ausführen als: Ich**
   - **Zugriff: Jeder** (nicht „Jeder mit Google-Konto“)
   - **Bereitstellen** → falls erneut nach Berechtigungen gefragt wird, wie oben zulassen → **Web-App-URL** (endet auf **`/exec`**) kopieren.
7. Kontrolle im Browser:
   - `…/exec` → zeigt „OK“
   - `…/exec?action=slots&service=insole&persons=1` → JSON mit `"ok":true` und `slots`

**Spätere Änderungen** an einer der Script-Dateien: Speichern allein reicht nicht. **Bereitstellen → Bereitstellungen verwalten → ✏️ → Version: „Neue Version“ → Bereitstellen.** So bleibt die URL gleich.

### d) config.js anpassen

```js
appsScriptUrl: 'https://script.google.com/macros/s/DEINE_ID/exec',  // aus c)
dryRun: false,                                                         // Live-Betrieb
```

Weitere Einstellungen (alle kommentiert):
- **Dienste** (`services`): `active`, `icon`, `name` (4 Sprachen), `calendarProperty`, `webhookProperty`, `baseMinutes`, `extraMinutesPerPerson`, `peopleMax`, `openingBlocks`, `types` (`['now','later']`, nur `['later']` oder nur `['now']`), `escortLanguages`
- **Neuen Dienst hinzufügen:** ein weiteres Objekt ins Array, einen Kalender anlegen, dessen ID unter dem neuen `calendarProperty` in den Script Properties eintragen, `CHAT_TEXT.serviceLabel` in `Code.gs` ergänzen (sonst wird Icon + japanischer Name verwendet), dann **alle drei Script-Dateien aktualisieren und neu bereitstellen**.
- `slotStepMinutes` (15), `slotLeadMinutes` (15), `maxSlots` (8), `submitLockSeconds` (30), `inactivityTimeoutSeconds` (45), `duplicateWindowSeconds` (30)

Nach jeder Änderung: `config.js` auf GitHub **und** als `Config.gs` in Apps Script aktualisieren, dann neue Version bereitstellen.

**Lokal testen (Dry-Run)**, `dryRun: true`:

```bash
python3 -m http.server 8000
```

<http://localhost:8000> öffnen. Die Slots werden lokal mit einer Beispielbelegung (`dryRunBookings`) simuliert, Buchungen belegen die Zeit bis zum Neuladen. Nachricht und Kalendertitel stehen in der Browser-Konsole, die Nachricht zusätzlich auf dem Bestätigungsscreen. Abends gibt es keine Slots mehr. Dafür `dryRunClock: '10:20'` setzen, um eine Uhrzeit zu simulieren.

**Tests:**

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run-tests.js
```

### e) GitHub Pages aktivieren

1. Auf <https://github.com> ein **öffentliches** Repository anlegen, z. B. `empfang-kiosk`.
2. **Add file → Upload files**, alle Projektdateien inkl. der Ordner `icons`, `apps-script`, `tests` hineinziehen → **Commit changes**. Im Repo liegen keine Geheimnisse: Webhook und Kalender-IDs stehen nur in den Script Properties.
3. **Settings → Pages** → Source **Deploy from a branch** → `main` / `(root)` → **Save**.
4. Nach 1–2 Minuten: `https://DEIN-NAME.github.io/empfang-kiosk/`
5. Änderungen kommen nach etwa 1–10 Minuten an (Cache). Auf dem iPad die App neu starten oder auf das automatische Neuladen warten (`reloadAfterHours`).

### f) iPad einrichten (8. Generation, Safari)

1. **Tastaturen:** Einstellungen → Allgemein → Tastatur → Tastaturen → **Japanisch (Kana/Romaji)**, **Koreanisch**, **Deutsch**, **Englisch**. Wechsel über die 🌐-Taste.
2. **Datum & Uhrzeit:** Einstellungen → Allgemein → Datum & Uhrzeit → **Automatisch**, Zeitzone Tokio.
3. **Zum Home-Bildschirm:** In Safari die GitHub-Pages-URL öffnen → Teilen (□↑) → **Zum Home-Bildschirm**. Ab jetzt nur noch über das Icon starten (Vollbild, keine Browserleiste).
4. **Automatische Sperre:** Einstellungen → Anzeige & Helligkeit → **Automatische Sperre → Nie**.
5. **Mitteilungen aus:** Kontrollzentrum → Fokus → **Nicht stören** dauerhaft an.
6. **Geführter Zugriff:** Einstellungen → Bedienungshilfen → **Geführter Zugriff** → Ein → Code festlegen, Automatische Sperre **Nie**. Kiosk-App öffnen → **Home-Taste 3× drücken** → **Optionen**:
   - **Tastaturen: EIN** (sonst kann niemand den Namen eingeben)
   - Berühren: EIN, Ein/Aus-Taste und Lautstärke: AUS
   - **Starten**. Beenden: Home-Taste 3× drücken und Code eingeben.
7. **Dauerladung:** Originalnetzteil dauerhaft anschließen, keine direkte Sonne oder Heizung, Helligkeit etwa 50–70 %, diebstahlsichere Halterung.

### g) Termin löschen = Slot freigeben

Im Google-Kalender des Raums auf den Termin tippen → **Löschen** (🗑). Der Kiosk berechnet die Slots bei jedem Aufruf neu aus dem Kalender, also ist die Zeit sofort wieder buchbar. Ebenso kann das Team Zeiten **blockieren**, indem es selbst einen Termin anlegt (z. B. „Pause 15:00–15:30“ oder ganztägig „geschlossen“).

### h) Testablauf und typische Fehler

**Testablauf**

1. Lokal mit `dryRun: true` (und ggf. `dryRunClock`) alles durchklicken: beide Dienste, alle Sprachen, Personenzahl ändern (die Slots ändern sich), Jetzt/Später, leerer Name, Zurück, Sperre, Inaktivität.
2. In Apps Script `testSlots` ausführen und mit dem Kalender vergleichen.
3. Live: auf dem iPad je Dienst eine „Später“-Buchung → Termin erscheint im richtigen Raumkalender, Nachricht im Chat.
4. Den Termin im Kalender löschen → Slot ist auf dem iPad wieder da.
5. „Vergeben“-Test: Auf dem iPad die Slots anzeigen, dann im Kalender genau zu einer angezeigten Zeit einen Termin anlegen, danach auf dem iPad diese Zeit wählen → „Dieser Termin wurde gerade vergeben“, und die Liste lädt neu.

**Typische Fehler**

| Problem | Ursache / Lösung |
|---|---|
| „Die freien Zeiten konnten nicht geladen werden“ | Apps Script → **Ausführungen** öffnen. Häufig: `CAL_ID_…` fehlt oder ist falsch, das bereitstellende Konto hat keinen Zugriff auf den Kalender, Kalenderberechtigung nicht bestätigt (`testSlots` ausführen), oder `Config.gs`/`Logic.gs` fehlen. |
| „Die Anfrage konnte nicht gesendet werden“ | iPad offline, Platzhalter-URL in `config.js`, Zeitüberschreitung, `WEBHOOK_URL` fehlt (bei „Jetzt“), oder das Backend kennt den Dienst nicht (`Config.gs` veraltet). |
| Neuer Dienst/neue Zeiten erscheinen, aber Buchung wird abgelehnt | `config.js` auf GitHub geändert, aber nicht `Config.gs` in Apps Script, oder keine neue Version bereitgestellt. |
| `/exec` zeigt eine Google-Anmeldung | Zugriff nicht auf **Jeder** gestellt, oder der Workspace-Admin erlaubt anonymen Zugriff nicht. |
| Slots um 9 Stunden verschoben | Zeitzone in `appsscript.json` bzw. `timeZone` in `config.js` ist nicht `Asia/Tokyo`, oder die Uhr des Kalenders bzw. des iPads ist falsch eingestellt. |
| Keine Slots, obwohl der Kalender leer aussieht | Ganztägiger Termin im Raumkalender? Es ist nach 17:15 (letzter Slot muss vor 18:00 enden)? |
| Termin im Kalender, aber keine Chat-Nachricht | Die Buchung bleibt bestehen, die Antwort enthält `notified:false`. Webhook-URL prüfen (`testWebhook`). |
| Änderungen kommen auf dem iPad nicht an | GitHub-Pages-Cache (bis 10 min). App im App-Umschalter schließen und neu öffnen. |

---

## Technik: Antwort des Backends lesen (CORS) und JSONP-Fallback

Das Frontend schickt Anfragen als **„einfache“ CORS-Requests**, also ohne Preflight:
- Slots: `GET …/exec?action=slots&service=insole&persons=2`
- Anfragen und Buchungen: `POST …/exec` mit `Content-Type: text/plain` und JSON im Body

Apps Script beantwortet `/exec` mit einer Weiterleitung (302) auf `script.googleusercontent.com`. Diese Antwort trägt in der Praxis `Access-Control-Allow-Origin: *`, deshalb kann `fetch` mit `redirect: 'follow'` das JSON normal lesen. Das ist ein weit verbreitetes Muster für Web-Apps mit ContentService, aber von Google nicht ausdrücklich zugesichert. Deshalb gibt es das Fallback.

**Fallback (JSONP):** Kann die Antwort nicht gelesen werden (Netzwerk-/CORS-Fehler, z. B. durch Firmen-Proxy oder Browser-Eigenheiten), wiederholt das Frontend die Anfrage automatisch per JSONP. Es lädt ein `<script>` mit `&callback=…`, und das Backend antwortet mit `callback({...})` (`ContentService.MimeType.JAVASCRIPT`). Buchungen laufen dann als `GET ?action=book&data=<JSON>&callback=…`.
- Jede Anfrage hat eine **Request-ID**. Das Backend merkt sich die Antwort 10 Minuten (ohne Namen). Kam der erste Versuch doch an, liefert die Wiederholung dieselbe Antwort, also gibt es keine Doppelbuchung.
- Nach einer Zeitüberschreitung wird **nicht** automatisch wiederholt.
- Einstellung `transport` in `config.js`: `'auto'` (Standard), `'fetch'` (nur CORS) oder `'jsonp'` (nur JSONP, falls CORS in eurem Netz dauerhaft scheitert).
- Nachteil von JSONP: Bei Buchungen steht der Name in der URL (Query-Parameter), die Google ggf. technisch protokolliert. Deshalb ist JSONP nur das Fallback.

## Sicherheit und Datenschutz

- **Die Apps-Script-URL ist öffentlich sichtbar** (in `config.js`). Mit ihr kann man nur
  - freie Slots der konfigurierten Dienste abfragen (nur Uhrzeiten, keine Namen),
  - Nachrichten im festen Format in den Chat-Space schicken und Termine zu freien Zeiten in die Raumkalender eintragen.

  Alle Eingaben werden im Backend geprüft: nur bekannte und aktive Dienste, erlaubte Anfrage-Arten, Sprache, Name nur aus Buchstaben (max. 30 Zeichen, keine Erwähnungen oder Formatierungen), 1–5 Personen, Uhrzeit muss frei und in den Öffnungszeiten sein. Ungültiges wird **ohne Webhook-Aufruf und ohne Kalendereintrag** verworfen. Webhook-URL und Kalender-IDs bleiben geheim in den Script Properties.
- Bremsen: gleicher Name + gleicher Dienst wird 30 s lang ignoriert, insgesamt höchstens 30 Anfragen pro 10 Minuten (`SETTINGS` in `Code.gs`), und das iPad sperrt die Buttons 30 s nach dem Senden.
- **Bei Missbrauch:** Apps Script → **Bereitstellungen verwalten** → alte Bereitstellung **archivieren**, **neue Bereitstellung** erzeugen und die neue `/exec`-URL in `config.js` eintragen. Die alte URL ist sofort wirkungslos. Falsche Termine im Kalender löschen. Im Notfall den Webhook neu anlegen und `WEBHOOK_URL` aktualisieren.
- **Gespeicherte Daten:** Nur bei **„Später“-Buchungen** liegen **Nachname, Uhrzeit, Personenzahl, Sprache und Begleitungsbedarf** als Termin im Kalender des jeweiligen Raums (sichtbar für die freigegebenen Teammitglieder). Sonst wird nichts gespeichert:
  - kein Sheet, keine Logs mit Namen (protokolliert werden nur HTTP-Status und Dienst-ID),
  - die Duplikat-Sperre hält nur einen SHA-256-Hash für 30 s,
  - die Request-ID-Antworten enthalten keine Namen,
  - auf dem iPad liegt nur der Zeitpunkt der Sendesperre im `localStorage`.

  Empfehlung: Alte Termine regelmäßig im Kalender löschen (z. B. monatlich), damit Namen nicht länger als nötig gespeichert bleiben.
