// Встроенный набор иконок для калькулятора. Линейные иконки 48×48,
// рисуются цветом текста (stroke: currentColor), поэтому сами
// подстраиваются под выбранное/невыбранное состояние карточки.
// Ключ сохраняется в content.json у варианта (option.icon).
const ICONS = {
  'floor-1': { label: 'Одноэтажный дом', body: '<path d="M6 22 24 8l18 14"/><path d="M10 19v21h28V19"/><path d="M20 40V30h8v10"/>' },
  'floor-attic': { label: 'Дом с мансардой', body: '<path d="M6 26 24 6l18 20"/><path d="M10 22v18h28V22"/><rect x="20" y="15" width="8" height="6"/><path d="M15 40v-8h6v8"/><rect x="27" y="30" width="7" height="5"/>' },
  'floor-2': { label: 'Двухэтажный дом', body: '<path d="M8 16 24 6l16 10"/><path d="M11 14v26h26V14"/><path d="M11 27h26"/><rect x="16" y="18" width="6" height="5"/><rect x="26" y="18" width="6" height="5"/><rect x="16" y="31" width="6" height="5"/><path d="M27 40v-9h5v9"/>' },
  slab: { label: 'Плита', body: '<path d="M4 30h40v8H4z"/><path d="M4 30l6-6h28l6 6"/><path d="M12 38v-8M20 38v-8M28 38v-8M36 38v-8" opacity=".5"/>' },
  strip: { label: 'Ленточный фундамент', body: '<path d="M8 12h32v8H8z"/><path d="M14 20v18h6V20M28 20v18h6V20"/><path d="M4 38h40"/>' },
  piles: { label: 'Сваи', body: '<path d="M6 12h36v7H6z"/><path d="M11 19v23M19 19v23M29 19v23M37 19v23"/><path d="M4 30h40" stroke-dasharray="2 3"/>' },
  'screw-piles': { label: 'Винтовые сваи', body: '<path d="M8 10h32v6H8z"/><path d="M16 16v26M32 16v26"/><path d="M12 30l8-3M12 35l8-3M28 30l8-3M28 35l8-3"/>' },
  brick: { label: 'Кирпич', body: '<rect x="6" y="10" width="36" height="28" rx="1"/><path d="M6 19h36M6 28h36M18 10v9M30 10v9M12 19v9M24 19v9M36 19v9M18 28v10M30 28v10"/>' },
  block: { label: 'Газобетон', body: '<rect x="6" y="12" width="36" height="24" rx="1"/><path d="M6 24h36M22 12v12M28 24v12"/><circle cx="13" cy="18" r="1"/><circle cx="33" cy="17" r="1"/><circle cx="15" cy="30" r="1"/><circle cx="36" cy="30" r="1"/>' },
  ceramic: { label: 'Керамический блок', body: '<rect x="8" y="10" width="32" height="28" rx="1"/><path d="M14 10v28M20 10v28M26 10v28M32 10v28" opacity=".6"/><path d="M8 24h32"/>' },
  timber: { label: 'Брус / бревно', body: '<rect x="6" y="10" width="36" height="8" rx="4"/><rect x="6" y="20" width="36" height="8" rx="4"/><rect x="6" y="30" width="36" height="8" rx="4"/>' },
  frame: { label: 'Каркас', body: '<path d="M8 40V14h32v26"/><path d="M8 14 24 6l16 8"/><path d="M16 14v26M24 14v26M32 14v26M8 27h32"/>' },
  'metal-tile': { label: 'Металлочерепица', body: '<path d="M4 34 24 12l20 22"/><path d="M10 28c3 3 6 3 8 0s6-3 8 0 6 3 8 0 5-2 6 0"/><path d="M15 23c2 2 5 2 7 0s5-2 7 0 4 2 5 0"/>' },
  shingles: { label: 'Мягкая черепица', body: '<path d="M4 34 24 12l20 22"/><path d="M10 28h28M15 23h18"/><path d="M14 28v4M20 28v4M26 28v4M32 28v4M19 23v4M25 23v4"/>' },
  seam: { label: 'Фальцевая кровля', body: '<path d="M4 34 24 12l20 22"/><path d="M17 20v14M24 12v22M31 20v14M10 27v7M38 27v7"/>' },
  'flat-roof': { label: 'Плоская кровля', body: '<path d="M6 18h36v4H6z"/><path d="M9 22v18h30V22"/><path d="M14 18v-4h20v4"/>' },
  box: { label: 'Коробка', body: '<path d="M6 22 24 8l18 14"/><path d="M10 19v21h28V19"/><path d="M17 26h5v6h-5zM26 26h5v6h-5z" stroke-dasharray="2 2"/>' },
  rough: { label: 'Предчистовая отделка', body: '<path d="M8 32l18-18 8 8-18 18H8z"/><path d="M30 18l6-6M34 10l4 4"/>' },
  turnkey: { label: 'Под ключ', body: '<circle cx="16" cy="24" r="8"/><path d="M24 24h18M36 24v6M41 24v5"/>' },
  gas: { label: 'Газ', body: '<path d="M24 6c2 7 10 11 10 20a10 10 0 0 1-20 0c0-5 3-8 5-11 1 4 3 5 5 6 0-6-2-10 0-15z"/>' },
  electric: { label: 'Электричество', body: '<path d="M27 4 12 27h11l-3 17 16-24H25z"/>' },
  'heat-pump': { label: 'Тепловой насос', body: '<rect x="6" y="12" width="36" height="26" rx="3"/><circle cx="18" cy="25" r="7"/><path d="M18 18v14M11 25h14M30 18h7M30 24h7M30 30h7"/>' },
  terrace: { label: 'Терраса', body: '<path d="M4 34h40M4 40h40"/><path d="M8 34V20M40 34V20M8 22h32"/><path d="M15 22v12M22 22v12M29 22v12M36 22v12" opacity=".6"/>' },
  garage: { label: 'Гараж', body: '<path d="M4 20 24 8l20 12"/><path d="M8 18v22h32V18"/><path d="M13 40V26h22v14"/><path d="M13 31h22M13 36h22"/>' },
  fireplace: { label: 'Камин', body: '<path d="M8 8h32v6H8zM10 14v26h28V14"/><path d="M16 40V24h16v16"/><path d="M24 38c-3 0-4-2-4-4 0-3 3-4 3-7 2 2 5 4 5 7 0 2-1 4-4 4z"/>' },
  'warm-floor': { label: 'Тёплый пол', body: '<path d="M6 38h36"/><path d="M10 32c0-4 4-4 4-8s-4-4-4-8M20 32c0-4 4-4 4-8s-4-4-4-8M30 32c0-4 4-4 4-8s-4-4-4-8"/>' },
  septic: { label: 'Септик', body: '<rect x="10" y="20" width="28" height="20" rx="8"/><path d="M4 16h40"/><path d="M18 16v-6h4M30 16v-6h4"/>' },
  well: { label: 'Скважина / колодец', body: '<path d="M14 18h20v22H14z"/><path d="M10 18h28M12 10h24"/><path d="M16 10v8M32 10v8"/><path d="M21 33a3 3 0 0 0 6 0c0-2-3-5-3-5s-3 3-3 5z"/>' },
  window: { label: 'Окна', body: '<rect x="8" y="6" width="32" height="36" rx="1"/><path d="M24 6v36M8 24h32"/><path d="M13 12l6-3M13 17l9-5" opacity=".6"/>' },
  fence: { label: 'Забор', body: '<path d="M6 40V16l4-4 4 4v24M20 40V16l4-4 4 4v24M34 40V16l4-4 4 4v24"/><path d="M4 22h40M4 32h40"/>' },
  solar: { label: 'Солнечные панели', body: '<path d="M8 36 14 18h26l-6 18z"/><path d="M11 27h26M21 18l-3 18M30 18l-3 18"/><path d="M6 40h36"/>' },
  ventilation: { label: 'Вентиляция', body: '<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="3"/><path d="M24 21c0-6 2-9 6-9-1 5-3 8-6 9zM27 24c6 0 9 2 9 6-5-1-8-3-9-6zM24 27c0 6-2 9-6 9 1-5 3-8 6-9zM21 24c-6 0-9-2-9-6 5 1 8 3 9 6z"/>' },
  design: { label: 'Проект / дизайн', body: '<path d="M30 6l12 12-24 24H6V30z"/><path d="M26 10l12 12"/>' },
  check: { label: 'Галочка', body: '<circle cx="24" cy="24" r="18"/><path d="M16 24l6 6 11-12"/>' },
  star: { label: 'Звезда', body: '<path d="M24 6l5.5 11.2 12.3 1.8-8.9 8.7 2.1 12.3L24 34.2 13 40l2.1-12.3-8.9-8.7 12.3-1.8z"/>' },
};

const DEFAULT_ICON = 'check';

module.exports = { ICONS, DEFAULT_ICON };
