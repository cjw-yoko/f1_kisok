# Empfangs-Kiosk (iPad): Yoko · WYS Relation · ZEPHI · Fotostudio · Paketdienst

Kostenlose Kiosk-Web-App für ein iPad am Eingang (1. Stock). Besucherinnen und Besucher wählen Sprache und Service, das Team bekommt sofort eine **japanische Nachricht in einem gemeinsamen Google-Chat-Space**. Termine für ZEPHI und das Fotostudio landen im Google-Kalender des jeweiligen Raums.

- **Frontend:** statische Dateien auf GitHub Pages (Vanilla JS, kein Build-Schritt)
- **Backend:** Google Apps Script als Web-App (Kalender + Chat-Webhook)
- **Kosten:** 0 €, kein eigener Server, kein Mac, kein Apple-Developer-Account
- **Sprachen:** 日本語, English, 한국어, Deutsch

## Ablauf

1. **Sprache** wählen
2. **„Willkommen – Bitte wählen Sie Ihren gewünschten Service“** mit 5 Kacheln:

   | | |
   |---|---|
   | **Yoko Co., Ltd.** (Logo) | **WYS Relation Co., Ltd.** (Logo) |
   | **ZEPHI** Custom Einlegesohlen / Fußpflege | **Fotostudio** |
   | **Paketdienst** (breit) | |

3. Je nach Kachel:
   - **Yoko / WYS Relation** (Besucher haben meist schon einen Termin): Abteilung wählen
     - Yoko: R&D Division · Media Division · Distribution Division · EC Business Division · Sonstiges
     - WYS Relation: Management Business Department · Casting Business Department · Sonstiges

     → **Name** (Pflicht) und **Firma** (optional) → „Anmelden“ → **„Herzlich willkommen! Bitte kommen Sie in den 3. Stock.“** Es gibt keinen Kalendereintrag.
   - **ZEPHI:** **Einlegesohlen** (45 Min. + 15 Min. je weitere Person) oder **Fußpflege** (60 Min. je Person) → Nachname + Personenzahl → **Jetzt anfragen** oder **Für später** (freie Zeiten von heute aus dem Kalender). **Einlegesohlen und Fußpflege teilen sich einen Kalender**, weil dieselbe Person für beides zuständig ist.
     **„Jetzt anfragen“ prüft den Kalender:**
     - Raum frei und genug Zeit bis zum nächsten Termin (45 bzw. 60 Min.) → „Wir kommen gleich zu Ihnen“
     - gerade läuft eine Behandlung und das Zeitfenster direkt danach ist frei → **„Bitte nehmen Sie im Wartebereich im 2. Stock Platz“** mit voraussichtlicher Uhrzeit
     - nächster Termin ebenfalls belegt, zu wenig Zeit bis zum nächsten Termin, Mittagspause oder außerhalb der Öffnungszeiten → **„Bitte buchen Sie eine andere Uhrzeit“**, die freien Zeiten erscheinen sofort

     In den ersten beiden Fällen wird die Zeit im Kalender eingetragen (Titel mit `【当日】` bzw. `【待合室】`), damit der nächste Kunde richtig behandelt wird.
   - **Fotostudio:** wie bisher (Nachname, Personen, jetzt oder später, eigener Kalender).
   - **Paketdienst:** Zusteller tippt sein Unternehmen an (ヤマト運輸, 佐川急便, 日本郵便, DHL …) oder „Anderes Unternehmen“ → Begrüßung **in der gewählten Sprache** (수고하셨습니다! / お疲れ様です！ / Thank you for your hard work! / Vielen Dank für Ihre Mühe!) mit einem kurzen Willkommen. Niemand kommt herunter. Im Chat erscheint nur eine Info, kein Kalendereintrag.
