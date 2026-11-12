'use strict';
/* Shaders compile off the main thread before a new build is shown (Engine3D._precompile): until they are ready
   render() draws nothing, so the splash / the previous engine's frame stays instead of a frozen page */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../helpers/scene');

/* a renderer that supports parallel compilation, with the promises and timers in the test's hands */
function slowCompile(ext = true) {
  const W = world();
  const r = W.e.renderer, pending = [], timers = [];
  r.extensions = { has: n => ext && n === 'KHR_parallel_shader_compile' };
  r.compileAsync = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); pending.push({ res, rej }); return p; };
  W.g.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  return { W, r, pending, timers };
}
const tick = () => new Promise(r => setImmediate(r));

test('a new build is not drawn until its shaders are compiled, then it is', async () => {
  const { W, r, pending } = slowCompile();
  W.build(8, 'v');
  assert.equal(pending.length, 1, 'build() did not start a compile');
  assert.equal(W.e.compiling, true);
  const n0 = r.renders;
  assert.equal(W.e.render(), false);
  assert.equal(r.renders, n0, 'rendered while the shaders were still compiling');
  W.frame(3);                                   // the sim and the scene keep running meanwhile
  pending[0].res(); await tick();
  assert.equal(W.e.compiling, false);
  assert.equal(W.e.render(), true);
  assert.equal(r.renders, n0 + 1);
});

test('a newer build supersedes an older compile; a failed compile still lets the engine show', async () => {
  const { W, pending } = slowCompile();
  W.build(8, 'v'); W.build(2, 'steam');
  assert.equal(pending.length, 2);
  pending[0].res(); await tick();
  assert.equal(W.e.compiling, true, 'the first engine\'s compile released the second engine');
  pending[1].rej(new Error('lost context')); await tick();
  assert.equal(W.e.compiling, false);
  assert.equal(W.e.render(), true);
});

test('a compile that never reports back is given up on (cap), and an old cap does not release a newer build', () => {
  const { W, timers } = slowCompile();
  W.build(8, 'v');
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 2000 && timers[0].ms <= 6000, `cap ${timers[0].ms} ms`);
  W.build(6, 'inline');
  timers[0].fn();
  assert.equal(W.e.compiling, true, 'the first build\'s cap released the second build');
  timers[1].fn();
  assert.equal(W.e.compiling, false);
});

test('without KHR_parallel_shader_compile nothing waits: the first render compiles as before', () => {
  const { W, r, pending } = slowCompile(false);
  W.build(8, 'v');
  assert.equal(pending.length, 0);
  assert.ok(!W.e.compiling);
  const n0 = r.renders;
  assert.equal(W.e.render(), true);
  assert.equal(r.renders, n0 + 1);
});
