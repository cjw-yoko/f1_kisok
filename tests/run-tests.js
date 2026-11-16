/*
 * Tests, run with macOS JavaScriptCore (same engine as Safari) from the project root:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run-tests.js
 * Covers: slot calculation, validation, chat/calendar texts, and the Apps Script
 * backend (Code.gs) with stubbed Google services (Calendar, Chat webhook, Cache, Lock).
 */
/* global load, print, KIOSK_CONFIG, KIOSK_I18N, KioskLogic, CHAT_TEXT, doPost, doGet */

var console = { log: function () {}, error: function () {}, info: function () {}, warn: function () {} };
load('config.js');
load('i18n.js');
load('logic.js');

var passed = 0, failed = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; print('FAIL ' + label + '\n  expected ' + e + '\n  actual   ' + a); }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

var L = KioskLogic;
var cfg = KIOSK_CONFIG;
var insole = L.findService(cfg, 'insole');
var studio = L.findService(cfg, 'studio');
var m = L.parseHHMM;

/** slot helper: "HH:MM-HH:MM" strings */
function slots(service, persons, now, busy, extra) {
  var opts = {
    blocks: service.openingBlocks,
    busy: (busy || []).map(function (b) { var p = b.split('-'); return { start: m(p[0]), end: m(p[1]) }; }),
    nowMinutes: m(now),
    leadMinutes: cfg.slotLeadMinutes,
    stepMinutes: cfg.slotStepMinutes,
    durationMinutes: L.durationFor(service, persons),
    maxSlots: cfg.maxSlots
  };
  for (var k in (extra || {})) opts[k] = extra[k];
  return L.computeFreeSlots(opts).map(function (s) { return s.start + '-' + s.end; });
}

/* =================== durations =================== */
eq([1, 2, 3, 4, 5].map(function (n) { return L.durationFor(insole, n); }), [45, 60, 75, 90, 105], 'insole duration = 45 + 15 x (n-1)');
eq([1, 3, 5].map(function (n) { return L.durationFor(studio, n); }), [30, 30, 30], 'studio duration stays 30');

/* =================== slots: basics, lunch break, end of day =================== */
eq(slots(insole, 1, '08:00'),
  ['09:00-09:45', '09:45-10:30', '10:30-11:15', '11:15-12:00', '13:00-13:45', '13:45-14:30', '14:30-15:15', '15:15-16:00'],
  'before opening: 8 slots, back to back, last morning slot ends exactly at 12:00');
eq(slots(insole, 2, '08:00'),
  ['09:00-10:00', '10:00-11:00', '11:00-12:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'],
  '2 persons (60 min)');
eq(slots(insole, 3, '08:00'),
  ['09:00-10:15', '10:15-11:30', '13:00-14:15', '14:15-15:30', '15:30-16:45', '16:45-18:00'],
  '3 persons (75 min): no 11:30 slot (would cross lunch), last slot ends exactly at 18:00');
eq(slots(insole, 1, '10:50')[0], '11:15-12:00', 'lunch: 10:50 + 15 = 11:05 -> 11:15, ends exactly at 12:00');
eq(slots(insole, 1, '11:00'), ['11:15-12:00', '13:00-13:45', '13:45-14:30', '14:30-15:15', '15:15-16:00', '16:00-16:45', '16:45-17:30'],
  'at 11:00 the 11:15-12:00 slot is still offered');
eq(slots(insole, 1, '11:01'), ['13:00-13:45', '13:45-14:30', '14:30-15:15', '15:15-16:00', '16:00-16:45', '16:45-17:30'],
  'at 11:01 no morning slot (11:30 + 45 would cross lunch)');
eq(slots(insole, 1, '12:30'), ['13:00-13:45', '13:45-14:30', '14:30-15:15', '15:15-16:00', '16:00-16:45', '16:45-17:30'],
  'during lunch: afternoon from 13:00');
