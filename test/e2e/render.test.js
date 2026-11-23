'use strict';
/* real WebGL (SwiftShader): every build compiles and draws; pixel invariants instead of reference images */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, open, props, until } = require('./page');
const { LAYOUT_IDS: IDS } = require('../helpers/load');

let browser, P;
before(async () => {
  browser = await launch();
  P = await open(browser, 'ignition=false&background=gradient');
});
after(async () => { await browser?.close(); });

const noErrors = tag => assert.deepEqual(P.errors, [], `${tag}: ${P.errors.join('\n')}`);

/* the opaque engine pixels (ground/shadows/effects hidden) stay out of what the dash draws */
async function checkEngineFrame(tag, minFrac = 0.04) {
  const st = await P.page.evaluate(() => __t.pixels({ only: 'engine', keepOut: __dbg.dash.keepOut(), margin: 2 }));
  const info = await P.page.evaluate(() => ({ calls: __dbg.eng3d.renderer.info.render.calls, tris: __dbg.eng3d.renderer.info.render.triangles, w: innerWidth, h: innerHeight }));
  assert.ok(info.calls > 10 && info.tris > 1000, `${tag}: drew ${info.calls} calls / ${info.tris} triangles`);
  assert.ok(st.bbox, `${tag}: nothing drawn`);
  const frac = st.opaque / (st.w * st.h);
  assert.ok(frac > minFrac && frac < 0.6, `${tag}: engine covers ${(frac * 100).toFixed(1)} % of the screen`);
  assert.equal(st.inKeepOut, 0, `${tag}: ${st.inKeepOut} engine pixels under the dash, e.g. ${JSON.stringify(st.sample)}`);
  assert.ok(st.bbox.x0 >= 0 && st.bbox.x1 < info.w && (st.bbox.x0 + st.bbox.x1) / 2 < info.w / 2, `${tag}: bbox ${JSON.stringify(st.bbox)}`);
  return st;
}

test('every layout × forced induction compiles, renders and keeps off the dash', async () => {
  for (const layout of IDS) for (const turbos of ['0', '1', 'sc', 'sc2']) {
    if (['radial', 'steam', 'jet'].includes(layout) && turbos !== '0') continue;   // they carry nothing anyway
    await props(P.page, { layout, turbos, cylinders: 8 });
    const got = await P.page.evaluate(() => [__dbg.eng3d.layout, __dbg.eng3d.ind.key]);
    assert.deepEqual(got, [layout, turbos]);
    await checkEngineFrame(`${layout} ${turbos}`);
    noErrors(`${layout} ${turbos}`);
  }
});

test('the biggest builds and the cutaway off still render and fit', async () => {
  for (const [layout, cylinders] of [['inline', 32], ['w', 32], ['boxer', 32], ['radial', 32], ['rotary', 32], ['steam', 8], ['jet', 16]]) {
    await props(P.page, { layout, cylinders, turbos: '2', cutaway: false });
    await checkEngineFrame(`${layout} ${cylinders}`, 0.025);          // long and thin: I32 is ~4 % of a 16:9 screen
    noErrors(`${layout} ${cylinders}`);
  }
  await props(P.page, { cutaway: true });
});

test('radio and portrait layouts keep the engine clear of the dash', async () => {
  await props(P.page, { layout: 'w', cylinders: 32, showradio: true });
  await checkEngineFrame('W32 + radio');
  await P.page.setViewportSize({ width: 720, height: 1280 });
  await until(P.page, () => __dbg.eng3d.w === 720);
  await props(P.page, { layout: 'inline', cylinders: 32 });
  const st = await P.page.evaluate(() => __t.pixels({ only: 'engine', keepOut: __dbg.dash.keepOut(), margin: 2 }));
  assert.equal(st.inKeepOut, 0, `portrait: ${JSON.stringify(st.sample)}`);
  assert.ok(st.bbox.y1 < 1280 * 0.6, `portrait: engine should sit above the dash, bbox ${JSON.stringify(st.bbox)}`);
  await P.page.setViewportSize({ width: 1280, height: 720 });
  await props(P.page, { showradio: false });
  noErrors('radio/portrait');
});

test('additive effects add light but never write alpha (no black boxes on the transparent canvas)', async () => {
  for (const layout of ['v', 'radial', 'jet']) {
    await props(P.page, { layout, cylinders: 8, turbos: '1', ignition: true });
    await P.page.evaluate(() => { __dbg.sim.pedalIn = true; });
    await until(P.page, () => __dbg.sim.flame > 0.6, null, 60000, `${layout} flames`);
    await P.page.evaluate(() => { __dbg.sim.emit('backfire', 1); });   // through the event queue, like the sim does
    await P.page.waitForTimeout(100);
    const st = await P.page.evaluate(() => __t.pixels({ only: 'fx' }));
    assert.ok(st.lit > 200, `${layout}: flames drew only ${st.lit} lit pixels`);
    assert.equal(st.opaque, 0, `${layout}: ${st.opaque} flame pixels wrote alpha`);
    // and with the engine: bright flame colour around the glow point
    const near = await P.page.evaluate(() => {
      const g = __dbg.eng3d.glowScreen();
      return __t.pixels({ near: { x: g.x, y: g.y, r: 160 } }).near;
    });
    assert.ok(near > 30, `${layout}: no flame colour near the exhaust (${near})`);
    await P.page.evaluate(() => { __dbg.sim.pedalIn = false; });
  }
  await props(P.page, { ignition: false });
  noErrors('additive');
});

