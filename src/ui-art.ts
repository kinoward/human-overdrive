const colors = {
  paper: '#f2efe5',
  road: '#fffdf7',
  park: '#dce4d2',
  leaf: '#b7c8a9',
  water: '#aecfd2',
  ink: '#425f52',
  coral: '#da7d64',
  mustard: '#d5b45b',
  block: '#e5decc',
};

function building(x: number, y: number, width: number, height: number, color: string, rotation = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rotation})"><rect width="${width}" height="${height}" rx="3" fill="${color}"/><rect x="${width / 2 - 2}" y="${height / 2 - 2}" width="4" height="4" rx="1" fill="${colors.road}" opacity=".6"/></g>`;
}

function trees(points: number[][]) {
  return points.map(([x, y, size = 8]) => `<circle cx="${x}" cy="${y}" r="${size}" fill="${colors.leaf}"/>`).join('');
}

function car(x: number, y: number, rotation: number, color: string) {
  return `<g class="map-car" transform="translate(${x} ${y}) rotate(${rotation})"><rect x="-4" y="-8" width="8" height="16" rx="3" fill="${color}"/><path d="M-2-3h4M-2 4h4" stroke="${colors.road}" stroke-width="1.6" stroke-linecap="round"/></g>`;
}

function beijing(hero: boolean) {
  return `<path d="M0 0h640v480H0z" fill="${colors.paper}"/>
    <g fill="${colors.park}"><rect x="124" y="91" width="89" height="66" rx="19"/><rect x="435" y="266" width="77" height="104" rx="22"/><rect x="244" y="267" width="62" height="46" rx="10"/><path d="M0 360h77v120H0zM549 0h91v101h-91z"/></g>
    <g fill="${colors.block}"><rect x="241" y="91" width="63" height="64" rx="7"/><rect x="338" y="91" width="65" height="64" rx="7"/><rect x="434" y="91" width="65" height="64" rx="7"/><rect x="125" y="185" width="85" height="43" rx="7"/><rect x="125" y="266" width="85" height="46" rx="7"/><rect x="242" y="343" width="62" height="40" rx="7"/><rect x="338" y="343" width="65" height="40" rx="7"/></g>
    <g fill="none" stroke="${colors.road}" stroke-linecap="round" stroke-linejoin="round"><path d="M-20 171h680M-20 248h680M-20 327h680M225-20v520M322-20v520M419-20v520" stroke-width="13"/><rect x="104" y="72" width="432" height="330" rx="69" stroke-width="22"/><path d="M104 114 59 69M536 114l46-45M104 361l-45 45M536 361l46 45" stroke-width="12"/></g>
    <path d="M263 202h37v22h-37zM341 278h43v24h-43z" fill="${colors.ink}"/>
    ${building(350, 194, 32, 31, colors.coral)}${building(143, 343, 38, 23, colors.mustard)}${building(452, 194, 27, 31, colors.mustard)}${building(260, 104, 25, 25, colors.coral)}${building(351, 107, 33, 22, colors.ink)}
    ${trees([[143, 112], [168, 127, 12], [189, 107, 7], [453, 289, 11], [486, 305], [463, 337, 13], [276, 291, 10], [579, 36, 12], [605, 63, 9], [32, 400, 13]])}
    ${car(184, 72, 90, colors.coral)}${car(536, 207, 180, colors.mustard)}${car(372, 402, -90, colors.ink)}${car(225, 301, 0, colors.coral)}${car(310, 171, 90, colors.mustard)}
    ${hero ? `${building(143, 194, 29, 22, colors.coral)}${building(185, 192, 13, 29, colors.mustard)}${building(139, 279, 25, 20, colors.ink)}${building(178, 278, 19, 20, colors.coral)}${building(350, 354, 29, 17, colors.mustard)}${building(444, 116, 21, 29, colors.coral)}${building(480, 119, 18, 23, colors.ink)}${building(263, 352, 22, 22, colors.coral)}${trees([[143, 145, 6], [191, 141, 6], [493, 354, 8], [43, 431, 10], [67, 402, 7]])}${car(104, 281, 0, colors.ink)}${car(464, 248, 90, colors.coral)}` : ''}
    <g transform="translate(322 247)"><circle r="27" fill="${colors.paper}"/><circle r="17" fill="${colors.coral}"/><path d="M-5 0h10M0-5v10" stroke="${colors.road}" stroke-width="2.5" stroke-linecap="round"/></g>`;
}

