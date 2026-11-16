// node scene.js out.png '<cfg json>'  → renders the recreation (and out_cmp.png: photo | render | 50% overlay)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const THREE = '/tmp/claude-0/-home-user/33f1d720-2b79-5949-88a1-6f8a4150d271/scratchpad/avatar/node_modules/three/';
const SITE = '/home/user/sky-salmon.github.io/';
const D = __dirname;
const [out, cfg] = process.argv.slice(2);
const mod = fs.readFileSync(D + '/scene.mjs', 'utf8');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const C = JSON.parse(cfg || '{}'), W = C.w || 960, H = C.h || 600;
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\//, r => { const rel = r.request().url().split('three@0.170.0/')[1]; try { r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(THREE + rel) }); } catch { r.abort(); } });
  await ctx.route(/__scene\.html/, r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#000}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
<script type="module">${mod}</script>` }));
  await ctx.route(/\/__env\//, r => { try { r.fulfill({ body: fs.readFileSync(path.join(D, 'env', decodeURIComponent(r.request().url().split('/__env/')[1]))) }); } catch { r.abort(); } });
  await ctx.route(/assets\/avatar\/clips\/__test\.glb/, r => r.fulfill({ body: fs.readFileSync(D + '/lazy.glb') }));
  const p = await ctx.newPage();
  p.on('pageerror', e => console.error('PAGEERR', e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error(m.type(), m.text().slice(0, 200)); });
  const q = new URLSearchParams({ look: fs.readFileSync(D + '/look.json', 'utf8'), cfg: cfg || '{}' });
  await p.goto('http://localhost:8766/__scene.html?' + q);
  await p.waitForFunction(() => window.__done, null, { timeout: 280000 });
  await (await p.$('canvas')).screenshot({ path: out });
  console.log(JSON.stringify(await p.evaluate(() => ({ box: window.__box, proj: window.__proj }))));
  await b.close();
})();
