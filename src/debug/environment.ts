/** Browser and feature information for the debug package and the info dialog. */
export interface EnvironmentInfo {
  userAgent: string;
  brands: string[] | null;
  platform: string | null;
  isBrave: boolean | null;
  language: string;
  screen: { width: number; height: number; pixelRatio: number };
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  features: {
    fileSystemAccess: boolean;
    indexedDB: boolean;
    storagePersisted: boolean | null;
    storageEstimateMb: { usage: number; quota: number } | null;
    webgl2: boolean;
    offscreenCanvas: boolean;
    compressionStreams: boolean;
  };
}

interface NavigatorExtras {
  userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string };
  brave?: { isBrave?: () => Promise<boolean> };
  deviceMemory?: number;
}

export async function collectEnvironment(): Promise<EnvironmentInfo> {
  const nav = navigator as Navigator & NavigatorExtras;
  let isBrave: boolean | null = null;
  try {
    isBrave = nav.brave?.isBrave ? await nav.brave.isBrave() : false;
  } catch {
    isBrave = null;
  }
  let storagePersisted: boolean | null = null;
  let storageEstimateMb: EnvironmentInfo['features']['storageEstimateMb'] = null;
  try {
    storagePersisted = nav.storage?.persisted ? await nav.storage.persisted() : null;
    const est = nav.storage?.estimate ? await nav.storage.estimate() : null;
    if (est) storageEstimateMb = { usage: Math.round((est.usage ?? 0) / 1e6), quota: Math.round((est.quota ?? 0) / 1e6) };
  } catch {
    /* not available */
  }
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return {
    userAgent: nav.userAgent,
    brands: nav.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`) ?? null,
    platform: nav.userAgentData?.platform ?? null,
    isBrave,
    language: nav.language,
    screen: { width: screen.width, height: screen.height, pixelRatio: window.devicePixelRatio },
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    features: {
      fileSystemAccess: 'showDirectoryPicker' in window,
      indexedDB: typeof indexedDB !== 'undefined',
      storagePersisted,
      storageEstimateMb,
      webgl2,
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      compressionStreams: typeof DecompressionStream !== 'undefined',
    },
  };
}

/** Short browser label, e.g. "Brave 130" or "Chrome 130". */
export function browserLabel(env: EnvironmentInfo): string {
  const brands = env.brands ?? [];
  const pick = (name: string) => brands.find((b) => b.startsWith(name));
  const chrome = pick('Google Chrome') ?? pick('Chromium');
  const version = chrome?.split(' ').pop() ?? '';
  if (env.isBrave) return `Brave (Chromium ${version})`.trim();
  const edge = pick('Microsoft Edge');
  if (edge) return edge;
  if (chrome) return chrome;
  const ff = /Firefox\/(\d+)/.exec(env.userAgent);
  if (ff) return `Firefox ${ff[1]}`;
  const safari = /Version\/(\d+).*Safari/.exec(env.userAgent);
  if (safari) return `Safari ${safari[1]}`;
  return env.userAgent.slice(0, 60);
}
