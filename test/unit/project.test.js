'use strict';
/* project.json (Wallpaper Engine properties) <-> the code <-> the settings panel <-> CLAUDE.md */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, scriptOrder, read, ROOT } = require('../helpers/load');

const project = JSON.parse(read('project.json'));
const props = project.general.properties;
const main = read('js/main.js');
const g = load();
const opts = k => props[k].options.map(o => o.value);
const layoutIds = opts('layout');

/* the PANEL table literal from main.js, evaluated on its own */
const PANEL = (() => {
  const m = main.match(/const PANEL = (\[[\s\S]*?\n {2}\]);/);
  assert.ok(m, 'PANEL table not found in main.js');
  return vm.runInNewContext(m[1], { EngineLayouts: g.EngineLayouts });
})();
/* every js file below js/, as 'js/…' paths */
const jsFiles = (dir = 'js') => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? jsFiles(dir + '/' + d.name) : d.name.endsWith('.js') ? [dir + '/' + d.name] : []);
const panelRows = Object.fromEntries(PANEL.flatMap(([, items]) => items).map(it => [it.k, it]));

test('every script parses (incl. main.js) and index.html loads them in the documented order', () => {
  const order = scriptOrder();
  for (const f of jsFiles()) {
    assert.ok(order.includes(f), `${f} is not loaded by index.html`);
    if (!f.endsWith('three.min.js')) assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  }
  for (const f of order) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} missing`);
  const doc = read('CLAUDE.md').match(/Load order in `index.html`: `([^`]+)`/)[1].split(/\s*→\s*/);
  assert.deepEqual(order.map(f => path.basename(f)), doc, 'CLAUDE.md load order is stale');
  assert.equal(project.file, 'index.html');
  assert.equal(project.type, 'web');
  assert.equal(project.general.supportsaudioprocessing, true);
  assert.ok(fs.existsSync(path.join(ROOT, project.preview)));
});

test('the layout combo lists exactly the registered layouts', () => {
  const declared = [...jsFiles().filter(f => !f.endsWith('three.min.js'))
    .flatMap(f => [...read(f).matchAll(/\b\w+Layout\.id = '(\w+)'/g)].map(m => m[1]))];
  assert.deepEqual([...declared].sort(), [...layoutIds].sort());
  for (const id of layoutIds) assert.equal(g.EngineLayouts.get(id).id, id, `${id} is not registered`);
  assert.ok(layoutIds.includes(props.layout.value));
});

test('forced induction combo == Induction.OPTIONS, hidden exactly for layouts that carry nothing', () => {
  assert.deepEqual([...opts('turbos')].sort(), Object.keys(g.Induction.OPTIONS).sort());
  const hidden = [...props.turbos.condition.matchAll(/layout\.value != '(\w+)'/g)].map(m => m[1]).sort();
  const none = layoutIds.filter(id => !g.Induction.supported(g.EngineLayouts.get(id))).sort();
  assert.deepEqual(hidden, none);
});

test('rev limiter is hidden exactly for the types with a fixed internal redline', () => {
  const hidden = [...props.redline.condition.matchAll(/layout\.value != '(\w+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(hidden, layoutIds.filter(id => g.EngineLayouts.type(id).redline != null).sort());
});

test('cylinders slider matches MAX_CYL, sliders have sane ranges, conditions name real properties', () => {
  assert.equal(props.cylinders.max, g.EngineLayouts.MAX_CYL);
  assert.equal(props.cylinders.min, 1);
  for (const [k, p] of Object.entries(props)) {
    if (p.type === 'slider') assert.ok(p.min < p.max && p.value >= p.min && p.value <= p.max, k);
    if (p.type === 'combo') assert.ok(opts(k).includes(p.value), `${k}: default not in options`);
    if (p.type === 'color') assert.match(p.value, /^[\d.]+ [\d.]+ [\d.]+$/, k);
    if (p.condition) for (const m of p.condition.matchAll(/(\w+)\.value/g)) assert.ok(props[m[1]], `${k}: condition on unknown ${m[1]}`);
  }
  const orders = Object.values(props).map(p => p.order);
  assert.equal(new Set(orders).size, orders.length, 'duplicate property order');
});

test('every property is read by applyUserProperties (schemecolor is WE-only)', () => {
  for (const k of Object.keys(props)) {
    if (k === 'schemecolor') continue;
    assert.ok(main.includes(`v('${k}')`), `main.js ignores the "${k}" property`);
  }
});

test('the browser settings panel mirrors project.json', () => {
  const keys = Object.keys(props).filter(k => k !== 'schemecolor').sort();
  assert.deepEqual(Object.keys(panelRows).sort(), keys);
  const typeOf = { bool: 'bool', combo: 'select', color: 'color', file: 'file' };
  for (const k of keys) {
    const p = props[k], row = panelRows[k];
    if (p.type === 'slider') {
      assert.ok(row.t === 'range' || row.t === 'number', `${k}: ${row.t}`);
      assert.equal(row.min, p.min, `${k} min`); assert.equal(row.max, p.max, `${k} max`);
    } else assert.equal(row.t, typeOf[p.type], `${k} type`);
    if (p.type === 'combo') assert.deepEqual([...row.o.map(o => o[0])], opts(k), `${k} options`);
    if (p.type !== 'file') assert.equal(row.d, p.value, `${k} default`);
  }
});

test('main.js defaults (S) match the project.json defaults', () => {
  const m = main.match(/const S = (\{[\s\S]*?\n {2}\});/);
  const S = vm.runInNewContext('(' + m[1] + ')', { Induction: g.Induction });
  const rgb = s => s.split(' ').map(Number);
  assert.equal(S.cylinders, props.cylinders.value);
  assert.equal(S.layout, props.layout.value);
  assert.equal(S.induction.key, props.turbos.value);
  assert.equal(S.cutaway, props.cutaway.value);
  assert.deepEqual([...S.accent], rgb(props.accentcolor.value));
  assert.deepEqual([...S.dashColor], rgb(props.dashcolor.value));
  assert.deepEqual([...S.bgcolor], rgb(props.bgcolor.value));
  assert.equal(S.background, props.background.value);
  assert.equal(S.bgdim * 100, props.bgdim.value);
  assert.equal(S.sensitivity * 100, props.sensitivity.value);
  assert.equal(S.redline, props.redline.value);
  assert.equal(Math.round(S.flameThr * 100), props.flamethreshold.value);
  assert.equal(S.stallDelay, props.stalldelay.value);
  assert.equal(S.animSpeed * 100, props.animspeed.value);
  assert.equal(S.sway * 100, props.sway.value);
  assert.equal(S.quality, props.quality.value);
  assert.equal(S.showBpm, props.showbpm.value);
  assert.equal(S.debug, props.debug.value);
  assert.equal(S.showControls, props.showcontrols.value);
  assert.equal(S.showRadio, props.showradio.value);
  assert.equal(S.odoUnits, props.odounits.value);
});
