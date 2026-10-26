/* Renders image candidates. Run it, look at them, copy the best over the files in the repo.
 * - The Workshop preview (`preview` in project.json): an animated GIF, 256x256 (Wallpaper Engine's limits for a preview:
 *   ≤ 256 px, under 1 MB; aim < 500 KB): 3 s (6 beats at 120 BPM, so it loops on the beat) of an engine revving to a
 *   kick drum, with flames. Only the engine, as close as it fits: the dash is unreadable at 256 px.
 *   test-results/preview/gif-<case>.gif (+ gif-<case>-sheet.png, four frames to look at without a GIF viewer) for each
 *   of CASES -> preview.gif.
 * - The README screenshots: the whole wallpaper at 1280x720, the frame with the most fire of a few loud seconds.
 *   test-results/preview/<scene>.jpg for each of SCENES -> screenshots/<scene>.jpg.
 *   npm run preview                  everything
 *   npm run preview -- gif           only the GIFs
 *   npm run preview -- jet rocket    only the GIFs / scenes whose name contains one of the words
 * Drives the page's own frame() with a fixed step (the rAF loop paused) and synthetic audio through the real analyser,
 * so the result does not depend on how fast the machine renders. Every run clears test-results/preview/. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { launch, open, ROOT } = require('../test/e2e/page');

const GIF = { size: 256, render: 1024, frames: 30, fps: 10, sub: 3, colors: 128, margin: 1.15 };
const SHOT = { w: 1280, h: 720, pick: 3, quality: 0.9 };   // the best of `pick` s
const SONG = { bpm: 120, warm: 14, loud: 6 };   // s of a moderate beat (BPM detection, the 20 s loudness EMA), then loud until the capture starts
/* GIF candidates: [name, query] */
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
/* README screenshots: name -> { q: URL query, radio: [artist, title] (the radio on, with this track) } */
const SCENES = {
  v8: { q: 'layout=v&cylinders=8&turbos=1&showradio=true', radio: ['THE PISTONS', 'REDLINE NIGHTS'] },
  jet: { q: 'layout=jet&cylinders=10&turbos=0' },
  rocket: { q: 'layout=rocket&cylinders=9&turbos=0&background=carbon' },
  steam: { q: 'layout=steam&cylinders=3&turbos=0' },
  radial: { q: 'layout=radial&cylinders=14&turbos=0&background=gradient' },
  marine: { q: 'layout=marine&cylinders=8&turbos=0' },
  electric: { q: 'layout=electric&cylinders=8&turbos=0&background=carbon' },
};
const OUT = path.join(ROOT, 'test-results', 'preview');

/* in the page: pause the rAF loop, set up the frame driver (synthetic audio at 30 Hz); `alone` frames the engine alone */
function setup([S, alone, margin]) {
  /* eslint-disable no-undef */
  window.wallpaperPropertyListener.setPaused(true);
  const d = __dbg, el = id => document.getElementById(id);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const P = window.__pv = { t: 0, C: {} };
  if (alone) {
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
    place(hi * margin);
    e.camBase = cam.position.clone(); e.pxScale.value = (innerHeight * e.renderer.getPixelRatio() / 2) / tanV;
  }
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
  const canvas = (k, w, h) => P.C[k] || (P.C[k] = Object.assign(document.createElement('canvas'), { width: w, height: h }));
  /* the page as it looks (bg canvas, the CSS glow in screen mode, WebGL, the dash when `dash`); must run in the same
     task as the last render, so the WebGL buffer is still there */
  P.compose = dash => {
    const W = innerWidth, H = innerHeight, c0 = canvas('full', W, H), x = c0.getContext('2d');
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
    if (dash) x.drawImage(el('dash'), 0, 0, W, H);
    return c0;
  };
  /* GIF frame k of n: the engine scaled down to `size` in halving steps (smooth, no aliasing), RGBA as base64 */
  P.gif = (size, k, n) => {
    let src = P.compose(false), w = src.width;
    while (w > size) { w = Math.max(size, w >> 1); const c = canvas(w, w, w), cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, w, w); src = c; }
    const j = [0, n / 3, 2 * n / 3, n - 1].map(Math.floor).indexOf(k);
    if (j >= 0) canvas('sheet', size * 2, size * 2).getContext('2d').drawImage(src, (j % 2) * size, (j >> 1) * size);
    const px = src.getContext('2d').getImageData(0, 0, size, size).data;
    let s = ''; for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return btoa(s);
  };
  /* screenshot: keeps the frame with the most fire (flame + the backfire flash) so far */
  P.shot = () => {
    const score = d.sim.flame + d.eng3d.flash;
    if (P.best !== undefined && score <= P.best) return;
    P.best = score;
    const c = P.compose(true), b = canvas('best', c.width, c.height);
    b.getContext('2d').drawImage(c, 0, 0);
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

const state = () => ({ state: __dbg.sim.state, rpm: Math.round(__dbg.sim.rpm), flame: +__dbg.sim.flame.toFixed(2), bpm: Math.round(__dbg.audio.bpm) });

async function gif(browser, name, query) {
  const { page, errors, ctx } = await open(browser, query, { we: true, w: GIF.render, h: GIF.render });
  await page.evaluate(setup, [SONG, true, GIF.margin]);
  await page.evaluate(s => __pv.run(s, false), SONG.warm + SONG.loud);
  const st = await page.evaluate(state);
  const frames = [];
  for (let i = 0; i < GIF.frames; i++) {
    const b64 = await page.evaluate(([G, i]) => { __pv.run((G.sub - 1) / 30, false); __pv.run(1 / 30, true); return __pv.gif(G.size, i, G.frames); }, [GIF, i]);
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

async function shot(browser, name, S) {
  const { page, errors, ctx } = await open(browser, S.q, { we: true, w: SHOT.w, h: SHOT.h });
  await page.evaluate(setup, [SONG, false]);
  // a used car: something on the odometer; the radio playing a track
  await page.evaluate(radio => { __dbg.odo._write(48213.7, 312.4); if (radio) __dbg.media.mock(...radio); }, S.radio || null);
  await page.evaluate(s => __pv.run(s, false), SONG.warm + SONG.loud);
  await page.evaluate(n => { for (let i = 0; i < n; i++) { __pv.run(1 / 30, true); __pv.shot(); } }, Math.round(SHOT.pick * 30));
  const st = await page.evaluate(state);
  const jpg = await page.evaluate(q => __pv.C.best.toDataURL('image/jpeg', q).split(',')[1], SHOT.quality);
  await ctx.close();
  if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
  const bytes = Buffer.from(jpg, 'base64');
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), bytes);
  console.log(`${name}.jpg: ${(bytes.length / 1024).toFixed(0)} KB  (at the end: ${JSON.stringify(st)})`);
}

(async () => {
  const words = process.argv.slice(2), want = n => !words.length || words.some(w => n.includes(w));
  const gifs = CASES.map(([n, q]) => ['gif-' + n, q]).filter(([n]) => want(n)), shots = Object.entries(SCENES).filter(([n]) => want(n));
  if (!gifs.length && !shots.length) throw new Error(`nothing matches ${words.join(' ')}; GIFs: ${CASES.map(c => 'gif-' + c[0]).join(' ')}; scenes: ${Object.keys(SCENES).join(' ')}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  try {
    for (const [name, q] of gifs) await gif(browser, name, q);
    for (const [name, S] of shots) await shot(browser, name, S);
  } finally { await browser.close(); }
  console.log(`-> ${path.relative(ROOT, OUT)}/; copy the best over preview.gif / screenshots/<scene>.jpg`);
})().catch(e => { console.error(e); process.exit(1); });