eq(slots(insole, 1, '16:20'), ['16:45-17:30'], 'day end: only one more slot');
eq(slots(insole, 2, '16:20'), ['16:45-17:45'], 'day end: 60 min still fits once');
eq(slots(insole, 4, '16:20'), [], 'day end: 90 min no longer fits after 16:45');
eq(slots(insole, 5, '15:00'), ['15:15-17:00'], '5 persons (105 min) late afternoon');
eq(slots(insole, 1, '17:30'), [], 'after the last possible start');
eq(slots(insole, 1, '19:00'), [], 'after closing');

/* =================== slots: lead time and grid =================== */
eq(slots(insole, 1, '09:00')[0], '09:15-10:00', 'lead 15 min: at 09:00 first slot 09:15');
eq(slots(insole, 1, '09:01')[0], '09:30-10:15', '09:01 + 15 = 09:16 -> rounded up to 09:30');
eq(slots(insole, 1, '08:44')[0], '09:00-09:45', 'before opening, block start wins');
eq(slots(studio, 1, '09:10'), ['09:30-10:00', '10:00-10:30', '10:30-11:00', '11:00-11:30', '11:30-12:00', '13:00-13:30', '13:30-14:00', '14:00-14:30'],
  'studio 30 min slots, max 8');

/* =================== slots: existing bookings =================== */
eq(slots(insole, 1, '08:00', ['10:00-10:45']),
  ['09:00-09:45', '10:45-11:30', '13:00-13:45', '13:45-14:30', '14:30-15:15', '15:15-16:00', '16:00-16:45', '16:45-17:30'],
  'booking 10:00-10:45: 09:45 no longer fits, slots continue after the booking');
eq(slots(insole, 1, '12:30', ['13:00-14:00']).slice(0, 3), ['14:00-14:45', '14:45-15:30', '15:30-16:15'],
  'longer booking (60 min) shifts the following slots');
eq(slots(insole, 1, '12:30', ['13:00-13:50']).slice(0, 2), ['14:00-14:45', '14:45-15:30'],
  'booking ending off-grid (13:50): next slot rounded up to 14:00');
eq(slots(insole, 1, '12:30', ['13:45-14:30']).slice(0, 3), ['13:00-13:45', '14:30-15:15', '15:15-16:00'],
  'booking in the middle: gap before and slots after');
eq(slots(insole, 1, '12:30', ['13:30-14:30']).slice(0, 2), ['14:30-15:15', '15:15-16:00'],
  'gap 13:00-13:30 too short for 45 min');
eq(slots(insole, 1, '08:00', ['10:00-11:00', '10:30-11:30']).slice(0, 3), ['09:00-09:45', '13:00-13:45', '13:45-14:30'],
  'overlapping bookings; 11:30 + 45 would cross lunch');
eq(slots(insole, 1, '08:00', ['11:30-13:30']).slice(3, 5), ['13:30-14:15', '14:15-15:00'],
  'booking across lunch break blocks end of morning and start of afternoon');
eq(slots(insole, 1, '08:00', ['00:00-24:00']), [], 'all-day event blocks the whole day');
eq(slots(insole, 1, '08:00', ['07:00-08:30', '19:00-20:00']).length, 8, 'bookings outside opening blocks are ignored');
eq(slots(insole, 1, '08:00', ['10:00-10:00']).length, 8, 'zero-length events are ignored');
eq(slots(insole, 2, '08:00', ['09:00-12:00', '13:00-16:30']), ['16:30-17:30'], '2 persons, only one gap left');
eq(slots(insole, 1, '08:00', [], { maxSlots: 3 }), ['09:00-09:45', '09:45-10:30', '10:30-11:15'], 'maxSlots respected');

/* =================== booking check =================== */
function free(start, persons, now, busy) {
  return L.isIntervalFree({
    blocks: insole.openingBlocks,
    busy: (busy || []).map(function (b) { var p = b.split('-'); return { start: m(p[0]), end: m(p[1]) }; }),
    nowMinutes: m(now),
    durationMinutes: L.durationFor(insole, persons)
  }, m(start));
}
eq(free('11:15', 1, '08:00'), true, 'free: 11:15-12:00');
eq(free('11:30', 1, '08:00'), false, 'not free: crosses lunch');
eq(free('17:15', 1, '08:00'), true, 'free: 17:15-18:00');
eq(free('17:30', 1, '08:00'), false, 'not free: crosses day end');
eq(free('10:00', 1, '08:00', ['10:30-11:00']), false, 'not free: overlaps booking');
eq(free('10:00', 1, '08:00', ['10:45-11:00']), true, 'free: booking starts exactly at slot end');
eq(free('09:00', 1, '09:30'), false, 'not free: in the past');
eq(free('08:30', 1, '08:00'), false, 'not free: before opening');

