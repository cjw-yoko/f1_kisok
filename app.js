/*
 * Kiosk UI controller: screens, timers, submit lock, API access.
 * Depends on config.js, i18n.js and logic.js (loaded before this file).
 */
(function () {
  'use strict';

  var cfg = KIOSK_CONFIG;
  var I18N = KIOSK_I18N;
  var L = KioskLogic;
  var LOCK_KEY = 'kiosk.lockUntil';
  var SLOT_RELOAD_DELAY_MS = 350;

  var state = {
    lang: null,
    service: null,
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
      request: $('screen-request'),
      confirm: $('screen-confirm')
    },
    serviceGrid: $('service-grid'),
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
    status: $('request-status'),
    error: $('request-error'),
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

  function serviceName(service) {
    return service.name[state.lang] || service.name.en || service.id;
  }

  function hasType(type) {
    return !!state.service && state.service.types.indexOf(type) !== -1;
  }

  function rangeText(slot) {
    return slot.start + '–' + slot.end;
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
        // Same requestId, so the backend answers a retry without booking twice.
        function () { return jsonp(cfg.appsScriptUrl + '?' + toQuery({ action: 'book', data: JSON.stringify(payload) })); }
      );
    }
  };

  /* ----- dry run: local simulation with sample bookings ----- */

  var dryBusy = {};

  function dryNowMinutes() {
    var simulated = L.parseHHMM(cfg.dryRunClock);
    if (!isNaN(simulated)) return simulated;
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function dryBusyFor(serviceId) {
    if (!dryBusy[serviceId]) {
      dryBusy[serviceId] = ((cfg.dryRunBookings || {})[serviceId] || []).map(function (b) {
        return { start: L.parseHHMM(b.start), end: L.parseHHMM(b.end) };
      });
    }
    return dryBusy[serviceId];
  }

  function dryOptions(service, persons) {
    return {
      blocks: service.openingBlocks,
      busy: dryBusyFor(service.id),
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
        var check = L.validateRequest(payload, cfg);
        if (!check.ok) return { ok: false, reason: 'invalid', error: check.error };
        var req = check.value;
        var service = L.findService(cfg, req.service);
        if (req.type === 'later') {
          var opts = dryOptions(service, req.persons);
          var start = L.parseHHMM(req.start);
          if (!L.isIntervalFree(opts, start)) return { ok: false, reason: 'taken' };
          dryBusyFor(service.id).push({ start: start, end: start + opts.durationMinutes });
          req.end = L.formatHHMM(start + opts.durationMinutes);
        }
        var message = L.buildChatMessage(req, service, cfg.chatTextPreview);
        console.log('[DRY RUN] payload:', JSON.stringify(payload));
        if (req.type === 'later') console.log('[DRY RUN] calendar event: ' + L.buildEventTitle(req, cfg.chatTextPreview));
        console.log('[DRY RUN] chat message:\n' + message);
        return { ok: true, start: req.start, end: req.end, preview: message };
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
  }

  function selectLanguage(lang) {
    if (!I18N[lang]) return;
    state.lang = lang;
    document.documentElement.lang = lang;
    applyTranslations();
    var services = L.activeServices(cfg);
    if (services.length === 1) {
      selectService(services[0]);
    } else {
      renderServices(services);
      showScreen('services');
    }
  }

  function renderServices(services) {
    el.serviceGrid.innerHTML = '';
    services.forEach(function (service) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-service';
      var icon = document.createElement('span');
      icon.className = 'service-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = service.icon;
      var label = document.createElement('span');
      label.className = 'service-name';
      label.textContent = serviceName(service);
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', function () { selectService(service); });
      el.serviceGrid.appendChild(btn);
    });
  }

  function selectService(service) {
    state.service = service;
    state.people = Math.min(state.people, service.peopleMax);
    el.requestTitle.textContent = '';
    var icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = service.icon + ' ';
    el.requestTitle.appendChild(icon);
    el.requestTitle.appendChild(document.createTextNode(serviceName(service)));
    el.btnNow.hidden = !hasType('now');
    el.btnLater.hidden = !hasType('later');
    clearErrors();
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
    el.error.textContent = '';
    updateLockUi();
  }

  function goBackFromRequest() {
    if (state.mode === 'slots' && hasType('now')) { exitSlotsMode(); return; }
    var services = L.activeServices(cfg);
    if (services.length > 1) {
      exitSlotsMode();
      state.service = null;
      renderServices(services);
      showScreen('services');
    } else {
      resetToHome();
    }
  }

  function resetToHome() {
    clearTimeout(timers.confirm);
    clearTimeout(timers.inactivity);
    clearTimeout(timers.slotReload);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    state.slotsSeq++;
    state.lang = null;
    state.service = null;
    state.people = 1;
    state.mode = 'choose';
    el.name.value = '';
    el.slotGrid.innerHTML = '';
    el.serviceGrid.innerHTML = '';
    el.dryRunMessage.textContent = '';
    clearErrors();
    document.documentElement.lang = 'ja';
    showScreen('home');
    maybeReload();
  }

  /* =================== inactivity =================== */

  function armInactivity() {
    clearTimeout(timers.inactivity);
    if (state.current === 'services' || state.current === 'request') {
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

  /* =================== errors =================== */

  function clearErrors() {
    el.nameError.textContent = '';
    el.name.removeAttribute('aria-invalid');
    el.error.textContent = '';
  }

  var NAME_ERRORS = { empty: 'errEmpty', too_long: 'errTooLong', invalid_chars: 'errChars' };

  /** Validates the name field; shows the error and returns null if invalid. */
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

  function updateLockUi() {
    var remaining = lockRemaining();
    var blocked = remaining > 0 || state.sending;
    el.btnNow.disabled = blocked;
    el.btnLater.disabled = blocked;
    el.btnNoSlotsNow.disabled = blocked;
    var slotButtons = el.slotGrid.querySelectorAll('button');
    for (var i = 0; i < slotButtons.length; i++) slotButtons[i].disabled = blocked;
    el.status.textContent = state.sending ? t('sending') : (remaining > 0 ? t('wait', remaining) : '');
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
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-slot';
      btn.textContent = rangeText(slot);
      btn.setAttribute('aria-label', t('slotAria', rangeText(slot)));
      btn.addEventListener('click', function () { submit('later', slot); });
      el.slotGrid.appendChild(btn);
    });
    var none = !res.slots || res.slots.length === 0;
    el.slotGrid.hidden = none;
    el.noSlots.hidden = !none;
    el.noSlotsNowText.hidden = !hasType('now');
    el.btnNoSlotsNow.hidden = !hasType('now');
    updateLockUi();
  }

  /* =================== sending =================== */

  function submit(type, slot) {
    if (state.sending || lockRemaining() > 0 || !state.service) return;
    var name = readName();
    if (!name) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    var payload = {
      requestId: newRequestId(),
      lang: state.lang,
      service: state.service.id,
      type: type,
      name: name,
      persons: state.people
    };
    if (type === 'later') payload.start = slot.start;

    state.sending = true;
    el.error.textContent = '';
    updateLockUi();

    api.request(payload).then(function (res) {
      state.sending = false;
      if (res && res.ok) {
        setLock();
        var booked = res.start && res.end ? { start: res.start, end: res.end } : slot;
        showConfirmation(type, booked, res.preview);
      } else if (res && res.reason === 'taken') {
        updateLockUi();
        el.error.textContent = t('errTaken');
        loadSlots();
      } else {
        console.error('Request rejected:', res);
        updateLockUi();
        el.error.textContent = t('errSend');
      }
    }, function (err) {
      state.sending = false;
      console.error('Sending failed:', err);
      updateLockUi();
      el.error.textContent = t('errSend');
    });
  }

  /* =================== confirmation =================== */

  function showConfirmation(type, slot, preview) {
    el.confirmText.textContent = type === 'later' ? t('confirmLater', rangeText(slot)) : t('confirmNow');
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

  function init() {
    var langButtons = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < langButtons.length; i++) {
      langButtons[i].addEventListener('click', function (e) {
        selectLanguage(e.currentTarget.getAttribute('data-lang'));
      });
    }
    var homeButtons = document.querySelectorAll('[data-back="home"]');
    for (i = 0; i < homeButtons.length; i++) homeButtons[i].addEventListener('click', resetToHome);
    el.requestBack.addEventListener('click', goBackFromRequest);

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

    el.btnNow.addEventListener('click', function () { submit('now'); });
    el.btnNoSlotsNow.addEventListener('click', function () { submit('now'); });
    el.btnLater.addEventListener('click', function () {
      if (lockRemaining() > 0 || state.sending) return;
      if (!readName()) return;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      el.error.textContent = '';
      enterSlotsMode();
    });
    el.btnRetry.addEventListener('click', loadSlots);
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
