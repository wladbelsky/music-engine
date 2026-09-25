/* Engine3D + Dash in Node (see load.js): the real THREE scene graph, no WebGL. */
'use strict';
const { load, LAYOUT_IDS: IDS } = require('./load');

const INDUCTION = ['0', '1', '2', '4', 'sc', 'sc2'];

/* the analyzer fields the sim reads */
function fakeAudio(o = {}) {
  return Object.assign({
    silentTime: 0, level: 0.3, bpm: 128, conf: 0.8, intensity: 0.5, power: 0.5, beats: [],
    takeBeats() { const b = this.beats; this.beats = []; return b; },
  }, o);
}

/**
 * world({ w, h, dash }) -> { g, e, d, frame(n, dt), sim, audio }
 * Mirrors main.js: dash.resize -> eng3d.setKeepOut(dash.keepOut()) -> eng3d.resize; build(); then per frame
 * sim.update -> eng3d.update. dash: options for Dash.set, or false for no dash (FIT_RIGHT fallback).
 */
function world({ w = 1920, h = 1080, dash = {}, seed } = {}) {
  const g = load({ seed });
  const e = new g.Engine3D(g.fakeCanvas());
  let d = null;
  if (dash !== false) { d = new g.Dash(g.fakeCanvas()); d.set(dash); d.resize(w, h, 1); e.setKeepOut(d.keepOut()); }
  e.resize(w, h);
  const sim = new g.EngineSim(), audio = fakeAudio();
  const W = { g, e, d, sim, audio, t: 0, w, h };
  W.build = (n, id, ind = '1') => {
    const L = g.EngineLayouts.get(id), eff = g.Induction.effective(g.Induction.parse(ind), L), type = g.EngineTypes.get(L.kind);
    if (W.userRedline === undefined) W.userRedline = sim.settings.redline;
    Object.assign(sim.settings, { kind: type.id, turbos: eff.turbos, blower: eff.blower, redline: type.redline ?? W.userRedline });
    e.build(n, id, g.Induction.parse(ind));
    e.resize(w, h);
    if (d) d.set({ kind: type.id, label: L.label(L.normCyl(n)) });
    return W;
  };
  W.resize = (w2, h2) => { W.w = w2; W.h = h2; if (d) { d.resize(w2, h2, 1); e.setKeepOut(d.keepOut()); } e.resize(w2, h2); return W; };
  W.dashSet = o => { d.set(o); e.setKeepOut(d.keepOut()); return W; };
  /* n frames of dt; each(W, i) may poke the sim/audio first */
  W.frame = (n = 1, dt = 1 / 30, each, anim = 1, quality = 'high') => {
    for (let i = 0; i < n; i++) {
      W.t += dt; g.clock.ms = W.t * 1000;
      if (each) each(W, i);
      if (audio.level < 0.004) audio.silentTime += dt;
      sim.update(dt, audio, W.t);
      e.update(dt, sim, anim, quality);
    }
    return W;
  };
  /* drive to 'running' at full throttle */
  W.rev = (secs = 3) => { audio.level = 0.3; audio.silentTime = 0; W.frame(Math.round(2.5 * 30)); sim.pedalIn = true; W.frame(Math.round(secs * 30)); return W; };
  return W;
}

function meshes(obj) { const out = []; obj.traverse(o => { if (o.isMesh || o.isInstancedMesh) out.push(o); }); return out; }

module.exports = { world, fakeAudio, meshes, IDS, INDUCTION };
