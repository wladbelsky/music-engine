/* Renders Workshop preview candidates: an animated GIF, 256x256 (Wallpaper Engine's limits for a preview: ≤ 256 px,
 * under 1 MB; aim < 500 KB): 3 s (6 beats at 120 BPM, so it loops on the beat) of an engine revving to a kick drum,
 * with flames. Only the engine, as close as it fits: the dash is unreadable at 256 px.
 *   npm run preview                  every candidate in CASES
 *   npm run preview -- jet rocket    only the cases whose name contains one of the words
 * Writes test-results/preview/<case>.gif (+ <case>-sheet.png, four frames to look at without a GIF viewer);
 * copy the best one over preview.gif. Drives the page's own frame() with a fixed step (the rAF loop paused) and
 * synthetic audio through the real analyser, so the result does not depend on how fast the machine renders. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { launch, open, ROOT } = require('../test/e2e/page');

const GIF = { size: 256, render: 1024, frames: 30, fps: 10, sub: 3, colors: 128, margin: 1.15 };
const SONG = { bpm: 120, warm: 14, loud: 6 };   // s of a moderate beat (BPM detection, the 20 s loudness EMA), then loud until the capture starts
/* [name, query] */
const CASES = [
  ['v8', 'layout=v&cylinders=8&turbos=1'],
  ['v12-blower', 'layout=v&cylinders=12&turbos=sc'],
  ['w16', 'layout=w&cylinders=16&turbos=4'],
  ['radial', 'layout=radial&cylinders=14&turbos=0'],
  ['rotary', 'layout=rotary&cylinders=3&turbos=1'],
  ['steam', 'layout=steam&cylinders=2&turbos=0'],
  ['jet', 'layout=jet&cylinders=8&turbos=0'],
  ['electric', 'layout=electric&cylinders=6&turbos=0'],
  ['marine', 'layout=marine&cylinders=6&turbos=0'],
  ['rocket', 'layout=rocket&cylinders=9&turbos=0'],
];
const OUT = path.join(ROOT, 'test-results', 'preview');

/* in the page: pause the rAF loop, frame the engine alone, set up the frame driver (synthetic audio at 30 Hz) */
function setup([G, S]) {
  /* eslint-disable no-undef */
  window.wallpaperPropertyListener.setPaused(true);
  const d = __dbg, el = id => document.getElementById(id);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const P = window.__pv = { t: 0, C: {} };
  // no room kept for the dash: the closest camera that still has every part on screen (Engine3D's own probe points),
  // with the box the core frames centred (more flame headroom, the layout's extras)
  const e = d.eng3d, cam = e.camera, tanV = Math.tan(cam.fov * Math.PI / 360);
  e.setKeepOut([]);
  cam.clearViewOffset(); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  const box = e.box.clone(); box.max.y += 1.8; e.lay.frameBox(box); if (e.lay.framePad) box.expandByScalar(e.lay.framePad);
  const c = box.getCenter(new THREE.Vector3());
  const place = k => { cam.position.copy(c).addScaledVector(e.camDir, k); cam.lookAt(c); cam.updateMatrixWorld(); };
  let lo = 1, hi = 200;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; place(mid); if (e._clear(false)) hi = mid; else lo = mid; }
  place(hi * G.margin);
  e.camBase = cam.position.clone(); e.pxScale.value = (innerHeight * e.renderer.getPixelRatio() / 2) / tanV;
  /* a kick drum and an off-beat hat, like the e2e beat, louder after `warm` */
  P.audio = t => {
    const lvl = t < S.warm ? 0.5 : 0.95, ph = (t * S.bpm / 60) % 1, arr = new Array(128).fill(0);
    const kick = Math.exp(-ph * 9) * lvl, hat = Math.exp(-((ph + 0.5) % 1) * 14) * lvl * 0.5;
    for (let i = 0; i < 64; i++) {
      let v = lvl * 0.25 * Math.exp(-i / 40) * (0.7 + 0.3 * rnd());
      if (i < 8) v += kick * (1 - i / 10);
      if (i > 36) v += hat * 0.5 * rnd();
      arr[i] = arr[i + 64] = Math.min(1, v);
    }
    return arr;
  };
  P.run = (secs, draw) => {
    const render = d.eng3d.render;
    if (!draw) d.eng3d.render = () => {};
    const dt = 1 / 30;
    for (let i = Math.round(secs / dt); i > 0; i--) { P.t += dt; d.audio.push(P.audio(P.t), P.t); d.frame(dt, P.t); }
    d.eng3d.render = render;
  };
  /* the composited page (bg canvas, the CSS glow in screen mode, WebGL; not the dash) scaled down to `size`; must run in
     the same task as the last render, so the WebGL buffer is still there */
  P.grab = (size, k, n) => {
    const W = innerWidth, H = innerHeight, C = P.C;
    const c0 = C.full || (C.full = Object.assign(document.createElement('canvas'), { width: W, height: H }));
    const x = c0.getContext('2d');
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.drawImage(el('bg'), 0, 0, W, H);
    const g = el('glow'), ga = Number(g.style.opacity) || 0;
    const m = ga > 0 && g.style.background.match(/at ([\d.]+)px ([\d.]+)px, (rgba?\([^)]*\)), (rgba?\([^)]*\)) 18%/);
    if (m) {   // radial-gradient(circle at x y, a, b 18%, transparent 45%): a circle out to the farthest corner
      const gx = +m[1], gy = +m[2], R = Math.hypot(Math.max(gx, W - gx), Math.max(gy, H - gy));
      const gr = x.createRadialGradient(gx, gy, 0, gx, gy, R);
      gr.addColorStop(0, m[3]); gr.addColorStop(0.18, m[4]); gr.addColorStop(0.45, 'rgba(0,0,0,0)');
      x.globalCompositeOperation = 'screen'; x.globalAlpha = ga; x.fillStyle = gr; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    }
    x.drawImage(el('gl'), 0, 0, W, H);
    // halving steps down to `size` (smooth, no aliasing)
    let src = c0, w = W;
    while (w > size) {
      w = Math.max(size, w >> 1);
      const c = C[w] || (C[w] = Object.assign(document.createElement('canvas'), { width: w, height: w }));
      const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, w, w); src = c;
    }
    const sheet = C.sheet || (C.sheet = Object.assign(document.createElement('canvas'), { width: size * 2, height: size * 2 }));
    const j = [0, n / 3, 2 * n / 3, n - 1].map(Math.floor).indexOf(k);
    if (j >= 0) sheet.getContext('2d').drawImage(src, (j % 2) * size, (j >> 1) * size);
    const px = src.getContext('2d').getImageData(0, 0, size, size).data;
    let s = ''; for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return btoa(s);
  };
}

