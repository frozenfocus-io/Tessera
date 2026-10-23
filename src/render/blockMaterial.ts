import * as THREE from 'three';

/** View modes of the slicer. */
export const MODE_ALL = 0;
export const MODE_SLICE = 1;
export const MODE_SINGLE = 2;

const MASK_WIDTH = 256;

const vertexShader = /* glsl */ `
in vec4 colorFace;
in vec2 layerType;

out vec3 vWorld;
out vec3 vColor;
flat out int vFace;
flat out int vLayer;
flat out int vType;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vColor = colorFace.rgb / 255.0;
  vFace = int(colorFace.a + 0.5);
  vLayer = int(layerType.x + 0.5);
  vType = int(layerType.y + 0.5);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;

uniform float uLayer;
uniform int uMode;
uniform float uAlpha;
uniform float uGrid;
uniform float uMarkUnknown;
uniform float uDimOthers;
uniform sampler2D uTypeMask;
uniform sampler2D uLayerMask;
uniform vec3 uHighlightColor;

in vec3 vWorld;
in vec3 vColor;
flat in int vFace;
flat in int vLayer;
flat in int vType;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float layer = float(vLayer);
  if (uMode != 0) {
    if (layer > uLayer + 0.5) discard;
    if (uMode == 2 && layer < uLayer - 0.5) discard;
  }

  vec3 n;
  float shade;
  vec2 coord;
  if (vFace == 0) { n = vec3(1.0, 0.0, 0.0); shade = 0.72; coord = vWorld.zy; }
  else if (vFace == 1) { n = vec3(-1.0, 0.0, 0.0); shade = 0.72; coord = vWorld.zy; }
  else if (vFace == 2) { n = vec3(0.0, 1.0, 0.0); shade = 1.0; coord = vWorld.xz; }
  else if (vFace == 3) { n = vec3(0.0, -1.0, 0.0); shade = 0.52; coord = vWorld.xz; }
  else if (vFace == 4) { n = vec3(0.0, 0.0, 1.0); shade = 0.86; coord = vWorld.xy; }
  else if (vFace == 5) { n = vec3(0.0, 0.0, -1.0); shade = 0.86; coord = vWorld.xy; }
  else { n = vec3(0.0); shade = 0.9; coord = vec2(0.5); }

  // Slight per-block brightness variation so neighbouring blocks stay distinguishable.
  vec3 cell = floor(vWorld - n * 0.01);
  float jitter = (hash13(cell + 0.5) - 0.5) * 0.07;
  vec3 col = vColor * (shade + jitter);

  // Block grid lines on every face, so blocks can be counted on merged surfaces.
  if (vFace < 6 && uGrid > 0.0) {
    vec2 w = fwidth(coord);
    vec2 g = abs(fract(coord - 0.5) - 0.5) / max(w, vec2(1e-4));
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    float fade = 1.0 - smoothstep(0.08, 0.35, max(w.x, w.y));
    col *= 1.0 - line * uGrid * fade;
  }

  vec4 tm = texelFetch(uTypeMask, ivec2(vType % ${MASK_WIDTH}, vType / ${MASK_WIDTH}), 0);

  // Unknown / modded blocks: diagonal red stripes.
  if (uMarkUnknown > 0.5 && tm.g > 0.5) {
    float s = step(0.5, fract((vWorld.x + vWorld.y + vWorld.z) * 2.0));
    col = mix(col, vec3(0.86, 0.14, 0.14), s * 0.5);
  }

  // Layers below the current one recede: dark slate grey (darker than any stone in the current
  // layer, so grey blocks of the current layer stay recognisable); finished layers tinted green.
  if (uMode == 1 && layer < uLayer - 0.5) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 grey = vec3(0.115, 0.13, 0.15) + l * 0.3;
    float done = texelFetch(uLayerMask, ivec2(vLayer % ${MASK_WIDTH}, vLayer / ${MASK_WIDTH}), 0).r;
    col = done > 0.5 ? mix(grey, vec3(0.30, 0.50, 0.33), 0.5) : grey;
  } else if (uMode != 0) {
    col *= 1.06;
  }

  if (tm.r > 0.5) {
    col = mix(col, uHighlightColor, 0.42) + 0.05;
  } else if (uDimOthers > 0.0) {
    col *= 1.0 - uDimOthers;
  }

  gl_FragColor = vec4(col, uAlpha);
}
`;

export interface BlockMaterials {
  opaque: THREE.ShaderMaterial;
  translucent: THREE.ShaderMaterial;
  typeMask: THREE.DataTexture;
  layerMask: THREE.DataTexture;
  setTypeMask(highlighted: ReadonlySet<number>, marked: ReadonlySet<number>): void;
  setDoneLayers(done: ReadonlySet<number>): void;
  setView(mode: number, layer: number): void;
  setDimOthers(v: number): void;
  setMarkUnknown(on: boolean): void;
  setGrid(strength: number): void;
  dispose(): void;
}

function makeMask(count: number): THREE.DataTexture {
  const height = Math.max(1, Math.ceil(Math.max(1, count) / MASK_WIDTH));
  const data = new Uint8Array(MASK_WIDTH * height * 4);
  const tex = new THREE.DataTexture(data, MASK_WIDTH, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Materials for one project (uniforms are per project, so projects stay independent). */
export function createBlockMaterials(typeCount: number, layerCount: number): BlockMaterials {
  const typeMask = makeMask(typeCount);
  const layerMask = makeMask(layerCount);
  const uniforms = () => ({
    uLayer: { value: 0 },
    uMode: { value: MODE_ALL },
    uAlpha: { value: 1 },
    uGrid: { value: 0.32 },
    uMarkUnknown: { value: 1 },
    uDimOthers: { value: 0 },
    uTypeMask: { value: typeMask },
    uLayerMask: { value: layerMask },
    uHighlightColor: { value: new THREE.Color(0xffd23f) },
  });
  // Three compiles ShaderMaterials as GLSL ES 3.00, so flat varyings and texelFetch are available
  // and gl_FragColor is mapped to the output (no explicit glslVersion needed).
  const opaque = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: uniforms(),
    side: THREE.FrontSide,
  });
  const translucent = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...uniforms(), uAlpha: { value: 0.42 } },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const both = [opaque, translucent];

  return {
    opaque,
    translucent,
    typeMask,
    layerMask,
    setTypeMask(highlighted, marked) {
      const d = typeMask.image.data as Uint8Array;
      d.fill(0);
      for (const t of highlighted) if (t * 4 < d.length) d[t * 4] = 255;
      for (const t of marked) if (t * 4 < d.length) d[t * 4 + 1] = 255;
      typeMask.needsUpdate = true;
    },
    setDoneLayers(done) {
      const d = layerMask.image.data as Uint8Array;
      d.fill(0);
      for (const y of done) if (y * 4 < d.length) d[y * 4] = 255;
      layerMask.needsUpdate = true;
    },
    setView(mode, layer) {
      for (const m of both) {
        m.uniforms.uMode.value = mode;
        m.uniforms.uLayer.value = layer;
      }
    },
    setDimOthers(v) {
      for (const m of both) m.uniforms.uDimOthers.value = v;
    },
    setMarkUnknown(on) {
      for (const m of both) m.uniforms.uMarkUnknown.value = on ? 1 : 0;
    },
    setGrid(strength) {
      for (const m of both) m.uniforms.uGrid.value = strength;
    },
    dispose() {
      opaque.dispose();
      translucent.dispose();
      typeMask.dispose();
      layerMask.dispose();
    },
  };
}
