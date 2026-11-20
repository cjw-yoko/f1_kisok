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
  // Company names may also contain digits and a few punctuation marks,
  // but nothing that formats or mentions in Google Chat (< > * _ ~ ` @).
  var COMPANY_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} &'’.,\-・()（）\/]*$/u;
  var MENTION_PATTERN = /^users\/(all|\d+)$/;

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

  /* ---------- config lookups ---------- */

  function isActive(item) { return !!item && item.active !== false; }

  function findById(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function activeServices(config) {
    return (config.services || []).filter(isActive);
  }

  /** Known and active service with this id, or null. */
  function findService(config, id) {
    return findById(activeServices(config), id);
  }

  function findGroup(config, id) {
    return findById(config.serviceGroups, id);
  }

  function activeCompanies(config) {
    return (config.companies || []).filter(function (c) { return isActive(c) && activeDepartments(c).length > 0; });
  }

  function findCompany(config, id) {
    return findById(activeCompanies(config), id);
  }

  function activeDepartments(company) {
    return ((company && company.departments) || []).filter(isActive);
  }

  function findDepartment(company, id) {
    return findById(activeDepartments(company), id);
  }

  function deliveryActive(config) {
    return isActive(config.delivery);
  }

  function findCarrier(config, id) {
    return findById(config.delivery && config.delivery.carriers, id);
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

  /** Company name; optional unless required is true. */
  function validateCompany(raw, maxLength, required) {
    var company = normalizeName(raw);
    if (!company) return required ? { ok: false, error: 'empty' } : { ok: true, value: '' };
    if (Array.from(company).length > maxLength) return { ok: false, error: 'too_long' };
    if (!COMPANY_PATTERN.test(company)) return { ok: false, error: 'invalid_chars' };
    return { ok: true, value: company };
  }

  function isValidPersons(n, max) {
    return typeof n === 'number' && n % 1 === 0 && n >= 1 && n <= max;
  }

  /* ---------- request validation (used by the backend) ---------- */

  function checkRequestId(data, req) {
    if (data.requestId === undefined) return null;
    if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(data.requestId)) return { ok: false, error: 'bad_request_id' };
    req.requestId = data.requestId;
    return null;
  }

  /**
   * Validates any kiosk request. kind: 'service' (default), 'visit' or 'delivery'.
   * -> { ok: true, value: {...normalized request, kind} } or { ok: false, error }
   */
  function validateRequest(data, config) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'bad_body' };
    if (LANGS.indexOf(data.lang) === -1) return { ok: false, error: 'bad_lang' };
    var kind = data.kind === undefined ? 'service' : data.kind;
    if (kind === 'visit') return validateVisitRequest(data, config);
    if (kind === 'delivery') return validateDeliveryRequest(data, config);
    if (kind === 'service') return validateServiceRequest(data, config);
    return { ok: false, error: 'bad_kind' };
  }

  /** Visitor of one of our companies: {lang, host, department, name, company?} */
  function validateVisitRequest(data, config) {
    var host = findCompany(config, data.host);
    if (!host) return { ok: false, error: 'bad_host' };
    var department = findDepartment(host, data.department);
    if (!department) return { ok: false, error: 'bad_department' };
    var companyRaw = data.company === undefined ? '' : data.company;
    if (typeof data.name !== 'string' || typeof companyRaw !== 'string') return { ok: false, error: 'bad_body' };
    var name = validateName(data.name, config.visitNameMaxLength);
    if (!name.ok) return { ok: false, error: 'bad_name' };
    var company = validateCompany(companyRaw, config.visitCompanyMaxLength, false);
    if (!company.ok) return { ok: false, error: 'bad_company' };
    var req = { kind: 'visit', lang: data.lang, host: host.id, department: department.id, name: name.value, company: company.value };
    return checkRequestId(data, req) || { ok: true, value: req };
  }

  /** {lang, carrier} or {lang, carrier: 'other', company} */
  function validateDeliveryRequest(data, config) {
    if (!deliveryActive(config)) return { ok: false, error: 'bad_kind' };
    var company;
    if (data.carrier === 'other') {
      if (!config.delivery.allowOther || typeof data.company !== 'string') return { ok: false, error: 'bad_company' };
      var c = validateCompany(data.company, config.delivery.companyMaxLength, true);
      if (!c.ok) return { ok: false, error: 'bad_company' };
      company = c.value;
    } else {
      var carrier = findCarrier(config, data.carrier);
      if (!carrier) return { ok: false, error: 'bad_carrier' };
      company = carrier.label;
    }
    var req = { kind: 'delivery', lang: data.lang, carrier: data.carrier, company: company };
    return checkRequestId(data, req) || { ok: true, value: req };
  }

  /** {lang, service, type, name, persons, start?} */
  function validateServiceRequest(data, config) {
    var service = findService(config, data.service);
    if (!service) return { ok: false, error: 'bad_service' };
    if (TYPES.indexOf(data.type) === -1 || service.types.indexOf(data.type) === -1) return { ok: false, error: 'bad_type' };

    if (typeof data.name !== 'string') return { ok: false, error: 'bad_name' };
    var name = validateName(data.name, config.nameMaxLength);
    if (!name.ok) return { ok: false, error: 'bad_name' };

    var persons = data.persons === undefined ? 1 : data.persons;
    if (!isValidPersons(persons, service.peopleMax)) return { ok: false, error: 'bad_persons' };

    var req = { kind: 'service', lang: data.lang, service: service.id, type: data.type, name: name.value, persons: persons };
    if (data.type === 'later') {
      if (!isValidTime(data.start)) return { ok: false, error: 'bad_time' };
      req.start = data.start;
    }
    return checkRequestId(data, req) || { ok: true, value: req };
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

  /** "users/123" / "users/all" -> "<users/123>", anything else -> '' (never trust free text). */
  function mentionTag(value) {
    var v = typeof value === 'string' ? value.trim() : '';
    return MENTION_PATTERN.test(v) ? '<' + v + '>' : '';
  }

  /** Puts the @mentions (e.g. "<users/all>", "<users/123>") in the first line. */
  function withMentions(body, mentions) {
    var tags = [];
    (mentions || []).forEach(function (m) { if (m && tags.indexOf(m) === -1) tags.push(m); });
    return tags.length ? tags.join(' ') + '\n' + body : body;
  }

  /** Service request. req: {lang, type, name, persons, start?, end?} */
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

  /** Visitor. req: {lang, host, department, name, company} */
  function buildVisitMessage(req, host, department, text) {
    var lines = [fill(text.visit, {
      company: (text.companyLabel && text.companyLabel[host.id]) || host.name,
      department: department.name.ja
    })];
    lines.push(fill(req.company ? text.visitorWithCompany : text.visitor, { name: req.name, company: req.company }));
    if (text.infoNote[req.lang]) lines.push(text.infoNote[req.lang]);
    if (department.other && text.visitOther) lines.push(text.visitOther);
    lines.push(fill(text.visitFooter, { floor: host.floor }));
    return lines.join('\n');
  }

  /** Delivery. req: {company} */
  function buildDeliveryMessage(req, text) {
    return fill(text.delivery, { company: req.company });
  }

  /** Chat text for any validated request (without @mentions). */
  function buildRequestMessage(req, config, text) {
    if (req.kind === 'visit') {
      var host = findCompany(config, req.host);
      return buildVisitMessage(req, host, findDepartment(host, req.department), text);
    }
    if (req.kind === 'delivery') return buildDeliveryMessage(req, text);
    return buildChatMessage(req, findService(config, req.service), text);
  }

  /** Script Property name whose value (users/<id>) is @mentioned for this request, or null. */
  function mentionPropertyFor(req, config) {
    if (req.kind === 'visit') {
      var d = findDepartment(findCompany(config, req.host), req.department);
      return (d && d.mentionProperty) || null;
    }
    if (req.kind === 'delivery') return (config.delivery && config.delivery.mentionProperty) || null;
    var s = findService(config, req.service);
    return (s && s.mentionProperty) || null;
  }

  function buildEventTitle(req, service, text) {
    return fill(text.eventTitle, {
      service: serviceLabel(service, text),
      name: req.name,
      persons: req.persons,
      langCode: req.lang.toUpperCase()
    });
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
    findGroup: findGroup,
    activeCompanies: activeCompanies,
    findCompany: findCompany,
    activeDepartments: activeDepartments,
    findDepartment: findDepartment,
    deliveryActive: deliveryActive,
    findCarrier: findCarrier,
    durationFor: durationFor,
    subtractIntervals: subtractIntervals,
    computeFreeSlots: computeFreeSlots,
    isIntervalFree: isIntervalFree,
    normalizeName: normalizeName,
    validateName: validateName,
    validateCompany: validateCompany,
    isValidPersons: isValidPersons,
    validateRequest: validateRequest,
    needsEscort: needsEscort,
    mentionTag: mentionTag,
    withMentions: withMentions,
    mentionPropertyFor: mentionPropertyFor,
    buildChatMessage: buildChatMessage,
    buildVisitMessage: buildVisitMessage,
    buildDeliveryMessage: buildDeliveryMessage,
    buildRequestMessage: buildRequestMessage,
    buildEventTitle: buildEventTitle,
    buildEventDescription: buildEventDescription
  };
})();
