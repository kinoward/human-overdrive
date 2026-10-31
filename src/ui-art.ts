function trees(points: number[][], color = '#659b7e') {
  return points.map(([x, y, size = 3]) => `<ellipse cx="${x}" cy="${y}" rx="${size}" ry="${size * 1.4}" fill="${color}" transform="rotate(-20 ${x} ${y})"/>`).join('');
}

const maps: Record<string, string> = {
  beijing: `<path d="M0 0h240v240H0z" fill="#eee9d2"/>
    <path d="M0 60h50q17 0 17 12v6H0zM240 69h-75q-18 0-18 17 0 11 9 18l13 12q10 9 10 24v23q0 25-25 25h-20q-24 0-24-24v-33q0-25 12-40l9-12q7-8 7-19V0h19v57q0 16 12 16h71zM0 170h52q15 0 15 15v55H0z" fill="#87bfc0"/>
    <path d="M122 88q18-10 22 10t-4 30q-13 8-19-5t1-35z" fill="#c5d7b5"/>
    <path d="M0 164h46q9 0 9-9v-16M156 122v29q0 11-11 11h-32" fill="none" stroke="#fff7dc" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    ${trees([[124, 99, 3], [130, 104, 3], [120, 108, 2.6], [128, 113, 2.4], [136, 108, 2.7]])}`,
  shanghai: `<path d="M0 0h240v240H0z" fill="#fbf5df"/>
    <path d="M125-20c-34 45-25 73-7 100s30 53 3 81-33 54-15 99h43c-24-37-11-59 11-84s29-58 7-91-21-61 9-105z" fill="#86c6c4"/>
    <path d="M154 134c17-14 44-23 86-21v16c-38-4-58 2-76 15z" fill="#86c6c4"/>
    <path d="M0 172h65q12 0 12-12v-51M177 47v37q0 12 12 12h51" fill="none" stroke="#fffdf1" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M26 42q29-17 48 8t-4 38Q37 99 24 74zM178 185q20-16 36 1t-2 35q-29 9-34-14z" fill="#dce49a"/>
    ${trees([[42, 54, 3], [48, 64, 2.5], [189, 193, 2.7]], '#aebd65')}`,
  chongqing: `<path d="M0 0h240v240H0z" fill="#e2e6b9"/>
    <path d="M0 0h240v34q-51 26-91 7T65 55Q27 66 0 47zM0 194q44-35 91-11t149-10v67H0z" fill="#cad5a5"/>
    <path d="M-20 92c70-9 89 12 135 33s87 17 145-4v32c-66 22-106 20-157-5S36 122-20 127z" fill="#83bcba"/>
    <path d="M121-20c-19 44-17 83 8 137l-25 15C76 81 76 33 90-20z" fill="#83bcba"/>
    <path d="M21 157q51-13 90 8t109 4M160 49q-12 33-4 57" fill="none" stroke="#fff8df" stroke-width="7" stroke-linecap="round"/>
    ${trees([[37, 52, 3], [45, 57, 3], [52, 51, 2.5], [178, 201, 3], [188, 207, 2.7], [199, 200, 3]], '#8ba978')}`,
  tokyo: `<path d="M0 0h240v240H0z" fill="#fff8e5"/>
    <path d="M0 0h120q-10 20-32 35T0 83zM0 161q38-15 63 7t29 72H0z" fill="#ecc5d0"/>
    <path d="M180-20c-23 43-19 66-24 94s-17 41-45 60-38 56-25 106h37c-16-42-11-59 17-78s43-42 44-70 6-57 31-88z" fill="#83c9c8"/>
    <path d="M160 96q36 12 37 40t-29 40l-42 13-7-16 41-14q23-9 18-25t-24-20zM116 210h61q29 0 63 27v23H116z" fill="#83c9c8"/>
    <path d="M164 0q-13 32-13 62t-24 49l-25 20M184 129q11 23-15 35l-22 6" fill="none" stroke="#fffdf1" stroke-width="5" stroke-linecap="round"/>
    ${trees([[64, 48, 2.6], [69, 53, 2.5], [140, 192, 2.6]], '#c58eaa')}`,
  'los-angeles': `<path d="M0 0h240v240H0z" fill="#fff5d6"/>
    <path d="M0 62q15 9 36 27t12 52q-4 19 14 28t35-1 44 13 55 8q24-7 44-1v52H0z" fill="#83c6bf"/>
    <path d="M0 73q18 11 32 23t10 43q-4 28 17 36t38-1 43 15 56 7" fill="none" stroke="#fffdf0" stroke-width="5" stroke-linecap="round"/>
    <path d="M153 22q23-9 32 8t18 26q7 17-9 20-19 2-29-19t-22-22q-4-8 10-13zM49 153q16-9 27 6t27 17q9 14-5 19t-27-6-23-8q-8-13 1-28z" fill="#dfe68c"/>
    <path d="M161 91v53q0 11-11 11h-36" fill="none" stroke="#fffdf0" stroke-width="5" stroke-linecap="round"/>
    ${trees([[159, 31, 2.7], [174, 50, 2.7], [58, 167, 2.7], [83, 181, 2.4]], '#b4c06b')}`,
};

