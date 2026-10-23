import { computed, signal } from '@preact/signals';
import type { Project } from './project';

/** All open projects (one tab each) and the active one. */
export const projects = signal<Project[]>([]);
export const activeId = signal<string | null>(null);
export const activeProject = computed(() => projects.value.find((p) => p.id === activeId.value) ?? null);

/** Files currently being read. */
export const importing = signal<{ fileName: string }[]>([]);

/** Show unknown/modded blocks with red stripes. */
export const markUnknown = signal(true);

/** Current camera projection of the 3D view (plan view = orthographic). */
export const projection = signal<'perspective' | 'orthographic'>('perspective');

export const helpOpen = signal(false);
export const debugOpen = signal(false);

/** A signal that follows a media query. The queries match the breakpoints in app.css. */
function mediaSignal(query: string) {
  const mql = typeof matchMedia === 'function' ? matchMedia(query) : null;
  const s = signal(mql?.matches ?? false);
  mql?.addEventListener?.('change', (e) => (s.value = e.matches));
  return s;
}

/** Phone and tablet layout: the project panel becomes a sheet (bottom, or right in landscape). */
export const compactLayout = mediaSignal('(max-width: 900px), (max-height: 520px)');
/** Phone in landscape: the sheet sits on the right and stays open. */
export const sideSheet = mediaSignal('(max-height: 520px) and (min-width: 600px)');
/** The primary pointer is a finger: tap instead of hover, gestures in the help. */
export const touchFirst = mediaSignal('(pointer: coarse)');

/** State of the sheet in the compact layout (per viewer, not saved with the project). */
export const sheetExpanded = signal(false);
export const sheetTab = signal<'material' | 'project'>('material');

/** Example files published next to the app (only in hosted test versions, see examples.ts). */
export interface ExampleFile {
  label: string;
  /** File name shown in the tab. */
  name: string;
  /** Either a URL next to the app … */
  file?: string;
  /** … or the file itself, base64-encoded (for hosts that serve no binary files). */
  data?: string;
}
export const examples = signal<ExampleFile[]>([]);

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  detail?: string;
  action?: { label: string; run: () => void };
}
export const toasts = signal<Toast[]>([]);
let toastId = 1;

export function showToast(
  kind: Toast['kind'],
  text: string,
  detail?: string,
  ms = kind === 'error' ? 9000 : 4000,
  action?: Toast['action'],
): void {
  const t: Toast = { id: toastId++, kind, text, detail, action };
  toasts.value = [...toasts.value, t];
  setTimeout(() => dismissToast(t.id), ms);
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Results of the last performance test, included in the debug package. */
export const lastBenchmark = signal<Record<string, unknown> | null>(null);