function shanghai(hero: boolean) {
  return `<path d="M0 0h640v480H0z" fill="${colors.paper}"/>
    <path d="M388-20c-66 86-73 138-39 196s40 97-9 150-55 107-25 174h79c-36-59-24-103 24-157s53-115 14-175-15-111 43-188z" fill="${colors.water}"/>
    <g fill="${colors.park}"><rect x="81" y="73" width="108" height="66" rx="20"/><rect x="455" y="273" width="117" height="99" rx="25"/><rect x="153" y="303" width="96" height="67" rx="18"/></g>
    <g fill="none" stroke="${colors.road}" stroke-linecap="round" stroke-linejoin="round"><path d="M58-20v520M212-20v520M-20 158h310M-20 280h324M-20 394h680M458-20v520M581-20v520M438 161h222M444 250h216" stroke-width="14"/><path d="M287-20c-35 91-23 147 10 210s-9 113-28 152-15 86-2 158M489-20c-59 80-73 132-41 194s31 112-10 161-48 106-10 165" stroke-width="12"/><path d="M212 206c77-6 173 14 246 0M212 331c87 13 160 15 246-8M212 53c88 8 181 6 246-8" stroke-width="18"/></g>
    ${building(84, 188, 33, 40, colors.ink)}${building(144, 190, 42, 26, colors.coral)}${building(91, 310, 29, 43, colors.mustard)}${building(477, 184, 31, 42, colors.coral)}${building(526, 186, 29, 41, colors.ink)}${building(88, 422, 42, 24, colors.coral)}${building(154, 421, 29, 24, colors.mustard)}
    ${trees([[108, 100, 11], [141, 112, 9], [171, 94, 8], [478, 299, 10], [512, 324, 14], [546, 295, 8], [532, 351, 10], [179, 329, 12], [219, 345, 9]])}
    <g transform="translate(388 112)"><circle r="14" fill="${colors.coral}"/><path d="M0-32v64" stroke="${colors.coral}" stroke-width="5"/><circle r="5" fill="${colors.road}"/></g>
    ${car(212, 113, 0, colors.coral)}${car(334, 206, 90, colors.mustard)}${car(458, 430, 0, colors.ink)}${car(136, 280, 90, colors.coral)}
    ${hero ? `${building(87, 26, 36, 26, colors.coral)}${building(146, 26, 35, 26, colors.ink)}${building(234, 90, 22, 42, colors.mustard)}${building(480, 73, 26, 37, colors.ink)}${building(526, 91, 27, 39, colors.mustard)}${building(475, 422, 32, 24, colors.coral)}${building(529, 422, 27, 24, colors.ink)}${car(521, 161, 90, colors.mustard)}${car(58, 350, 180, colors.ink)}` : ''}`;
}

