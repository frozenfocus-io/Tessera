import { computed, effect } from '@preact/signals';
import { log } from '../debug/log';
import { MODE_ALL, MODE_SINGLE, MODE_SLICE } from '../render/blockMaterial';
import { MeshPool } from '../render/meshPool';
import { ProjectScene } from '../render/ProjectScene';
import { raycastVolume } from '../render/raycast';
import { Viewer } from '../render/Viewer';
import { persistWorkspace, scheduleSave } from './importer';
import type { Project, ViewMode } from './project';
import { activeId, activeProject, markUnknown, projection, projects } from './workspace';

let viewer: Viewer | null = null;
let pool: MeshPool | null = null;
const bindings = new Map<string, () => void>();

export function getViewer(): Viewer | null {
  return viewer;
}

export function getPool(): MeshPool | null {
  return pool;
}

const modeNumber = (m: ViewMode): number => (m === 'all' ? MODE_ALL : m === 'slice' ? MODE_SLICE : MODE_SINGLE);

/** Whether blocks in layer `y` are visible in the given view. */
const layerShown = (mode: ViewMode, layer: number, y: number): boolean =>
  mode === 'all' || (mode === 'slice' ? y <= layer : y === layer);

/** Item key for pins: "item:<id>" from the material list, "type:<n>" from clicking a block. */
export function highlightTypesFor(p: Project): { types: number[]; pinned: boolean } {
  const pin = p.pinned.value;
  if (pin?.startsWith('item:')) return { types: p.materials.typeIdsForItem(pin.slice(5)), pinned: true };
  if (pin?.startsWith('type:')) return { types: [Number(pin.slice(5))], pinned: true };
  const h = p.hover.value;
  return { types: h ? [h.typeId] : [], pinned: false };
}

/** Creates the scene of a project on first use and keeps it in sync with the project's state. */
function ensureScene(p: Project): ProjectScene {
  if (p.scene) return p.scene;
  const scene = new ProjectScene(p.id, p.data.volume, p.bounds, p.model, pool!);
  p.scene = scene;
  p.meshProgress.value = { done: 0, total: 1 };
  void scene
    .build((done, total) => {
      p.meshProgress.value = { done, total };
    })
    .then((stats) => {
      p.meshProgress.value = null;
      p.sceneStats.value = { ...stats };
    });

  const highlightKey = computed(() => {
    const { types, pinned } = highlightTypesFor(p);
    return `${pinned ? 'P' : 'H'}:${types.join(',')}`;
  });

  const disposers = [
    effect(() => {
      scene.setView(modeNumber(p.viewMode.value), p.layer.value);
      p.outlineInfo.value = { ...scene.outlineInfo };
      // A block that the new view hides loses its info card and outline (the marking of its kind stays).
      const h = p.hover.peek();
      if (h && !layerShown(p.viewMode.value, p.layer.value, h.y)) p.hover.value = null;
    }),
    effect(() => {
      scene.setDoneLayers(p.done.value);
    }),
    effect(() => {
      scene.setMarkUnknown(markUnknown.value);
    }),
    effect(() => {
      void highlightKey.value;
      const { types, pinned } = highlightTypesFor(p);
      scene.setHighlight(types, pinned ? 0.35 : 0);
      p.outlineInfo.value = { ...scene.outlineInfo };
    }),
    effect(() => {
      const h = p.hover.value;
      if (h) scene.showHover(h.x, h.y, h.z, h.palette);
      else scene.hideHover();
    }),
    effect(() => {
      void p.revision.value;
      scheduleSave(p);
    }),
  ];
  bindings.set(p.id, () => disposers.forEach((d) => d()));
  return scene;
}

/** Creates the viewer inside the given element and wires it to the workspace. */
export function attachViewer(container: HTMLElement): () => void {
  viewer = new Viewer(container);
  viewer.onProjectionChange = (p) => {
    projection.value = p;
  };
  pool = new MeshPool();
  let current: Project | null = null;
  let camTimer: ReturnType<typeof setTimeout> | undefined;

  viewer.onCameraChange = () => {
    if (!current) return;
    clearTimeout(camTimer);
    const p = current;
    camTimer = setTimeout(() => {
      p.camera = viewer!.getCameraState();
      p.touch();
    }, 500);
  };

  const stopActive = effect(() => {
    const p = activeProject.value;
    if (current && current !== p && viewer) {
      current.camera = viewer.getCameraState();
      current.hover.value = null;
    }
    current = p;
    if (!viewer) return;
    if (!p) {
      viewer.setScene(null);
      return;
    }
    const scene = ensureScene(p);
    viewer.setScene(scene, p.camera, p.bounds);
    if (!p.camera) p.camera = viewer.getCameraState();
    log.debug('workspace', `Aktiver Tab: ${p.name}`);
  });

  // Drop bindings of closed projects.
  const stopClosed = effect(() => {
    const ids = new Set(projects.value.map((p) => p.id));
    for (const [id, dispose] of bindings) {
      if (!ids.has(id)) {
        dispose();
        bindings.delete(id);
      }
    }
  });

  const stopPersist = effect(() => {
    void activeId.value;
    persistWorkspace();
  });

  return () => {
    stopActive();
    stopClosed();
    stopPersist();
    for (const d of bindings.values()) d();
    bindings.clear();
    viewer?.dispose();
    pool?.dispose();
    viewer = null;
    pool = null;
  };
}

/** Updates the hover target from a pointer position (client coordinates). */
export function hoverAt(p: Project, clientX: number, clientY: number): void {
  if (!viewer) return;
  const { origin, direction } = viewer.rayAt(clientX, clientY);
  const mode = p.viewMode.value;
  const filter =
    mode === 'all' ? {} : mode === 'slice' ? { maxLayer: p.layer.value } : { minLayer: p.layer.value, maxLayer: p.layer.value };
  const hit = raycastVolume(p.data.volume, p.model.table, origin, direction, filter);
  const prev = p.hover.value;
  if (!hit) {
    if (prev) p.hover.value = null;
    return;
  }
  if (prev && prev.x === hit.x && prev.y === hit.y && prev.z === hit.z && prev.palette === hit.palette) return;
  p.hover.value = { x: hit.x, y: hit.y, z: hit.z, palette: hit.palette, typeId: p.model.table.typeId[hit.palette] };
}
