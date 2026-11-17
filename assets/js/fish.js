// sky-salmon — 魚, the author's own Sky kid: the look read from their outfit QR, and what it takes to draw it as it is
// in the game (the Bat cape's hem) and as it is in their clip (the clip's light). Used by the home stage and by the
// height page, where 魚 waits on the stage until a visitor reads their own QR.
import * as THREE from 'three';

// 魚: the look in the author's outfit QR (pieces, dyes, and the body they set in the game)
export const FISH = {
  pieces: { outfit: 'CharSkyKid_Body_AP08BaggyPants_01', cape: 'CharSkyKid_Wing_Bat', hair: 'CharSkyKid_Hair_WitchHat_01', mask: 'CharSkyKid_Mask_None',
    neck: 'CharSkyKid_Neck_AP24StripesScarf', shoes: 'CharSkyKid_Feet_AuroraSneakers', horn: 'CharSkyKid_Horn_AP06Tassel', face: 'CharSkyKid_Face_None',
    prop: 'CharSkyKid_Prop_MischiefCat', hat: 'CharSkyKid_Hat_None' },
  dyes: { outfit: ['black_black', 'black_black'], horn: ['black_black', null] },
  body: { height: 1.8867949, scale: -0.0049999999 }
};

// The Bat cape is black with an orange-red band along its scalloped hem (in the game a colour-shifting shader draws
// it). The band is found on the mesh itself: the open edges in the lower part of the cape are the hem.
export function batCape(root) {
  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.material.userData.sh || o.material.userData.sh.shader !== 'AvatarCham') return;
    const geo = o.geometry;
    if (!geo.attributes.aRim) {
      o.updateMatrix();
      const pos = geo.attributes.position, n = pos.count, P = [];
      for (let i = 0; i < n; i++) P.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrix));
      const idx = geo.index.array, edges = new Map();
      for (let f = 0; f < idx.length; f += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const i = idx[f + a], j = idx[f + b], k = i < j ? i + ',' + j : j + ',' + i; edges.set(k, (edges.get(k) || 0) + 1);
      }
      let minY = Infinity, maxY = -Infinity;
      for (const v of P) { minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
      const hem = [];
      for (const [k, c] of edges) if (c === 1) for (const v of k.split(',').map(Number)) if (P[v].y < minY + 0.4 * (maxY - minY)) hem.push(P[v]);
      const rim = new Float32Array(n), R = 0.2;
      for (let i = 0; i < n; i++) { let d = 1e9; for (const h of hem) d = Math.min(d, P[i].distanceToSquared(h)); rim[i] = 1 - THREE.MathUtils.smoothstep(Math.sqrt(d), R * 0.4, R); }
      geo.setAttribute('aRim', new THREE.BufferAttribute(rim, 1));
    }
    const u = o.material.userData.u;
    u.colour0.value.setRGB(0.03, 0.027, 0.03); u.useColour1.value = 0; u.useMask.value = 0;
    const prev = o.material.onBeforeCompile;
    o.material.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRim; varying float vRim;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRim = aRim;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRim;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.06, 0.0), vRim);\n totalEmissiveRadiance += vRim * vec3(0.3, 0.035, 0.0);');
    };
    o.material.customProgramCacheKey = () => 'batcape';
    o.material.needsUpdate = true;
  });
}

// ── the clip's own light ─────────────────────────────────────────────────
// By the wall the kid has to look as the footage does: dim and warm, the hat a black shape, the hair the brightest
// thing. The stage's sunset lighting cannot give that, so while the footage still shows each piece is drawn a second
// way and the two are mixed (uClip, 1 by the wall → 0 on the stage): the piece's own colours, through one soft light
// from low on the lamp's side, tinted per piece to the colours measured in the footage.
//   tint   what the piece's own colours are multiplied by (as shown on screen, r g b)
//   gamma  contrast on those colours: 1 leaves dark parts (the hat, on the hair's mesh) black, less lifts them
//   lo     how dark the side away from the light is, against 1 for the lit side
//   floor  the darkest the piece gets (the footage's own shadow colour); with no tint, the whole piece (the cape:
//          its lit hem does not show in the footage)
// On the stage itself two smaller things keep the kid the footage's colours under the sunset: `dark` holds a piece's
// black cloth down (the hat is black in the game; under the stage's strong back light it came out brown), and `warm`
// tints the whole piece (the hair, pale in plain light, is warm in the footage's).
export const CLIP_LOOK = {
  hair:   { tint: [1.07, 0.65, 0.475], gamma: 1.0, lo: 0.527, dark: 0.4, warm: [1, 0.93, 0.84] },
  outfit: { tint: [1.52, 0.79, 0.38], gamma: 0.5, lo: 0.2, floor: [0.115, 0.098, 0.063], dark: 0.8 },
  neck:   { tint: [0.52, 0.34, 0.16], gamma: 0.6, lo: 0.5, warm: [1, 0.96, 0.9] },
  horn:   { tint: [2.03, 1.7, 0.67], gamma: 0.7, lo: 0.6 },
  cape:   { tint: [0, 0, 0], gamma: 1, lo: 1, floor: [0.085, 0.07, 0.042], dark: 0.7 },
  other:  { tint: [0.3, 0.24, 0.16], gamma: 1, lo: 0.6, floor: [0.07, 0.055, 0.035] }
};
export const clipU = { value: 0 }, clipDir = { value: new THREE.Vector3(0.3, -0.9, 0.3).normalize() };   // in the camera's space: from below, a little to the lamp's side
export function clipLook(root) {
  root.traverse(o => {
    const m = o.material;
    if (!o.isMesh || !m || !m.userData.u || m.userData.clipLook) return;
    const L = CLIP_LOOK[m.userData.slot] || CLIP_LOOK.other;
    const u = m.userData.clipLook = { uClip: clipU, uClipDir: clipDir, uClipTint: { value: new THREE.Vector3(...L.tint) },
      uClipShape: { value: new THREE.Vector2(L.gamma, L.lo) }, uClipFloor: { value: new THREE.Vector3(...(L.floor || [0, 0, 0])) },
      uStage: { value: new THREE.Vector4(...(L.warm || [1, 1, 1]), L.dark ?? 1) } };
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
    m.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uClip; uniform vec2 uClipShape; uniform vec3 uClipDir, uClipTint, uClipFloor; uniform vec4 uStage;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          gl_FragColor.rgb *= uStage.rgb * mix(uStage.a, 1.0, smoothstep(0.01, 0.12, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))));
          if (uClip > 0.0) {
            float cs = clamp(dot(normal, uClipDir) * 0.5 + 0.5, 0.0, 1.0);
            vec3 cc = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(uClipShape.x)) * uClipTint * mix(uClipShape.y, 1.0, smoothstep(0.6, 0.95, cs));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, max(cc, uClipFloor), uClip);
          }`);
    };
    m.customProgramCacheKey = () => key + '|clip';
    m.needsUpdate = true;
  });
}
