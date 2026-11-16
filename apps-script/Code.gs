/**
 * Kiosk backend (Google Apps Script web app).
 *
 * Project files in the Apps Script editor:
 *   Code.gs          this file
 *   Config.gs        copy of config.js   (services, opening blocks, durations)
 *   Logic.gs         copy of logic.js    (slot calculation, validation, texts)
 *   appsscript.json  time zone Asia/Tokyo, scopes
 *
 * Script Properties:
 *   WEBHOOK_URL                 Google Chat webhook (default for all services)
 *   WEBHOOK_URL_<SERVICE>       optional per-service override, e.g. WEBHOOK_URL_INSOLE
 *   CAL_ID_INSOLE, CAL_ID_STUDIO  calendar IDs (one calendar per room)
 *
 * API
 *   GET  ?action=slots&service=insole&persons=2   -> {ok, date, duration, slots:[{start,end}]}
 *   POST body (text/plain, JSON) {requestId, lang, service, type, name, persons, start?}
 *        -> {ok:true, start?, end?} | {ok:false, reason:'taken'|'invalid'|...}
 *   JSONP fallback: add &callback=fn to a GET; bookings via GET ?action=book&data=<JSON>
 *
 * Privacy: "later" bookings create a calendar event (name, time, persons,
 * language, escort). Nothing else is stored; logs never contain names.
 */
/* global KIOSK_CONFIG, KioskLogic */

/* ===== Chat and calendar texts (easy to change) =====
 * Placeholders: {service} {name} {persons} {start} {end} {langCode} {langName} {escort}
 * The kiosk's dry-run preview uses a copy in config.js (chatTextPreview).
 */
var CHAT_TEXT = {
  now: '🔔 お客様がいらっしゃいました｜{service}｜{name}様（{persons}名）',
  later: '🕒 ご予約｜{service}｜{start}–{end}｜{name}様（{persons}名）',
  serviceLabel: { insole: '👟 インソール', studio: '📸 フォトスタジオ' },
  // Second line if the language is in the service's escortLanguages ...
  escortNote: {
    en: '🇬🇧 英語の同行が必要です',
    de: '🇩🇪 ドイツ語の同行が必要です',
    ko: '🇰🇷 韓国語の同行が必要です'
  },
  // ... otherwise this informational line (Japanese: none).
  infoNote: {
    en: '🇬🇧 英語のお客様',
    de: '🇩🇪 ドイツ語のお客様',
    ko: '🇰🇷 韓国語のお客様（対応可能）'
  },
  eventTitle: '{name}様（{persons}名）{langCode}',
  eventDescription: '言語: {langName}（{langCode}）\n同行: {escort}',
  escortYes: '必要',
  escortNo: '不要',
  langName: { ja: '日本語', en: '英語', ko: '韓国語', de: 'ドイツ語' }
};

var SETTINGS = {
  RATE_LIMIT_MAX: 30,               // max. requests per window (all kiosks together)
  RATE_LIMIT_WINDOW_SECONDS: 600,
  REQUEST_ID_CACHE_SECONDS: 600,    // a retried request (same requestId) gets the same answer
  LOCK_TIMEOUT_MS: 10000
};

var CALLBACK_PATTERN = /^[A-Za-z_$][\w$]{0,63}$/;

/* ===== Entry points ===== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.callback !== undefined && !CALLBACK_PATTERN.test(p.callback)) {
    return ContentService.createTextOutput('invalid callback');
  }
  var result;
  if (p.action === 'slots') {
    result = handleSlots_(p.service, p.persons);
  } else if (p.action === 'book') {
    result = handleRequest_(parseJson_(p.data));
  } else if (p.callback) {
    result = { ok: true };
  } else {
    return ContentService.createTextOutput('OK'); // health check
  }
  return respond_(result, p.callback);
}

function doPost(e) {
  return respond_(handleRequest_(parseJson_(e && e.postData && e.postData.contents)));
}

/* ===== Slots ===== */