/* =================== names =================== */
function v(name) { return L.validateName(name, 30); }
eq(v('  Müller  '), { ok: true, value: 'Müller' }, 'trim');
eq(v('山田').ok && v('やまだ').ok && v('ヤマダ・ハナコ').ok && v('ｻﾄｳ').ok && v('Yamada').ok && v('김').ok, true, 'kanji / kana / romaji / hangul');
eq(v("O'Brien-Smith").ok, true, 'apostrophe + hyphen');
eq(v('van  der　Berg').value, 'van der Berg', 'collapse whitespace incl. full-width space');
eq(v('Müller').value, 'Müller', 'NFC normalization');
eq(v('   ').error, 'empty', 'only spaces');
eq(v('A'.repeat(31)).error, 'too_long', '31 chars too long');
eq(v('𠮷'.repeat(30)).ok, true, '30 astral kanji counted as 30');
eq([v('<users/all>').error, v('*x*').error, v('Test1').error, v('😀').error, v('-Smith').error],
  ['invalid_chars', 'invalid_chars', 'invalid_chars', 'invalid_chars', 'invalid_chars'], 'mentions, formatting, digits, emoji blocked');

/* =================== texts =================== */
var T = cfg.chatTextPreview;
eq(L.buildChatMessage({ lang: 'ja', type: 'now', name: '山田', persons: 2 }, insole, T),
  '🔔 お客様がいらっしゃいました｜👟 インソール｜山田様（2名）', 'ja now: no extra line');
eq(L.buildChatMessage({ lang: 'de', type: 'now', name: 'Müller', persons: 1 }, studio, T),
  '🔔 お客様がいらっしゃいました｜📸 フォトスタジオ｜Müller様（1名）\n🇩🇪 ドイツ語の同行が必要です', 'de now studio: escort');
eq(L.buildChatMessage({ lang: 'en', type: 'later', name: 'Smith', persons: 3, start: '14:00', end: '15:15' }, insole, T),
  '🕒 ご予約｜👟 インソール｜14:00–15:15｜Smith様（3名）\n🇬🇧 英語の同行が必要です', 'en later: range + escort');
eq(L.buildChatMessage({ lang: 'ko', type: 'now', name: '김', persons: 1 }, insole, T),
  '🔔 お客様がいらっしゃいました｜👟 インソール｜김様（1名）\n🇰🇷 韓国語のお客様（対応可能）', 'ko: info line, no escort');
var noEscort = clone(insole); noEscort.escortLanguages = [];
eq(L.buildChatMessage({ lang: 'en', type: 'now', name: 'Smith', persons: 1 }, noEscort, T).split('\n')[1], '🇬🇧 英語のお客様',
  'escortLanguages decides: en without escort -> info line');
eq(L.buildEventTitle({ lang: 'de', name: 'Müller', persons: 2 }, T), 'Müller様（2名）DE', 'event title');
eq(L.buildEventDescription({ lang: 'ko' }, insole, T), '言語: 韓国語（KO）\n同行: 不要', 'event description ko');
eq(L.buildEventDescription({ lang: 'de' }, insole, T), '言語: ドイツ語（DE）\n同行: 必要', 'event description de');

/* =================== translations complete =================== */
var keys = Object.keys(KIOSK_I18N.ja).sort();
['en', 'ko', 'de'].forEach(function (lang) { eq(Object.keys(KIOSK_I18N[lang]).sort(), keys, 'i18n keys complete: ' + lang); });
eq(KIOSK_I18N.de.errTaken, 'Dieser Termin wurde gerade vergeben. Bitte wählen Sie eine andere Uhrzeit.', 'de taken text');
cfg.services.forEach(function (s) {
  eq(L.LANGS.every(function (l) { return typeof s.name[l] === 'string' && s.name[l].length > 0; }), true, 'service names complete: ' + s.id);
});

