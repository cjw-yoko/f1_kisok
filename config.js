/*
 * Kiosk configuration – shared by frontend AND backend.
 *
 * This file is used twice:
 *   1. on GitHub Pages by the kiosk page,
 *   2. in the Apps Script project as "Config.gs" (copy the whole file).
 * After changing companies, services, opening blocks or durations, update BOTH
 * places (and create a new Apps Script deployment version).
 */
var KIOSK_CONFIG = {
  /* ---------- frontend ---------- */

  // The /exec URL of your Google Apps Script web app deployment.
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbzxjKWYb3OdZ38zxDIfHoY9lDvgDMGeZZFBdCv2Hn7xbwIcyCdRTUH37KR1IfNwkfJOlQ/exec',

  // true  = nothing is sent; slots are simulated locally with sample bookings,
  //         the chat message is printed to the console and the confirmation screen.
  // false = live mode (Apps Script backend + Google Calendar).
  dryRun: false,

  // Dry run only: simulate the time of day, e.g. '10:20' (null = real clock).
  dryRunClock: null,

  // How the kiosk talks to Apps Script:
  // 'auto'  = normal CORS fetch, falls back to JSONP if the response cannot be read
  // 'fetch' = CORS fetch only, 'jsonp' = JSONP only (see README)
  transport: 'auto',

  submitLockSeconds: 10,         // submit buttons stay locked after a successful request
  inactivityTimeoutSeconds: 45,  // back to the home screen after inactivity
  confirmationSeconds: 10,       // confirmation screen duration
  requestTimeoutSeconds: 15,     // network timeout
  reloadAfterHours: 12,          // reload while idle to pick up new versions (0 = off)

  // Languages that are not offered at certain times (iPad clock). The button is greyed out.
  // days: 0 = Sunday ... 6 = Saturday. German: the only German speaker is not available
  // on weekdays from 12:30 to 17:00.
  languageAvailability: {
    de: {
      unavailable: [{ days: [1, 2, 3, 4, 5], start: '12:30', end: '17:00' }],
      note: 'Zurzeit nicht verfügbar · bitte English wählen'
    }
  },

  /* ---------- shared (frontend + backend) ---------- */

  timeZone: 'Asia/Tokyo',  // must match appsscript.json
  slotStepMinutes: 15,     // first slot of a free interval starts on this grid (rounded up)
  slotLeadMinutes: 15,     // slots start at least this many minutes from now
  maxSlots: 8,             // max. number of slots offered
  nameMaxLength: 30,       // last name for service requests
  duplicateWindowSeconds: 30,  // the same request within this window is ignored

  /*
   * Menu after the language selection (tiles in this order):
   *   companies (top row) -> service groups / services (middle) -> delivery (bottom, wide)
   *
   * Every request ends up in ONE Google Chat space (Script Property WEBHOOK_URL).
   * mentionProperty (optional) = Script Property with "users/<id>" of the person
   * in charge, who is then @mentioned in addition to @all.
   */

  // Our companies: visitors usually have an appointment. They choose the
  // department and enter their name; the team gets a chat message (no calendar).
  companies: [
    {
      id: 'yoko',
      active: true,
      name: 'Yoko Co., Ltd.',
      logo: 'icons/yoko-logo.png',
      floor: 3,                                  // "please come to the 3rd floor"
      departments: [
        { id: 'rd', name: { ja: '研究開発部（R&D）', en: 'R&D Division', ko: '연구개발부 (R&D)', de: 'Forschung & Entwicklung (R&D)' }, mentionProperty: 'MENTION_YOKO_RD' },
        { id: 'media', name: { ja: 'メディア事業部', en: 'Media Division', ko: '미디어 사업부', de: 'Medien' }, mentionProperty: 'MENTION_YOKO_MEDIA' },
        { id: 'distribution', name: { ja: '流通事業部', en: 'Distribution Division', ko: '유통 사업부', de: 'Vertrieb (Distribution)' }, mentionProperty: 'MENTION_YOKO_DISTRIBUTION' },
        { id: 'ec', name: { ja: 'EC事業部', en: 'EC Business Division', ko: 'EC 사업부', de: 'E-Commerce' }, mentionProperty: 'MENTION_YOKO_EC' },
        { id: 'other', other: true, name: { ja: 'その他', en: 'Other', ko: '기타', de: 'Sonstiges' }, mentionProperty: 'MENTION_YOKO_OTHER' }
      ]
    },
    {
      id: 'wys',
      active: true,
      name: 'WYS Relation Co., Ltd.',
      logo: 'icons/wys-logo.png',
      floor: 3,
      departments: [
        { id: 'management', name: { ja: 'マネジメント事業部', en: 'Management Business Department', ko: '매니지먼트 사업부', de: 'Management' }, mentionProperty: 'MENTION_WYS_MANAGEMENT' },
        { id: 'casting', name: { ja: 'キャスティング事業部', en: 'Casting Business Department', ko: '캐스팅 사업부', de: 'Casting' }, mentionProperty: 'MENTION_WYS_CASTING' },
        { id: 'other', other: true, name: { ja: 'その他', en: 'Other', ko: '기타', de: 'Sonstiges' }, mentionProperty: 'MENTION_WYS_OTHER' }
      ]
    }
  ],
  visitNameMaxLength: 50,     // full name of a visitor
  visitCompanyMaxLength: 60,  // visitor's company (optional)

  // Groups combine several services into one tile (e.g. ZEPHI = insoles + foot care).
  serviceGroups: [
    {
      id: 'zephi',
      logo: 'icons/zephi-logo.png',           // wordmark from the ZEPHI logo proposal (PDF)
      title: 'ZEPHI',
      name: { ja: 'カスタムインソール / フットケア', en: 'Custom Insoles / Foot Care', ko: '맞춤 인솔 / 풋케어', de: 'Custom Einlegesohlen / Fußpflege' }
    }
  ],

  // Bookable services. Services with the same calendarProperty share one calendar
  // (insoles and foot care: one person is in charge of both).
  services: [
    {
      id: 'insole',
      active: true,
      group: 'zephi',
      icon: 'insole',                         // key in icons.js (an emoji also works)
      name: { ja: 'カスタムインソール', en: 'Custom Insoles', ko: '맞춤 인솔', de: 'Custom Einlegesohlen' },
      calendarProperty: 'CAL_ID_INSOLE',      // Script Property holding the calendar ID
      mentionProperty: 'MENTION_ZEPHI',
      baseMinutes: 45,
      extraMinutesPerPerson: 15,              // duration = base + extra * (persons - 1)
      peopleMax: 5,
      openingBlocks: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' }
      ],
      types: ['now', 'later'],                // allowed request types
      escortLanguages: ['en', 'de'],          // languages that need an interpreter escort
      // "Request now" checks the calendar: free -> served right away; someone is being
      // served and the next slot is free -> waiting area on waitFloor; otherwise -> book
      // another time. The time is entered in the calendar.
      nowCheck: true,
      waitFloor: 2
    },
    {
      id: 'footcare',
      active: true,
      group: 'zephi',
      icon: 'footcare',
      name: { ja: 'フットケア', en: 'Foot Care', ko: '풋케어', de: 'Fußpflege' },
      calendarProperty: 'CAL_ID_INSOLE',      // same calendar as the insoles
      mentionProperty: 'MENTION_ZEPHI',
      baseMinutes: 60,                        // one foot care appointment = 1 hour
      extraMinutesPerPerson: 60,              // each further person +1 hour (set 0 for a fixed hour)
      peopleMax: 3,
      openingBlocks: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' }
      ],
      types: ['now', 'later'],
      escortLanguages: ['en', 'de'],
      nowCheck: true,
      waitFloor: 2
    },
    {
      id: 'studio',
      active: true,
      icon: 'studio',
      wordmark: 'PHOTO STUDIO',               // shown next to the logo on the menu tile
      name: { ja: 'フォトスタジオ', en: 'Photo Studio', ko: '포토 스튜디오', de: 'Fotostudio' },
      calendarProperty: 'CAL_ID_STUDIO',
      mentionProperty: 'MENTION_STUDIO',
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

  // Parcel / delivery services: tap the company on arrival -> greeting on the screen
  // (deliveryGreeting in i18n.js) and an information message in the chat. Nobody comes down.
  delivery: {
    active: true,
    icon: 'parcel',
    mentionProperty: 'MENTION_DELIVERY',
    allowOther: true,             // "other company" with free text
    companyMaxLength: 40,
    carriers: [
      { id: 'yamato', label: 'ヤマト運輸', sub: 'Yamato Transport' },
      { id: 'sagawa', label: '佐川急便', sub: 'Sagawa Express' },
      { id: 'japanpost', label: '日本郵便', sub: 'Japan Post' },
      { id: 'seino', label: '西濃運輸', sub: 'Seino' },
      { id: 'fukuyama', label: '福山通運', sub: 'Fukuyama' },
      { id: 'amazon', label: 'Amazon', sub: '' },
      { id: 'dhl', label: 'DHL', sub: '' },
      { id: 'fedex', label: 'FedEx', sub: '' },
      { id: 'ups', label: 'UPS', sub: '' }
    ]
  },

  // Dry run only: sample bookings per calendar (busy intervals, HH:MM).
  dryRunBookings: {
    CAL_ID_INSOLE: [{ start: '10:00', end: '10:45' }, { start: '14:00', end: '15:15' }],
    CAL_ID_STUDIO: [{ start: '09:30', end: '10:00' }, { start: '13:00', end: '14:30' }, { start: '16:00', end: '16:30' }]
  },

  // Chat texts for the DRY-RUN PREVIEW ONLY. The real texts are CHAT_TEXT in
  // apps-script/Code.gs – keep both identical (a test checks this).
  chatTextPreview: {
    everyone: '<users/all>',
    now: '*🔔 お客様がいらっしゃいました｜{service}*\n{name}様（{persons}名）',
    later: '*🕒 ご予約が入りました｜{service}｜{start}–{end}*\n{name}様（{persons}名）',
    nowBooked: '🗓 {start}–{end} でカレンダーに登録しました',
    wait: '*⏳ 待合室でお待ちいただいています｜{service}*\n{name}様（{persons}名）',
    waitBooked: '→ {floor}階の待合室にご案内しました。次の枠 {start}–{end} をカレンダーに登録済みです。',
    serviceLabel: { insole: '👟 ZEPHI インソール', footcare: '🦶 ZEPHI フットケア', studio: '📸 フォトスタジオ' },
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
    eventTitle: '{tag}{service}｜{name}様（{persons}名）{langCode}',
    eventTag: { later: '', now: '【当日】', wait: '【待合室】' },
    eventDescription: '言語: {langName}（{langCode}）\n同行: {escort}',
    escortYes: '必要',
    escortNo: '不要',
    langName: { ja: '日本語', en: '英語', ko: '韓国語', de: 'ドイツ語' },
    visit: '*🏢 来客です｜{company}｜{department}*',
    visitor: '{name}様',
    visitorWithCompany: '{name}様（{company}）',
    visitOther: '⚠️ 担当部署が未定です。どなたか対応をお願いします。',
    visitFooter: '→ {floor}階へご案内しました。担当の方は対応をお願いします。',
    companyLabel: { yoko: 'YOKO', wys: 'WYS Relation' },
    delivery: '*📦 配達業者が到着しました｜{company}*'
  }
};
