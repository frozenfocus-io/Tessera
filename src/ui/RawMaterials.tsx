import type { Project } from '../app/project';
import { itemName } from '../catalog/runtime';
import type { Recipe } from '../catalog/types';
import { isCreativeOnly, stackSize } from '../blocks/items';
import { breakDown, recipeBookFor, type RecipeBook } from '../materials/breakdown';
import { describeSlots, formatShulkers, formatStacks, SHULKER_SLOTS, type MaterialSummary } from '../materials/materialList';
import { catalogDialogOpen, showToast } from '../app/workspace';
import { IconCopy } from './icons';
import { num } from './format';

/**
 * Raw material breakdown: what has to be mined or gathered for the selected layers, and how
 * every block is made. A table of its own, separate from the material list.
 */
export function RawMaterials({ project: p, summary, scopeText }: { project: Project; summary: MaterialSummary; scopeText: string }) {
  const catalog = p.catalog;
  if (!catalog) {
    return (
      <div class="raw-empty">
        <p>Für die Rohstoffe braucht Tessera die Rezepte aus dem Spiel und aus den Mods.</p>
        <button class="btn btn-primary" onClick={() => (catalogDialogOpen.value = true)}>
          Modpack einlesen
        </button>
      </div>
    );
  }
  const book = recipeBookFor(catalog);
  const choices = p.recipeChoice.value;
  const demand = new Map<string, number>();
  for (const r of summary.rows) if (!r.liquid) demand.set(r.item, (demand.get(r.item) ?? 0) + r.count);
  const result = breakDown(demand, book, choices);
  const name = (id: string) => itemName(catalog, id);

  const rows = [...result.raw].map(([item, count]) => {
    const size = stackSize(item);
    const stacks = Math.floor(count / size);
    const remainder = count - stacks * size;
    const slots = stacks + (remainder > 0 ? 1 : 0);
    return { item, count, size, stacks, remainder, slots, name: name(item), creative: isCreativeOnly(item) };
  });
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
  const totalItems = rows.reduce((n, r) => n + r.count, 0);
  const totalSlots = rows.reduce((n, r) => n + r.slots, 0);
  const switchableRaw = rows.filter((r) => book.options(r.item).length > 0);

  const copy = async () => {
    const lines = [
      `${p.name} – Rohstoffe (${scopeText})`,
      ...rows.map((r) => `${num(r.count)}\t${r.name}\t${formatStacks({ stacks: r.stacks, remainder: r.remainder, stackSize: r.size })}`),
      '',
      'Herstellung:',
      ...result.steps.map((s) => `${num(s.crafts)}× ${s.recipe.station}: ${recipeText(s.recipe, book, name)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast('success', 'Rohstoffliste kopiert.');
    } catch {
      showToast('error', 'Kopieren hat nicht geklappt – der Browser hat den Zugriff auf die Zwischenablage verweigert.');
    }
  };

  if (rows.length === 0) return <p class="muted material-empty">In diesem Bereich gibt es nichts zu besorgen.</p>;

  return (
    <>
      <div class="material-totals">
        <div>
          <strong>{num(totalItems)}</strong>
          <span>Rohstoffe</span>
        </div>
        <div title="Inventarplätze: jeder angefangene Stack belegt einen Platz">
          <strong>{num(totalSlots)}</strong>
          <span>Stacks</span>
        </div>
        <div title={`${num(totalSlots)} Plätze = ${describeSlots(totalSlots)} (eine Kiste hat 27 Plätze)`}>
          <strong>{formatShulkers(totalSlots / SHULKER_SLOTS)}</strong>
          <span>Shulker</span>
        </div>
        <button class="btn btn-icon btn-ghost" title="Rohstoffe und Herstellung als Text kopieren" aria-label="Rohstoffe kopieren" onClick={copy}>
          <IconCopy />
        </button>
      </div>
      <div class="material-scroll">
        <table class="material">
          <thead>
            <tr>
              <th scope="col" class="c-name">
                Rohstoff
              </th>
              <th scope="col" class="c-num">
                Anzahl
              </th>
              <th scope="col" class="c-stack">
                Stacks
              </th>
              <th scope="col" class="c-sk" title="Shulker-Kisten">
                SK
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item} class="is-static">
                <td class="c-name">
                  <span class="cell-name">
                    <span class="name">{r.name}</span>
                    {r.creative ? <span class="tag" title="Im Survival nicht erhältlich">C</span> : null}
                  </span>
                </td>
                <td class="c-num">{num(r.count)}</td>
                <td class="c-stack">{formatStacks({ stacks: r.stacks, remainder: r.remainder, stackSize: r.size })}</td>
                <td class="c-sk" title={describeSlots(r.slots)}>
                  {formatShulkers(r.slots / SHULKER_SLOTS)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="craft">
          <h4>Herstellung</h4>
          <p class="muted craft-note">Tessera nimmt für jeden Block den günstigsten Weg. Hier kannst du ihn ändern.</p>
          <ul class="craft-list">
            {result.steps.map((s) => (
              <li key={s.item}>
                <div class="craft-head">
                  <span class="craft-name">{name(s.item)}</span>
                  <span class="craft-count">{num(s.crafts)}×</span>
                </div>
                <RecipeSelect project={p} book={book} item={s.item} current={s.recipe.id} name={name} />
              </li>
            ))}
            {switchableRaw.map((r) => (
              <li key={`raw-${r.item}`}>
                <div class="craft-head">
                  <span class="craft-name">{r.name}</span>
                  <span class="craft-count muted">Rohstoff</span>
                </div>
                <RecipeSelect project={p} book={book} item={r.item} current="raw" name={name} />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p class="material-scope muted">Umfang: {scopeText}.</p>
    </>
  );
}

function recipeText(r: Recipe, book: RecipeBook, name: (id: string) => string): string {
  const inputs = r.inputs.map((i) => {
    const pick = book.pickOption(i.options);
    return `${i.count} ${pick ? name(pick) : i.options[0]}`;
  });
  return `${inputs.join(' + ')} → ${r.output.count}`;
}

function RecipeSelect({ project: p, book, item, name }: { project: Project; book: RecipeBook; item: string; current: string; name: (id: string) => string }) {
  const options = book.options(item);
  const chosen = p.recipeChoice.value[item] ?? 'auto';
  const defaultRecipe = book.chosen(item, {});
  const autoLabel = defaultRecipe ? `Automatisch: ${defaultRecipe.station} – ${recipeText(defaultRecipe, book, name)}` : 'Automatisch: als Rohstoff besorgen';
  return (
    <select class="craft-select" aria-label={`Herstellung von ${name(item)}`} value={chosen} onChange={(e) => p.chooseRecipe(item, (e.currentTarget as HTMLSelectElement).value)}>
      <option value="auto">{autoLabel}</option>
      {options.map((o) => (
        <option key={o.recipe.id} value={o.recipe.id}>
          {o.recipe.station}: {recipeText(o.recipe, book, name)}
        </option>
      ))}
      <option value="raw">Als Rohstoff besorgen</option>
    </select>
  );
}