/* =================== backend (Code.gs) with stubs =================== */
var TOKYO_OFFSET = 9 * 3600 * 1000;
function tokyo(hhmm) { // 16 Nov 2026 in Tokyo
  var p = hhmm.split(':');
  return new Date(Date.UTC(2026, 10, 16, parseInt(p[0], 10), parseInt(p[1], 10)) - TOKYO_OFFSET);
}
function pad(n) { return (n < 10 ? '0' : '') + n; }

var props = {};
var cacheStore = {};
var fetchCalls = [];
var webhookStatus = 200;
var calendars = {};
var currentTime = tokyo('08:00');

function makeCalendar() {
  return {
    events: [],
    getEvents: function (start, end) {
      return this.events.filter(function (ev) { return ev.s < end && ev.e > start; });
    },
    createEvent: function (title, s, e, opts) {
      var ev = makeEvent(s, e, false);
      ev.title = title; ev.description = opts.description;
      this.events.push(ev);
      return ev;
    }
  };
}
function makeEvent(s, e, allDay) {
  return { s: s, e: e, isAllDayEvent: function () { return allDay; },
           getStartTime: function () { return this.s; }, getEndTime: function () { return this.e; } };
}
function resetBackend() {
  props = { WEBHOOK_URL: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t',
            CAL_ID_INSOLE: 'cal-insole', CAL_ID_STUDIO: 'cal-studio' };
  calendars = { 'cal-insole': makeCalendar(), 'cal-studio': makeCalendar() };
  cacheStore = {}; fetchCalls = []; webhookStatus = 200; currentTime = tokyo('08:00');
}
resetBackend();

var PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return props.hasOwnProperty(k) ? props[k] : null; } }; } };
var CacheService = { getScriptCache: function () { return {
  get: function (k) { return cacheStore.hasOwnProperty(k) ? cacheStore[k] : null; },
  put: function (k, val) { cacheStore[k] = val; }
}; } };
var LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
var CalendarApp = { getCalendarById: function (id) { return calendars[id] || null; } };
var UrlFetchApp = { fetch: function (url, opts) {
  fetchCalls.push({ url: url, text: JSON.parse(opts.payload).text });
  return { getResponseCode: function () { return webhookStatus; } };
} };
var ContentService = {
  MimeType: { JSON: 'json', JAVASCRIPT: 'javascript' },
  createTextOutput: function (s) { return { content: s, mime: 'text', setMimeType: function (mt) { this.mime = mt; return this; }, getContent: function () { return this.content; } }; }
};
var Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: function (alg, text) { // deterministic fake digest (signed bytes like Apps Script)
    var out = [], h = 7;
    for (var i = 0; i < 32; i++) {
      for (var j = 0; j < text.length; j++) h = (h * 31 + text.charCodeAt(j) + i) | 0;
      out.push((h & 255) - 128);
    }
    return out;
  },
  formatDate: function (date, tz, fmt) { // Asia/Tokyo only (UTC+9, no DST)
    var d = new Date(date.getTime() + TOKYO_OFFSET);
    if (fmt === 'yyyy-MM-dd') return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    if (fmt === 'H') return String(d.getUTCHours());
    if (fmt === 'm') return String(d.getUTCMinutes());
    throw new Error('unsupported format ' + fmt);
  },
  parseDate: function (str, tz, fmt) {
    var p = str.split(/[- :]/).map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]) - TOKYO_OFFSET);
  }
};
load('apps-script/Code.gs');
nowDate_ = function () { return currentTime; }; // eslint-disable-line no-global-assign

function get(params) { return JSON.parse(doGet({ parameter: params }).getContent()); }
function post(obj) {
  var body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return JSON.parse(doPost({ postData: { contents: body } }).getContent());
}
function addBusy(calId, from, to) { calendars[calId].events.push(makeEvent(tokyo(from), tokyo(to), false)); }
function slotList(res) { return res.slots.map(function (s) { return s.start + '-' + s.end; }); }