**Deutsch** ist Mo–Fr von 12:30 bis 17:00 ausgegraut („Zurzeit nicht verfügbar · bitte English wählen“), weil dann niemand Deutschsprachiges im Haus ist. Die Zeiten stehen in `config.js` unter `languageAvailability` (Uhr des iPads).
4. Bestätigung, nach 10 s zurück zum Start. Nach 45 s Inaktivität geht es ebenfalls zurück zum Start, und alle Eingaben werden gelöscht. Nach einer gesendeten Anfrage sind die Buttons **10 s** gesperrt (`submitLockSeconds`).

## Design, Logos und Icons

- **Stil der YOKO-Website:**
  - Farben: Papierweiß `#F7F6F3`, weiße Karten mit feinen Linien, Navy `#1E2E42`, Yoko-Rot `#DE3A2C`, Bronze für kleine Überschriften mit roter Raute
  - Schriften: Shippori Mincho (japanische Überschriften), Cormorant Garamond und IBM Plex Sans (Englisch/Deutsch), Noto Serif KR (Koreanisch). Die Schriften kommen wie auf der Website von Google Fonts; ohne Internet nutzt das iPad die eingebauten Hiragino-Schriften.
  - Alle Farben stehen als Variablen oben in `style.css`.
- **Logos** (Ordner `icons/`):
  - `yoko-logo.png`, `wys-logo.png`
  - `zephi-logo.png`: der kursive ZEPHI-Schriftzug aus dem Logo-Vorschlag (PDF). Der ist allen vier Kandidaten A–D gemeinsam; sobald das Symbol entschieden ist, einfach die Datei ersetzen.
  - `studio-logo.svg`: neues Fotostudio-Logo (Blende mit rotem Kern + „PHOTO STUDIO“), auch für andere Zwecke nutzbar.
- **Icons und Flaggen** statt Emojis: eigene minimalistische SVGs in `icons.js` (Einlegesohle, Fußpflege, Paket, Fotostudio, runde Flaggen). In `config.js` steht nur der Schlüssel (`icon: 'insole'`); ein Emoji funktioniert dort weiterhin als Notlösung. In den **Chat-Nachrichten** bleiben die Emojis, weil das Team sie dort schneller erfasst.

## Chat-Nachrichten: damit niemand etwas übersieht

**Alles geht in einen Space** (Script Property `WEBHOOK_URL`). Jede Nachricht

1. beginnt mit **`@alle`** (`<users/all>`), damit jedes Mitglied eine Benachrichtigung bekommt,
2. erwähnt optional zusätzlich die **zuständige Person** (`MENTION_…`, siehe unten),
3. hat eine **fette Kopfzeile**, aus der sofort hervorgeht, wer zuständig ist (Firma und Abteilung bzw. Dienst).

| Fall | Nachricht im Chat |
|---|---|
| Yoko, Besucher | **@alle** @Zuständige<br>**🏢 来客です｜YOKO｜研究開発部（R&D）**<br>山田 太郎様（株式会社サンプル）<br>→ 3階へご案内しました。担当の方は対応をお願いします。 |
| WYS, „Sonstiges“, Englisch | **@alle**<br>**🏢 来客です｜WYS Relation｜その他**<br>John Smith様<br>🇬🇧 英語のお客様<br>⚠️ 担当部署が未定です。どなたか対応をお願いします。<br>→ 3階へご案内しました。… |
| ZEPHI jetzt (Raum frei) | **@alle** @Zuständige<br>**🔔 お客様がいらっしゃいました｜🦶 ZEPHI フットケア**<br>山田様（1名）<br>🗓 10:07–11:07 でカレンダーに登録しました |
| ZEPHI jetzt (Behandlung läuft) | **@alle** @Zuständige<br>**⏳ 待合室でお待ちいただいています｜👟 ZEPHI インソール**<br>山田様（1名）<br>→ 2階の待合室にご案内しました。次の枠 10:45–11:30 をカレンダーに登録済みです。 |
| ZEPHI später, Deutsch | **@alle** @Zuständige<br>**🕒 ご予約が入りました｜👟 ZEPHI インソール｜14:00–14:45**<br>Müller様（1名）<br>🇩🇪 ドイツ語の同行が必要です |
| Fotostudio | wie bisher: „jetzt“ nur Chat-Nachricht (ohne Kalenderprüfung), „später“ mit Kalendereintrag |
| Paketdienst | **@alle**<br>**📦 配達業者が到着しました｜ヤマト運輸** (nur zur Info) |

