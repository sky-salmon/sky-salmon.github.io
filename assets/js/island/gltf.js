// Load an authored model from assets/models/<name>.glb and convert it to the
// site's toon look. Returns null when the file is not there yet, so callers can
// fall back to the procedural placeholder.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toon, addOutline } from './toon.js';

const loader = new GLTFLoader();
export const MODEL_BASE = new URL('../../models/', import.meta.url);

// Which models actually loaded vs. fell back — handy for checking what's still missing.
export const modelStatus = {};

// assets/models/manifest.json lists which .glb files exist, so missing ones cost no 404s.
let manifestPromise = null;
function manifest() {
  manifestPromise ||= fetch(new URL('manifest.json', MODEL_BASE), { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : { models: [] }))
    .then(m => new Set(Array.isArray(m.models) ? m.models : []))
    .catch(() => new Set());
  return manifestPromise;
}

export async function loadToonModel(name) {
  const url = new URL(`${name}.glb`, MODEL_BASE).href;
  try {
    if (!(await manifest()).has(name)) { modelStatus[name] = 'placeholder'; return null; }
    const gltf = await loader.loadAsync(url);
    // collect first: adding outline meshes while traversing would make traverse visit (and outline) them too
    const meshes = [];
    gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    meshes.forEach(o => {
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      const color = src && src.color ? '#' + src.color.getHexString() : '#ffffff';
      o.material = toon(color, {
        noCache: true,
        vertexColors: !!o.geometry.attributes.color,
        map: src && src.map ? src.map : null,
        transparent: !!(src && src.transparent),
        side: src ? src.side : THREE.FrontSide
      });
      if (!o.name.startsWith('nooutline_')) addOutline(o);
    });
    modelStatus[name] = 'glb';
    return gltf;
  } catch (err) {
    console.warn(`[models] ${name}.glb failed to load, using placeholder`, err);
    modelStatus[name] = 'placeholder';
    return null;
  }
}

// Wrap a loaded glTF as { object, update, mixer, actions } and start `autoplay` clips.
export function wrapGltf(gltf, autoplay = ['idle']) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  autoplay.forEach(n => actions[n] && actions[n].play());
  return { object: gltf.scene, mixer, actions, update: (t, dt) => mixer.update(dt) };
}

// Find named empty nodes (e.g. slot_1 … slot_6) inside a model.
export function findNodes(root, prefix) {
  const out = [];
  root.traverse(o => { if (o.name && o.name.startsWith(prefix)) out.push(o); });
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