test('HDR and bloom: flames glow beyond their own pixels at high quality, low draws straight to the canvas, the bloom writes no alpha', async () => {
  await props(P.page, { layout: 'v', cylinders: 8, turbos: '1', ignition: true, quality: 'high' });
  assert.ok(await P.page.evaluate(() => !!__dbg.eng3d.post), 'no post-processing at high quality');
  await P.page.evaluate(() => { __dbg.sim.pedalIn = true; });
  await until(P.page, () => __dbg.sim.flame > 0.6, null, 60000, 'flames');
  // one frozen moment, drawn three ways: with the bloom, without it, and at low quality
  const r = await P.page.evaluate(() => {
    window.wallpaperPropertyListener.setPaused(true);
    const e = __dbg.eng3d, out = {};
    e.post.bloom.enabled = false; out.plain = __t.pixels({ only: 'fx', keep: true }); e.post.bloom.enabled = true;
    out.bloom = __t.pixels({ only: 'fx', against: out.plain.buf }); delete out.plain.buf;
    e.setQuality('low'); out.post = !!e.post; out.low = __t.pixels({ only: 'fx' }); out.lowAll = __t.pixels({});
    e.setQuality('high');
    window.wallpaperPropertyListener.setPaused(false);
    return out;
  });
  assert.ok(r.plain.lit > 200, `flames drew only ${r.plain.lit} lit pixels`);
  assert.equal(r.bloom.opaque, 0, `${r.bloom.opaque} bloom/flame pixels wrote alpha`);
  assert.equal(r.post, false, 'low quality still post-processes');
  // the same frozen frame with and without the bloom: pixels that were dark and now glow (none without a bloom)
  assert.ok(r.bloom.gained > r.plain.lit * 0.04, `the bloom adds no glow around the flames: ${r.bloom.gained} dark pixels lit by it (flames: ${r.plain.lit} lit pixels)`);
  assert.ok(r.low.lit > 200 && r.low.opaque === 0, `low quality flames: ${JSON.stringify({ lit: r.low.lit, opaque: r.low.opaque })}`);
  assert.ok(r.lowAll.opaque > 1000, 'low quality drew no engine');
  await P.page.evaluate(() => { __dbg.sim.pedalIn = false; });
  // engine off: nothing glows (bright metal under the studio lights must not bloom into a haze)
  await props(P.page, { ignition: false });
  await until(P.page, () => __dbg.sim.state === 'off' && __dbg.eng3d.flames.size.every(s => s === 0), null, 30000, 'effects gone');
  const off = await P.page.evaluate(() => __t.pixels({ only: 'fx' }));
  assert.equal(off.lit, 0, `${off.lit} lit effect pixels with the engine off`);
  noErrors('hdr');
});

test('ambient occlusion (high only) only darkens the engine and the floor under it, never the fire', async () => {
  await props(P.page, { layout: 'v', cylinders: 8, turbos: '1', ignition: true, quality: 'high', ambientocclusion: false });
  assert.equal(await P.page.evaluate(() => __dbg.eng3d.post.ao.enabled), false, 'AO on while switched off');
  await props(P.page, { quality: 'medium', ambientocclusion: true });
  assert.equal(await P.page.evaluate(() => __dbg.eng3d.post.ao.enabled), false, 'AO on at medium quality');
  await props(P.page, { quality: 'high' });
  assert.equal(await P.page.evaluate(() => __dbg.eng3d.post.ao.enabled), true, 'no AO at high quality');
  await P.page.evaluate(() => { __dbg.sim.pedalIn = true; });
  await until(P.page, () => __dbg.sim.flame > 0.6, null, 60000, 'flames');
  // one frozen moment: the fire alone (its bright pixels = the mask), the frame without AO, the frame with it
  const r = await P.page.evaluate(() => {
    window.wallpaperPropertyListener.setPaused(true);
    const e = __dbg.eng3d, ao = e.post.ao, out = {};
    e.post.bloom.enabled = false;                          // the bloom spreads light: compare the frame itself
    out.fire = __t.pixels({ only: 'fx', keepMask: 120 });
    ao.enabled = false; out.plain = __t.pixels({ keep: true }); ao.enabled = true;
    out.ao = __t.pixels({ against: out.plain.buf, mask: out.fire.bright });
    e.post.bloom.enabled = true;
    delete out.plain.buf; delete out.fire.bright;
    window.wallpaperPropertyListener.setPaused(false);
    return out;
  });
  assert.ok(r.ao.mask > 500, `too little fire to test: ${r.ao.mask} bright fire pixels`);
  assert.ok(r.ao.darker > r.plain.opaque * 0.02, `AO darkens nothing: ${r.ao.darker} darker pixels of ${r.plain.opaque}`);
  assert.ok(r.ao.brighter <= r.plain.opaque * 0.001, `AO brightened ${r.ao.brighter} pixels`);
  assert.ok(r.ao.maskDarker <= r.ao.mask * 0.01, `AO dimmed the fire: ${r.ao.maskDarker} of ${r.ao.mask} bright fire pixels darker`);
  await P.page.evaluate(() => { __dbg.sim.pedalIn = false; });
  await props(P.page, { ignition: false, ambientocclusion: false });
  noErrors('ao');
});

