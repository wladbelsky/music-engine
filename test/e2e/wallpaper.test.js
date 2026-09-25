'use strict';
/* the wallpaper as Wallpaper Engine drives it: audio + media listeners, properties, pause, mouse */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, open, props, until } = require('./page');

let browser, P;
before(async () => {
  browser = await launch();
  P = await open(browser, 'stalldelay=2', { we: true });
});
after(async () => { await browser?.close(); });
const ev = fn => P.page.evaluate(fn);

test('WE mode: one audio listener, the media listeners, no settings panel', async () => {
  const t = await ev(() => ({ audio: __t.audioRegs, media: Object.keys(__t.mediaRegs).sort(), panel: getComputedStyle(document.getElementById('devpanel')).display, demo: __t.intervals30 }));
  assert.equal(t.audio, 1);
  assert.deepEqual(t.media, ['Playback', 'Properties', 'Status']);
  assert.equal(t.panel, 'none');
  assert.equal(t.demo, 0, 'no demo source in WE');
});

test('music starts the engine, BPM is found, silence stalls it after the delay', async () => {
  await ev(() => __t.beat(128));
  await until(P.page, () => __dbg.sim.state === 'running', null, 30000, 'running');
  await until(P.page, () => Math.abs(__dbg.audio.bpm - 128) < 4 && __dbg.audio.conf > 0.3, null, 60000, 'bpm 128');
  const rpm = await ev(() => __dbg.sim.rpm);
  assert.ok(rpm > 900, `rpm ${rpm}`);
  await ev(() => __t.stopBeat());                         // no callbacks at all = silence
  await until(P.page, () => __dbg.sim.state === 'stalled', null, 30000, 'stalled');
  assert.equal(P.errors.length, 0, P.errors.join('\n'));
});

test('dash: the key toggles the ignition, holding the pedal revs, the odometer rolls and TRIP resets', async () => {
  const pt = await ev(() => { const d = __dbg.dash; return { key: d.keyC, pedal: { x: d.pedalR.x + d.pedalR.w / 2, y: d.pedalR.y + d.pedalR.h / 2 }, odo: d.odoHit }; });
  const on0 = await ev(() => __dbg.sim.ignition);
  await P.page.mouse.click(pt.key.x, pt.key.y);
  assert.equal(await ev(() => __dbg.sim.ignition), !on0);
  await until(P.page, () => __dbg.sim.state === 'off');
  await P.page.mouse.click(pt.key.x, pt.key.y);
  assert.equal(await ev(() => __dbg.sim.ignition), true);

  const km0 = await ev(() => __dbg.odo.km);
  await P.page.mouse.move(pt.pedal.x, pt.pedal.y);
  await P.page.mouse.down();
  assert.equal(await ev(() => __dbg.sim.pedalIn), true);
  await until(P.page, () => __dbg.sim.state === 'running' && __dbg.sim.rpm > 5000, null, 30000, 'revving on the pedal');
  await P.page.waitForTimeout(1500);
  await P.page.mouse.up();
  assert.equal(await ev(() => __dbg.sim.pedalIn), false);
  const odo = await ev(() => ({ km: __dbg.odo.km, trip: __dbg.odo.trip }));
  assert.ok(odo.km > km0 && odo.trip > 0, `odometer ${JSON.stringify(odo)}`);
  // pause flushes the distance to localStorage
  await ev(() => window.wallpaperPropertyListener.setPaused(true));
  const stored = await ev(() => JSON.parse(localStorage.getItem('music-engine.odometer')));
  assert.ok(Math.abs(stored.km - odo.km) < 0.01, `stored ${JSON.stringify(stored)}`);
  await ev(() => window.wallpaperPropertyListener.setPaused(false));
  await P.page.mouse.click(pt.odo.x + pt.odo.w / 2, pt.odo.y + pt.odo.h / 2);
  assert.equal(await ev(() => __dbg.odo.trip), 0);
  await props(P.page, { showcontrols: false });
  assert.equal(await ev(() => __dbg.dash.hitTest(__dbg.dash.keyC.x, __dbg.dash.keyC.y)), null);
  await props(P.page, { showcontrols: true });
});

test('radio: WE media events show the track; no track = AUX', async () => {
  await props(P.page, { showradio: true });
  assert.ok(await ev(() => !!__dbg.dash.radio), 'radio drawn');
  await ev(() => { __t.mediaRegs.Properties({ title: 'Around the World', artist: 'Daft Punk' }); __t.mediaRegs.Playback({ state: 1 }); });
  let m = await ev(() => ({ t: __dbg.media.title, a: __dbg.media.artist, s: __dbg.media.state, on: __dbg.media.active(performance.now() / 1000) }));
  assert.deepEqual(m, { t: 'Around the World', a: 'Daft Punk', s: 'playing', on: true });
  await ev(() => __t.mediaRegs.Playback({ state: 2 }));
  assert.equal(await ev(() => __dbg.media.state), 'paused');
  await ev(() => __t.mediaRegs.Properties({ title: '' }));
  m = await ev(() => __dbg.media.active(performance.now() / 1000));
  assert.equal(m, false);
  await ev(() => __t.mediaRegs.Status({ enabled: false }));
  await P.page.waitForTimeout(300);
  await props(P.page, { showradio: false });
  assert.equal(P.errors.length, 0, P.errors.join('\n'));
});