- Sprachzeile bei Diensten: Englisch und Deutsch → „同行が必要です“ (Begleitung nötig, `escortLanguages`), Koreanisch → „韓国語のお客様（対応可能）“, Japanisch → keine Zeile.
- **Kalendertermin** („später“): Titel z. B. `🦶 ZEPHI フットケア｜山田様（1名）JA`. So sieht man im gemeinsamen Kalender sofort, ob es um Einlegesohlen oder Fußpflege geht. In der Beschreibung stehen Sprache und Begleitungsbedarf.
- Alle Texte stehen als Konstante `CHAT_TEXT` oben in `apps-script/Code.gs`. Die Kopie `chatTextPreview` in `config.js` dient nur der Dry-Run-Vorschau. Bei Änderungen beide anpassen (ein Test prüft, dass sie gleich sind).
- `@alle` ausschalten: in `CHAT_TEXT` `everyone: ''` setzen (und in `chatTextPreview`).

**Wichtig fürs Team:** In der Google-Chat-App (Handy und PC) die Benachrichtigungen für den Space auf **„Alle“** stellen und die Chat-App-Benachrichtigungen auf dem Handy erlauben. In manchen Workspaces kann ein Space-Manager einschränken, wer `@alle` verwenden darf. Dann muss die Einstellung für Apps/Webhooks erlaubt sein.

## Update auf diese Version

Diese Version umfasst das neue Design im Stil der YOKO-Website, die Logos und Icons, die zeitabhängige Deutsch-Option sowie die Änderungen davor: Paketdienst-Begrüßung, 10 s Sperre und die „Jetzt“-Prüfung für ZEPHI.

**1. Apps Script (zuerst!)**: drei Dateien ersetzen, jeweils einfügen (⌘A, ⌘V) und **speichern**, bevor du die nächste kopierst:

```bash
pbcopy < /Users/zinuchai/Desktop/IPAD_APP/apps-script/Code.gs
```
→ in **Code.gs**
```bash
pbcopy < /Users/zinuchai/Desktop/IPAD_APP/config.js
```
→ in **Config.gs**
```bash
pbcopy < /Users/zinuchai/Desktop/IPAD_APP/logic.js
```
→ in **Logic.gs**

Kontrolle mit ⌘F: `bookNow_` in Code.gs, `languageAvailability` in Config.gs, `isLanguageAvailable` in Logic.gs. Danach **Bereitstellen → Bereitstellungen verwalten → ✏️ → Version: „Neue Version“ → Bereitstellen**.

**2. GitHub:** diese Dateien hochladen → **Commit changes**:
- `index.html`, `style.css`, `app.js`, `i18n.js`, `logic.js`, `config.js`
- **neu:** `icons.js`
- im Ordner `icons`: **neu** `zephi-logo.png` und `studio-logo.svg`

**3. iPad:** App schließen und neu öffnen (GitHub-Cache bis 10 Min.).

## Projektstruktur

```
index.html             Eine Seite mit allen Screens (Sprache, Menü, ZEPHI, Abteilungen, Anmeldung,
                       Paketdienst, Name/Slots, Bestätigung)
style.css              Layout für Hoch- und Querformat
config.js              ⚙️ Konfiguration – auch als „Config.gs“ im Apps-Script-Projekt!
logic.js               Slot-Berechnung, Prüfungen, Texte – auch als „Logic.gs“ im Apps-Script-Projekt!
i18n.js                Alle UI-Texte (ja/en/ko/de)
app.js                 UI-Steuerung: Screens, Timer, Sendesperre, API-Zugriff, Dry-Run
manifest.webmanifest   Für „Zum Home-Bildschirm“
icons/                 App-Icons, yoko-logo.png, wys-logo.png, zephi-logo.png, studio-logo.svg
icons.js               Minimalistische SVG-Icons und runde Flaggen
apps-script/Code.gs          Backend (Chat-Texte als Konstanten ganz oben)
apps-script/appsscript.json  Zeitzone Asia/Tokyo, Berechtigungen
tests/run-tests.js     Tests für Slots, Prüfungen, Nachrichten und Backend
```

