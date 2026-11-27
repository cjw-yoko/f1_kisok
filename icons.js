/*
 * Minimal line icons and round flags (inline SVG, no emoji).
 * Icons use currentColor, so CSS decides their colour.
 * config.js refers to them by key (services[].icon, delivery.icon); an unknown key is
 * shown as plain text, so an emoji still works for services added later.
 */
var KIOSK_ICONS = {
  // Custom insole: upright sole with heel cup and perforation dots
  insole:
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M33.5 5C42 5 46.5 11 46 19.5c-.4 7-3.4 11-3.6 17.5-.2 5.5 1 9.5 0 14.5-1 5.5-4.6 8.5-9.6 8.5-5.4 0-9-3.2-9.4-9-.4-5.6 2.6-10 1.6-16.5C24 28 19 24 19.5 16.5 20 9.5 25.5 5 33.5 5z"/>' +
    '<path d="M28 49.5c.4 3.6 2.4 5.5 5 5.5s4.6-1.9 5-5.5"/>' +
    '<g fill="currentColor" stroke="none">' +
    '<circle cx="28" cy="15" r="1.6"/><circle cx="33.5" cy="13.5" r="1.6"/><circle cx="39" cy="15" r="1.6"/>' +
    '<circle cx="30.5" cy="20.5" r="1.6"/><circle cx="36.5" cy="20.5" r="1.6"/>' +
    '</g></svg>',

  // Foot care: footprint with toes and a small sparkle
  footcare:
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M23 29c0-4.5 4.2-7 10.5-7S46 24.5 46 30c0 5.5-3.6 9.5-4 16-.5 7.5-2 13-8.5 13-6 0-8-5.5-7.5-11.5.4-6.5-3-11-3-18.5z"/>' +
    '<g fill="currentColor" stroke="none">' +
    '<circle cx="26.5" cy="14.5" r="4"/><circle cx="34" cy="11.5" r="3"/><circle cx="40" cy="13" r="2.6"/>' +
    '<circle cx="44.6" cy="16.8" r="2.2"/><circle cx="47.6" cy="21.8" r="1.9"/>' +
    '<path d="M12 37l1.6 4.4 4.4 1.6-4.4 1.6L12 49l-1.6-4.4L6 43l4.4-1.6z"/>' +
    '</g></svg>',

  // Parcel: isometric box with tape
  parcel:
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M32 6l23 11.5v29L32 58 9 46.5v-29z"/>' +
    '<path d="M9 17.5L32 29l23-11.5M32 29v29"/>' +
    '<path d="M20.5 11.8l23 11.5v9.5"/>' +
    '</svg>',

  // Photo studio: aperture (six blades) with a red core
  studio:
    '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<circle cx="50" cy="50" r="40"/>' +
    '<path d="M90 50L46.9 61.5M70 84.6L38.5 53.1M30 84.6L41.5 41.5M10 50L53.1 38.5M30 15.4L61.5 46.9M70 15.4L58.5 58.5"/>' +
    '<path d="M58.5 58.5L46.9 61.5 38.5 53.1 41.5 41.5 53.1 38.5 61.5 46.9z" fill="#DE3A2C" stroke="none"/>' +
    '</svg>'
};

var KIOSK_FLAGS = {
  ja:
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<circle cx="50" cy="50" r="50" fill="#FFFFFF"/><circle cx="50" cy="50" r="20" fill="#BC002D"/>' +
    '<circle cx="50" cy="50" r="49.2" fill="none" stroke="rgba(28,36,48,.18)" stroke-width="1.6"/></svg>',

  en:
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<defs><clipPath id="kiosk-flag-en"><circle cx="50" cy="50" r="50"/></clipPath></defs>' +
    '<g clip-path="url(#kiosk-flag-en)">' +
    '<rect width="100" height="100" fill="#012169"/>' +
    '<path d="M0 0L100 100M100 0L0 100" stroke="#FFFFFF" stroke-width="20"/>' +
    '<path d="M0 0L100 100M100 0L0 100" stroke="#C8102E" stroke-width="6.5"/>' +
    '<path d="M50 0V100M0 50H100" stroke="#FFFFFF" stroke-width="33"/>' +
    '<path d="M50 0V100M0 50H100" stroke="#C8102E" stroke-width="20"/>' +
    '</g><circle cx="50" cy="50" r="49.2" fill="none" stroke="rgba(28,36,48,.18)" stroke-width="1.6"/></svg>',

  ko:
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<defs>' +
    '<g id="kiosk-tri-solid"><rect x="-8" y="-1.5" width="16" height="3"/></g>' +
    '<g id="kiosk-tri-broken"><rect x="-8" y="-1.5" width="7" height="3"/><rect x="1" y="-1.5" width="7" height="3"/></g>' +
    '</defs>' +
    '<circle cx="50" cy="50" r="50" fill="#FFFFFF"/>' +
    '<g transform="rotate(33.7 50 50)">' +
    '<path d="M33 50a17 17 0 0 1 34 0 8.5 8.5 0 0 0-17 0 8.5 8.5 0 0 1-17 0z" fill="#CD2E3A"/>' +
    '<path d="M33 50a8.5 8.5 0 0 0 17 0 8.5 8.5 0 0 1 17 0 17 17 0 0 1-34 0z" fill="#0047A0"/>' +
    '</g>' +
    '<g fill="#000000">' +
    '<g transform="translate(27 27) rotate(-45)"><use href="#kiosk-tri-solid" y="-5"/><use href="#kiosk-tri-solid"/><use href="#kiosk-tri-solid" y="5"/></g>' +
    '<g transform="translate(73 27) rotate(45)"><use href="#kiosk-tri-broken" y="-5"/><use href="#kiosk-tri-solid"/><use href="#kiosk-tri-broken" y="5"/></g>' +
    '<g transform="translate(27 73) rotate(45)"><use href="#kiosk-tri-solid" y="-5"/><use href="#kiosk-tri-broken"/><use href="#kiosk-tri-solid" y="5"/></g>' +
    '<g transform="translate(73 73) rotate(-45)"><use href="#kiosk-tri-broken" y="-5"/><use href="#kiosk-tri-broken"/><use href="#kiosk-tri-broken" y="5"/></g>' +
    '</g>' +
    '<circle cx="50" cy="50" r="49.2" fill="none" stroke="rgba(28,36,48,.18)" stroke-width="1.6"/></svg>',

  de:
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<defs><clipPath id="kiosk-flag-de"><circle cx="50" cy="50" r="50"/></clipPath></defs>' +
    '<g clip-path="url(#kiosk-flag-de)">' +
    '<rect width="100" height="34" fill="#000000"/><rect y="33.3" width="100" height="34" fill="#DD0000"/><rect y="66.6" width="100" height="33.4" fill="#FFCE00"/>' +
    '</g><circle cx="50" cy="50" r="49.2" fill="none" stroke="rgba(28,36,48,.18)" stroke-width="1.6"/></svg>'
};
