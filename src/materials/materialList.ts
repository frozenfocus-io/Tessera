import type { PaletteEntryInfo } from '../blocks/blockModel';
import { isCreativeOnly, stackSize } from '../blocks/items';
import { readableName } from '../blocks/names';
import type { LayerHistogram } from '../core/volume';

/** Shulker box capacity in slots. */
export const SHULKER_SLOTS = 27;

const LIQUIDS = new Set(['minecraft:water_bucket', 'minecraft:lava_bucket']);

export interface MaterialRow {
  item: string;
  displayName: string;
  count: number;
  stackSize: number;
  stacks: number;
  remainder: number;
  /** Inventory slots needed: the full stacks plus one slot for a partial stack. */
  slots: number;
  /** Shulker boxes needed (fractional): slots / 27, because a partial stack still takes a whole slot. */
  shulkers: number;
  swatch: number;
  /** Modded or unknown: colour/shape not reliable yet. */
  marked: boolean;
  creativeOnly: boolean;
  /** Water/lava source blocks: counted, but not part of the item totals. */
  liquid: boolean;
  /** Block types that use this item (for highlighting in the view). */
  typeIds: number[];
}

export interface MaterialSummary {
  rows: MaterialRow[];
  totalItems: number;
  /** Inventory slots for all items (each partial stack counts as one slot). */
  totalStacks: number;
  /** totalStacks / 27 */
  totalShulkers: number;
  /** Placed blocks (not items) in the selected layers. */
  blocks: number;
}

interface ItemInfo {
  item: string;
  displayName: string;
  stackSize: number;
  swatch: number;
  marked: boolean;
  creativeOnly: boolean;
  liquid: boolean;
  typeIds: Set<number>;
}

/**
 * Per-layer item counts for one project, precomputed from the per-layer palette histogram so
 * that any layer selection (all, one layer, from a layer, not yet done) is a quick sum.
 */
export class MaterialIndex {
  private readonly items: ItemInfo[] = [];
  private readonly byItem = new Map<string, ItemInfo>();
  /** For layer y: pairs [itemIndex, count] in layerPairs[offsets[y]*2 .. offsets[y+1]*2). */
  private readonly offsets: Uint32Array;
  private readonly layerPairs: Uint32Array;
  private readonly layerBlocks: Uint32Array;
  readonly sizeY: number;

  /**
   * @param nameOf display name of an item (German names from the catalog when one is loaded)
   */
  constructor(entries: readonly PaletteEntryInfo[], hist: LayerHistogram, sizeY: number, nameOf: (item: string) => string = readableName) {
    this.sizeY = sizeY;
    const itemIndex = new Map<string, number>();
    // palette index -> list of [itemIndex, multiplier]
    const costs: [number, number][][] = entries.map((e) =>
      e.items.map((c) => {
        let idx = itemIndex.get(c.item);
        if (idx === undefined) {
          idx = this.items.length;
          itemIndex.set(c.item, idx);
          const liquid = LIQUIDS.has(c.item);
          const info: ItemInfo = {
            item: c.item,
            displayName: nameOf(liquid ? c.item.replace(/_bucket$/, '') : c.item),
            stackSize: stackSize(c.item),
            swatch: e.colors.swatch,
            marked: e.colors.marked,
            creativeOnly: isCreativeOnly(c.item),
            liquid,
            typeIds: new Set(),
          };
          this.items.push(info);
          this.byItem.set(c.item, info);
        }
        this.items[idx].typeIds.add(e.typeId);
        return [idx, c.count] as [number, number];
      }),
    );

    this.offsets = new Uint32Array(sizeY + 1);
    this.layerBlocks = new Uint32Array(sizeY);
    const out: number[] = [];
    const acc = new Map<number, number>();
    for (let y = 0; y < sizeY; y++) {
      this.offsets[y] = out.length / 2;
      acc.clear();
      for (let i = hist.offsets[y]; i < hist.offsets[y + 1]; i++) {
        const p = hist.pairs[i * 2];
        const n = hist.pairs[i * 2 + 1];
        this.layerBlocks[y] += n;
        for (const [idx, mult] of costs[p] ?? []) acc.set(idx, (acc.get(idx) ?? 0) + n * mult);
      }
      for (const [idx, n] of acc) out.push(idx, n);
    }
    this.offsets[sizeY] = out.length / 2;
    this.layerPairs = Uint32Array.from(out);
  }

  /** Block types whose placement uses this item. */
  typeIdsForItem(item: string): number[] {
    const it = this.byItem.get(item);
    return it ? [...it.typeIds] : [];
  }

  /** Item counts over all layers for which `include(y)` is true. */
  summarize(include: (y: number) => boolean): MaterialSummary {
    const counts = new Float64Array(this.items.length);
    let blocks = 0;
    for (let y = 0; y < this.sizeY; y++) {
      if (!include(y)) continue;
      blocks += this.layerBlocks[y];
      for (let i = this.offsets[y]; i < this.offsets[y + 1]; i++) counts[this.layerPairs[i * 2]] += this.layerPairs[i * 2 + 1];
    }
    const rows: MaterialRow[] = [];
    let totalItems = 0;
    let totalStacks = 0;
    for (let i = 0; i < this.items.length; i++) {
      const count = counts[i];
      if (count === 0) continue;
      const it = this.items[i];
      const stacks = Math.floor(count / it.stackSize);
      const remainder = count - stacks * it.stackSize;
      const slots = stacks + (remainder > 0 ? 1 : 0);
      if (!it.liquid) {
        totalItems += count;
        totalStacks += slots;
      }
      rows.push({
        item: it.item,
        displayName: it.displayName,
        count,
        stackSize: it.stackSize,
        stacks,
        remainder,
        slots,
        shulkers: slots / SHULKER_SLOTS,
        swatch: it.swatch,
        marked: it.marked,
        creativeOnly: it.creativeOnly,
        liquid: it.liquid,
        typeIds: [...it.typeIds],
      });
    }
    rows.sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, 'de'));
    return { rows, totalItems, totalStacks, totalShulkers: totalStacks / SHULKER_SLOTS, blocks };
  }
}

const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatCount(n: number): string {
  return nf.format(n);
}

/** "3 × 64 + 12", "12", "2 × 16" */
export function formatStacks(row: Pick<MaterialRow, 'stacks' | 'remainder' | 'stackSize'>): string {
  if (row.stacks === 0) return nf.format(row.remainder);
  const base = `${nf.format(row.stacks)} × ${row.stackSize}`;
  return row.remainder > 0 ? `${base} + ${nf.format(row.remainder)}` : base;
}

/** Fractional shulker boxes with one decimal; tiny amounts as "<0,1" so that they don't read as zero. */
export function formatShulkers(n: number): string {
  if (!(n > 0)) return '–';
  if (n < 0.05) return `<${nf1.format(0.1)}`;
  return nf1.format(n);
}

/** Slots as whole shulker boxes: "1 volle Shulker-Kiste + 4 Plätze", "3 Plätze", "2 volle Shulker-Kisten". */
export function describeSlots(slots: number): string {
  const full = Math.floor(slots / SHULKER_SLOTS);
  const rest = slots - full * SHULKER_SLOTS;
  const parts: string[] = [];
  if (full > 0) parts.push(`${nf.format(full)} ${full === 1 ? 'volle Shulker-Kiste' : 'volle Shulker-Kisten'}`);
  if (rest > 0 || full === 0) parts.push(`${nf.format(rest)} ${rest === 1 ? 'Platz' : 'Plätze'}`);
  return parts.join(' + ');
}
