import { strToU8, zipSync } from 'fflate';
import type { Project } from '../app/project';
import { catalog, catalogOrigin, compactLayout, sideSheet, touchFirst } from '../app/workspace';
import { folderFiles, folderName, folderStatus } from '../platform/folder';
import { inArtifactViewer } from '../platform/save';
import { BUILD_TIME, STAGE, VERSION } from '../version';
import { collectEnvironment, browserLabel } from './environment';
import { formatLogLine, log } from './log';

export interface DebugPackageOptions {
  projects: Project[];
  activeId: string | null;
  includeProjectFiles: 'none' | 'active' | 'all';
  webgl: Record<string, unknown> | null;
  frame: Record<string, unknown> | null;
  benchmark: Record<string, unknown> | null;
  meshPool: Record<string, unknown> | null;
}

const appStart = Date.now();

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(0, 80) || 'projekt';
}

function projectReport(p: Project): Record<string, unknown> {
  const r = p.data;
  const stats = p.sceneStats.value ?? p.scene?.stats ?? null;
  return {
    id: p.id,
    name: p.name,
    file: p.fileName,
    fileSizeBytes: r.fileSize,
    format: r.formatLabel,
    compression: r.compression,
    dataVersion: r.info.dataVersion,
    minecraftVersion: r.minecraftVersion,
    size: { x: r.volume.sizeX, y: r.volume.sizeY, z: r.volume.sizeZ },
    contentBounds: r.analysis.bounds,
    blocks: r.analysis.nonAir,
    paletteSize: r.volume.palette.length,
    blockTypes: p.model.types.length - 1,
    offset: r.info.offset,
    worldEditOffset: r.info.weOffset,
    blockEntities: r.info.blockEntityCount,
    entities: r.info.entityCount,
    warnings: r.info.warnings,
    renames: r.info.renames,
    unknownBlocks: p.unknownBlocks,
    plan: p.isPlan
      ? {
          diagnostics: r.diagnostics ?? [],
          link: p.link.value,
          fileMissing: p.fileMissing.value,
          lastFileError: p.fileIssue.value,
        }
      : undefined,
    importTimingsMs: Object.fromEntries(Object.entries(r.timings).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    meshing: stats
      ? {
          chunks: stats.chunksTotal,
          emptyChunks: stats.chunksEmpty,
          meshedChunks: stats.chunksMeshed,
          opaqueQuads: stats.opaqueQuads,
          translucentQuads: stats.translucentQuads,
          triangles: (stats.opaqueQuads + stats.translucentQuads) * 2,
          vertices: stats.vertices,
          wallMs: Math.round(stats.wallMs),
          workerMs: Math.round(stats.workerMs),
          extractMs: Math.round(stats.extractMs),
          mode: stats.mode,
          workers: stats.workers,
          errors: stats.errors,
          done: stats.done,
        }
      : null,
    view: {
      layer: p.layer.value,
      displayLayer: p.displayLayer(p.layer.value),
      layers: p.layerCount,
      viewMode: p.viewMode.value,
      doneLayers: [...p.done.value].sort((a, b) => a - b),
      materialMode: p.materialMode.value,
      materialView: p.materialView.value,
      recipeChoices: p.recipeChoice.value,
      pinned: p.pinned.value,
      camera: p.camera,
    },
  };
}

/** Builds "tessera-debug-<time>.zip" with debug.json, log.txt and optionally the project files. */
export async function buildDebugPackage(opts: DebugPackageOptions): Promise<{ blob: Blob; fileName: string; summary: string }> {
  const env = await collectEnvironment();
  const now = new Date();
  const report = {
    tessera: { version: VERSION, stage: STAGE, buildTime: BUILD_TIME, createdAt: now.toISOString(), uptimeSeconds: Math.round((Date.now() - appStart) / 1000) },
    browser: browserLabel(env),
    environment: env,
    webgl: opts.webgl,
    frame: opts.frame,
    benchmark: opts.benchmark,
    meshPool: opts.meshPool,
    memory: (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory
      ? (() => {
          const m = (performance as Performance & { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
          return { usedMb: Math.round(m.usedJSHeapSize / 1e6), totalMb: Math.round(m.totalJSHeapSize / 1e6), limitMb: Math.round(m.jsHeapSizeLimit / 1e6) };
        })()
      : null,
    ui: {
      compactLayout: compactLayout.value,
      sideSheet: sideSheet.value,
      touchFirst: touchFirst.value,
      artifactViewer: inArtifactViewer(),
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
    },
    catalog: catalog.value
      ? {
          origin: catalogOrigin.value,
          minecraft: catalog.value.minecraft,
          createdAt: catalog.value.createdAt,
          blocks: Object.keys(catalog.value.blocks).length,
          models: catalog.value.models.length,
          recipes: catalog.value.recipes.length,
          families: Object.keys(catalog.value.families).length,
          warnings: catalog.value.warnings,
          sources: catalog.value.sources,
        }
      : null,
    projectFolder: { status: folderStatus.value, name: folderName.value, files: folderFiles.value.length },
    activeProject: opts.activeId,
    projects: opts.projects.map(projectReport),
    logCounts: { ...log.counts },
    log: log.all(),
  };

  const files: Record<string, Uint8Array> = {
    'debug.json': strToU8(JSON.stringify(report, null, 2)),
    'log.txt': strToU8(log.all().map((e) => formatLogLine(e, appStart)).join('\n') + '\n'),
    'LIESMICH.txt': strToU8(
      [
        'Tessera – Debug-Paket',
        '',
        `Erstellt: ${now.toLocaleString('de-DE')}`,
        `Tessera ${VERSION} (${STAGE}), ${browserLabel(env)}`,
        '',
        'Inhalt:',
        '  debug.json  Version, Browser, Funktionen, Leistungswerte, Projekte, unbekannte Blöcke, komplettes Log',
        '  log.txt     dasselbe Log als lesbarer Text',
        '  projekte/   die betroffenen Projektdateien (falls beigelegt)',
        '',
        'Diese Datei kannst du Claude direkt geben.',
      ].join('\n'),
    ),
  };

  const include =
    opts.includeProjectFiles === 'all'
      ? opts.projects
      : opts.includeProjectFiles === 'active'
        ? opts.projects.filter((p) => p.id === opts.activeId)
        : [];
  const used = new Set<string>();
  for (const p of include) {
    let name = safeFileName(p.fileName);
    while (used.has(name)) name = `_${name}`;
    used.add(name);
    files[`projekte/${name}`] = p.source;
  }

  const zip = zipSync(files, { level: 6 });
  const fileName = `tessera-debug-${timestamp(now)}.zip`;
  log.info('debug', `Debug-Paket erstellt: ${fileName}`, { bytes: zip.length, projectFiles: include.length });
  const summary = `${report.projects.length} Projekt(e), ${log.all().length} Log-Einträge`;
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), fileName, summary };
}