eq(CHAT_TEXT, cfg.chatTextPreview, 'Code.gs CHAT_TEXT equals config.js chatTextPreview');
eq(doGet({ parameter: {} }).getContent(), 'OK', 'doGet health check');

// --- slots endpoint
addBusy('cal-insole', '10:00', '10:45');
var res = get({ action: 'slots', service: 'insole', persons: '1' });
eq(res.ok && res.date === '2026-11-16' && res.duration === 45, true, 'slots: ok, date in Tokyo, duration');
eq(slotList(res), ['09:00-09:45', '10:45-11:30', '13:00-13:45', '13:45-14:30', '14:30-15:15', '15:15-16:00', '16:00-16:45', '16:45-17:30'],
  'slots endpoint respects calendar events');
eq(get({ action: 'slots', service: 'insole', persons: '3' }).duration, 75, 'slots: duration for 3 persons');
eq(slotList(get({ action: 'slots', service: 'studio', persons: '1' }))[0], '09:00-09:30', 'studio uses its own calendar');
eq(get({ action: 'slots', service: 'spa', persons: '1' }).reason, 'invalid', 'slots: unknown service');
eq(get({ action: 'slots', service: 'insole', persons: '6' }).reason, 'invalid', 'slots: too many persons');
var jsonpOut = doGet({ parameter: { action: 'slots', service: 'insole', persons: '1', callback: 'cb_1' } });
eq([jsonpOut.getContent().indexOf('cb_1({"ok":true'), jsonpOut.mime], [0, 'javascript'], 'slots via JSONP');
eq(doGet({ parameter: { action: 'slots', callback: 'alert(1)//' } }).getContent(), 'invalid callback', 'JSONP callback validated');

calendars['cal-insole'].events.push(makeEvent(tokyo('00:00'), tokyo('23:59'), true));
eq(get({ action: 'slots', service: 'insole', persons: '1' }).slots, [], 'all-day event (e.g. closed) -> no slots');
calendars['cal-insole'].events.pop();
var longEvent = makeEvent(new Date(tokyo('00:00').getTime() - 3600000), tokyo('09:30'), false);
calendars['cal-insole'].events.push(longEvent);
eq(slotList(get({ action: 'slots', service: 'insole', persons: '1' }))[0], '10:45-11:30', 'event starting yesterday (until 09:30) blocks the morning start');
calendars['cal-insole'].events.pop();

currentTime = tokyo('16:20');
eq(slotList(get({ action: 'slots', service: 'insole', persons: '1' })), ['16:45-17:30'], 'slots use current Tokyo time + lead');
currentTime = tokyo('08:00');

delete props.CAL_ID_STUDIO;
eq(get({ action: 'slots', service: 'studio', persons: '1' }).reason, 'server', 'missing calendar property -> server error');
props.CAL_ID_STUDIO = 'cal-studio';

// --- booking ("later")
resetBackend();
res = post({ requestId: 'req-00000001', lang: 'de', service: 'insole', type: 'later', name: ' Müller ', persons: 2, start: '13:00' });
eq(res, { ok: true, start: '13:00', end: '14:00', notified: true }, 'booking ok');
var ev = calendars['cal-insole'].events[0];
eq([ev.title, ev.description, ev.s.getTime() === tokyo('13:00').getTime(), ev.e.getTime() === tokyo('14:00').getTime()],
  ['Müller様（2名）DE', '言語: ドイツ語（DE）\n同行: 必要', true, true], 'calendar event title, description, times');
eq(fetchCalls[0].text, '🕒 ご予約｜👟 インソール｜13:00–14:00｜Müller様（2名）\n🇩🇪 ドイツ語の同行が必要です', 'booking chat message');
eq(calendars['cal-studio'].events.length, 0, 'other room untouched');

eq(slotList(get({ action: 'slots', service: 'insole', persons: '1' })).slice(4, 6), ['14:00-14:45', '14:45-15:30'],
  'after booking, following slots shift');