**Wichtig:** `config.js` und `logic.js` werden **von Frontend und Backend gemeinsam** genutzt. Firmen, Abteilungen, Dienste, Öffnungszeiten und Dauern gibt es so nur einmal, und das Backend verlässt sich nie auf Werte aus dem Browser. Wer eine der beiden Dateien ändert, muss sie **auf GitHub und in Apps Script** aktualisieren und eine neue Version bereitstellen.

## Wie die freien Zeiten berechnet werden

- **Dauer** = `baseMinutes + extraMinutesPerPerson × (Personen − 1)`
  - Einlegesohlen: 45 / 60 / 75 / 90 / 105 Min. für 1–5 Personen
  - Fußpflege: 60 / 120 / 180 Min. für 1–3 Personen (für eine feste Stunde unabhängig von der Personenzahl: `extraMinutesPerPerson: 0`)
  - Fotostudio: immer 30 Min.
- **Öffnungsblöcke:** 09:00–12:00 und 13:00–18:00. Kein Slot ragt in die Mittagspause oder über 18:00 hinaus.
- Freie Intervalle = Block minus **alle Termine im Kalender** minus die Zeit bis „jetzt + 15 Min.“. Einlegesohlen und Fußpflege lesen und schreiben denselben Kalender (`CAL_ID_INSOLE`), blockieren sich also gegenseitig.
- Slots liegen direkt hintereinander und beginnen auf dem nächsten 15-Minuten-Raster. Es werden höchstens 8 angeboten, nur für heute, Zeitzone Asia/Tokyo.
- Vor jeder Buchung prüft das Backend unter Sperre erneut. Ist die Zeit inzwischen belegt, heißt es „Dieser Termin wurde gerade vergeben“, und die Liste lädt neu.
- **„Jetzt“ bei ZEPHI** (`nowCheck: true`): Läuft gerade kein Termin, muss das Fenster *jetzt bis jetzt + Dauer* frei sein und in einem Öffnungsblock liegen. Läuft gerade ein Termin, gilt dasselbe für das Fenster *Ende des laufenden Termins bis + Dauer*. Dann wartet der Kunde im Wartebereich (`waitFloor: 2`). Ist das Fenster nicht frei, erscheint „Bitte buchen Sie eine andere Uhrzeit“. Ohne `nowCheck` (Fotostudio) bleibt „Jetzt“ eine reine Chat-Nachricht.
- **Termin löschen = Slot frei:** Termin im Kalender löschen, dann ist die Zeit sofort wieder buchbar. Ein eigener Termin (z. B. „Pause“) oder ein ganztägiger Termin („geschlossen“) blockiert die Zeit.

---

## Einrichtung von Grund auf

### a) Google-Chat-Space und Webhook

> Voraussetzung: ein **Google-Workspace-Konto**. Private Gmail-Konten haben keine Webhooks.

1. In Google Chat einen Space anlegen, z. B. „受付 1F“, und **alle** Mitarbeitenden hinzufügen.
2. Space-Name → **Apps und Integrationen** → **Webhooks** → **Webhook hinzufügen** → Name `受付キオスク` → **Speichern** → URL kopieren (geheim halten).
3. Alle stellen die Benachrichtigungen für diesen Space auf **„Alle“**.

### b) Zwei Raumkalender

Mit **demselben Konto**, das später das Apps Script bereitstellt:

