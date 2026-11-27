/**
 * Kiosk backend (Google Apps Script web app).
 *
 * Project files in the Apps Script editor:
 *   Code.gs          this file
 *   Config.gs        copy of config.js   (companies, services, opening blocks, durations)
 *   Logic.gs         copy of logic.js    (slot calculation, validation, texts)
 *   appsscript.json  time zone Asia/Tokyo, scopes
 *
 * Script Properties:
 *   WEBHOOK_URL                   Google Chat webhook – ALL messages go to this one space
 *   CAL_ID_INSOLE, CAL_ID_STUDIO  calendar IDs (insoles + foot care share CAL_ID_INSOLE)
 *   MENTION_...                   optional "users/<id>" of the person in charge, see config.js
 *                                 (mentionProperty of departments, services and delivery)
 *
 * API
 *   GET  ?action=slots&service=insole&persons=2   -> {ok, date, duration, slots:[{start,end}]}
 *   POST body (text/plain, JSON), one of
 *     service:  {requestId, lang, service, type: 'now'|'later', name, persons, start?}
 *     visit:    {requestId, lang, kind: 'visit', host, department, name, company?}
 *     delivery: {requestId, lang, kind: 'delivery', carrier, company?}
 *     -> {ok:true, mode?: 'now'|'wait', start?, end?} | {ok:false, reason:'taken'|'full'|'invalid'|...}
 *   JSONP fallback: add &callback=fn to a GET; requests via GET ?action=book&data=<JSON>
 *
 * Privacy: "later" bookings create a calendar event (name, time, persons,
 * language, escort). Visits and deliveries are only sent to the chat.
 * Nothing else is stored; logs never contain names.
 */
/* global KIOSK_CONFIG, KioskLogic */

/* ===== Chat and calendar texts (easy to change) =====
 * Placeholders: {service} {name} {persons} {start} {end} {company} {department}
 *               {floor} {langCode} {langName} {escort}
 * *text* is bold in Google Chat.
 * The kiosk's dry-run preview uses a copy in config.js (chatTextPreview).
 */
