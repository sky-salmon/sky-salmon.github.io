// node sweep.js cfg.json outdir 'js expr per variant' v1 v2 ...  → loads the scene once, applies each variant, screenshots
// the expression sees S (= window.__scene) and v (the variant value, JSON-parsed)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const THREE = '/tmp/claude-0/-home-user/33f1d720-2b79-5949-88a1-6f8a4150d271/scratchpad/avatar/node_modules/three/';
const D = __dirname, [cfgFile, outDir, expr, ...vals] = process.argv.slice(2);
const cfg = fs.readFileSync(cfgFile, 'utf8'), mod = fs.readFileSync(process.env.SCENE || D + '/scene.mjs', 'utf8');
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const C = JSON.parse(cfg);
  const ctx = await b.newContext({ viewport: { width: C.w || 960, height: C.h || 600 } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\//, r => { const rel = r.request().url().split('three@0.170.0/')[1]; try { r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(THREE + rel) }); } catch { r.abort(); } });
  await ctx.route(/__scene\.html/, r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#000}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
<script type="module">${mod}</script>` }));
  await ctx.route(/\/__env\//, r => { try { r.fulfill({ body: fs.readFileSync(path.join(D, 'env', decodeURIComponent(r.request().url().split('/__env/')[1]))) }); } catch { r.abort(); } });
  await ctx.route(/assets\/avatar\/clips\/__test\.glb/, r => r.fulfill({ body: fs.readFileSync(D + '/lazy.glb') }));
  const p = await ctx.newPage();
  p.on('pageerror', e => console.error('PAGEERR', e.message));
  p.on('console', m => { if (m.type() === 'error') console.error(m.text().slice(0, 300)); });
  await p.goto('http://localhost:8766/__scene.html?' + new URLSearchParams({ look: fs.readFileSync(D + '/look.json', 'utf8'), cfg }));
  await p.waitForFunction(() => window.__done, null, { timeout: 280000 });
  const canvas = await p.$('canvas');
  for (const [i, v] of vals.entries()) {
    const info = await p.evaluate(([e, v]) => { const S = window.__scene; const r = (new Function('S', 'v', e))(S, JSON.parse(v)); S.renderer.render(S.scene, S.camera); return r; }, [expr, v]);
    if (info) console.log(v, JSON.stringify(info));
    await canvas.screenshot({ path: path.join(outDir, `v_${String(i).padStart(2, '0')}.png`) });
  }
  await b.close();
})();
