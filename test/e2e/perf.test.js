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

test('glcheck (debug flag) logs a GL error from getProgramParameter with its stack, once per call site', async () => {
  const G = await open(browser, 'glcheck=1&quality=low');
  const logs = [];
  G.page.on('console', m => { if (m.type() === 'warning' && m.text().startsWith('glcheck:')) logs.push(m.text()); });
  await G.page.evaluate(() => {
    const gl = __dbg.eng3d.renderer.getContext(), p = gl.createProgram();
    gl.deleteProgram(p);
    for (let i = 0; i < 3; i++) gl.getProgramParameter(p, gl.LINK_STATUS);   // a deleted program: what WE's console showed
  });
  await G.page.waitForTimeout(200);
  assert.equal(logs.length, 1, `logged ${logs.length} times: ${logs.join(' / ')}`);
  assert.match(logs[0], /GL error 0x501, isProgram false/);
  await G.ctx.close();
});

test('perfReport leaves pauses (gaps over 1 s) out of the frame times and counts them', async () => {
  const P = await open(browser, 'quality=low');
  const r = await P.page.evaluate(async () => {
    window.wallpaperPropertyListener.setPaused(true);
    await new Promise(res => setTimeout(res, 300));
    const p = perfReport(0.5);
    for (const now of [1000, 1016.7, 1033.4, 27000, 27016.7]) __dbg.frame(1 / 60, now / 1000, 1 / 60, now);
    return p;
  });
  assert.equal(r.pauses, 1);
  assert.equal(r.frames, 5);
  assert.ok(Math.abs(r.frameMs - 16.7) < 0.1 && r.frameMsMax < 17, `frame times with the pause: ${r.frameMs} / max ${r.frameMsMax}`);
  assert.ok(Math.abs(r.fps - 59.9) < 0.5, `fps ${r.fps}`);
  await P.ctx.close();
});