var CHAT_TEXT = {
  // First line of EVERY message: notifies everybody in the space, so nothing is
  // overlooked. Set to '' to switch it off. The person in charge (MENTION_...)
  // is added to the same line.
  everyone: '<users/all>',

  // Services (ZEPHI insoles / foot care, photo studio)
  now: '*🔔 お客様がいらっしゃいました｜{service}*\n{name}様（{persons}名）',
  later: '*🕒 ご予約が入りました｜{service}｜{start}–{end}*\n{name}様（{persons}名）',
  // "Now" with calendar check (services with nowCheck: ZEPHI):
  nowBooked: '🗓 {start}–{end} でカレンダーに登録しました',
  wait: '*⏳ 待合室でお待ちいただいています｜{service}*\n{name}様（{persons}名）',
  waitBooked: '→ {floor}階の待合室にご案内しました。次の枠 {start}–{end} をカレンダーに登録済みです。',
  serviceLabel: { insole: '👟 ZEPHI インソール', footcare: '🦶 ZEPHI フットケア', studio: '📸 フォトスタジオ' },
  // Extra line if the language is in the service's escortLanguages ...
  escortNote: {
    en: '🇬🇧 英語の同行が必要です',
    de: '🇩🇪 ドイツ語の同行が必要です',
    ko: '🇰🇷 韓国語の同行が必要です'
  },
  // ... otherwise this informational line (Japanese: none). Also used for visitors.
  infoNote: {
    en: '🇬🇧 英語のお客様',
    de: '🇩🇪 ドイツ語のお客様',
    ko: '🇰🇷 韓国語のお客様（対応可能）'
  },
  // Calendar event (shared insole/foot care calendar shows the service).
  // {tag}: eventTag of "later" / same-day "now" / "wait" (waiting area) entries.
  eventTitle: '{tag}{service}｜{name}様（{persons}名）{langCode}',
  eventTag: { later: '', now: '【当日】', wait: '【待合室】' },
  eventDescription: '言語: {langName}（{langCode}）\n同行: {escort}',
  escortYes: '必要',
  escortNo: '不要',
  langName: { ja: '日本語', en: '英語', ko: '韓国語', de: 'ドイツ語' },

  // Visitors of YOKO / WYS Relation (usually with an appointment)
  visit: '*🏢 来客です｜{company}｜{department}*',
  visitor: '{name}様',
  visitorWithCompany: '{name}様（{company}）',
  visitOther: '⚠️ 担当部署が未定です。どなたか対応をお願いします。',
  visitFooter: '→ {floor}階へご案内しました。担当の方は対応をお願いします。',
  companyLabel: { yoko: 'YOKO', wys: 'WYS Relation' },

  // Parcel services (information only – nobody has to come down)
  delivery: '*📦 配達業者が到着しました｜{company}*'
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

/* ===== Requests (service now / later, visit, delivery) ===== */

/** Key for the duplicate check (hashed, so no personal data sits in the cache). */
function duplicateKey_(req) {
  if (req.kind === 'visit') return 'visit|' + req.host + '|' + req.department + '|' + req.name.toLowerCase();
  if (req.kind === 'delivery') return 'delivery|' + req.company.toLowerCase();
  return req.service + '|' + req.name.toLowerCase();
}

function dispatch_(req) {
  if (req.kind === 'visit' || req.kind === 'delivery') {
    return notify_(req) ? { ok: true } : { ok: false, reason: 'notify_failed' };
  }
  var service = KioskLogic.findService(KIOSK_CONFIG, req.service);
  if (req.type === 'later') return bookLater_(req, service);
  if (service.nowCheck) return bookNow_(req, service);
  // "now" without check (photo studio): chat message only, the team decides on site.
  return notify_(req) ? { ok: true } : { ok: false, reason: 'notify_failed' };
}

/**
 * "now" with calendar check (ZEPHI): served right away, waiting area after the
 * current appointment, or {reason:'full'} (please book another time).
 * The time is entered in the calendar so the next request knows the room is busy.
 */
function bookNow_(req, service) {
  var day = today_();
  var calendar = getCalendar_(service);
  var duration = KioskLogic.durationFor(service, req.persons);
  var decision = KioskLogic.decideNow({
    blocks: service.openingBlocks,
    busy: busyIntervals_(calendar, day),
    nowMinutes: day.nowMinutes,
    durationMinutes: duration
  });
  if (decision.mode === 'full') return { ok: false, reason: 'full' };

  var full = { kind: 'service', lang: req.lang, service: service.id, type: 'now', mode: decision.mode,
               name: req.name, persons: req.persons,
               start: KioskLogic.formatHHMM(decision.start), end: KioskLogic.formatHHMM(decision.end) };
  calendar.createEvent(
    KioskLogic.buildEventTitle(full, service, CHAT_TEXT),
    dateAt_(day.ymd, decision.start),
    dateAt_(day.ymd, decision.end),
    { description: KioskLogic.buildEventDescription(full, service, CHAT_TEXT) }
  );
  var notified = notify_(full);
  return { ok: true, mode: decision.mode, start: full.start, end: full.end, notified: notified };
}

function handleRequest_(data) {
  var check = KioskLogic.validateRequest(data, KIOSK_CONFIG);
  if (!check.ok) return { ok: false, reason: 'invalid', error: check.error };
  var req = check.value;
  var cache = CacheService.getScriptCache();
  var reqKey = req.requestId ? 'req_' + req.requestId : null;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(SETTINGS.LOCK_TIMEOUT_MS)) return { ok: false, reason: 'busy' };
  var result;
  try {
    // A retry of the same request (e.g. the JSONP fallback) gets the first answer.
    var previous = reqKey ? cache.get(reqKey) : null;
    if (previous) return JSON.parse(previous);

    var dupKey = 'dup_' + sha256Hex_(duplicateKey_(req));
    if (cache.get(dupKey)) {
      result = { ok: true, duplicate: true };
    } else if (isRateLimited_(cache)) {
      result = { ok: false, reason: 'rate_limited' };
    } else {
      result = dispatch_(req);
      if (result.ok) cache.put(dupKey, '1', KIOSK_CONFIG.duplicateWindowSeconds);
    }
    if (reqKey) cache.put(reqKey, JSON.stringify(result), SETTINGS.REQUEST_ID_CACHE_SECONDS);
  } catch (err) {
    console.error('Request failed (' + req.kind + ' ' + (req.service || req.host || '') + '): ' + err.message);
    result = { ok: false, reason: 'server' };
  } finally {
    lock.releaseLock();
  }
  return result;
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

  var full = { kind: 'service', lang: req.lang, service: service.id, type: 'later', name: req.name,
               persons: req.persons, start: req.start, end: KioskLogic.formatHHMM(startMin + duration) };
  calendar.createEvent(
    KioskLogic.buildEventTitle(full, service, CHAT_TEXT),
    dateAt_(day.ymd, startMin),
    dateAt_(day.ymd, startMin + duration),
    { description: KioskLogic.buildEventDescription(full, service, CHAT_TEXT) }
  );
  var notified = notify_(full);
  return { ok: true, start: full.start, end: full.end, notified: notified };
}

