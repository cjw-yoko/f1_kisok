/*
 * Kiosk configuration – shared by frontend AND backend.
 *
 * This file is used twice:
 *   1. on GitHub Pages by the kiosk page,
 *   2. in the Apps Script project as "Config.gs" (copy the whole file).
 * After changing services, opening blocks or durations, update BOTH places
 * (and create a new Apps Script deployment version).
 */
var KIOSK_CONFIG = {
  /* ---------- frontend ---------- */

  // The /exec URL of your Google Apps Script web app deployment.
  appsScriptUrl: 'https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID_HERE/exec',

  // true  = nothing is sent; slots are simulated locally with sample bookings,
  //         the chat message is printed to the console and the confirmation screen.
  // false = live mode (Apps Script backend + Google Calendar).
  dryRun: true,

  // Dry run only: simulate the time of day, e.g. '10:20' (null = real clock).
  dryRunClock: null,

  // How the kiosk talks to Apps Script:
  // 'auto'  = normal CORS fetch, falls back to JSONP if the response cannot be read
  // 'fetch' = CORS fetch only, 'jsonp' = JSONP only (see README)
  transport: 'auto',

  submitLockSeconds: 30,         // submit buttons stay locked after a successful request
  inactivityTimeoutSeconds: 45,  // back to the home screen after inactivity
  confirmationSeconds: 10,       // confirmation screen duration
  requestTimeoutSeconds: 15,     // network timeout
  reloadAfterHours: 12,          // reload while idle to pick up new versions (0 = off)

  /* ---------- shared (frontend + backend) ---------- */

  timeZone: 'Asia/Tokyo',  // must match appsscript.json
  slotStepMinutes: 15,     // first slot of a free interval starts on this grid (rounded up)
  slotLeadMinutes: 15,     // slots start at least this many minutes from now
  maxSlots: 8,             // max. number of slots offered
  nameMaxLength: 30,
  duplicateWindowSeconds: 30,  // same name + same service within this window is ignored

  // Services shown after the language selection. Add more objects to add services.
  // active: false hides a service (and the backend rejects it).
  // If only one service is active, the service menu is skipped.
  services: [
    {
      id: 'insole',
      active: true,
      icon: '👟',
      name: { ja: 'インソール', en: 'Insoles', ko: '인솔', de: 'Einlegesohlen' },
      calendarProperty: 'CAL_ID_INSOLE',      // Script Property holding the calendar ID
      webhookProperty: 'WEBHOOK_URL_INSOLE',  // optional, overrides WEBHOOK_URL
      baseMinutes: 45,
      extraMinutesPerPerson: 15,              // duration = base + extra * (persons - 1)
      peopleMax: 5,
      openingBlocks: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' }
      ],
      types: ['now', 'later'],                // allowed request types
      escortLanguages: ['en', 'de']           // languages that need an interpreter escort
    },
    {
      id: 'studio',
      active: true,
      icon: '📸',
      name: { ja: 'フォトスタジオ', en: 'Photo Studio', ko: '포토 스튜디오', de: 'Fotostudio' },
      calendarProperty: 'CAL_ID_STUDIO',
      webhookProperty: 'WEBHOOK_URL_STUDIO',
      baseMinutes: 30,
      extraMinutesPerPerson: 0,
      peopleMax: 5,
      openingBlocks: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' }
      ],
      types: ['now', 'later'],
      escortLanguages: ['en', 'de']
    }
  ],

  // Dry run only: sample bookings per service (busy intervals, HH:MM).
  dryRunBookings: {
    insole: [{ start: '10:00', end: '10:45' }, { start: '14:00', end: '15:15' }],
    studio: [{ start: '09:30', end: '10:00' }, { start: '13:00', end: '14:30' }, { start: '16:00', end: '16:30' }]
  },

  // Chat texts for the DRY-RUN PREVIEW ONLY. The real texts are CHAT_TEXT in
  // apps-script/Code.gs – keep both identical (a test checks this).
  chatTextPreview: {
    now: '🔔 お客様がいらっしゃいました｜{service}｜{name}様（{persons}名）',
    later: '🕒 ご予約｜{service}｜{start}–{end}｜{name}様（{persons}名）',
    serviceLabel: { insole: '👟 インソール', studio: '📸 フォトスタジオ' },
    escortNote: {
      en: '🇬🇧 英語の同行が必要です',
      de: '🇩🇪 ドイツ語の同行が必要です',
      ko: '🇰🇷 韓国語の同行が必要です'
    },
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
  }
};
