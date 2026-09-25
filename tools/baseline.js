#!/usr/bin/env node
/* Writes test/fixtures/baseline.json: the numeric baseline of the existing engines (test/helpers/baseline.js).
 * Run it only when an old engine's behaviour changes on purpose; test/unit/baseline.test.js compares against it.
 *   node tools/baseline.js            all cases
 *   node tools/baseline.js jet steam  only the scene/dash/sim cases whose key mentions one of these words */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('../test/helpers/baseline');

const file = path.join(__dirname, '..', 'test', 'fixtures', 'baseline.json');
const only = process.argv.slice(2);
const fresh = record();
let out = fresh;
if (only.length && fs.existsSync(file)) {
  out = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const part of Object.keys(fresh)) for (const k of Object.keys(fresh[part])) if (only.some(w => k.includes(w))) out[part][k] = fresh[part][k];
}
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log('wrote', path.relative(process.cwd(), file), (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