res = post({ lang: 'en', service: 'insole', type: 'later', name: 'Smith', persons: 1, start: '13:30' });
eq(res, { ok: false, reason: 'taken' }, 'overlapping booking -> taken');
eq([calendars['cal-insole'].events.length, fetchCalls.length], [1, 1], 'taken: no event, no webhook');
eq(post({ lang: 'en', service: 'insole', type: 'later', name: 'Smith', persons: 1, start: '11:30' }).reason, 'taken', 'crossing lunch -> taken');
eq(post({ lang: 'en', service: 'insole', type: 'later', name: 'Smith', persons: 2, start: '17:15' }).reason, 'taken', 'crossing day end -> taken');
currentTime = tokyo('10:00');
eq(post({ lang: 'en', service: 'insole', type: 'later', name: 'Smith', persons: 1, start: '09:30' }).reason, 'taken', 'past slot -> taken');
currentTime = tokyo('08:00');
eq(post({ lang: 'en', service: 'studio', type: 'later', name: 'Smith', persons: 1, start: '13:30' }).ok, true, 'same time in the other room is free');

// deleting the event frees the slot
calendars['cal-insole'].events = [];
eq(slotList(get({ action: 'slots', service: 'insole', persons: '1' }))[4], '13:00-13:45', 'deleted event frees the slot');
eq(post({ lang: 'ko', service: 'insole', type: 'later', name: '김', persons: 1, start: '13:00' }).ok, true, 'slot bookable again');
eq(calendars['cal-insole'].events[0].description, '言語: 韓国語（KO）\n同行: 不要', 'ko event: no escort');

// --- "now"
resetBackend();
eq(post({ lang: 'ko', service: 'insole', type: 'now', name: '김', persons: 1 }), { ok: true }, 'now ok');
eq(fetchCalls[0].text, '🔔 お客様がいらっしゃいました｜👟 インソール｜김様（1名）\n🇰🇷 韓国語のお客様（対応可能）', 'now ko message');
eq(calendars['cal-insole'].events.length, 0, 'now: no calendar entry');
addBusy('cal-studio', '00:00', '23:59');
eq(post({ lang: 'ja', service: 'studio', type: 'now', name: '山田', persons: 3 }).ok, true, 'now ignores slots (team decides)');
eq(fetchCalls[1].text, '🔔 お客様がいらっしゃいました｜📸 フォトスタジオ｜山田様（3名）', 'now ja studio message');

// --- validation: nothing is sent or booked
resetBackend();
[
  ['not json', 'bad json'],
  [[1, 2], 'array'],
  [{ lang: 'de', service: 'spa', type: 'now', name: 'X', persons: 1 }, 'unknown service'],
  [{ lang: 'de', type: 'now', name: 'X', persons: 1 }, 'missing service'],
  [{ lang: 'fr', service: 'insole', type: 'now', name: 'X', persons: 1 }, 'unknown language'],
  [{ lang: 'de', service: 'insole', type: 'soon', name: 'X', persons: 1 }, 'unknown type'],
  [{ lang: 'de', service: 'insole', type: 'now', name: '', persons: 1 }, 'empty name'],
  [{ lang: 'de', service: 'insole', type: 'now', name: '<users/all>', persons: 1 }, 'mention'],
  [{ lang: 'de', service: 'insole', type: 'now', name: 'X', persons: 6 }, 'too many persons'],
  [{ lang: 'de', service: 'insole', type: 'now', name: 'X', persons: '2' }, 'persons as string'],
  [{ lang: 'de', service: 'insole', type: 'later', name: 'X', persons: 1 }, 'later without start'],
  [{ lang: 'de', service: 'insole', type: 'later', name: 'X', persons: 1, start: '9:00' }, 'bad time'],
  [{ requestId: 'x', lang: 'de', service: 'insole', type: 'now', name: 'X', persons: 1 }, 'bad requestId']
].forEach(function (c) { eq(post(c[0]).reason, 'invalid', 'rejected: ' + c[1]); });
eq(doPost({}).getContent().indexOf('"reason":"invalid"') !== -1, true, 'rejected: missing body');
cfg.services[1].active = false;
eq(post({ lang: 'de', service: 'studio', type: 'now', name: 'X', persons: 1 }).reason, 'invalid', 'rejected: inactive service');
eq(get({ action: 'slots', service: 'studio', persons: '1' }).reason, 'invalid', 'slots: inactive service');
cfg.services[1].active = true;
cfg.services[0].types = ['later'];
eq(post({ lang: 'de', service: 'insole', type: 'now', name: 'X', persons: 1 }).reason, 'invalid', 'rejected: type not allowed for service');
cfg.services[0].types = ['now', 'later'];
eq([fetchCalls.length, calendars['cal-insole'].events.length], [0, 0], 'no webhook call and no event for invalid requests');

