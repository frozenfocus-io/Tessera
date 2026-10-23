import { log } from '../debug/log';

/**
 * Saving files the app generates (screenshots, debug package).
 *
 * Normally a download link does the job. Inside the claude.ai artifact viewer a page may not
 * start downloads itself; there the viewer's `downloads` capability asks the person and saves
 * the file. The capability is reached through `window.claude.use`, which only exists there.
 */

interface DownloadsCapability {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}

interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

function claudeHost(): ClaudeHost | null {
  const c = (window as unknown as { claude?: Partial<ClaudeHost> }).claude;
  return c && typeof c.use === 'function' ? (c as ClaudeHost) : null;
}

let downloads: Promise<DownloadsCapability | null> | null = null;

function downloadsCapability(): Promise<DownloadsCapability | null> {
  const host = claudeHost();
  if (!host) return Promise.resolve(null);
  downloads ??= host
    .use('downloads')
    .then((d) => (d && typeof (d as DownloadsCapability).save === 'function' ? (d as DownloadsCapability) : null))
    .catch(() => null);
  return downloads;
}

/** True inside the claude.ai artifact viewer. */
export function inArtifactViewer(): boolean {
  return claudeHost() !== null;
}

/** Resolves the downloads capability early, so the first save does not wait for it. */
export function prepareSaving(): void {
  if (inArtifactViewer()) void downloadsCapability();
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

/** Saves a generated file. Never throws. */
export async function saveFile(blob: Blob, fileName: string): Promise<SaveOutcome> {
  if (!inArtifactViewer()) {
    downloadLink(blob, fileName);
    return 'saved';
  }
  const cap = await downloadsCapability();
  if (!cap) {
    log.warn('save', `Speichern nicht möglich (keine Download-Fähigkeit): ${fileName}`);
    return 'unavailable';
  }
  try {
    await cap.save({ filename: fileName, data: blob });
    return 'saved';
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (code === 'declined') return 'declined';
    log.warn('save', `Speichern abgelehnt: ${fileName}`, e);
    return 'unavailable';
  }
}

/** Classic download through a temporary link. */
export function downloadLink(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
