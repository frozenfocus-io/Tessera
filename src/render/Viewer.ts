import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Bounds } from '../core/volume';
import { log } from '../debug/log';
import type { ProjectScene } from './ProjectScene';

export type Projection = 'perspective' | 'orthographic';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  projection?: Projection;
  /** Orthographic only: visible height in blocks at zoom 1 and the zoom factor. */
  orthoHeight?: number;
  zoom?: number;
}

export interface BenchmarkResult {
  frames: number;
  seconds: number;
  avgFps: number;
  minFps: number;
  p95FrameMs: number;
  triangles: number;
  drawCalls: number;
}

export interface FrameStats {
  fps: number | null;
  lastFrameMs: number;
  drawCalls: number;
  triangles: number;
}

const BACKGROUND = 0x1a1e23;
const FOV = 45;

/**
 * Owns the WebGL renderer, the cameras and the controls. Renders the active project's scene on
 * demand (when something changed) to keep the laptop cool; while interacting it renders every
 * frame and measures the frame rate. Two projections: perspective for looking around, and an
 * orthographic plan view for building layer by layer (blocks line up exactly with the grid).
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly perspective: THREE.PerspectiveCamera;
  readonly orthographic: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  private cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private orthoHeight = 40;
  private active: ProjectScene | null = null;
  private dirty = true;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private benchmarking = false;
  readonly frameStats: FrameStats = { fps: null, lastFrameMs: 0, drawCalls: 0, triangles: 0 };
  /** Fired after the camera moved (debounced by the caller). */
  onCameraChange: () => void = () => {};
  /** Fired after every rendered frame. */
  onFrame: () => void = () => {};
  /** Fired when the projection changes. */
  onProjectionChange: (p: Projection) => void = () => {};

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(BACKGROUND, 1);
    this.renderer.domElement.classList.add('viewer-canvas');
    container.appendChild(this.renderer.domElement);

    this.perspective = new THREE.PerspectiveCamera(FOV, 1, 0.05, 8000);
    this.perspective.position.set(20, 20, 20);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 8000);
    this.cam = this.perspective;

    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.keys = { LEFT: '', UP: '', RIGHT: '', BOTTOM: '' }; // arrow keys belong to the layer slider
    this.controls.addEventListener('change', () => {
      this.dirty = true;
      this.onCameraChange();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const gl = this.renderer.getContext();
    log.info('render', 'WebGL bereit', {
      version: gl.getParameter(gl.VERSION),
      shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    });
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      log.error('render', 'WebGL-Kontext verloren (Grafikkarte überlastet oder Treiberproblem).');
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      log.warn('render', 'WebGL-Kontext wiederhergestellt.');
      this.requestRender();
    });

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get camera(): THREE.Camera {
    return this.cam;
  }

  get projection(): Projection {
    return this.cam === this.orthographic ? 'orthographic' : 'perspective';
  }

  requestRender(): void {
    this.dirty = true;
  }

  private updateOrthoFrustum(): void {
    const aspect = this.perspective.aspect;
    const h = this.orthoHeight / 2;
    this.orthographic.left = -h * aspect;
    this.orthographic.right = h * aspect;
    this.orthographic.top = h;
    this.orthographic.bottom = -h;
    this.orthographic.updateProjectionMatrix();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.updateOrthoFrustum();
    const pr = this.renderer.getPixelRatio();
    this.active?.hover.setResolution(w * pr, h * pr);
    this.dirty = true;
  }

  private loop(now: number): void {
    this.raf = requestAnimationFrame(this.loop);
    const moving = this.controls.update();
    if (!this.dirty && !moving && !this.benchmarking) {
      if (now - this.lastFrameAt > 600) this.frameStats.fps = null;
      return;
    }
    this.dirty = false;
    this.renderFrame(now);
  }

  private renderFrame(now: number): void {
    const t0 = performance.now();
    if (this.active) {
      this.renderer.render(this.active.scene, this.cam);
    } else {
      this.renderer.clear();
    }
    this.frameStats.lastFrameMs = performance.now() - t0;
    this.frameStats.drawCalls = this.renderer.info.render.calls;
    this.frameStats.triangles = this.renderer.info.render.triangles;
    if (this.lastFrameAt > 0 && now - this.lastFrameAt < 250) {
      this.frameTimes.push(now - this.lastFrameAt);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameStats.fps = avg > 0 ? 1000 / avg : null;
    } else {
      this.frameTimes = [];
    }
    this.lastFrameAt = now;
    this.onFrame();
  }

  /** Switches projection, keeping the camera position, target and roughly the visible size. */
  setProjection(p: Projection): void {
    if (p === this.projection) return;
    const target = this.controls.target.clone();
    if (p === 'orthographic') {
      const dist = this.perspective.position.distanceTo(target);
      this.orthoHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      this.orthographic.position.copy(this.perspective.position);
      this.orthographic.up.copy(this.perspective.up);
      this.orthographic.zoom = 1;
      this.updateOrthoFrustum();
      this.cam = this.orthographic;
    } else {
      const visible = this.orthoHeight / this.orthographic.zoom;
      const dist = visible / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
      const dir = this.orthographic.position.clone().sub(target).normalize();
      this.perspective.position.copy(target).addScaledVector(dir, dist);
      this.perspective.up.copy(this.orthographic.up);
      this.cam = this.perspective;
    }
    this.cam.lookAt(target);
    this.controls.object = this.cam;
    this.controls.update();
    this.dirty = true;
    this.onProjectionChange(p);
  }

  setScene(scene: ProjectScene | null, camera?: CameraState | null, bounds?: Bounds | null): void {
    this.active = scene;
    if (scene) {
      scene.onChange = () => this.requestRender();
      const pr = this.renderer.getPixelRatio();
      scene.hover.setResolution(this.container.clientWidth * pr, this.container.clientHeight * pr);
      if (camera) this.setCameraState(camera);
      else if (bounds) this.frame(bounds);
    }
    this.dirty = true;
  }

  getCameraState(): CameraState {
    const p = this.cam.position;
    const t = this.controls.target;
    const state: CameraState = { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], projection: this.projection };
    if (this.projection === 'orthographic') {
      state.orthoHeight = this.orthoHeight;
      state.zoom = this.orthographic.zoom;
    }
    return state;
  }

  setCameraState(s: CameraState): void {
    if (s.projection === 'orthographic') {
      this.orthoHeight = s.orthoHeight ?? this.orthoHeight;
      this.orthographic.zoom = s.zoom ?? 1;
      this.updateOrthoFrustum();
      this.cam = this.orthographic;
    } else {
      this.cam = this.perspective;
    }
    this.controls.object = this.cam;
    this.cam.position.set(...s.position);
    this.controls.target.set(...s.target);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.controls.target);
    this.controls.update();
    this.dirty = true;
    this.onProjectionChange(this.projection);
  }

  /**
   * Fraction of the view's width and height that is free of overlays (toolbar, layer slider,
   * info lines), kept symmetric so that the centred model stays clear of them.
   */
  private freeFraction(): { fw: number; fh: number } {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const i = this.frameInsets;
    const fw = (w - 2 * Math.max(i.left, i.right)) / w;
    const fh = (h - 2 * Math.max(i.top, i.bottom)) / h;
    return { fw: Math.min(1, Math.max(0.35, fw)), fh: Math.min(1, Math.max(0.35, fh)) };
  }

  /**
   * Camera distance at which the bounding box, seen from direction `dir`, just fits into the
   * free part of the view. Fits the box's eight corners, which is much tighter than the
   * bounding sphere for tall towers on a narrow phone screen.
   */
  private fitDistance(bounds: Bounds, dir: THREE.Vector3): { center: THREE.Vector3; radius: number; distance: number } {
    const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2);
    const radius = 0.5 * Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
    const { fw, fh } = this.freeFraction();
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * fh;
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * this.perspective.aspect * fw;
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const v = new THREE.Vector3();
    let distance = 0;
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [bounds.minY, bounds.maxY]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          v.set(x, y, z).sub(center);
          const along = v.dot(dir);
          distance = Math.max(distance, Math.abs(v.dot(right)) / tanH + along, Math.abs(v.dot(up)) / tanV + along);
        }
      }
    }
    return { center, radius, distance: Math.max(distance * 1.04, radius * 0.6 + 2) };
  }

  /** Space taken by overlays at the edges of the view, in CSS pixels (set by the UI). */
  frameInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Perspective overview of the whole build. */
  frame(bounds: Bounds): void {
    const dir = new THREE.Vector3(1, 0.85, 1.25).normalize();
    const { center, radius, distance } = this.fitDistance(bounds, dir);
    if (this.projection !== 'perspective') {
      this.cam = this.perspective;
      this.controls.object = this.cam;
      this.onProjectionChange('perspective');
    }
    this.perspective.position.copy(center).addScaledVector(dir, distance);
    this.perspective.up.set(0, 1, 0);
    this.perspective.near = Math.max(0.05, radius / 500);
    this.perspective.far = Math.max(1000, distance + radius * 4);
    this.perspective.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.perspective.lookAt(center);
    this.controls.update();
    this.dirty = true;
  }

  /**
   * Turns the camera towards a part of the model: looks at the bounds from the given direction
   * (from the target towards the camera) and fits them into the view, in perspective.
   */
  focus(bounds: Bounds, from: [number, number, number]): void {
    const dir = new THREE.Vector3(...from);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.85, 1.25);
    dir.normalize();
    const { center, radius, distance } = this.fitDistance(bounds, dir);
    if (this.projection !== 'perspective') {
      this.cam = this.perspective;
      this.controls.object = this.cam;
      this.onProjectionChange('perspective');
    }
    this.perspective.position.copy(center).addScaledVector(dir, Math.max(distance, 12));
    this.perspective.up.set(0, 1, 0);
    this.perspective.near = Math.max(0.05, radius / 500);
    this.perspective.far = Math.max(this.perspective.far, distance + radius * 4);
    this.perspective.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.perspective.lookAt(center);
    this.controls.update();
    this.dirty = true;
  }

  /** Current viewing direction (from the target towards the camera). */
  get viewDirection(): [number, number, number] {
    const p = this.cam.position;
    const t = this.controls.target;
    return [p.x - t.x, p.y - t.y, p.z - t.z];
  }

  /**
   * Plan view: orthographic, straight down onto the given layer, north at the top of the
   * screen. Blocks line up exactly with the grid like on a blueprint.
   */
  topView(bounds: Bounds, layer: number | null): void {
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    const aspect = this.perspective.aspect;
    const { fw, fh } = this.freeFraction();
    this.orthoHeight = Math.max(d / fh, w / (aspect * fw)) * 1.06 + 1;
    this.orthographic.zoom = 1;
    this.updateOrthoFrustum();
    const y = layer === null ? bounds.maxY : layer + 1;
    const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, y, (bounds.minZ + bounds.maxZ) / 2);
    this.cam = this.orthographic;
    this.controls.object = this.cam;
    this.controls.target.copy(target);
    // A tiny offset towards south keeps north at the top and avoids the pole singularity.
    this.orthographic.position.set(target.x, target.y + 200, target.z + 0.01);
    this.orthographic.up.set(0, 1, 0);
    this.orthographic.lookAt(target);
    this.controls.update();
    this.dirty = true;
    this.onProjectionChange('orthographic');
  }

  /** World-space ray through a point in client (CSS pixel) coordinates. */
  rayAt(clientX: number, clientY: number): { origin: [number, number, number]; direction: [number, number, number] } {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cam);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    return { origin: [o.x, o.y, o.z], direction: [d.x, d.y, d.z] };
  }

  /** Camera heading in degrees (0 = looking north). */
  get heading(): number {
    const dx = this.controls.target.x - this.cam.position.x;
    const dz = this.controls.target.z - this.cam.position.z;
    return (Math.atan2(dx, -dz) * 180) / Math.PI;
  }

  /** Renders a fresh frame and returns it as PNG. */
  screenshot(): Promise<Blob | null> {
    this.renderFrame(performance.now());
    const url = this.canvas.toDataURL('image/png');
    return fetch(url).then((r) => r.blob());
  }

  /** Orbits once around the target for `seconds`, rendering every frame, and measures the frame rate. */
  benchmark(seconds = 5): Promise<BenchmarkResult> {
    if (this.benchmarking) return Promise.reject(new Error('Leistungstest läuft bereits.'));
    this.benchmarking = true;
    const start = this.getCameraState();
    const target = this.controls.target.clone();
    const offset = this.cam.position.clone().sub(target);
    const times: number[] = [];
    let last = 0;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now: number) => {
        const elapsed = (now - t0) / 1000;
        if (last > 0) times.push(now - last);
        last = now;
        const angle = (elapsed / seconds) * Math.PI * 2;
        const rotated = offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        this.cam.position.copy(target).add(rotated);
        this.cam.lookAt(target);
        this.renderFrame(now);
        if (elapsed < seconds) {
          requestAnimationFrame(step);
          return;
        }
        this.benchmarking = false;
        this.setCameraState(start);
        const sorted = [...times].sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
        const worst = sorted[sorted.length - 1] ?? avg;
        resolve({
          frames: times.length,
          seconds,
          avgFps: 1000 / avg,
          minFps: 1000 / worst,
          p95FrameMs: p95,
          triangles: this.frameStats.triangles,
          drawCalls: this.frameStats.drawCalls,
        });
      };
      requestAnimationFrame(step);
    });
  }

  webglInfo(): Record<string, unknown> {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: gl.getParameter(gl.VERSION),
      shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      antialias: gl.getContextAttributes()?.antialias,
      pixelRatio: this.renderer.getPixelRatio(),
      canvas: [this.canvas.width, this.canvas.height],
      projection: this.projection,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