// --- duplicates and idempotency
resetBackend();
eq(post({ lang: 'de', service: 'insole', type: 'now', name: 'Müller', persons: 1 }).ok, true, 'first request');
eq(post({ lang: 'de', service: 'insole', type: 'later', name: 'müller', persons: 1, start: '13:00' }), { ok: true, duplicate: true },
  'same name + service within 30 s ignored (case-insensitive, any type)');
eq([fetchCalls.length, calendars['cal-insole'].events.length], [1, 0], 'duplicate: no webhook, no event');
eq(post({ lang: 'de', service: 'studio', type: 'now', name: 'Müller', persons: 1 }).ok, true, 'same name, other service is fine');
cacheStore = {}; // window expired
eq(post({ lang: 'de', service: 'insole', type: 'now', name: 'Müller', persons: 1 }), { ok: true }, 'after the window: sent again');

resetBackend();
var payload = { requestId: 'abcdef12-3456', lang: 'en', service: 'insole', type: 'later', name: 'Brown', persons: 1, start: '09:00' };
var first = post(payload);
cacheStore = Object.keys(cacheStore).reduce(function (o, k) { if (k.indexOf('dup_') !== 0) o[k] = cacheStore[k]; return o; }, {});
eq(post(payload), first, 'retry with same requestId returns the first answer');
var viaJsonp = doGet({ parameter: { action: 'book', data: JSON.stringify(payload), callback: 'cb' } }).getContent();
eq(viaJsonp, 'cb(' + JSON.stringify(first) + ');', 'JSONP booking fallback with same requestId returns the first answer');
eq([calendars['cal-insole'].events.length, fetchCalls.length], [1, 1], 'retries do not book or notify twice');

// --- webhooks
resetBackend();
props.WEBHOOK_URL_STUDIO = 'https://chat.googleapis.com/v1/spaces/STUDIO/messages?key=k&token=t';
post({ lang: 'ja', service: 'studio', type: 'now', name: 'A', persons: 1 });
post({ lang: 'ja', service: 'insole', type: 'now', name: 'A', persons: 1 });
eq([fetchCalls[0].url.indexOf('STUDIO') !== -1, fetchCalls[1].url.indexOf('AAA') !== -1], [true, true], 'per-service webhook overrides the default');

resetBackend();
delete props.WEBHOOK_URL;
eq(post({ lang: 'ja', service: 'insole', type: 'now', name: 'A', persons: 1 }).reason, 'notify_failed', 'now without webhook -> notify_failed');
eq(post({ lang: 'ja', service: 'insole', type: 'later', name: 'B', persons: 1, start: '09:00' }), { ok: true, start: '09:00', end: '09:45', notified: false },
  'later: booking stays even if the chat message fails');
props.WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';
webhookStatus = 500;
eq(post({ lang: 'ja', service: 'insole', type: 'now', name: 'C', persons: 1 }).reason, 'notify_failed', 'webhook HTTP 500 -> notify_failed');
webhookStatus = 200;
eq(post({ lang: 'ja', service: 'insole', type: 'now', name: 'C', persons: 1 }).ok, true, 'failed send is not marked as duplicate');

// --- rate limit
resetBackend();
var limited = 0;
for (var i = 0; i < 35; i++) {
  var nm = 'Rate' + 'abcdefg'.charAt(i % 7) + 'abcde'.charAt(Math.floor(i / 7));
  if (post({ lang: 'ja', service: 'insole', type: 'now', name: nm, persons: 1 }).reason === 'rate_limited') limited++;
}
eq(limited, 5, 'rate limit: 30 per window');

print('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) throw new Error(failed + ' test(s) failed');
