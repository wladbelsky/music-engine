'use strict';
/* browser mode (no Wallpaper Engine): the settings panel, saved settings, the demo source */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, open, until, ROOT } = require('./page');

const props = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.json'), 'utf8')).general.properties;
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('?demo=1 starts exactly one demo source (setupDev ran 3× once)', async () => {
  const P = await open(browser, 'demo=1');
  assert.equal(await P.page.evaluate(() => __t.intervals30), 1);
  assert.equal(await P.page.evaluate(() => __t.audioRegs), 0);
  await until(P.page, () => __dbg.sim.state === 'running', null, 30000, 'demo runs the engine');
  assert.deepEqual(P.errors, []);
  await P.ctx.close();
});

test('the panel has a control for every WE property, with the same options and ranges', async () => {
  const P = await open(browser, '');
  await P.page.evaluate(() => { document.getElementById('devpanel').style.display = 'block'; });
  const ctl = await P.page.evaluate(keys => Object.fromEntries(keys.map(k => {
    const c = document.getElementById('dv-' + k);
    return [k, c && { tag: c.tagName, type: c.type, min: c.min, max: c.max, options: c.options ? [...c.options].map(o => o.value) : null, value: c.type === 'checkbox' ? c.checked : c.value }];
  })), Object.keys(props));
  for (const [k, p] of Object.entries(props)) {
    if (k === 'schemecolor') continue;
    const c = ctl[k];
    assert.ok(c, `no control for ${k}`);
    if (p.type === 'combo') { assert.deepEqual(c.options, p.options.map(o => o.value), k); assert.equal(c.value, p.value, `${k} default`); }
    if (p.type === 'slider') { assert.equal(Number(c.min), p.min, `${k} min`); assert.equal(Number(c.max), p.max, `${k} max`); assert.equal(Number(c.value), p.value, `${k} default`); }
    if (p.type === 'bool') assert.equal(c.value, p.value, `${k} default`);
  }
  assert.deepEqual(P.errors, []);
  await P.ctx.close();
});

test('panel edits apply like WE, show the applied value, survive a reload; URL wins and is not saved', async () => {
  const P = await open(browser, '');
  const pg = P.page;
  await pg.evaluate(() => { document.getElementById('devpanel').style.display = 'block'; });
  await pg.selectOption('#dv-layout', 'radial');
  assert.equal(await pg.isDisabled('#dv-turbos'), true, 'radial: no forced induction');
  await pg.selectOption('#dv-layout', 'steam');
  assert.equal(await pg.isDisabled('#dv-redline'), true, 'steam: fixed scale');
  await pg.selectOption('#dv-layout', 'rotary');
  assert.equal(await pg.isDisabled('#dv-turbos'), false);
  await pg.fill('#dv-cylinders', '99');
  await pg.dispatchEvent('#dv-cylinders', 'change');
  assert.equal(await pg.inputValue('#dv-cylinders'), '32', 'shows the clamped value');
  await pg.selectOption('#dv-turbos', 'sc2');
  await until(pg, () => __dbg.eng3d.layout === 'rotary' && __dbg.eng3d.n === 32 && __dbg.eng3d.ind.key === 'sc2');

  await pg.reload();
  await until(pg, () => window.__dbg && __dbg.eng3d.layout === 'rotary');
  assert.deepEqual(await pg.evaluate(() => [__dbg.S.layout, __dbg.S.cylinders, __dbg.S.induction.key]), ['rotary', 32, 'sc2']);
  assert.equal(await pg.inputValue('#dv-layout'), 'rotary');

  await pg.goto(P.url + '?layout=inline');
  await until(pg, () => window.__dbg && __dbg.eng3d && __dbg.eng3d.layout === 'inline');
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('music-engine.settings')));
  assert.equal(saved.layout, 'rotary', 'the URL parameter was saved');

  // Reset settings forgets the panel but keeps the mileage
  await pg.evaluate(() => localStorage.setItem('music-engine.odometer', JSON.stringify({ km: 1234.5, trip: 12 })));
  await pg.goto(P.url);
  await until(pg, () => window.__dbg && __dbg.eng3d.layout === 'rotary');
  await pg.evaluate(() => { document.getElementById('devpanel').style.display = 'block'; });
  await Promise.all([pg.waitForEvent('load'), pg.click('#dv-reset')]);
  await until(pg, () => window.__dbg && __dbg.eng3d && __dbg.eng3d.layout === 'v');
  assert.equal(await pg.evaluate(() => localStorage.getItem('music-engine.settings')), null);
  assert.ok(Math.abs(await pg.evaluate(() => __dbg.odo.km) - 1234.5) < 0.01);
  assert.deepEqual(P.errors, []);
  await P.ctx.close();
});

test('the key is kept like a setting in the browser; clicks on the panel never reach the key', async () => {
  const P = await open(browser, '');
  const pg = P.page;
  const key = await pg.evaluate(() => __dbg.dash.keyC);
  await pg.mouse.click(key.x, key.y);
  assert.equal(await pg.evaluate(() => __dbg.sim.ignition), false);
  assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('music-engine.settings')).ignition), false);
  // lay the panel over the key and click there
  await pg.evaluate(k => { const p = document.getElementById('devpanel'); p.style.display = 'block'; p.style.left = (k.x - 20) + 'px'; p.style.top = (k.y - 20) + 'px'; }, key);
  await pg.mouse.click(key.x, key.y);
  assert.equal(await pg.evaluate(() => __dbg.sim.ignition), false, 'a click on the panel toggled the ignition');
  assert.deepEqual(P.errors, []);
  await P.ctx.close();
});

test('file pickers list extensions, not audio/* or image/* (Android asks for the microphone / camera for those)', async () => {
  const P = await open(browser, '');
  const acc = await P.page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map(i => [i.id, i.accept]));
  assert.ok(acc.length >= 2, JSON.stringify(acc));
  for (const [id, a] of acc) {
    assert.ok(!/\*/.test(a), `${id}: accept="${a}" has a wildcard`);
    assert.ok(/^(\.\w+,)*\.\w+$/.test(a), `${id}: accept="${a}" is not a list of extensions`);
  }
  assert.ok(acc.find(([id]) => id === 'dv-file')[1].includes('.mp3'));
  assert.deepEqual(P.errors, []);
  await P.ctx.close();
});