test('junk property values from WE are clamped and never break the frame', async () => {
  const junk = [
    { cylinders: 'abc' }, { cylinders: 0 }, { cylinders: 99 }, { cylinders: 7.5 },
    { redline: 7 }, { redline: 'x' }, { redline: 1e9 }, { animspeed: 'x' }, { animspeed: -50 }, { sway: 'zz' }, { sway: -10 },
    { layout: 'zzz' }, { turbos: 'bogus' }, { background: 'nope' }, { odounits: '??' }, { quality: 'ultra' },
    { accentcolor: '2 -1 x' }, { bgdim: 'x' }, { sensitivity: -100 }, { stalldelay: 'x' }, { flamethreshold: 500 },
  ];
  for (const p of junk) await props(P.page, p);
  const S = await ev(() => ({ c: __dbg.S.cylinders, red: __dbg.S.redline, anim: __dbg.S.animSpeed, sway: __dbg.S.sway, layout: __dbg.eng3d.layout, ind: __dbg.S.induction.key, odo: __dbg.S.odoUnits }));
  assert.ok(S.c >= 1 && S.c <= 32);
  assert.ok(S.red >= 500 && S.red <= 15000);
  assert.ok(S.anim >= 0 && Number.isFinite(S.anim) && S.sway >= 0 && Number.isFinite(S.sway));
  assert.equal(S.layout, 'v');
  assert.equal(S.ind, '1');
  assert.equal(S.odo, 'km');
  await ev(() => { __dbg.sim.pedalIn = true; });
  await P.page.waitForTimeout(1500);
  const fin = await ev(() => { const e = __dbg.eng3d, s = __dbg.sim; return [s.rpm, s.boost, s.temp, e.crank, e.heat, e.mountY, e.eng.position.y, e.eng.rotation.x].every(Number.isFinite); });
  await ev(() => { __dbg.sim.pedalIn = false; });
  assert.ok(fin, 'NaN reached the sim or the engine');
  const st = await ev(() => __t.pixels({ only: 'engine' }));
  assert.ok(st.opaque > 1000, 'engine still visible');
  assert.equal(P.errors.length, 0, P.errors.join('\n'));
  // back to sane values for the next tests
  await props(P.page, { cylinders: 8, redline: 7000, animspeed: 100, sway: 100, layout: 'v', turbos: '1', stalldelay: 2, flamethreshold: 62, sensitivity: 100, bgdim: 20, quality: 'high', accentcolor: '0.75 0.08 0.06' });
});

test('pause stops the loop; any setPaused sequence leaves exactly one rAF chain', async () => {
  const pending = () => ev(() => __t.raf.size);
  assert.equal(await pending(), 1);
  await ev(() => { const L = window.wallpaperPropertyListener; for (let i = 0; i < 5; i++) L.setPaused(false); });
  assert.equal(await pending(), 1, 'unpause without a pause stacked loops');
  await ev(() => { const L = window.wallpaperPropertyListener; L.setPaused(true); L.setPaused(false); L.setPaused(true); L.setPaused(false); });
  assert.equal(await pending(), 1, 'pause+unpause in one frame stacked loops');
  await P.page.waitForTimeout(300);
  assert.equal(await pending(), 1);
  await ev(() => window.wallpaperPropertyListener.setPaused(true));
  await P.page.waitForTimeout(200);
  const f0 = await ev(() => __dbg.eng3d.renderer.info.render.frame);
  await P.page.waitForTimeout(600);
  assert.equal(await ev(() => __dbg.eng3d.renderer.info.render.frame), f0, 'renders while paused');
  assert.equal(await pending(), 0);
  await ev(() => window.wallpaperPropertyListener.setPaused(false));
  await P.page.waitForTimeout(300);
  assert.ok(await ev(() => __dbg.eng3d.renderer.info.render.frame) > f0);
  assert.equal(await pending(), 1);
  // the FPS limit from WE's general properties skips frames but keeps one chain
  await ev(() => window.wallpaperPropertyListener.applyGeneralProperties({ fps: 10 }));
  await P.page.waitForTimeout(500);
  assert.equal(await pending(), 1);
  await ev(() => window.wallpaperPropertyListener.applyGeneralProperties({ fps: 0 }));
});