function handleSlots_(serviceId, personsRaw) {
  var service = KioskLogic.findService(KIOSK_CONFIG, serviceId);
  var persons = parseInt(personsRaw, 10);
  if (!service || !KioskLogic.isValidPersons(persons, service.peopleMax)) {
    return { ok: false, reason: 'invalid' };
  }
  var duration = KioskLogic.durationFor(service, persons);
  if (service.types.indexOf('later') === -1) {
    return { ok: true, service: service.id, persons: persons, duration: duration, slots: [] };
  }
  try {
    var day = today_();
    return {
      ok: true,
      date: day.ymd,
      service: service.id,
      persons: persons,
      duration: duration,
      slots: KioskLogic.computeFreeSlots(slotOptions_(service, persons, day))
    };
  } catch (err) {
    console.error('Slot calculation failed for ' + service.id + ': ' + err.message);
    return { ok: false, reason: 'server' };
  }
}

function slotOptions_(service, persons, day) {
  return {
    blocks: service.openingBlocks,
    busy: busyIntervals_(getCalendar_(service), day),
    nowMinutes: day.nowMinutes,
    leadMinutes: KIOSK_CONFIG.slotLeadMinutes,
    stepMinutes: KIOSK_CONFIG.slotStepMinutes,
    durationMinutes: KioskLogic.durationFor(service, persons),
    maxSlots: KIOSK_CONFIG.maxSlots
  };
}

/* ===== Requests (now / later) ===== */

function handleRequest_(data) {
  var check = KioskLogic.validateRequest(data, KIOSK_CONFIG);
  if (!check.ok) return { ok: false, reason: 'invalid', error: check.error };
  var req = check.value;
  var service = KioskLogic.findService(KIOSK_CONFIG, req.service);
  var cache = CacheService.getScriptCache();

  var reqKey = req.requestId ? 'req_' + req.requestId : null;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(SETTINGS.LOCK_TIMEOUT_MS)) return { ok: false, reason: 'busy' };
  var result;
  try {
    // A retry of the same request (e.g. the JSONP fallback) gets the first answer.
    var previous = reqKey ? cache.get(reqKey) : null;
    if (previous) return JSON.parse(previous);

    var dupKey = 'dup_' + sha256Hex_(req.service + '|' + req.name.toLowerCase());
    if (cache.get(dupKey)) {
      result = { ok: true, duplicate: true };
    } else if (isRateLimited_(cache)) {
      result = { ok: false, reason: 'rate_limited' };
    } else {
      result = req.type === 'later' ? bookLater_(req, service) : notifyNow_(req, service);
      if (result.ok) cache.put(dupKey, '1', KIOSK_CONFIG.duplicateWindowSeconds);
    }
    if (reqKey) cache.put(reqKey, JSON.stringify(result), SETTINGS.REQUEST_ID_CACHE_SECONDS);
  } catch (err) {
    console.error('Request failed for ' + req.service + ': ' + err.message);
    result = { ok: false, reason: 'server' };
  } finally {
    lock.releaseLock();
  }
  return result;
}

/** "now": chat message only – no calendar entry, no slot check. */
function notifyNow_(req, service) {
  var sent = sendToChat_(KioskLogic.buildChatMessage(req, service, CHAT_TEXT), service);
  return sent ? { ok: true } : { ok: false, reason: 'notify_failed' };
}

/** "later": re-check the slot (we hold the script lock), create the event, notify. */
function bookLater_(req, service) {
  var day = today_();
  var calendar = getCalendar_(service);
  var startMin = KioskLogic.parseHHMM(req.start);
  var duration = KioskLogic.durationFor(service, req.persons);
  var free = KioskLogic.isIntervalFree({
    blocks: service.openingBlocks,
    busy: busyIntervals_(calendar, day),
    nowMinutes: day.nowMinutes,
    durationMinutes: duration
  }, startMin);
  if (!free) return { ok: false, reason: 'taken' };

  var full = { lang: req.lang, type: 'later', name: req.name, persons: req.persons,
               start: req.start, end: KioskLogic.formatHHMM(startMin + duration) };
  calendar.createEvent(
    KioskLogic.buildEventTitle(full, CHAT_TEXT),
    dateAt_(day.ymd, startMin),
    dateAt_(day.ymd, startMin + duration),
    { description: KioskLogic.buildEventDescription(full, service, CHAT_TEXT) }
  );
  var notified = sendToChat_(KioskLogic.buildChatMessage(full, service, CHAT_TEXT), service);
  return { ok: true, start: full.start, end: full.end, notified: notified };
}

/* ===== Calendar ===== */

function getCalendar_(service) {
  var id = PropertiesService.getScriptProperties().getProperty(service.calendarProperty);
  if (!id) throw new Error('Script property ' + service.calendarProperty + ' is missing');
  var calendar = CalendarApp.getCalendarById(id);
  if (!calendar) throw new Error('Calendar for ' + service.id + ' not found or no access');
  return calendar;
}