function chongqing(hero: boolean) {
  return `<path d="M0 0h640v480H0z" fill="${colors.paper}"/>
    <g fill="${colors.park}"><path d="M0 0h255c-55 47-58 88-121 110S41 114 0 162z"/><path d="M640 238c-65-33-104-14-123 39s-8 100-64 137-68 35-84 66h271z"/><path d="M64 354c42-40 115-26 132 13s-2 72-18 113H0v-75z"/></g>
    <g fill="none" stroke="${colors.leaf}" stroke-width="2" opacity=".6"><path d="M0 47c64-17 102-7 146-47M0 78c86-22 121-4 188-78M0 111c101-23 159-30 201-89M490 480c14-66 103-76 150-94M520 480c11-45 75-59 120-64"/></g>
    <path d="M-30 140c144-11 210 17 318 77s205 63 382 12v57c-193 54-295 39-414-29S79 195-30 198z" fill="${colors.water}"/>
    <path d="M320-20c-24 90-40 147-6 221l-46 25c-42-86-27-162-13-246z" fill="${colors.water}"/>
    <g fill="none" stroke="${colors.road}" stroke-linecap="round" stroke-linejoin="round"><path d="M-20 90c144-28 185 1 239 44M-20 242c102-34 182-7 282 53s205 67 398 13M-20 309c103-27 182-6 276 49s245 71 404 25M347-20c-26 81-11 132 38 181s129 25 275-7" stroke-width="14"/><path d="M112 73 85 260M221 110l-64 229M405 123l-83 260M526 165l-57 254" stroke-width="19"/><path d="M85 260 46 480M322 383l-39 117M469 419l-22 81M350 67c101 47 175 45 310 19" stroke-width="12"/></g>
    ${building(101, 105, 37, 25, colors.coral, 7)}${building(171, 114, 26, 30, colors.mustard, 14)}${building(117, 261, 31, 33, colors.ink, 15)}${building(207, 288, 37, 25, colors.coral, 28)}${building(382, 342, 34, 28, colors.mustard, 10)}${building(421, 81, 31, 29, colors.coral, 12)}${building(498, 111, 39, 24, colors.ink, -5)}
    ${trees([[55, 41, 9], [91, 26, 12], [167, 39, 8], [546, 359, 12], [582, 338, 10], [596, 380, 13], [104, 397, 12], [136, 426, 8]])}
    ${car(97, 180, 9, colors.ink)}${car(366, 240, 22, colors.coral)}${car(505, 238, 16, colors.mustard)}${car(267, 362, -61, colors.ink)}
    ${hero ? `${building(52, 360, 27, 22, colors.mustard, -11)}${building(192, 362, 27, 34, colors.coral, 24)}${building(280, 305, 18, 27, colors.ink, 26)}${building(465, 32, 33, 22, colors.mustard, 13)}${building(555, 107, 30, 23, colors.coral, -7)}${trees([[551, 427, 9], [581, 450, 13], [612, 418, 8], [152, 378, 9]])}${car(563, 170, 84, colors.coral)}` : ''}`;
}

function tokyo(hero: boolean) {
  return `<path d="M0 0h640v480H0z" fill="${colors.paper}"/>
    <path d="M640 179c-79 2-134 33-144 88s-53 64-82 101-17 74-59 112h285z" fill="${colors.water}"/>
    <g fill="${colors.park}"><path d="M209 128c52-34 118-9 125 38s-43 96-94 78-74-83-31-116z"/><rect x="69" y="310" width="84" height="90" rx="21"/><path d="M432 10h114v63H432z"/></g>
    <g fill="none" stroke="${colors.road}" stroke-linecap="round" stroke-linejoin="round"><path d="M-20 89h680M-20 274h509M-20 418h436M174-20v520M359-20v520M69-20v310M449-20v238M-20 188h180M359 178h301M-20 356h174M265 259v241" stroke-width="14"/><path d="M174 70c-48 30-71 110-43 165s111 112 176 73 100-78 82-145S245 28 174 70z" stroke-width="19"/><path d="m389 281 98 70 99-86M359 418l113 55M487 351l-15 122" stroke-width="17"/></g>
    <path d="m524 286 63 24-19 49-61-25zM444 379l38 15-14 35-36-14z" fill="${colors.paper}"/>
    ${building(87, 111, 40, 31, colors.coral)}${building(89, 212, 36, 33, colors.mustard)}${building(197, 336, 37, 31, colors.ink)}${building(283, 342, 45, 26, colors.coral)}${building(384, 108, 35, 42, colors.mustard)}${building(477, 112, 37, 35, colors.ink)}${building(531, 304, 26, 27, colors.coral, 21)}
    ${trees([[228, 154, 11], [268, 143, 9], [288, 177, 12], [242, 206, 10], [95, 332, 11], [127, 361, 13], [93, 383, 7], [459, 37, 11], [498, 42, 9]])}
    ${car(174, 366, 0, colors.coral)}${car(308, 89, 90, colors.mustard)}${car(410, 178, 90, colors.ink)}${car(436, 315, 125, colors.coral)}
    ${hero ? `${building(22, 109, 24, 37, colors.ink)}${building(26, 208, 23, 36, colors.coral)}${building(194, 444, 38, 22, colors.mustard)}${building(286, 443, 41, 23, colors.ink)}${building(477, 28, 26, 27, colors.coral)}${building(541, 114, 26, 34, colors.mustard)}${trees([[304, 213, 7], [209, 185, 8], [121, 313, 7]])}${car(58, 274, -90, colors.mustard)}` : ''}`;
}