1. <https://calendar.google.com> → „Weitere Kalender“ **+** → **Neuen Kalender erstellen**: `ZEPHI（インソール・フットケア）` und `フォトスタジオ`, jeweils Zeitzone **Japan**.
2. Je Kalender: **Einstellungen und Freigabe** → **Für bestimmte Personen freigeben** → Team mit „Änderungen an Terminen vornehmen“ (nicht öffentlich!) → unter **Kalender integrieren** die **Kalender-ID** kopieren.

### c) Apps Script

1. <https://script.google.com> → **Neues Projekt** („受付キオスク“).
2. ⚙️ **Projekteinstellungen** → Haken bei **„Manifestdatei ‚appsscript.json‘ im Editor anzeigen“**.
3. Dateien anlegen bzw. ersetzen:

   | Datei im Editor | Inhalt aus |
   |---|---|
   | `Code.gs` | `apps-script/Code.gs` |
   | `Config.gs` (neu: **+ → Skript** → `Config`) | `config.js` |
   | `Logic.gs` (neu: `Logic`) | `logic.js` |
   | `appsscript.json` | `apps-script/appsscript.json` |

4. **Script Properties** (⚙️ → Skripteigenschaften):

   | Eigenschaft | Wert |
   |---|---|
   | `WEBHOOK_URL` | Webhook-URL aus a) – **alle** Nachrichten gehen hierhin |
   | `CAL_ID_INSOLE` | Kalender-ID ZEPHI (Einlegesohlen **und** Fußpflege) |
   | `CAL_ID_STUDIO` | Kalender-ID Fotostudio |
   | *optional* `MENTION_YOKO_RD`, `MENTION_YOKO_MEDIA`, `MENTION_YOKO_DISTRIBUTION`, `MENTION_YOKO_EC`, `MENTION_YOKO_OTHER` | zuständige Person je Yoko-Abteilung |
   | *optional* `MENTION_WYS_MANAGEMENT`, `MENTION_WYS_CASTING`, `MENTION_WYS_OTHER` | zuständige Person je WYS-Abteilung |
   | *optional* `MENTION_ZEPHI` | zuständige Person für Einlegesohlen **und** Fußpflege |
   | *optional* `MENTION_STUDIO`, `MENTION_DELIVERY` | zuständig für Fotostudio bzw. Pakete |

   Wert jeweils `users/<Nutzer-ID>`, z. B. `users/112233445566778899000`. Die numerische ID findet der Workspace-Admin in der Admin-Konsole (admin.google.com → Nutzer → Person öffnen, Zahl in der Adresszeile). Ohne Eintrag oder bei ungültigem Wert gibt es nur `@alle`. Die Person muss Mitglied des Space sein.
5. **Testen** (Funktion oben im Dropdown wählen → Ausführen; beim ersten Mal Berechtigungen für **Kalender** und **externe Dienste** bestätigen: „Berechtigungen überprüfen“ → Konto → ggf. „Erweitert“ → „… wechseln (unsicher)“ → „Zulassen“):
   - `testWebhook`: Testnachricht mit @alle
   - `testMentions`: zeigt im Protokoll, wer je Abteilung bzw. Dienst erwähnt wird (sendet nichts)
   - `testVisit` / `testDelivery`: Test-Besucher bzw. -Lieferung
   - `testSlots`: freie Slots aus den Kalendern
   - `testBooking` (optional): bucht einen echten Testtermin, danach im Kalender löschen
6. **Bereitstellen → Neue Bereitstellung → Web-App**: Ausführen als **Ich**, Zugriff **Jeder** → `/exec`-URL kopieren.
   Kontrolle: `…/exec` zeigt „OK“, `…/exec?action=slots&service=footcare&persons=1` zeigt JSON mit `slots`.

**Spätere Änderungen:** Speichern reicht nicht. **Bereitstellungen verwalten → ✏️ → Neue Version → Bereitstellen.**

### d) config.js

```js
appsScriptUrl: 'https://script.google.com/macros/s/DEINE_ID/exec',
dryRun: false,
```

