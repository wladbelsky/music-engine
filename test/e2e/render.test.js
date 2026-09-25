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