function losAngeles(hero: boolean) {
  return `<path d="M0 0h640v480H0z" fill="${colors.paper}"/>
    <path d="M0 283c75 11 94 41 143 70s81 63 94 127H0z" fill="${colors.water}"/>
    <path d="M0 257c75 12 111 52 158 76s88 77 107 147h-28c-13-64-45-98-94-127S75 294 0 283z" fill="#e6d7b5"/>
    <g fill="${colors.park}"><path d="M291 0h349v62c-90 24-140-19-201 10S339 71 291 0z"/><rect x="443" y="222" width="127" height="70" rx="17"/><rect x="289" y="341" width="63" height="78" rx="16"/></g>
    <g fill="none" stroke="${colors.road}" stroke-linecap="round" stroke-linejoin="round"><path d="M-20 102h680M-20 202h680M146 309h514M243 433h417M91-20v294M208-20v379M382-20v520M594-20v520M-20 26h313M288 87v222M475 79v123M477 309v191" stroke-width="12"/><path d="M-20 156c168-10 211 35 283 89s196 30 250 103 56 107 75 152M117-20c-6 127 23 169 111 225s128 150 183 295" stroke-width="22"/></g>
    ${building(116, 48, 36, 29, colors.coral)}${building(239, 119, 26, 43, colors.mustard)}${building(312, 116, 43, 29, colors.ink)}${building(405, 121, 43, 27, colors.coral)}${building(499, 117, 37, 32, colors.mustard)}${building(400, 340, 42, 31, colors.ink)}${building(515, 393, 37, 23, colors.coral)}
    ${trees([[469, 243, 9], [505, 261, 13], [546, 245, 10], [318, 366, 10], [327, 398, 8], [429, 31, 12], [496, 25, 9], [572, 35, 14]])}
    <g fill="${colors.mustard}"><circle cx="549" cy="79" r="16"/><path d="M549 52v-7M549 113v-7M522 79h-7M583 79h-7" stroke="${colors.mustard}" stroke-width="3" stroke-linecap="round"/></g>
    ${car(162, 187, 125, colors.ink)}${car(355, 274, 80, colors.coral)}${car(382, 190, 0, colors.mustard)}${car(543, 433, 90, colors.ink)}
    ${hero ? `${building(28, 47, 35, 30, colors.mustard)}${building(242, 46, 29, 28, colors.ink)}${building(405, 226, 23, 43, colors.mustard)}${building(513, 334, 35, 25, colors.coral)}${building(275, 451, 43, 23, colors.mustard)}${building(403, 452, 43, 23, colors.coral)}${trees([[548, 278, 7], [478, 279, 6], [350, 35, 11], [606, 16, 7]])}${car(594, 251, 0, colors.coral)}` : ''}`;
}

const maps: Record<string, (hero: boolean) => string> = {
  beijing,
  shanghai,
  chongqing,
  tokyo,
  'los-angeles': losAngeles,
};

export function cityMapArt(cityId: string, hero = false): string {
  return `<svg class="city-map-art${hero ? ' city-map-hero' : ''}" viewBox="0 0 640 480" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${maps[cityId](hero)}<text x="24" y="458" fill="${colors.ink}" opacity=".65" font-size="10" font-family="inherit" letter-spacing="1.5">关卡风格插画</text></svg>`;
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
};

export function uiIcon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${icons[name]}</svg>`;
}
