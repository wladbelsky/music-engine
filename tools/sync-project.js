#!/usr/bin/env node
/* Brings project.json (what Wallpaper Engine reads) in line with the engine registries (js/core/layout.js):
 * the `layout` combo lists every registered layout in load order, labelled with its static `title`, and the
 * conditions that hide `turbos` (layouts that carry no forced induction) and `redline` (engine types with a
 * fixed internal redline) name exactly those layouts. Run it after adding an engine: `npm run sync:project`.
 * test/unit/project.test.js fails while project.json is out of date. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load, ROOT } = require('../test/helpers/load');

const FILE = path.join(ROOT, 'project.json');
const notIn = ids => ids.map(id => `layout.value != '${id}'`).join(' && ');

/* project (parsed JSON) -> a synced copy; g = a loaded vm context (test/helpers/load.js) */
function sync(project, g = load()) {
  const out = JSON.parse(JSON.stringify(project)), props = out.general.properties;
  const layouts = g.EngineLayouts.list();
  props.layout.options = layouts.map(L => ({ label: L.title || L.id, value: L.id }));
  const noInduction = layouts.filter(L => !g.Induction.supported(L)).map(L => L.id);
  const fixedRedline = layouts.filter(L => g.EngineTypes.get(L.kind).redline != null).map(L => L.id);
  props.turbos.condition = notIn(noInduction);
  props.redline.condition = notIn(fixedRedline);
  for (const k of ['turbos', 'redline']) if (!props[k].condition) delete props[k].condition;
  return out;
}
const format = p => JSON.stringify(p, null, 2);   // the file's own style (2 spaces, no final newline)

module.exports = { sync, format, FILE };

if (require.main === module) {
  const cur = fs.readFileSync(FILE, 'utf8'), next = format(sync(JSON.parse(cur)));
  if (next === cur) console.log('project.json is up to date');
  else { fs.writeFileSync(FILE, next); console.log('project.json updated'); }
}