test('ambient occlusion leaves the glow of hot metal alone (AO grain on a cooling turbo)', async () => {
  await props(P.page, { layout: 'v', cylinders: 8, turbos: '2', ignition: false, quality: 'high', ambientocclusion: true });
  await until(P.page, () => __dbg.sim.state === 'off', null, 30000, 'engine off');
  // only the glow lights the frame: no lights, no environment, the turbo housings half way through cooling down
  const r = await P.page.evaluate(() => {
    window.wallpaperPropertyListener.setPaused(true);
    const e = __dbg.eng3d, ao = e.post.ao, undo = [];
    e.scene.traverse(o => { if (o.isLight && o.intensity) { undo.push([o, o.intensity]); o.intensity = 0; } });
    const env = e.scene.environmentIntensity, hot = e.mats.turboHot.emissiveIntensity, fl = e.flameLight.intensity;
    e.scene.environmentIntensity = 0; e.flameLight.intensity = 0;   // (render() lights the fire's pool from it) e.mats.turboHot.emissiveIntensity = 0.35; e.post.bloom.enabled = false;
    ao.enabled = false; const a = __t.pixels({ only: 'engine', keep: true }).buf;
    ao.enabled = true; const b = __t.pixels({ only: 'engine', keep: true }).buf;
    undo.forEach(([o, i]) => { o.intensity = i; });
    e.scene.environmentIntensity = env; e.mats.turboHot.emissiveIntensity = hot; e.flameLight.intensity = fl; e.post.bloom.enabled = true;
    window.wallpaperPropertyListener.setPaused(false);
    let glow = 0, darker = 0;
    for (let k = 0; k < a.length; k += 4) {
      const v = Math.max(a[k], a[k + 1], a[k + 2]);
      if (v <= 24) continue;
      glow++; if (Math.max(b[k], b[k + 1], b[k + 2]) < v - 6) darker++;
    }
    return { glow, darker };
  });
  assert.ok(r.glow > 300, `too little glow to test: ${r.glow} pixels`);
  assert.ok(r.darker <= r.glow * 0.01, `AO darkened the glow: ${r.darker} of ${r.glow} pixels`);
  await props(P.page, { ambientocclusion: false, turbos: '1' });
  noErrors('ao glow');
});

test('highlights on metal and paint stop at white: nothing but glowing parts and fire blooms (the rocking boxer flashed)', async () => {
  await props(P.page, { layout: 'boxer', cylinders: 6, turbos: '1', ignition: false, quality: 'high' });
  await until(P.page, () => __dbg.sim.state === 'off' && __dbg.eng3d.flames.size.every(s => s === 0), null, 30000, 'engine off');
  // the cold engine tilted through its rocking: the bloom must not add a visible glow anywhere on it
  const r = await P.page.evaluate(() => {
    window.wallpaperPropertyListener.setPaused(true);
    const e = __dbg.eng3d, rx0 = e.eng.rotation.x;
    let worst = 0;
    for (let i = 0; i <= 12; i++) {
      e.eng.rotation.x = -0.06 + i * 0.01; e.eng.updateMatrixWorld(true);
      e.post.bloom.enabled = false; const a = __t.pixels({ only: 'engine', keep: true }).buf;
      e.post.bloom.enabled = true; const b = __t.pixels({ only: 'engine', keep: true }).buf;
      let n = 0; for (let k = 0; k < a.length; k += 4) if (Math.max(b[k] - a[k], b[k + 1] - a[k + 1], b[k + 2] - a[k + 2]) > 30) n++;
      worst = Math.max(worst, n);
    }
    e.eng.rotation.x = rx0;
    window.wallpaperPropertyListener.setPaused(false);
    return worst;
  });
  assert.ok(r < 50, `the bloom glows around highlights on the cold engine: ${r} pixels`);
  await props(P.page, { layout: 'v', cylinders: 8 });
  noErrors('highlights');
});