/* one palette for all frames (no flicker between frames), from every other frame; after the first frame a pixel
   that keeps its colour is transparent (the frame below shows through), so the static background costs nothing */
function encode(frames) {
  const all = new Uint8Array(frames[0].length * Math.ceil(frames.length / 2));
  frames.filter((f, i) => i % 2 === 0).forEach((f, i) => all.set(f, i * f.length));
  const palette = quantize(all, GIF.colors - 1), TI = palette.length;
  palette.push([255, 0, 255]);
  const gif = GIFEncoder(), delay = 1000 / GIF.fps;
  let shown = null;
  for (const f of frames) {
    const idx = applyPalette(f, palette);
    if (!shown) gif.writeFrame(idx, GIF.size, GIF.size, { palette, delay, repeat: 0 });
    else gif.writeFrame(idx.map((v, j) => (v === shown[j] ? TI : v)), GIF.size, GIF.size, { delay, transparent: true, transparentIndex: TI, dispose: 1 });
    shown = idx;
  }
  gif.finish();
  return gif.bytes();
}

async function render(browser, name, query) {
  const { page, errors, ctx } = await open(browser, query, { we: true, w: GIF.render, h: GIF.render });
  await page.evaluate(setup, [GIF, SONG]);
  await page.evaluate(s => __pv.run(s, false), SONG.warm + SONG.loud);
  const st = await page.evaluate(() => ({ state: __dbg.sim.state, rpm: Math.round(__dbg.sim.rpm), flame: +__dbg.sim.flame.toFixed(2), bpm: Math.round(__dbg.audio.bpm) }));
  const frames = [];
  for (let i = 0; i < GIF.frames; i++) {
    const b64 = await page.evaluate(([G, i]) => { __pv.run((G.sub - 1) / 30, false); __pv.run(1 / 30, true); return __pv.grab(G.size, i, G.frames); }, [GIF, i]);
    frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
  }
  const sheet = await page.evaluate(() => __pv.C.sheet.toDataURL('image/png').split(',')[1]);
  fs.writeFileSync(path.join(OUT, `${name}-sheet.png`), Buffer.from(sheet, 'base64'));
  await ctx.close();
  if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);

  const bytes = encode(frames);
  fs.writeFileSync(path.join(OUT, `${name}.gif`), bytes);
  console.log(`${name}.gif: ${(bytes.length / 1024).toFixed(0)} KB  (at the start: ${JSON.stringify(st)})${bytes.length >= 1024 * 1024 ? '  TOO BIG for Wallpaper Engine (1 MB)' : ''}`);
}

(async () => {
  const words = process.argv.slice(2);
  const cases = CASES.filter(([n]) => !words.length || words.some(w => n.includes(w)));
  if (!cases.length) throw new Error(`no case matches ${words.join(' ')}; cases: ${CASES.map(c => c[0]).join(' ')}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  try { for (const [name, query] of cases) await render(browser, name, query); } finally { await browser.close(); }
  console.log(`-> ${path.relative(ROOT, OUT)}/; copy the best over preview.gif`);
})().catch(e => { console.error(e); process.exit(1); });
