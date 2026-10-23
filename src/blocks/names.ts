import { namespaceOf, shortName } from '../core/blockstate';

/**
 * Readable names derived from ids ("minecraft:stone_brick_stairs" -> "Stone Brick Stairs").
 * Stage 2 replaces these with the real (German) names from the language files of the game and mods.
 */
const SPECIAL: Record<string, string> = {
  tnt: 'TNT',
  jack_o_lantern: "Jack o'Lantern",
  lily_of_the_valley: 'Lily of the Valley',
  oxeye_daisy: 'Oxeye Daisy',
};

const SMALL_WORDS = new Set(['of', 'the', 'o']);

export function readableName(name: string): string {
  const ns = namespaceOf(name);
  const id = shortName(name).replace(/^[a-z0-9_.-]+:/, '');
  const base =
    SPECIAL[id] ??
    id
      .split(/[_/]+/)
      .filter(Boolean)
      .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  return ns === 'minecraft' ? base : `${base} (${ns})`;
}

/** German labels for common block state properties and values, for the hover card. */
const PROP_LABELS: Record<string, string> = {
  facing: 'Richtung',
  half: 'Hälfte',
  shape: 'Form',
  type: 'Typ',
  axis: 'Achse',
  open: 'offen',
  hinge: 'Scharnier',
  waterlogged: 'geflutet',
  powered: 'aktiv',
  face: 'Befestigung',
  lit: 'leuchtet',
  layers: 'Schichten',
  rotation: 'Drehung',
  north: 'Nord',
  east: 'Ost',
  south: 'Süd',
  west: 'West',
  up: 'oben',
  down: 'unten',
  part: 'Teil',
  age: 'Alter',
  extended: 'ausgefahren',
  hanging: 'hängend',
  in_wall: 'in Mauer',
  snowy: 'verschneit',
  candles: 'Kerzen',
  level: 'Pegel',
};

const VALUE_LABELS: Record<string, string> = {
  north: 'Nord',
  east: 'Ost',
  south: 'Süd',
  west: 'West',
  up: 'oben',
  down: 'unten',
  top: 'oben',
  bottom: 'unten',
  double: 'doppelt',
  upper: 'oben',
  lower: 'unten',
  left: 'links',
  right: 'rechts',
  true: 'ja',
  false: 'nein',
  straight: 'gerade',
  inner_left: 'Innenecke links',
  inner_right: 'Innenecke rechts',
  outer_left: 'Außenecke links',
  outer_right: 'Außenecke rechts',
  wall: 'Wand',
  floor: 'Boden',
  ceiling: 'Decke',
  none: 'keine',
  low: 'niedrig',
  tall: 'hoch',
  head: 'Kopf',
  foot: 'Fuß',
};

export function propLabel(key: string): string {
  return PROP_LABELS[key] ?? key;
}

export function valueLabel(value: string): string {
  return VALUE_LABELS[value] ?? value;
}
