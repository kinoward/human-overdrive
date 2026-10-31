import { assetUrl } from './asset-url';

export function cityMapArt(cityId: string): string {
  return `<img class="city-map-art" src="${assetUrl(`assets/ui-racing/maps/${cityId}-v1.webp`)}" alt="" aria-hidden="true" loading="eager"/>`;
}

const icons: Record<string, string> = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18z"/>',
  'arrow-right': '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5m6-6-6 6 6 6"/>',
  play: '<path d="m9 5 10 7-10 7z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M9 5v14M16 5v14" stroke-width="3"/>',
  sound: '<path d="M11 4 6 8H3v8h3l5 4zM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14"/>',
  muted: '<path d="M11 4 6 8H3v8h3l5 4zM16 9l5 6m0-6-5 6"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 14v5m-4 2h8m-7-2h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  car: '<path d="m5 9 2-5h10l2 5m-14 0h14l2 3v7h-3v-3H6v3H3v-7zM7 12h.01M17 12h.01M3 16h18"/>',
  bike: '<circle cx="5" cy="16" r="4"/><circle cx="19" cy="16" r="4"/><path d="m5 16 5-8 5 8H5m10 0 3-12h-4M8 5h5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  restart: '<path d="M4 5v6h6M4.5 10a8 8 0 1 1 .8 8"/>',
  options: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6M10 15v6" stroke-width="3.5"/>',
  records: '<path d="M4 12h4v9H4zm6-8h4v17h-4zm6 12h4v5h-4z" fill="currentColor" stroke="none"/>',
  medal: '<circle cx="12" cy="9" r="6.5"/><circle cx="12" cy="9" r="3"/><path d="m8 15-1 7 5-3 5 3-1-7" fill="currentColor" stroke="none"/>',
  home: '<path d="m3 11 9-8 9 8M5 10v11h5v-6h4v6h5V10"/>',
};

export function uiIcon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${icons[name]}</svg>`;
}
