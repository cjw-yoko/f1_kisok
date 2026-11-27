/*
 * Kiosk UI controller: screens, timers, submit lock, API access.
 * Depends on config.js, i18n.js and logic.js (loaded before this file).
 *
 * Screens: home (language) -> services (menu tiles)
 *   company tile  -> departments -> visit (name, company) -> confirm ("welcome, 3rd floor")
 *   group tile    -> group (e.g. ZEPHI insoles / foot care) -> request
 *   service tile  -> request (name, persons, now / slots) -> confirm
 *   delivery tile -> delivery (carriers / other) -> confirm ("수고하셨습니다!")
 */
(function () {
  'use strict';

  var cfg = KIOSK_CONFIG;
  var I18N = KIOSK_I18N;
  var L = KioskLogic;
  var LOCK_KEY = 'kiosk.lockUntil';
  var SLOT_RELOAD_DELAY_MS = 350;
  var INTERACTIVE_SCREENS = ['services', 'group', 'departments', 'visit', 'delivery', 'request'];

  var state = {
    lang: null,
    service: null,
    group: null,
    company: null,
    department: null,
    people: 1,
    mode: 'choose',          // request screen: 'choose' (now/later buttons) or 'slots'
    sending: false,
    lockUntil: 0,
    slotsSeq: 0,             // ignores outdated slot responses
    lastActivity: Date.now(),
    loadedAt: Date.now(),
    current: 'home'
  };
  var timers = { inactivity: null, confirm: null, lockTick: null, slotReload: null };

  function $(id) { return document.getElementById(id); }

  var el = {
    screens: {
      home: $('screen-home'),
      services: $('screen-services'),
      group: $('screen-group'),
      departments: $('screen-departments'),
      visit: $('screen-visit'),
      delivery: $('screen-delivery'),
      request: $('screen-request'),
      confirm: $('screen-confirm')
    },
    menuGrid: $('menu-grid'),
    // group
    groupLogo: $('group-logo'),
    groupTitle: $('group-title'),
    groupName: $('group-name'),
    groupGrid: $('group-grid'),
    // company
    departmentsLogo: $('departments-logo'),
    departmentsCompany: $('departments-company'),
    departmentGrid: $('department-grid'),
    visitCompanyName: $('visit-company-name'),
    visitTitle: $('visit-title'),
    visitBack: $('btn-visit-back'),
    visitName: $('visit-name'),
    visitCompany: $('visit-company'),
    btnVisitSend: $('btn-visit-send'),
    // delivery
    carrierGrid: $('carrier-grid'),
    deliveryOther: $('delivery-other'),
    deliveryForm: $('delivery-form'),
    deliveryCompany: $('delivery-company'),
    btnDeliverySend: $('btn-delivery-send'),
    // request
    requestEyebrow: $('request-eyebrow'),
    requestTitle: $('request-title'),
    requestIntro: $('request-intro'),
    requestBack: $('btn-request-back'),
    form: $('request-form'),
    name: $('name-input'),
    nameError: $('name-error'),
    peopleValue: $('people-value'),
    peopleLess: $('people-less'),
    peopleMore: $('people-more'),
    choosePanel: $('choose-panel'),
    btnNow: $('btn-now'),
    btnLater: $('btn-later'),
    slotPanel: $('slot-panel'),
    slotsInfo: $('slots-info'),
    slotsLoading: $('slots-loading'),
    slotsLoadError: $('slots-load-error'),
    btnRetry: $('btn-retry'),
    slotGrid: $('slot-grid'),
    noSlots: $('no-slots'),
    noSlotsNowText: $('no-slots-now-text'),
    btnNoSlotsNow: $('btn-noslots-now'),
    // confirmation
    confirmTitle: $('confirm-title'),
    confirmText: $('confirm-text'),
    confirmCountdown: $('confirm-countdown'),
    dryRunBox: $('dryrun-box'),
    dryRunMessage: $('dryrun-message'),
    btnDone: $('btn-done')
  };

  /* =================== i18n =================== */

  function t(key, arg) {
    var dict = I18N[state.lang] || I18N.ja;
    var value = dict[key];
    return typeof value === 'function' ? value(arg) : value;
  }

  function applyTranslations() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    nodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-placeholder')));
    nodes = document.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-label', t(nodes[i].getAttribute('data-i18n-aria')));
  }

  /** Localized text from a {ja, en, ko, de} object (plain strings are returned as is). */
  function local(obj) {
    if (typeof obj === 'string') return obj;
    return (obj && (obj[state.lang] || obj.en || obj.ja)) || '';
  }

  function hasType(type) {
    return !!state.service && state.service.types.indexOf(type) !== -1;
  }

  function rangeText(slot) {
    return slot.start + '–' + slot.end;
  }

  function span(className, text) {
    var node = document.createElement('span');
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** SVG icon from icons.js by key; an unknown key (e.g. an emoji) is shown as text. */
  function iconNode(key, className) {
    var node = span(className);
    node.setAttribute('aria-hidden', 'true');
    if (typeof KIOSK_ICONS !== 'undefined' && KIOSK_ICONS[key]) node.innerHTML = KIOSK_ICONS[key];
    else node.textContent = key || '';
    return node;
  }

  function logoNode(src, className) {
    var img = document.createElement('img');
    img.className = className;
    img.src = src;
    img.alt = '';   // the name is written next to the logo
    return img;
  }

  function button(className, children, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ' + className;
    children.forEach(function (c) { if (c) btn.appendChild(c); });
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* =================== API =================== */

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function toQuery(params) {
    return Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  function isConfiguredUrl(url) {
    return /^https:\/\/script\.google\.com\/.+\/exec$/.test(url || '') && url.indexOf('PASTE_') === -1;
  }

  /** CORS fetch that reads the JSON answer (Apps Script redirects to googleusercontent.com, which allows CORS). */
  function fetchJson(url, options) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, cfg.requestTimeoutSeconds * 1000);
    options.cache = 'no-store';
    options.redirect = 'follow';
    if (controller) options.signal = controller.signal;
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      clearTimeout(timeout);
      return data;
    }, function (err) {
      clearTimeout(timeout);
      throw err;
    });
  }

  /** JSONP fallback: the backend wraps its JSON in callback(...) when &callback= is given. */
  var jsonpSeq = 0;
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var name = '__kioskJsonp' + (++jsonpSeq) + '_' + Date.now();
      var script = document.createElement('script');
      var timer = setTimeout(function () { done(); reject(new Error('JSONP timeout')); }, cfg.requestTimeoutSeconds * 1000);
      function done() {
        clearTimeout(timer);
        window[name] = function () {}; // late answers are ignored
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[name] = function (data) { done(); resolve(data); };
      script.onerror = function () { done(); reject(new Error('JSONP request failed')); };
      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + name;
      document.head.appendChild(script);
    });
  }

  function callBackend(viaFetch, viaJsonp) {
    if (!isConfiguredUrl(cfg.appsScriptUrl)) return Promise.reject(new Error('appsScriptUrl is not configured in config.js'));
    if (navigator.onLine === false) return Promise.reject(new Error('offline'));
    if (cfg.transport === 'jsonp') return viaJsonp();
    var attempt = viaFetch();
    if (cfg.transport === 'fetch') return attempt;
    return attempt.catch(function (err) {
      if (err && err.name === 'AbortError') throw err; // timeout: do not send twice
      console.warn('Reading the response via fetch failed, using JSONP fallback:', err);
      return viaJsonp();
    });
  }

  var liveApi = {
    slots: function (serviceId, persons) {
      var url = cfg.appsScriptUrl + '?' + toQuery({ action: 'slots', service: serviceId, persons: persons });
      return callBackend(
        function () { return fetchJson(url, { method: 'GET' }); },
        function () { return jsonp(url); }
      );
    },
    request: function (payload) {
      return callBackend(
        function () {
          return fetchJson(cfg.appsScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request, no preflight
            body: JSON.stringify(payload)
          });
        },
        // Same requestId, so the backend answers a retry without booking or sending twice.
        function () { return jsonp(cfg.appsScriptUrl + '?' + toQuery({ action: 'book', data: JSON.stringify(payload) })); }
      );
    }
  };

  /* ----- dry run: local simulation with sample bookings (per calendar, like the backend) ----- */

  var dryBusy = {};

  function dryNowMinutes() {
    var simulated = L.parseHHMM(cfg.dryRunClock);
    if (!isNaN(simulated)) return simulated;
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function dryBusyFor(service) {
    var key = service.calendarProperty;
    if (!dryBusy[key]) {
      dryBusy[key] = ((cfg.dryRunBookings || {})[key] || []).map(function (b) {
        return { start: L.parseHHMM(b.start), end: L.parseHHMM(b.end) };
      });
    }
    return dryBusy[key];
  }

  function dryOptions(service, persons) {
    return {
      blocks: service.openingBlocks,
      busy: dryBusyFor(service),
      nowMinutes: dryNowMinutes(),
      leadMinutes: cfg.slotLeadMinutes,
      stepMinutes: cfg.slotStepMinutes,
      durationMinutes: L.durationFor(service, persons),
      maxSlots: cfg.maxSlots
    };
  }

  var dryApi = {
    slots: function (serviceId, persons) {
      var service = L.findService(cfg, serviceId);
      return delay(250).then(function () {
        if (!service) return { ok: false, reason: 'invalid' };
        var opts = dryOptions(service, persons);
        var slots = service.types.indexOf('later') !== -1 ? L.computeFreeSlots(opts) : [];
        console.log('[DRY RUN] slots', serviceId, persons + ' persons', JSON.stringify(slots));
        return { ok: true, duration: opts.durationMinutes, slots: slots };
      });
    },
    request: function (payload) {
      return delay(300).then(function () {
        var text = cfg.chatTextPreview;
        var check = L.validateRequest(payload, cfg);
        if (!check.ok) return { ok: false, reason: 'invalid', error: check.error };
        var req = check.value;
        if (req.kind === 'service' && req.type === 'later') {
          var service = L.findService(cfg, req.service);
          var opts = dryOptions(service, req.persons);
          var start = L.parseHHMM(req.start);
          if (!L.isIntervalFree(opts, start)) return { ok: false, reason: 'taken' };
          dryBusyFor(service).push({ start: start, end: start + opts.durationMinutes });
          req.end = L.formatHHMM(start + opts.durationMinutes);
          console.log('[DRY RUN] calendar event (' + service.calendarProperty + '): ' + L.buildEventTitle(req, service, text));
        }
        if (req.kind === 'service' && req.type === 'now' && L.findService(cfg, req.service).nowCheck) {
          var nowService = L.findService(cfg, req.service);
          var decision = L.decideNow({
            blocks: nowService.openingBlocks,
            busy: dryBusyFor(nowService),
            nowMinutes: dryNowMinutes(),
            durationMinutes: L.durationFor(nowService, req.persons)
          });
          if (decision.mode === 'full') return { ok: false, reason: 'full' };
          dryBusyFor(nowService).push({ start: decision.start, end: decision.end });
          req.mode = decision.mode;
          req.start = L.formatHHMM(decision.start);
          req.end = L.formatHHMM(decision.end);
          console.log('[DRY RUN] calendar event (' + nowService.calendarProperty + '): ' + L.buildEventTitle(req, nowService, text));
        }
        var prop = L.mentionPropertyFor(req, cfg);
        var message = L.withMentions(L.buildRequestMessage(req, cfg, text), [text.everyone, prop ? '[@' + prop + ']' : '']);
        console.log('[DRY RUN] payload:', JSON.stringify(payload));
        console.log('[DRY RUN] chat message:\n' + message);
        return { ok: true, mode: req.mode, start: req.start, end: req.end, preview: message };
      });
    }
  };

  var api = cfg.dryRun ? dryApi : liveApi;

  /* =================== screens =================== */

  function showScreen(name) {
    Object.keys(el.screens).forEach(function (key) {
      el.screens[key].hidden = key !== name;
    });
    state.current = name;
    var heading = el.screens[name].querySelector('h1');
    if (heading) {
      try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }
    }
    window.scrollTo(0, 0);
    armInactivity();
    updateLockUi();
  }

  function showError(message) {
    var node = el.screens[state.current] && el.screens[state.current].querySelector('.js-error');
    if (node) node.textContent = message;
  }

  function showErrorOn(screen, message) {
    var node = el.screens[screen].querySelector('.js-error');
    if (node) node.textContent = message;
  }

  function blurActive() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* =================== menu =================== */

  /** Tiles in display order: companies, service groups / services, delivery. */
  function menuEntries() {
    var entries = [];
    L.activeCompanies(cfg).forEach(function (c) { entries.push({ kind: 'company', company: c }); });
    var seenGroups = {};
    L.activeServices(cfg).forEach(function (s) {
      var group = s.group && L.findGroup(cfg, s.group);
      if (!group) { entries.push({ kind: 'service', service: s }); return; }
      if (seenGroups[group.id]) return;
      seenGroups[group.id] = true;
      entries.push({ kind: 'group', group: group });
    });
    if (L.deliveryActive(cfg)) entries.push({ kind: 'delivery' });
    return entries;
  }

  function groupServices(group) {
    return L.activeServices(cfg).filter(function (s) { return s.group === group.id; });
  }

  function openEntry(entry) {
    if (entry.kind === 'company') openDepartments(entry.company);
    else if (entry.kind === 'group') openGroup(entry.group);
    else if (entry.kind === 'delivery') openDelivery();
    else selectService(entry.service);
  }

  function selectLanguage(lang) {
    if (!I18N[lang] || !L.isLanguageAvailable(cfg, lang, kioskNow())) return;
    state.lang = lang;
    document.documentElement.lang = lang;
    applyTranslations();
    var entries = menuEntries();
    if (entries.length === 1) openEntry(entries[0]);
    else showMenu();
  }

  function showMenu() {
    if (menuEntries().length <= 1) { resetToHome(); return; }
    exitSlotsMode();
    state.service = null;
    state.group = null;
    state.company = null;
    state.department = null;
    renderMenu();
    showScreen('services');
  }

  function renderMenu() {
    el.menuGrid.innerHTML = '';
    menuEntries().forEach(function (entry) {
      var tile;
      if (entry.kind === 'company') {
        tile = button('btn-tile btn-tile-company', [
          entry.company.logo ? logoNode(entry.company.logo, 'tile-logo') : null,
          span('tile-name', local(entry.company.name))
        ], function () { openEntry(entry); });
      } else if (entry.kind === 'group') {
        var g = entry.group;
        tile = button('btn-tile btn-tile-brand', [
          g.logo ? logoNode(g.logo, 'tile-logo tile-logo-brand') : iconNode(g.icon || '', 'tile-icon'),
          !g.logo && g.title ? span('tile-title', g.title) : null,
          span('tile-name', local(g.name))
        ], function () { openEntry(entry); });
        tile.setAttribute('aria-label', (g.title ? g.title + ' ' : '') + local(g.name));
      } else if (entry.kind === 'service') {
        var sv = entry.service;
        tile = button('btn-tile btn-tile-brand', [
          sv.wordmark
            ? (function () {
                var mark = span('tile-mark');
                mark.appendChild(iconNode(sv.icon, 'tile-icon'));
                mark.appendChild(span('tile-wordmark', sv.wordmark));
                return mark;
              })()
            : iconNode(sv.icon, 'tile-icon'),
          span(sv.wordmark ? 'tile-name' : 'tile-title', local(sv.name))
        ], function () { openEntry(entry); });
      } else {
        tile = button('btn-tile btn-tile-wide', [
          iconNode(cfg.delivery.icon || 'parcel', 'tile-icon'),
          (function () {
            var text = span('tile-text');
            text.appendChild(span('tile-title', t('deliveryName')));
            text.appendChild(span('tile-sub', t('deliverySub')));
            return text;
          })()
        ], function () { openEntry(entry); });
      }
      var icon = tile.querySelector('.tile-icon');
      if (icon) icon.setAttribute('aria-hidden', 'true');
      el.menuGrid.appendChild(tile);
    });
    // An odd number of normal tiles: let the last one span the full row.
    var normal = el.menuGrid.querySelectorAll('.btn-tile:not(.btn-tile-wide)');
    if (normal.length % 2 === 1) normal[normal.length - 1].classList.add('btn-tile-wide-even');
  }

  /* =================== service groups (ZEPHI) =================== */

  function openGroup(group) {
    var services = groupServices(group);
    if (services.length === 1) { selectService(services[0]); return; }
    state.group = group;
    el.groupLogo.hidden = !group.logo;
    if (group.logo) { el.groupLogo.src = group.logo; el.groupLogo.alt = group.title || ''; }
    el.groupTitle.textContent = group.title || '';
    el.groupTitle.hidden = !group.title || !!group.logo;
    el.groupName.textContent = local(group.name);
    el.groupGrid.innerHTML = '';
    services.forEach(function (service) {
      el.groupGrid.appendChild(button('btn-choice', [
        iconNode(service.icon, 'choice-icon'),
        (function () {
          var text = span('choice-text');
          text.appendChild(span('choice-name', local(service.name)));
          text.appendChild(span('choice-sub', t('durationHint', L.durationFor(service, 1))));
          return text;
        })()
      ], function () { selectService(service); }));
    });
    showScreen('group');
  }

  /* =================== services (request screen) =================== */

  function selectService(service) {
    state.service = service;
    state.nowFull = false;
    state.people = Math.min(state.people, service.peopleMax);
    var group = service.group && L.findGroup(cfg, service.group);
    el.requestEyebrow.textContent = group && group.title ? group.title : '';
    el.requestEyebrow.hidden = !(group && group.title);
    el.requestTitle.textContent = '';
    el.requestTitle.appendChild(iconNode(service.icon, 'title-icon'));
    el.requestTitle.appendChild(document.createTextNode(local(service.name)));
    el.btnNow.hidden = !hasType('now');
    el.btnLater.hidden = !hasType('later');
    clearRequestErrors();
    renderPeople();
    showScreen('request');
    // Only "later" allowed: skip the buttons and show the slots right away.
    if (!hasType('now')) enterSlotsMode(); else exitSlotsMode();
  }

  function enterSlotsMode() {
    state.mode = 'slots';
    el.choosePanel.hidden = true;
    el.slotPanel.hidden = false;
    el.requestIntro.textContent = t('requestIntroLater');
    loadSlots();
  }

  function exitSlotsMode() {
    state.mode = 'choose';
    state.slotsSeq++;
    clearTimeout(timers.slotReload);
    el.choosePanel.hidden = false;
    el.slotPanel.hidden = true;
    el.slotGrid.innerHTML = '';
    el.requestIntro.textContent = t('requestIntro');
    showErrorOn('request', '');
  }

  function goBackFromRequest() {
    if (state.mode === 'slots' && hasType('now')) { exitSlotsMode(); return; }
    var group = state.service && state.service.group && L.findGroup(cfg, state.service.group);
    if (group && groupServices(group).length > 1) { exitSlotsMode(); openGroup(group); return; }
    showMenu();
  }

  /* =================== companies (Yoko / WYS): visitor check-in =================== */

  var VISIT_FIELDS = ['visitName', 'visitCompany'];

  function openDepartments(company) {
    state.company = company;
    var departments = L.activeDepartments(company);
    if (departments.length === 1) { openVisit(departments[0]); return; }
    el.departmentsLogo.hidden = !company.logo;
    if (company.logo) el.departmentsLogo.src = company.logo;
    el.departmentsLogo.alt = local(company.name);
    el.departmentsCompany.textContent = local(company.name);
    el.departmentGrid.innerHTML = '';
    departments.forEach(function (d, i) {
      var num = span('choice-num', (i < 9 ? '0' : '') + (i + 1));
      num.setAttribute('aria-hidden', 'true');
      el.departmentGrid.appendChild(button('btn-choice' + (d.other ? ' btn-choice-other' : ''), [
        num,
        span('choice-name', local(d.name))
      ], function () { openVisit(d); }));
    });
    showScreen('departments');
  }

  function openVisit(department) {
    state.department = department;
    el.visitCompanyName.textContent = local(state.company.name);
    el.visitTitle.textContent = local(department.name);
    clearVisitErrors();
    showScreen('visit');
  }

  function backFromVisit() {
    if (state.company && L.activeDepartments(state.company).length > 1) showScreen('departments');
    else showMenu();
  }

  function setFieldError(input, message) {
    var node = $(input.id + '-error');
    if (node) node.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }

  function clearVisitErrors() {
    VISIT_FIELDS.forEach(function (key) { setFieldError(el[key], ''); });
    showErrorOn('visit', '');
  }

  /** Validates name and company, shows every error at once; returns the values or null. */
  function readVisit() {
    var name = L.validateName(el.visitName.value, cfg.visitNameMaxLength);
    var company = L.validateCompany(el.visitCompany.value, cfg.visitCompanyMaxLength, false);
    var nameMsg = { empty: t('errNameRequired'), too_long: t('errMaxLen', cfg.visitNameMaxLength), invalid_chars: t('errChars') };
    var companyMsg = { too_long: t('errMaxLen', cfg.visitCompanyMaxLength), invalid_chars: t('errCompanyChars') };
    setFieldError(el.visitName, name.ok ? '' : nameMsg[name.error]);
    setFieldError(el.visitCompany, company.ok ? '' : companyMsg[company.error]);
    if (!name.ok || !company.ok) return null;
    el.visitName.value = name.value;
    el.visitCompany.value = company.value;
    return { name: name.value, company: company.value };
  }

  function submitVisit() {
    if (!state.company || !state.department || isBlocked()) return;
    var data = readVisit();
    if (!data) return;
    blurActive();
    var company = state.company;
    sendRequest({
      requestId: newRequestId(),
      kind: 'visit',
      lang: state.lang,
      host: company.id,
      department: state.department.id,
      name: data.name,
      company: data.company
    }, function () {
      return { title: t('welcomeTitle'), text: t('confirmVisit', company.floor) };
    });
  }

  /* =================== deliveries =================== */

  function openDelivery() {
    el.carrierGrid.innerHTML = '';
    (cfg.delivery.carriers || []).forEach(function (carrier) {
      el.carrierGrid.appendChild(button('btn-carrier js-submit', [
        span('carrier-label', carrier.label),
        carrier.sub ? span('carrier-sub', carrier.sub) : null
      ], function () { submitDelivery(carrier.id); }));
    });
    if (cfg.delivery.allowOther) {
      var other = button('btn-carrier btn-carrier-other', [span('', t('deliveryOther'))], function () {
        el.deliveryOther.hidden = false;
        other.setAttribute('aria-expanded', 'true');
        el.deliveryCompany.focus();
      });
      other.setAttribute('aria-expanded', 'false');
      el.carrierGrid.appendChild(other);
    }
    el.deliveryOther.hidden = true;
    el.deliveryCompany.value = '';
    setFieldError(el.deliveryCompany, '');
    showErrorOn('delivery', '');
    showScreen('delivery');
  }

  function submitDelivery(carrierId) {
    if (isBlocked()) return;
    var payload = { requestId: newRequestId(), kind: 'delivery', lang: state.lang, carrier: carrierId };
    if (carrierId === 'other') {
      var company = L.validateCompany(el.deliveryCompany.value, cfg.delivery.companyMaxLength, true);
      var msg = { empty: t('errCompanyEmpty'), too_long: t('errMaxLen', cfg.delivery.companyMaxLength), invalid_chars: t('errCompanyChars') };
      setFieldError(el.deliveryCompany, company.ok ? '' : msg[company.error]);
      if (!company.ok) return;
      el.deliveryCompany.value = company.value;
      payload.company = company.value;
    }
    blurActive();
    sendRequest(payload, function () {
      return { title: t('deliveryGreeting'), text: t('confirmDelivery') };
    });
  }

  /* =================== language availability (e.g. German not on weekdays 12:30–17:00) =================== */

  /** Kiosk clock; in dry-run mode dryRunClock can simulate the time of day. */
  function kioskNow() {
    var now = new Date();
    var simulated = cfg.dryRun ? L.parseHHMM(cfg.dryRunClock) : NaN;
    if (!isNaN(simulated)) now.setHours(Math.floor(simulated / 60), simulated % 60, 0, 0);
    return now;
  }

  function updateLanguageAvailability() {
    var now = kioskNow();
    var buttons = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < buttons.length; i++) {
      var lang = buttons[i].getAttribute('data-lang');
      var available = L.isLanguageAvailable(cfg, lang, now);
      buttons[i].disabled = !available;
      var note = document.querySelector('[data-lang-note="' + lang + '"]');
      if (note) {
        var rules = cfg.languageAvailability && cfg.languageAvailability[lang];
        note.textContent = rules && rules.note ? rules.note : '';
        note.hidden = available || !note.textContent;
      }
    }
  }

  /* =================== reset =================== */

  function resetToHome() {
    clearTimeout(timers.confirm);
    clearTimeout(timers.inactivity);
    clearTimeout(timers.slotReload);
    blurActive();
    state.slotsSeq++;
    state.lang = null;
    state.service = null;
    state.group = null;
    state.company = null;
    state.department = null;
    state.people = 1;
    state.mode = 'choose';
    el.name.value = '';
    VISIT_FIELDS.forEach(function (key) { el[key].value = ''; });
    el.deliveryCompany.value = '';
    el.deliveryOther.hidden = true;
    [el.slotGrid, el.menuGrid, el.groupGrid, el.departmentGrid, el.carrierGrid].forEach(function (g) { g.innerHTML = ''; });
    el.dryRunMessage.textContent = '';
    clearRequestErrors();
    clearVisitErrors();
    setFieldError(el.deliveryCompany, '');
    var errors = document.querySelectorAll('.js-error');
    for (var i = 0; i < errors.length; i++) errors[i].textContent = '';
    document.documentElement.lang = 'ja';
    updateLanguageAvailability();
    showScreen('home');
    maybeReload();
  }

  /* =================== inactivity =================== */

  function armInactivity() {
    clearTimeout(timers.inactivity);
    if (INTERACTIVE_SCREENS.indexOf(state.current) !== -1) {
      timers.inactivity = setTimeout(resetToHome, cfg.inactivityTimeoutSeconds * 1000);
    }
  }

  function onActivity() {
    state.lastActivity = Date.now();
    armInactivity();
  }

  /* =================== persons =================== */

  function renderPeople() {
    var max = state.service ? state.service.peopleMax : 1;
    el.peopleValue.textContent = t('peopleUnit', state.people);
    el.peopleLess.disabled = state.people <= 1;
    el.peopleMore.disabled = state.people >= max;
  }

  function changePeople(delta) {
    var next = state.people + delta;
    if (!state.service || next < 1 || next > state.service.peopleMax) return;
    state.people = next;
    renderPeople();
    if (state.mode === 'slots') {
      // Hide old slots immediately, reload after a short pause (several taps = one request).
      state.slotsSeq++;
      showSlotsLoading();
      clearTimeout(timers.slotReload);
      timers.slotReload = setTimeout(loadSlots, SLOT_RELOAD_DELAY_MS);
    }
  }

  /* =================== errors (request screen) =================== */

  function clearRequestErrors() {
    el.nameError.textContent = '';
    el.name.removeAttribute('aria-invalid');
    showErrorOn('request', '');
  }

  var NAME_ERRORS = { empty: 'errEmpty', too_long: 'errTooLong', invalid_chars: 'errChars' };

  /** Validates the last-name field; shows the error and returns null if invalid. */
  function readName() {
    var result = L.validateName(el.name.value, cfg.nameMaxLength);
    if (!result.ok) {
      el.nameError.textContent = t(NAME_ERRORS[result.error]);
      el.name.setAttribute('aria-invalid', 'true');
      return null;
    }
    el.nameError.textContent = '';
    el.name.removeAttribute('aria-invalid');
    el.name.value = result.value;
    return result.value;
  }

  /* =================== submit lock =================== */

  function lockRemaining() {
    return Math.max(0, Math.ceil((state.lockUntil - Date.now()) / 1000));
  }

  function isBlocked() {
    return state.sending || lockRemaining() > 0;
  }

  function loadLock() {
    try {
      var stored = parseInt(window.localStorage.getItem(LOCK_KEY), 10) || 0;
      // Guard against clock changes: never lock longer than the configured time.
      state.lockUntil = Math.min(stored, Date.now() + cfg.submitLockSeconds * 1000);
    } catch (e) { state.lockUntil = 0; }
  }

  function setLock() {
    state.lockUntil = Date.now() + cfg.submitLockSeconds * 1000;
    try { window.localStorage.setItem(LOCK_KEY, String(state.lockUntil)); } catch (e) { /* memory only */ }
    startLockTick();
  }

  function startLockTick() {
    clearInterval(timers.lockTick);
    updateLockUi();
    if (lockRemaining() > 0) timers.lockTick = setInterval(updateLockUi, 1000);
  }

  /** All submit buttons (class js-submit) are disabled while sending or locked. */
  function updateLockUi() {
    var remaining = lockRemaining();
    var blocked = remaining > 0 || state.sending;
    var buttons = document.querySelectorAll('.js-submit');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = blocked;
    var status = state.sending ? t('sending') : (remaining > 0 ? t('wait', remaining) : '');
    var lines = document.querySelectorAll('.js-status');
    for (i = 0; i < lines.length; i++) lines[i].textContent = status;
    if (remaining === 0) clearInterval(timers.lockTick);
  }

  /* =================== slots =================== */

  function showSlotsLoading() {
    el.slotGrid.innerHTML = '';
    el.slotGrid.hidden = true;
    el.noSlots.hidden = true;
    el.slotsLoadError.hidden = true;
    el.slotsLoading.hidden = false;
  }

  function loadSlots() {
    if (!state.service) return;
    var seq = ++state.slotsSeq;
    var service = state.service;
    showSlotsLoading();
    el.slotsInfo.textContent = t('slotsIntro', L.durationFor(service, state.people));
    api.slots(service.id, state.people).then(function (res) {
      if (seq !== state.slotsSeq) return;
      if (!res || !res.ok) throw new Error('slots: ' + (res && res.reason));
      renderSlots(res);
    }).catch(function (err) {
      if (seq !== state.slotsSeq) return;
      console.error('Loading slots failed:', err);
      el.slotsLoading.hidden = true;
      el.slotsLoadError.hidden = false;
    });
  }

  function renderSlots(res) {
    el.slotsLoading.hidden = true;
    el.slotsInfo.textContent = t('slotsIntro', res.duration);
    el.slotGrid.innerHTML = '';
    (res.slots || []).forEach(function (slot) {
      var btn = button('btn-slot js-submit', [document.createTextNode(rangeText(slot))], function () { submitService('later', slot); });
      btn.setAttribute('aria-label', t('slotAria', rangeText(slot)));
      el.slotGrid.appendChild(btn);
    });
    var none = !res.slots || res.slots.length === 0;
    el.slotGrid.hidden = none;
    el.noSlots.hidden = !none;
    // Do not offer "now" again if it was just refused.
    var offerNow = hasType('now') && !state.nowFull;
    el.noSlotsNowText.hidden = !offerNow;
    el.btnNoSlotsNow.hidden = !offerNow;
    updateLockUi();
  }

  /* =================== sending =================== */

  function submitService(type, slot) {
    if (isBlocked() || !state.service) return;
    var name = readName();
    if (!name) return;
    blurActive();
    var payload = {
      requestId: newRequestId(),
      lang: state.lang,
      service: state.service.id,
      type: type,
      name: name,
      persons: state.people
    };
    if (type === 'later') payload.start = slot.start;
    var service = state.service;
    sendRequest(payload, function (res) {
      if (type === 'later') return { title: t('confirmTitle'), text: t('confirmLater', rangeText(res.start && res.end ? res : slot)) };
      if (res.mode === 'wait') {
        return { title: t('waitTitle'), text: t('confirmWait', { floor: service.waitFloor || 2, range: rangeText(res) }) };
      }
      return { title: t('confirmTitle'), text: t('confirmNow') };
    });
  }

  /** Sends any request; confirmation(res) returns {title, text, titleLang?} on success. */
  function sendRequest(payload, confirmation) {
    state.sending = true;
    showError('');
    updateLockUi();

    api.request(payload).then(function (res) {
      state.sending = false;
      if (res && res.ok) {
        setLock();
        showConfirmation(confirmation(res), res.preview);
      } else if (res && res.reason === 'taken') {
        updateLockUi();
        showError(t('errTaken'));
        loadSlots();
      } else if (res && res.reason === 'full') {
        // "Now" is not possible (next appointment booked / not enough time): show the free times.
        state.nowFull = true;
        updateLockUi();
        if (state.mode === 'slots') loadSlots(); else enterSlotsMode();
        showError(t('errNowFull'));
      } else {
        console.error('Request rejected:', res);
        updateLockUi();
        showError(t('errSend'));
      }
    }, function (err) {
      state.sending = false;
      console.error('Sending failed:', err);
      updateLockUi();
      showError(t('errSend'));
    });
  }

  /* =================== confirmation =================== */

  function showConfirmation(content, preview) {
    el.confirmTitle.textContent = content.title;
    if (content.titleLang) el.confirmTitle.setAttribute('lang', content.titleLang);
    else el.confirmTitle.removeAttribute('lang');
    el.confirmText.textContent = content.text;
    el.dryRunBox.hidden = !cfg.dryRun;
    el.dryRunMessage.textContent = preview || '';
    showScreen('confirm');

    var remaining = cfg.confirmationSeconds;
    el.confirmCountdown.textContent = t('confirmReturn', remaining);
    clearTimeout(timers.confirm);
    (function tick() {
      timers.confirm = setTimeout(function () {
        remaining -= 1;
        if (remaining <= 0) { resetToHome(); return; }
        el.confirmCountdown.textContent = t('confirmReturn', remaining);
        tick();
      }, 1000);
    })();
  }

  /* =================== periodic reload (kiosk updates) =================== */

  function maybeReload() {
    if (!(cfg.reloadAfterHours > 0) || navigator.onLine === false) return;
    if (Date.now() - state.loadedAt > cfg.reloadAfterHours * 3600 * 1000) window.location.reload();
  }

  /* =================== wiring =================== */

  function onBack(e) {
    var target = e.currentTarget.getAttribute('data-back');
    if (target === 'home') resetToHome();
    else if (target === 'services') showMenu();
  }

  /** Enter moves to the next field; on the last field it closes the keyboard. */
  function chainInputs(inputs) {
    inputs.forEach(function (input, i) {
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing) return; // keep IME conversion working
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus(); else input.blur();
      });
      input.addEventListener('input', function () { setFieldError(input, ''); });
      input.addEventListener('blur', function () {
        setTimeout(function () {
          if (!document.activeElement || document.activeElement.tagName !== 'INPUT') window.scrollTo(0, 0);
        }, 50);
      });
    });
  }

  function init() {
    var flags = document.querySelectorAll('[data-flag]');
    for (var f = 0; f < flags.length; f++) {
      var flagSvg = typeof KIOSK_FLAGS !== 'undefined' && KIOSK_FLAGS[flags[f].getAttribute('data-flag')];
      if (flagSvg) flags[f].innerHTML = flagSvg;
    }
    updateLanguageAvailability();
    setInterval(updateLanguageAvailability, 30 * 1000);

    var langButtons = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < langButtons.length; i++) {
      langButtons[i].addEventListener('click', function (e) {
        selectLanguage(e.currentTarget.getAttribute('data-lang'));
      });
    }
    var backButtons = document.querySelectorAll('[data-back]');
    for (i = 0; i < backButtons.length; i++) backButtons[i].addEventListener('click', onBack);
    el.requestBack.addEventListener('click', goBackFromRequest);
    el.visitBack.addEventListener('click', backFromVisit);

    // request screen
    el.form.addEventListener('submit', function (e) {
      e.preventDefault();
      el.name.blur(); // "Done"/Enter just closes the keyboard
    });
    el.name.addEventListener('input', function () {
      if (el.nameError.textContent) { el.nameError.textContent = ''; el.name.removeAttribute('aria-invalid'); }
    });
    // Safari sometimes leaves the page scrolled after the keyboard closes.
    el.name.addEventListener('blur', function () { setTimeout(function () { window.scrollTo(0, 0); }, 50); });
    el.name.maxLength = cfg.nameMaxLength;

    el.peopleLess.addEventListener('click', function () { changePeople(-1); });
    el.peopleMore.addEventListener('click', function () { changePeople(1); });

    el.btnNow.addEventListener('click', function () { submitService('now'); });
    el.btnNoSlotsNow.addEventListener('click', function () { submitService('now'); });
    el.btnLater.addEventListener('click', function () {
      if (isBlocked()) return;
      if (!readName()) return;
      blurActive();
      showErrorOn('request', '');
      enterSlotsMode();
    });
    el.btnRetry.addEventListener('click', loadSlots);

    // visitor check-in
    el.visitName.maxLength = cfg.visitNameMaxLength;
    el.visitCompany.maxLength = cfg.visitCompanyMaxLength;
    $('visit-form').addEventListener('submit', function (e) { e.preventDefault(); });
    chainInputs(VISIT_FIELDS.map(function (key) { return el[key]; }));
    el.btnVisitSend.addEventListener('click', submitVisit);

    // delivery
    if (cfg.delivery) el.deliveryCompany.maxLength = cfg.delivery.companyMaxLength;
    el.deliveryForm.addEventListener('submit', function (e) { e.preventDefault(); submitDelivery('other'); });
    el.deliveryCompany.addEventListener('input', function () { setFieldError(el.deliveryCompany, ''); });
    el.btnDeliverySend.addEventListener('click', function () { submitDelivery('other'); });

    el.btnDone.addEventListener('click', resetToHome);

    ['touchstart', 'pointerdown', 'keydown', 'input'].forEach(function (type) {
      document.addEventListener(type, onActivity, { passive: true, capture: true });
    });

    // Kiosk: block pinch zoom (Safari gesture events).
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

    // After the app was in the background for a long time, start over.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (state.current !== 'home' && Date.now() - state.lastActivity > cfg.inactivityTimeoutSeconds * 1000) {
        resetToHome();
      }
      startLockTick();
    });

    setInterval(function () {
      if (state.current === 'home' && Date.now() - state.lastActivity > 60 * 1000) maybeReload();
    }, 10 * 60 * 1000);

    if (cfg.dryRun) {
      document.body.classList.add('is-dryrun');
      console.info('[DRY RUN] Kiosk is in dry-run mode – nothing will be sent.');
    }

    loadLock();
    startLockTick();
    showScreen('home');
  }

  init();
})();
