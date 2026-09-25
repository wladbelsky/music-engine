/* Playwright helpers: the wallpaper in headless Chromium with SwiftShader WebGL (no GPU needed). */
'use strict';
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL0 = 'file://' + path.join(ROOT, 'index.html');
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const launch = () => chromium.launch({ args: ARGS });

/* runs before the page's scripts: counters for rAF / DemoSource intervals, a fake WE (optional),
   an in-page beat generator, and a pixel reader for the WebGL canvas */
function initScript(we) {
  /* eslint-disable no-undef */
  const T = window.__t = { raf: new Set(), intervals30: 0, audioRegs: 0, mediaRegs: {} };
  const rAF = window.requestAnimationFrame.bind(window), cAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { const id = rAF(ts => { T.raf.delete(id); cb(ts); }); T.raf.add(id); return id; };
  window.cancelAnimationFrame = id => { T.raf.delete(id); cAF(id); };
  const sI = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { if (Math.abs(ms - 1000 / 30) < 0.5) T.intervals30++; return sI(fn, ms, ...a); };
  if (we) {
    window.wallpaperRegisterAudioListener = cb => { T.audioRegs++; T.audio = cb; };
    for (const k of ['Status', 'Properties', 'Playback']) window['wallpaperRegisterMedia' + k + 'Listener'] = cb => { T.mediaRegs[k] = cb; };
  }
  // a kick drum at `bpm` fed through whatever the page registered (WE listener) at ~30 Hz
  T.beat = (bpm, lvl = 0.8) => {
    clearInterval(T.beatId);
    const t0 = performance.now();
    T.beatId = sI(() => {
      const t = (performance.now() - t0) / 1000, ph = (t * bpm / 60) % 1, arr = new Array(128).fill(0);
      if (bpm > 0) {
        const kick = Math.exp(-ph * 9) * lvl, hat = Math.exp(-((ph + 0.5) % 1) * 14) * lvl * 0.5;
        for (let i = 0; i < 64; i++) {
          let v = lvl * 0.25 * Math.exp(-i / 40) * (0.7 + 0.3 * Math.random());
          if (i < 8) v += kick * (1 - i / 10);
          if (i > 36) v += hat * 0.5 * Math.random();
          arr[i] = arr[i + 64] = Math.min(1, v);
        }
      }
      T.audio && T.audio(arr);
    }, 1000 / 30);
  };
  T.stopBeat = () => clearInterval(T.beatId);
  /* render one frame and read the WebGL canvas back (same task, so no preserveDrawingBuffer needed).
     opts.only: 'engine' hides the ground, contact shadow, flames and smoke; 'fx' hides the engine, ground, contact
     shadow and smoke (additive effects only). Returns stats in CSS px. */
  T.pixels = (opts = {}) => {
    const e = __dbg.eng3d, r = e.renderer, gl = r.getContext(), undo = [];
    const hide = o => { if (o && o.visible) { o.visible = false; undo.push(o); } };
    if (opts.only === 'engine') { hide(e.ground); e.root.children.forEach(o => { if (o !== e.eng) hide(o); }); hide(e.flames.points); hide(e.smoke.points); }
    if (opts.only === 'fx') { hide(e.ground); hide(e.eng); e.root.children.forEach(o => { if (o.isMesh && o.material.alphaMap) hide(o); }); hide(e.smoke.points); }
    e.render();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    undo.forEach(o => { o.visible = true; });
    const k = innerWidth / W, ko = opts.keepOut || [], m = opts.margin || 0;
    const st = { w: W, h: H, opaque: 0, lit: 0, litNoAlpha: 0, bbox: null, inKeepOut: 0, sample: null, near: 0 };
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = buf[i + 3], rgb = Math.max(buf[i], buf[i + 1], buf[i + 2]);
      const cx = x * k, cy = (H - 1 - y) * k;                         // GL rows are bottom-up
      if (rgb > 24) { st.lit++; if (a === 0) st.litNoAlpha++; }
      if (opts.near && rgb > 150 && buf[i] > buf[i + 2] + 40 && Math.hypot(cx - opts.near.x, cy - opts.near.y) < opts.near.r) st.near++;
      if (a < 8) continue;
      st.opaque++;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (const s of ko) if (s.r !== undefined ? Math.hypot(cx - s.x, cy - s.y) < s.r - m : cx > s.x + m && cx < s.x + s.w - m && cy > s.y + m && cy < s.y + s.h - m) { st.inKeepOut++; if (!st.sample) st.sample = { x: cx, y: cy, s }; break; }
    }
    if (x1 >= 0) st.bbox = { x0, x1, y0, y1 };
    return st;
  };
}

/**
 * open(browser, query, { we, w, h, storage }) -> { page, errors, url }
 * we: fake the Wallpaper Engine API (audio + media listeners). errors: pageerror + console errors, incl. shader errors.
 */
async function open(browser, query = '', { we = false, w = 1280, h = 720, context } = {}) {
  const ctx = context || await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /THREE\.WebGL(Program|Renderer).*(error|Error)|Shader Error/.test(t)) errors.push('console: ' + t); });
  await page.addInitScript(initScript, we);
  const url = URL0 + (query ? '?' + query : '');
  await page.goto(url);
  await page.waitForFunction(() => window.__dbg && __dbg.eng3d.root && __dbg.eng3d.renderer.info.render.frame > 2, null, { timeout: 30000 });
  if (!we) await page.evaluate(() => { const p = document.getElementById('devpanel'); if (p) p.style.display = 'none'; });
  return { page, errors, url, ctx };
}

/* apply WE properties like Wallpaper Engine does and wait until a rebuild (if any) has rendered */
async function props(page, p) {
  await page.evaluate(p2 => {
    const o = {}; for (const k in p2) o[k] = { value: p2[k] };
    window.wallpaperPropertyListener.applyUserProperties(o);
    window.__t.frame0 = __dbg.eng3d.renderer.info.render.frame;
  }, p);
  await page.waitForFunction(() => __dbg.eng3d.renderer.info.render.frame > window.__t.frame0 + 2, null, { timeout: 30000 });
}

/* wait for a condition on the page, with a readable failure */
async function until(page, fn, arg, timeout = 30000, what = String(fn)) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); } catch (e) {
    const dbg = await page.evaluate(() => ({ state: __dbg.sim.state, rpm: Math.round(__dbg.sim.rpm), flame: __dbg.sim.flame, bpm: __dbg.audio.bpm })).catch(() => null);
    throw new Error(`timed out waiting for ${what}; sim ${JSON.stringify(dbg)}`);
  }
}

module.exports = { launch, open, props, until, ROOT, URL0 };