export function cityMapArt(cityId: string, hero = false): string {
  return `<svg class="city-map-art${hero ? ' city-map-hero' : ''}" viewBox="0 0 240 240" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${maps[cityId]}</svg>`;
}

export function menuRoadArt(): string {
  return `<svg class="menu-road-art" viewBox="0 0 1400 800" preserveAspectRatio="none" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path d="m590 850 327-397q33-39 33-88V-30M850 546q55 35 55 92M950 185h80V97" stroke="#fffefa" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="973" y="43" width="126" height="169" rx="23" fill="#fffefa"/>
    <path d="m1067 65 76 77 6 37 45 46v29q0 20-20 20h-43q-12 0-23-11L992 147z" fill="#343733" opacity=".25"/>
    <path d="m920 647 29 30v41q0 12-12 12h-31l-21-23z" fill="#343733" opacity=".25"/>
    <path d="M990 60h76q9 0 9 9v78h-76q-9 0-9-9z" fill="#9b6257"/>
    <path d="M987 56h75q9 0 9 9v75h-76q-8 0-8-8z" fill="#d58b55"/>
    <path d="M984 53h72q8 0 8 8v69h-72q-8 0-8-8z" fill="#efb85d"/>
    <path d="M982 51h68q9 0 9 9v65h-27v5h-25v-5h-16q-9 0-9-9z" fill="#ffd17b"/>
    <path d="M1000 59a9 9 0 1 1 18 0c0 7-9 14-9 14s-9-7-9-14z" fill="#3a342c" stroke="#fff9e7" stroke-width="2.5"/>
    <circle cx="1009" cy="59" r="3.5" fill="#786c4d"/>
    <path d="M886 650h39v37h-39z" fill="#d97f51"/>
    <path d="M886 649q0-5 5-5h29q5 0 5 5v18h-39z" fill="#ffd078"/>
    <rect x="906" y="635" width="9" height="10" rx="2" fill="#efbb65"/>
    <g transform="translate(846 548) rotate(40)"><rect x="-6" y="-10" width="12" height="20" rx="3" fill="#efbd60" stroke="#dab05c"/><path d="M-4-5h8M-4 5h8" stroke="#ffdf98" stroke-width="2"/></g>
    <g transform="translate(950 267)"><rect x="-6" y="-10" width="12" height="20" rx="3" fill="#efbd60" stroke="#dab05c"/><path d="M-4-5h8M-4 5h8" stroke="#ffdf98" stroke-width="2"/></g>
    <g transform="translate(906 628) rotate(-7)"><rect x="-4" y="-7" width="8" height="14" rx="2" fill="#efbd60"/><path d="M-2-3h4M-2 3h4" stroke="#ffdf98" stroke-width="1.5"/></g>
  </svg>`;
}

const icons: Record<string, string> = {
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
