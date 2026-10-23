import { useEffect, useRef, useState } from 'preact/hooks';
import { openFiles } from '../app/importer';
import { getViewer } from '../app/viewController';
import { activeProject, debugOpen, helpOpen, touchFirst } from '../app/workspace';
import { Dialogs } from './Dialogs';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';
import { Viewport } from './Viewport';

const ACCEPT = '.schem,.schematic,.litematic,.nbt';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const openPicker = () => fileInput.current?.click();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openPicker();
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      // A keyboard-focused button keeps its own Space/Enter behaviour.
      if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement | null)?.closest('button, [role=slider], a')) return;
      if (helpOpen.value || debugOpen.value) return;
      if (e.key === '?') {
        helpOpen.value = true;
        return;
      }
      const p = activeProject.value;
      if (!p) return;
      const viewer = getViewer();
      switch (e.key) {
        case 'ArrowUp':
          p.stepLayer(1);
          break;
        case 'ArrowDown':
          p.stepLayer(-1);
          break;
        case 'PageUp':
          p.setLayer(p.layer.value + 10);
          break;
        case 'PageDown':
          p.setLayer(p.layer.value - 10);
          break;
        case 'Home':
          p.setLayer(p.minLayer);
          break;
        case 'End':
          p.setLayer(p.maxLayer);
          break;
        case ' ':
          p.toggleDone();
          break;
        case 'Escape':
          if (p.pinned.value) p.togglePinned(null);
          else p.setViewMode('all');
          break;
        case 's':
        case 'S':
          p.setViewMode(p.viewMode.value === 'single' ? 'slice' : 'single');
          break;
        case 'f':
        case 'F':
          if (p.bounds) viewer?.frame(p.bounds);
          break;
        case 't':
        case 'T':
          if (p.bounds) viewer?.topView(p.bounds, p.viewMode.value === 'all' ? null : p.layer.value);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    // Buttons clicked with the mouse give focus back, so Space keeps meaning "layer done".
    const onClick = (e: MouseEvent) => {
      if (e.detail > 0) (e.target as HTMLElement | null)?.closest('button')?.blur();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, []);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <div
      class="app"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) void openFiles(files);
      }}
    >
      <TopBar onOpen={openPicker} />
      <main class="workspace">
        <Viewport onOpen={openPicker} />
        <Sidebar />
      </main>
      <input
        ref={fileInput}
        type="file"
        // Phone file pickers grey out unknown extensions; the format is recognised by content anyway.
        accept={touchFirst.value ? undefined : ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const input = e.currentTarget;
          const files = Array.from(input.files ?? []);
          input.value = '';
          if (files.length) void openFiles(files);
        }}
      />
      {dragging ? (
        <div class="drop-overlay" aria-hidden="true">
          <div>Loslassen zum Öffnen</div>
          <span>Jede Datei bekommt einen eigenen Tab.</span>
        </div>
      ) : null}
      <Toasts />
      <Dialogs />
    </div>
  );
}