Anpassbar (alles kommentiert):
- **`companies`** (Yoko, WYS): `name`, `logo`, `floor` (Etage in der Begrüßung), `departments` mit `id`, `name` (4 Sprachen), `other: true` für „Sonstiges“, `mentionProperty`. Firma oder Abteilung ausblenden: `active: false`.
- **`serviceGroups`** (ZEPHI): fasst Dienste mit gleichem `group` zu einer Kachel zusammen.
- **`services`**: `group`, `calendarProperty` (gleicher Wert = gemeinsamer Kalender), `baseMinutes`, `extraMinutesPerPerson`, `peopleMax`, `openingBlocks`, `types` (`now`/`later`), `escortLanguages`, `mentionProperty`.
- **`delivery`**: `greeting` (`수고하셨습니다!`), `carriers`, `allowOther`, `mentionProperty`.
- Zeiten: `slotStepMinutes`, `slotLeadMinutes`, `maxSlots`, `submitLockSeconds`, `inactivityTimeoutSeconds`, `duplicateWindowSeconds`.

**Lokal testen (Dry-Run):** `dryRun: true` setzen (nicht so hochladen!) und

```bash
python3 -m http.server 8000
```

<http://localhost:8000> öffnen. Slots werden mit `dryRunBookings` simuliert (pro Kalender, also auch hier gemeinsam für ZEPHI). Die Chat-Nachricht erscheint auf dem Bestätigungsscreen und in der Konsole, die zuständige Person als `[@MENTION_…]`. Abends `dryRunClock: '10:20'` setzen, um eine Uhrzeit zu simulieren.

