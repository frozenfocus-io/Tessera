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
