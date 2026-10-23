/** Minecraft target version of the modpack (see concept document). */
export const TARGET_MC_VERSION = '1.21.1';
export const TARGET_DATA_VERSION = 3955;

/** Known Java Edition data versions (release versions only). */
const DATA_VERSIONS: ReadonlyArray<[number, string]> = [
  [1519, '1.13'],
  [1628, '1.13.1'],
  [1631, '1.13.2'],
  [1952, '1.14'],
  [1957, '1.14.1'],
  [1963, '1.14.2'],
  [1968, '1.14.3'],
  [1976, '1.14.4'],
  [2225, '1.15'],
  [2227, '1.15.1'],
  [2230, '1.15.2'],
  [2566, '1.16'],
  [2567, '1.16.1'],
  [2578, '1.16.2'],
  [2580, '1.16.3'],
  [2584, '1.16.4'],
  [2586, '1.16.5'],
  [2724, '1.17'],
  [2730, '1.17.1'],
  [2860, '1.18'],
  [2865, '1.18.1'],
  [2975, '1.18.2'],
  [3105, '1.19'],
  [3117, '1.19.1'],
  [3120, '1.19.2'],
  [3218, '1.19.3'],
  [3337, '1.19.4'],
  [3463, '1.20'],
  [3465, '1.20.1'],
  [3578, '1.20.2'],
  [3698, '1.20.3'],
  [3700, '1.20.4'],
  [3837, '1.20.5'],
  [3839, '1.20.6'],
  [3953, '1.21'],
  [3955, '1.21.1'],
  [4080, '1.21.2'],
  [4082, '1.21.3'],
  [4189, '1.21.4'],
  [4325, '1.21.5'],
  [4435, '1.21.6'],
  [4438, '1.21.7'],
  [4440, '1.21.8'],
  [4554, '1.21.9'],
  [4556, '1.21.10'],
];

/** Human readable Minecraft version for a data version ("1.20.1", "≈ 1.20.1", …). */
export function minecraftVersionLabel(dataVersion: number | null): string | null {
  if (dataVersion === null || !Number.isFinite(dataVersion)) return null;
  let best: [number, string] | null = null;
  for (const entry of DATA_VERSIONS) {
    if (entry[0] <= dataVersion) best = entry;
    else break;
  }
  if (!best) return `vor 1.13 (DataVersion ${dataVersion})`;
  if (best[0] === dataVersion) return best[1];
  const last = DATA_VERSIONS[DATA_VERSIONS.length - 1];
  if (dataVersion > last[0]) return `neuer als ${last[1]}`;
  return `≈ ${best[1]}`;
}