**Tests:**

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run-tests.js
```

### e) GitHub Pages

Öffentliches Repository → alle Dateien hochladen (inkl. `icons/`) → **Settings → Pages** → `main` / `(root)` → **Save**. Webhook und Kalender-IDs stehen nur in den Script Properties, nicht im Repo.

### f) iPad (8. Generation)

1. Tastaturen: Japanisch (Kana/Romaji), Koreanisch, Englisch, Deutsch.
2. Datum & Uhrzeit automatisch, Zeitzone Tokio.
3. Safari → URL → Teilen → **Zum Home-Bildschirm**, nur noch über das Icon starten.
4. Automatische Sperre: **Nie**. Fokus **Nicht stören** dauerhaft an.
5. **Geführter Zugriff:** Home-Taste 3× → Optionen: **Tastaturen EIN**, Ein/Aus- und Lautstärketasten AUS → Starten.
6. Dauerhaft am Netzteil, Helligkeit etwa 50–70 %.

### g) Testablauf

1. Dry-Run lokal: alle 5 Kacheln, alle Sprachen, Zurück-Buttons, Sperre, Inaktivität.
2. Live auf dem iPad:
   - Yoko → jede Abteilung einmal (Nachricht mit @alle bzw. der zuständigen Person)
   - WYS → „Sonstiges“ (⚠️-Zeile)
   - ZEPHI → Fußpflege später buchen → Termin im ZEPHI-Kalender → danach zeigen die Einlegesohlen diese Stunde nicht mehr an
   - Termin löschen → wieder frei
   - Paketdienst → 수고하셨습니다!
3. Auf den Handys prüfen, ob alle die Benachrichtigung bekommen haben.

### h) Typische Fehler

| Problem | Ursache / Lösung |
|---|---|
| Neue Kacheln fehlen oder werden abgelehnt | `Config.gs`/`Logic.gs` in Apps Script noch alt, oder keine neue Version bereitgestellt. |
| Kachel ohne Text oder mit „undefined“ | `i18n.js` auf GitHub ist nicht die aktuelle Version. |
| Logo fehlt | `icons/yoko-logo.png` bzw. `icons/wys-logo.png` nicht hochgeladen. |
| Niemand wird benachrichtigt | Space-Benachrichtigungen auf „Alle“ stellen. Prüfen, ob `@alle` im Space für Apps erlaubt ist. `testWebhook` ausführen. |
| Zuständige Person wird nicht erwähnt | Wert muss genau `users/<Zahl>` sein, die Person muss im Space sein. Mit `testMentions` prüfen. |
| Fußpflege und Einlegesohlen überschneiden sich | Beide Dienste müssen `calendarProperty: 'CAL_ID_INSOLE'` haben. |
| „Die freien Zeiten konnten nicht geladen werden“ | Apps Script → **Ausführungen**: Kalender-ID falsch, kein Zugriff oder Berechtigung nicht bestätigt (`testSlots`). |
| „Die Anfrage konnte nicht gesendet werden“ | iPad offline oder `WEBHOOK_URL` fehlt bzw. ist falsch. |
| `/exec` verlangt eine Anmeldung | Zugriff nicht auf **Jeder**, oder der Admin erlaubt anonymen Zugriff nicht. |
| Änderungen kommen nicht an | GitHub-Pages-Cache (bis 10 Min.), App neu starten. |

---

## Technik: CORS und JSONP-Fallback

Slots per `GET …/exec?action=slots…`, Anfragen per `POST …/exec` mit `Content-Type: text/plain`. Das sind „einfache“ CORS-Requests ohne Preflight. Apps Script leitet auf `script.googleusercontent.com` weiter, das in der Praxis `Access-Control-Allow-Origin: *` sendet, so dass das Frontend die JSON-Antwort lesen kann. Das ist ein verbreitetes Muster, aber von Google nicht ausdrücklich zugesichert.

**Fallback:** Scheitert das Lesen, wiederholt das Frontend die Anfrage per JSONP (`&callback=…`, Anfragen als `GET ?action=book&data=…`). Jede Anfrage hat eine Request-ID, das Backend merkt sich die Antwort 10 Minuten (ohne Namen). Eine Wiederholung bucht oder sendet also nie doppelt. Nach einer Zeitüberschreitung wird nicht automatisch wiederholt. Einstellung `transport`: `'auto'`, `'fetch'` oder `'jsonp'`. Nachteil von JSONP: Namen stehen in der URL, deshalb ist es nur das Fallback.

## Sicherheit und Datenschutz

- Die Apps-Script-URL ist öffentlich sichtbar. Mit ihr kann man nur freie Uhrzeiten abfragen sowie Nachrichten im festen Format in den einen Space schicken bzw. Termine zu freien Zeiten eintragen.
- Alle Eingaben werden im Backend geprüft: bekannte und aktive Firmen, Abteilungen, Dienste und Zusteller, Namen nur aus Buchstaben, Firmennamen ohne `< > * _ ~ @`, Personenzahl, Uhrzeit frei und in den Öffnungszeiten. Ungültiges wird ohne Nachricht und ohne Kalendereintrag verworfen. Erwähnungen kommen nur aus den Script Properties, nie aus Eingaben.
- Bremsen:
  - Gleiche Anfrage innerhalb von 30 s wird ignoriert (gleicher Name + Dienst, gleicher Besucher + Abteilung, gleicher Zusteller).
  - Höchstens 30 Anfragen pro 10 Minuten.
  - Das iPad sperrt die Buttons 30 s nach dem Senden.
- **Bei Missbrauch:** alte Bereitstellung archivieren, neue erzeugen, neue `/exec`-URL in `config.js`. Notfalls den Webhook neu anlegen.
- **Gespeicherte Daten:**
  - Nur „später“-Buchungen (ZEPHI, Fotostudio) liegen als Termin im Raumkalender: Nachname, Zeit, Personen, Sprache, Begleitung.
  - Besucher (Name, Firma) und Paketdienste stehen nur in der Chat-Nachricht.
  - Logs enthalten keine Namen. Die Duplikat-Sperre speichert nur einen Hash für 30 s.
  - Auf dem iPad liegt nur der Zeitpunkt der Sendesperre.

  Empfehlung: alte Termine regelmäßig löschen.
