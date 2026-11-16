/*
 * Pure, DOM-free logic shared by frontend AND backend.
 *
 * Used by the kiosk page, by the tests, and in the Apps Script project as
 * "Logic.gs" (copy the whole file). Keep it free of browser/Apps Script APIs.
 * All times are minutes since midnight (local time of the room).
 */
var KioskLogic = (function () {
  'use strict';

  var LANGS = ['ja', 'en', 'ko', 'de'];
  var TYPES = ['now', 'later'];
  var DAY_MINUTES = 24 * 60;
  var TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
  // Letters of any script (Latin, Kanji, Kana, Hangul, ...), combining marks,
  // spaces, apostrophes, dots, hyphens and the Japanese middle dot.
  var NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’.\-・]*$/u;

  /* ---------- time helpers ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** "HH:MM" -> minutes since midnight, or NaN. "24:00" is accepted as end of day. */
  function parseHHMM(value) {
    if (value === '24:00') return DAY_MINUTES;
    if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return NaN;
    return parseInt(value.slice(0, 2), 10) * 60 + parseInt(value.slice(3, 5), 10);
  }

  function formatHHMM(minutes) {
    return pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);
  }

  function isValidTime(value) {
    return typeof value === 'string' && TIME_PATTERN.test(value);
  }

  function ceilToStep(minutes, step) {
    return Math.ceil(minutes / step) * step;
  }

  /* ---------- services ---------- */

  function activeServices(config) {
    return (config.services || []).filter(function (s) { return s.active !== false; });
  }

  /** Known and active service with this id, or null. */
  function findService(config, id) {
    var list = activeServices(config);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function durationFor(service, persons) {
    return service.baseMinutes + (service.extraMinutesPerPerson || 0) * (persons - 1);
  }

  /* ---------- slots ---------- */

  /** base interval minus busy intervals -> list of free intervals */
  function subtractIntervals(base, busy) {
    var free = [base];
    busy.forEach(function (b) {
      var next = [];
      free.forEach(function (f) {
        if (b.end <= f.start || b.start >= f.end) { next.push(f); return; }
        if (b.start > f.start) next.push({ start: f.start, end: b.start });
        if (b.end < f.end) next.push({ start: b.end, end: f.end });
      });
      free = next;
    });
    return free;
  }

  /**
   * Free slots of one day.
   * opts: {
   *   blocks:      [{start:'09:00', end:'12:00'}, ...]  opening blocks
   *   busy:        [{start:600, end:645}, ...]          existing bookings (minutes)
   *   nowMinutes:  current time of day (minutes)
   *   leadMinutes, stepMinutes, durationMinutes, maxSlots
   * }
   * Per block: free intervals = block minus bookings minus (now + lead).
   * In each interval, slots of the duration are laid out back to back, starting
   * at the first grid point (rounded up); a slot must fit completely.
   * Returns up to maxSlots {start:'HH:MM', end:'HH:MM'} sorted by start.
   */
  function computeFreeSlots(opts) {
    var duration = opts.durationMinutes;
    var step = opts.stepMinutes || 15;
    var earliest = opts.nowMinutes + (opts.leadMinutes || 0);
    var busy = (opts.busy || []).filter(function (b) { return b.end > b.start; });
    var slots = [];
    if (!(duration > 0)) return slots;

    (opts.blocks || []).forEach(function (block) {
      var start = Math.max(parseHHMM(block.start), earliest);
      var end = parseHHMM(block.end);
      if (isNaN(start) || isNaN(end) || start >= end) return;
      subtractIntervals({ start: start, end: end }, busy).forEach(function (free) {
        for (var t = ceilToStep(free.start, step); t + duration <= free.end; t += duration) {
          slots.push({ start: t, end: t + duration });
        }
      });
    });

    slots.sort(function (a, b) { return a.start - b.start; });
    return slots.slice(0, opts.maxSlots || 8).map(function (s) {
      return { start: formatHHMM(s.start), end: formatHHMM(s.end) };
    });
  }

  /**
   * Booking check: [start, start+duration) lies inside one opening block,
   * does not overlap a booking and has not started yet.
   */
  function isIntervalFree(opts, startMinutes) {
    var end = startMinutes + opts.durationMinutes;
    if (startMinutes < opts.nowMinutes) return false;
    var inBlock = (opts.blocks || []).some(function (b) {
      return startMinutes >= parseHHMM(b.start) && end <= parseHHMM(b.end);
    });
    if (!inBlock) return false;
    return !(opts.busy || []).some(function (b) { return b.start < end && b.end > startMinutes; });
  }

  /* ---------- names ---------- */

  /** NFC, collapse all whitespace (incl. full-width space) and trim. */
  function normalizeName(raw) {
    var s = String(raw == null ? '' : raw);
    if (s.normalize) s = s.normalize('NFC');
    return s.replace(/\s+/g, ' ').trim();
  }

  /** -> { ok: true, value } or { ok: false, error: 'empty'|'too_long'|'invalid_chars' } */
  function validateName(raw, maxLength) {
    var name = normalizeName(raw);
    if (!name) return { ok: false, error: 'empty' };
    if (Array.from(name).length > maxLength) return { ok: false, error: 'too_long' };
    if (!NAME_PATTERN.test(name)) return { ok: false, error: 'invalid_chars' };
    return { ok: true, value: name };
  }

  function isValidPersons(n, max) {
    return typeof n === 'number' && n % 1 === 0 && n >= 1 && n <= max;
  }

  /* ---------- request validation (used by the backend) ---------- */

  /**
   * -> { ok: true, value: {lang, service, type, name, persons, start?, requestId?} }
   *    or { ok: false, error }
   */
  function validateRequest(data, config) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'bad_body' };
    var service = findService(config, data.service);
    if (!service) return { ok: false, error: 'bad_service' };
    if (LANGS.indexOf(data.lang) === -1) return { ok: false, error: 'bad_lang' };
    if (TYPES.indexOf(data.type) === -1 || service.types.indexOf(data.type) === -1) return { ok: false, error: 'bad_type' };

    if (typeof data.name !== 'string') return { ok: false, error: 'bad_name' };
    var name = validateName(data.name, config.nameMaxLength);
    if (!name.ok) return { ok: false, error: 'bad_name' };

    var persons = data.persons === undefined ? 1 : data.persons;
    if (!isValidPersons(persons, service.peopleMax)) return { ok: false, error: 'bad_persons' };

    var req = { lang: data.lang, service: service.id, type: data.type, name: name.value, persons: persons };
    if (data.type === 'later') {
      if (!isValidTime(data.start)) return { ok: false, error: 'bad_time' };
      req.start = data.start;
    }
    if (data.requestId !== undefined) {
      if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(data.requestId)) return { ok: false, error: 'bad_request_id' };
      req.requestId = data.requestId;
    }
    return { ok: true, value: req };
  }

  /* ---------- texts for chat and calendar ---------- */

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (m, key) {
      return values[key] === undefined ? m : String(values[key]);
    });
  }

  function serviceLabel(service, text) {
    return (text.serviceLabel && text.serviceLabel[service.id]) || (service.icon + ' ' + service.name.ja);
  }

  function needsEscort(service, lang) {
    return (service.escortLanguages || []).indexOf(lang) !== -1;
  }

  /** req: {lang, type, name, persons, start?, end?} */
  function buildChatMessage(req, service, text) {
    var head = fill(req.type === 'later' ? text.later : text.now, {
      service: serviceLabel(service, text),
      name: req.name,
      persons: req.persons,
      start: req.start,
      end: req.end
    });
    var note = needsEscort(service, req.lang) ? text.escortNote[req.lang] : text.infoNote[req.lang];
    return note ? head + '\n' + note : head;
  }

  function buildEventTitle(req, text) {
    return fill(text.eventTitle, { name: req.name, persons: req.persons, langCode: req.lang.toUpperCase() });
  }

  function buildEventDescription(req, service, text) {
    return fill(text.eventDescription, {
      langName: text.langName[req.lang],
      langCode: req.lang.toUpperCase(),
      escort: needsEscort(service, req.lang) ? text.escortYes : text.escortNo
    });
  }

  return {
    LANGS: LANGS,
    TYPES: TYPES,
    DAY_MINUTES: DAY_MINUTES,
    parseHHMM: parseHHMM,
    formatHHMM: formatHHMM,
    isValidTime: isValidTime,
    ceilToStep: ceilToStep,
    activeServices: activeServices,
    findService: findService,
    durationFor: durationFor,
    subtractIntervals: subtractIntervals,
    computeFreeSlots: computeFreeSlots,
    isIntervalFree: isIntervalFree,
    normalizeName: normalizeName,
    validateName: validateName,
    isValidPersons: isValidPersons,
    validateRequest: validateRequest,
    needsEscort: needsEscort,
    buildChatMessage: buildChatMessage,
    buildEventTitle: buildEventTitle,
    buildEventDescription: buildEventDescription
  };
})();
