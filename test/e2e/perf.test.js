'use strict';
/* perfReport() / perfFlags() (main.js; taken from carrier-wallpaper): measuring on a real GPU from the devtools
   console, also inside Wallpaper Engine, where the switches live in localStorage. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, open } = require('./page');

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('perfReport measures frames, CPU, draw calls; two reports at once keep their own frames', async () => {
  const P = await open(browser, 'quality=medium');
  const [r, r2] = await P.page.evaluate(async () => {
    const p = perfReport(4);
    await new Promise(res => setTimeout(res, 2000));
    return Promise.all([p, perfReport(2)]);
  });
  assert.ok(r.frames >= 3, `only ${r.frames} frames in 4 s`);
  assert.ok(r2.frames >= 1 && r2.frames < r.frames, `the later report: ${r2.frames} frames (first ${r.frames})`);
  for (const k of ['fps', 'frameMs', 'cpuMs', 'renderCpuMs', 'dashCpuMs', 'drawCalls', 'triangles']) assert.ok(Number.isFinite(r[k]) && r[k] > 0, `${k} = ${r[k]}`);
  assert.ok(r.cpuMs >= r.renderCpuMs, 'the frame took less CPU than its render');
  assert.equal(r.quality, 'medium');
  assert.equal(r.layout, 'v');
  assert.ok(typeof r.gpu === 'string' && r.gpu.length > 0);
  assert.match(String(r.gpuMs), /perfFlags/, 'GPU timing without the flag');
  assert.deepEqual(P.errors, []);
  await P.ctx.close();
});

test('perfFlags keeps its switches in localStorage; bloom / flame shadow off survive a quality change; gputime times the GPU', async () => {
  const P = await open(browser, '');
  const saved = await P.page.evaluate(() => { perfFlags({ bloom: false }); const a = localStorage.getItem('music-engine.perf'); perfFlags({}); return [a, localStorage.getItem('music-engine.perf')]; });
  assert.deepEqual(saved, ['{"bloom":false}', '{}']);
  await P.page.evaluate(() => perfFlags({ bloom: false, fireshadow: false }));
  await P.page.reload();
  await P.page.waitForFunction(() => window.__dbg && __dbg.eng3d.renderer.info.render.frame > 2, null, { timeout: 30000 });
  const st = await P.page.evaluate(() => {
    const e = __dbg.eng3d, one = () => [e.post.bloom.enabled, e.fire[0].castShadow];
    const a = one();
    window.wallpaperPropertyListener.applyUserProperties({ quality: { value: 'medium' } });
    window.wallpaperPropertyListener.applyUserProperties({ quality: { value: 'high' } });
    return [a, one()];
  });
  assert.deepEqual(st, [[false, false], [false, false]], 'bloom / flame shadow back on');
  await P.page.evaluate(() => perfFlags({}));
  assert.deepEqual(P.errors, []);
  await P.ctx.close();   // (a second page rendering at the same time starves SwiftShader: the next load timed out)
  // ?gputime=1: a number where the GPU has timer queries, else it says so (never the "set the flag" hint)
  const G = await open(browser, 'gputime=1&quality=low');
  const g = await G.page.evaluate(() => perfReport(3));
  assert.ok(Number.isFinite(g.gpuMs) ? g.gpuMs > 0 : /no timer queries/.test(g.gpuMs), `gpuMs = ${g.gpuMs}`);
  assert.deepEqual(G.errors, []);
  await G.ctx.close();
});
