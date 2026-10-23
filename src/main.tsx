import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import './styles/app.css';

import { render } from 'preact';
import { loadCatalogAtStartup } from './app/catalogState';
import { restoreWorkspace } from './app/importer';
import { startFileWatch } from './app/planFiles';
import { restoreFolder } from './platform/folder';
import { getPool, getViewer } from './app/viewController';
import { activeProject, projects } from './app/workspace';
import { log } from './debug/log';
import { loadExamples } from './platform/examples';
import { prepareSaving } from './platform/save';
import { App } from './ui/App';
import { BUILD_TIME, STAGE, VERSION } from './version';

// Logging runs from the start, so even startup errors end up in the debug package.
log.installGlobalHandlers();
log.info('app', `Tessera ${VERSION} startet (${STAGE})`, { build: BUILD_TIME, userAgent: navigator.userAgent });

declare global {
  interface Window {
    /** Read-only status for troubleshooting in the browser console and automated checks. */
    __tessera?: {
      version: string;
      status: () => unknown;
      camera: (position: [number, number, number], target: [number, number, number]) => void;
    };
  }
}

window.__tessera = {
  version: VERSION,
  status: () => ({
    projects: projects.value.map((p) => ({
      id: p.id,
      name: p.name,
      blocks: p.data.analysis.nonAir,
      layer: p.layer.value,
      viewMode: p.viewMode.value,
      meshing: p.meshProgress.value,
      scene: p.sceneStats.value,
      hover: p.hover.value,
    })),
    active: activeProject.value?.id ?? null,
    frame: getViewer()?.frameStats ?? null,
    pool: getPool() ? { mode: getPool()!.mode, workers: getPool()!.workerCount } : null,
    log: log.counts,
  }),
  camera: (position, target) => getViewer()?.setCameraState({ position, target }),
};

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
  // Projects are built with the catalog, so it has to be there before the tabs come back;
  // linked building plans are read from the project folder, so that comes first too.
  void Promise.all([loadCatalogAtStartup(), restoreFolder()])
    .then(() => restoreWorkspace())
    .then(() => startFileWatch());
  void loadExamples();
  prepareSaving();
}