/* ===== Calendar ===== */

function getCalendar_(service) {
  var id = PropertiesService.getScriptProperties().getProperty(service.calendarProperty);
  if (!id) throw new Error('Script property ' + service.calendarProperty + ' is missing');
  var calendar = CalendarApp.getCalendarById(id.trim());
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

/** "<users/all> <users/123…>" for this request (everyone + optional person in charge). */
function mentionsFor_(req) {
  var mentions = [CHAT_TEXT.everyone];
  var property = KioskLogic.mentionPropertyFor(req, KIOSK_CONFIG);
  if (property) mentions.push(KioskLogic.mentionTag(PropertiesService.getScriptProperties().getProperty(property)));
  return mentions;
}

/** Builds the message for a validated request and sends it. */
function notify_(req) {
  var body = KioskLogic.buildRequestMessage(req, KIOSK_CONFIG, CHAT_TEXT);
  return sendToChat_(KioskLogic.withMentions(body, mentionsFor_(req)));
}

/** Returns true on HTTP 2xx. Logs the status only – never the text. */
function sendToChat_(text) {
  var url = PropertiesService.getScriptProperties().getProperty('WEBHOOK_URL');
  url = url ? url.trim() : '';
  if (url.indexOf('https://chat.googleapis.com/') !== 0) {
    console.error('Script property WEBHOOK_URL is missing or invalid.');
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

/** Sends one test message (also triggers the authorization prompt). Uses @all like real messages. */
function testWebhook() {
  var text = KioskLogic.withMentions('【テスト】キオスクからのテストメッセージです。', [CHAT_TEXT.everyone]);
  console.log('testWebhook sent: ' + sendToChat_(text));
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

/** Prints which @mention each department / service would get (sends nothing). */
function testMentions() {
  var props = PropertiesService.getScriptProperties();
  var rows = [];
  KioskLogic.activeCompanies(KIOSK_CONFIG).forEach(function (c) {
    KioskLogic.activeDepartments(c).forEach(function (d) { rows.push([c.id + '/' + d.id, d.mentionProperty]); });
  });
  KioskLogic.activeServices(KIOSK_CONFIG).forEach(function (s) { rows.push([s.id, s.mentionProperty]); });
  rows.push(['delivery', KIOSK_CONFIG.delivery && KIOSK_CONFIG.delivery.mentionProperty]);
  rows.forEach(function (r) {
    var tag = r[1] ? KioskLogic.mentionTag(props.getProperty(r[1])) : '';
    console.log(r[0] + ': ' + (r[1] || '-') + ' -> ' + (tag || '(only @all)'));
  });
}

/** Sends one test visitor message for the first department of the first company. */
function testVisit() {
  var host = KioskLogic.activeCompanies(KIOSK_CONFIG)[0];
  var req = { kind: 'visit', lang: 'ja', host: host.id, department: KioskLogic.activeDepartments(host)[0].id, name: 'テスト', company: '' };
  var body = '【テスト】\n' + KioskLogic.buildRequestMessage(req, KIOSK_CONFIG, CHAT_TEXT);
  console.log('testVisit sent: ' + sendToChat_(KioskLogic.withMentions(body, mentionsFor_(req))));
}

/** Sends a test delivery notice. */
function testDelivery() {
  var req = { kind: 'delivery', lang: 'ja', carrier: 'other', company: 'テスト運輸' };
  var body = '【テスト】\n' + KioskLogic.buildRequestMessage(req, KIOSK_CONFIG, CHAT_TEXT);
  console.log('testDelivery sent: ' + sendToChat_(KioskLogic.withMentions(body, mentionsFor_(req))));
}