/** Today's events as busy intervals in minutes; all-day events block the whole day. */
function busyIntervals_(calendar, day) {
  return calendar.getEvents(day.start, day.end).map(function (ev) {
    if (ev.isAllDayEvent()) return { start: 0, end: KioskLogic.DAY_MINUTES };
    var s = ev.getStartTime(), e = ev.getEndTime();
    return {
      start: s.getTime() <= day.start.getTime() ? 0 : minutesOfDay_(s),
      end: e.getTime() >= day.end.getTime() ? KioskLogic.DAY_MINUTES : minutesOfDay_(e)
    };
  });
}

/* ===== Time (always in KIOSK_CONFIG.timeZone) ===== */

function nowDate_() {
  return new Date();
}

function today_() {
  var tz = KIOSK_CONFIG.timeZone;
  var now = nowDate_();
  var ymd = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var start = Utilities.parseDate(ymd + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
  var end = new Date(Utilities.parseDate(ymd + ' 23:59', tz, 'yyyy-MM-dd HH:mm').getTime() + 60000);
  return { ymd: ymd, start: start, end: end, nowMinutes: minutesOfDay_(now) };
}

function minutesOfDay_(date) {
  var tz = KIOSK_CONFIG.timeZone;
  return parseInt(Utilities.formatDate(date, tz, 'H'), 10) * 60 + parseInt(Utilities.formatDate(date, tz, 'm'), 10);
}

function dateAt_(ymd, minutes) {
  return Utilities.parseDate(ymd + ' ' + KioskLogic.formatHHMM(minutes), KIOSK_CONFIG.timeZone, 'yyyy-MM-dd HH:mm');
}

/* ===== Google Chat ===== */

function webhookUrl_(service) {
  var props = PropertiesService.getScriptProperties();
  return (service && service.webhookProperty && props.getProperty(service.webhookProperty)) ||
    props.getProperty('WEBHOOK_URL');
}

/** Returns true on HTTP 2xx. Logs the status only – never the text. */
function sendToChat_(text, service) {
  var url = webhookUrl_(service);
  if (!url || url.indexOf('https://chat.googleapis.com/') !== 0) {
    console.error('Webhook URL missing or invalid (WEBHOOK_URL / ' + (service && service.webhookProperty) + ').');
    return false;
  }
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    console.log('Chat webhook responded with HTTP ' + code);
    return code >= 200 && code < 300;
  } catch (err) {
    console.error('Chat webhook request failed: ' + (err && err.name));
    return false;
  }
}

/* ===== Helpers ===== */

function parseJson_(text) {
  try { return JSON.parse(text || ''); } catch (err) { return null; }
}

function respond_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function isRateLimited_(cache) {
  var key = 'rate_' + Math.floor(Date.now() / (SETTINGS.RATE_LIMIT_WINDOW_SECONDS * 1000));
  var count = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(count), SETTINGS.RATE_LIMIT_WINDOW_SECONDS);
  return count > SETTINGS.RATE_LIMIT_MAX;
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/* ===== Manual tests (run from the Apps Script editor) ===== */

/** Sends a test message to the default webhook (also triggers the authorization prompt). */
function testWebhook() {
  var service = KIOSK_CONFIG.services[0];
  var text = '【テスト】\n' + KioskLogic.buildChatMessage(
    { lang: 'de', type: 'now', name: 'テスト', persons: 1 }, service, CHAT_TEXT);
  console.log('testWebhook sent: ' + sendToChat_(text, service));
}

/** Checks calendar access and prints today's free slots for every service. */
function testSlots() {
  KioskLogic.activeServices(KIOSK_CONFIG).forEach(function (s) {
    console.log(s.id + ': ' + JSON.stringify(handleSlots_(s.id, '1')));
  });
}

/** Books the first free slot of the first service with a test name (creates a real event!). */
function testBooking() {
  var service = KIOSK_CONFIG.services[0];
  var slots = handleSlots_(service.id, '1');
  if (!slots.ok || !slots.slots.length) { console.log('No free slot: ' + JSON.stringify(slots)); return; }
  var result = handleRequest_({ lang: 'en', service: service.id, type: 'later', name: 'Test', persons: 1, start: slots.slots[0].start });
  console.log('testBooking: ' + JSON.stringify(result));
}
