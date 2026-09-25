/* Numeric baseline of the existing engines (sim traces, dash drawing, scene), so refactors and new engine
 * types provably leave the old ones alone. `npm run baseline` writes test/fixtures/baseline.json from this;
 * test/unit/baseline.test.js records again and compares. Not image goldens: numbers from the real code.
 *
 * Everything is driven by one scripted "song" (music -> peak -> drop -> silence/stall -> restart with the
 * pedal -> key off/on) with a fresh seeded vm per case, so Math.random call order only matters within a case. */
'use strict';
const { load } = require('./load');
const { world, fakeAudio } = require('./scene');

/* the engines the baseline covers: [layout, cylinders, induction] */
const SCENE_CASES = [
  ['inline', 4, '0'], ['inline', 6, '1'], ['v', 8, '2'], ['v', 12, 'sc'], ['boxer', 6, 'sc2'], ['w', 16, '4'],
  ['radial', 9, '0'], ['radial', 14, '1'], ['rotary', 2, '1'], ['rotary', 4, 'sc'], ['steam', 2, '0'], ['steam', 5, '0'],
  ['jet', 8, '0'], ['jet', 16, '0'],
];
const SIM_CASES = [
  { kind: 'piston', turbos: 0, blower: false }, { kind: 'piston', turbos: 1, blower: false }, { kind: 'piston', turbos: 2, blower: false },
  { kind: 'piston', turbos: 0, blower: true }, { kind: 'piston', turbos: 2, blower: true },
  { kind: 'piston', turbos: 1, blower: false, redline: 9500 }, { kind: 'piston', turbos: 1, blower: false, redline: 5000 },
  { kind: 'steam', turbos: 0, blower: false, redline: 7000 }, { kind: 'jet', turbos: 0, blower: false, redline: 7000 },
];
const DASH_KINDS = ['piston', 'steam', 'jet'];

const DT = 1 / 30;
/* the song: returns what the audio / key / pedal do at time t */
function song(t) {
  if (t < 6) return { mus: 0.5, bpm: 124 };
  if (t < 9) return { mus: 0.95, bpm: 128 };
  if (t < 10) return { mus: 0.15, bpm: 128 };
  if (t < 15) return { mus: 0 };
  if (t < 18) return { mus: 0.6, bpm: 140, pedal: t > 16 && t < 17 };
  if (t < 19) return { mus: 0.6, bpm: 140, off: true };
  return { mus: 0.7, bpm: 140 };
}
const SONG_T = 22;

/* applies the song to (audio, sim) before the step at time t */
function drive(a, sim, t, st) {
  const s = song(t);
  if (s.mus > 0) {
    Object.assign(a, { level: 0.3, silentTime: 0, intensity: s.mus, power: s.mus, bpm: s.bpm, conf: 0.8 });
    const period = 60 / s.bpm, n = Math.floor(t / period);
    if (n > st.beat) { st.beat = n; a.beats.push(0.4 + 0.6 * s.mus); }
  } else Object.assign(a, { level: 0, intensity: 0, power: 0 });
  sim.pedalIn = !!s.pedal;
  sim.ignition = !s.off;
}

const r = v => (typeof v === 'number' && isFinite(v) ? +v.toPrecision(9) : v);
const vec = v => [r(v.x), r(v.y), r(v.z)];

/* ---- sim: sampled every 0.1 s, all events with their time ---- */
function simTrace(settings) {
  const g = load();
  const sim = new g.EngineSim();
  Object.assign(sim.settings, settings);
  const a = fakeAudio(), st = { beat: -1 }, out = { samples: [], events: [] };
  const n = Math.round(SONG_T / DT);
  for (let i = 1; i <= n; i++) {
    const t = i * DT;
    drive(a, sim, t, st);
    if (a.level < 0.004) a.silentTime += DT;
    sim.update(DT, a, t);
    for (const e of sim.takeEvents()) out.events.push([r(t), e.type, r(e.k)]);
    if (i % 3 === 0) out.samples.push([r(t), sim.state, r(sim.rpm), r(sim.boost), r(sim.temp), r(sim.flame), r(sim.throttle), r(sim.kick),
      r(sim.pedal), sim.limiter ? 1 : 0, Object.keys(sim.warn).sort().filter(k => sim.warn[k]).join(',')]);
  }
  return out;
}

/* ---- dash: a 2D context that hashes every call (static layer and live frame), so drawing changes show ---- */
function recordingCanvas(log) {
  const c = { width: 300, height: 150, style: {}, addEventListener() {} };
  const special = {
    measureText: s => ({ width: String(s).length * 7 }),
    createLinearGradient: (...a) => { log('lg', a); return { addColorStop: (...b) => log('stop', b) }; },
    createRadialGradient: (...a) => { log('rg', a); return { addColorStop: (...b) => log('stop', b) }; },
    createPattern: () => ({ setTransform() {} }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const store = { canvas: c };
  const ctx = new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : k in special ? special[k] : typeof k === 'string' ? (...a) => log(k, a) : undefined),
    set: (t, k, v) => { t[k] = v; log('=' + String(k), [v]); return true; },
  });
  c.getContext = () => ctx;
  return c;
}
function hasher() {
  let h = 2166136261 >>> 0, n = 0;
  const add = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  const fmt = v => typeof v === 'number' ? (isFinite(v) ? (Math.round(v * 1e3) / 1e3).toString() : String(v)) : typeof v === 'object' && v ? '#obj' : String(v);
  return { log(k, a) { n++; add(k + '(' + a.map(fmt).join(',') + ')'); }, get: () => ({ calls: n, hash: h.toString(16) }) };
}

function dashTrace(kind, w, h, radio) {
  const g = load();
  const H = hasher();
  g.document.createElement = () => recordingCanvas(H.log);
  g.run('Date = (D => class extends D { constructor(...a) { if (a.length) super(...a); else super(2026, 0, 1, 12, 34, 56); } static now() { return 1767270896000; } })(Date);'); // the radio clock
  let cur = H.log;   // Path2D calls go to whichever hasher is recording
  g.Path2D = class { constructor() { return new Proxy({}, { get: (t, k) => (...a) => cur('p.' + String(k), a) }); } };
  const d = new g.Dash(recordingCanvas(H.log));
  d.set({ kind, redline: kind === 'piston' ? 7500 : 7000, label: 'TEST 8', showRadio: radio });
  d.resize(w, h, 1);
  const layout = H.get();
  const sim = new g.EngineSim(); sim.settings.kind = kind; sim.settings.redline = kind === 'piston' ? 7500 : 7000;
  const a = fakeAudio({ bands: new Array(64).fill(0), peak: 0.5 }), st = { beat: -1 };
  const media = new g.MediaInfo(); if (radio && w > h) media.mock('Artist', 'A long title that has to scroll across the display');
  const odo = new g.Odometer();
  const frames = [];
  const n = Math.round(12 / DT);
  for (let i = 1; i <= n; i++) {
    const t = i * DT;
    drive(a, sim, t, st);
    for (let j = 0; j < 64; j++) a.bands[j] = a.intensity * 0.4 * (1 - j / 70) * (0.75 + 0.25 * Math.sin(t * 7 + j));
    if (a.level < 0.004) a.silentTime += DT;
    sim.update(DT, a, t);
    const H2 = hasher();
    d.c = recordingCanvas(H2.log); d.ctx = d.c.getContext('2d'); cur = H2.log;
    d.draw(sim, a, DT, t, media, odo);
    if (i % 30 === 0) frames.push(H2.get());
  }
  return { layout, keepOut: JSON.parse(JSON.stringify(d.keepOut())).map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r(v)]))), frames };
}

/* ---- scene: build stats, then the song through Engine3D.update, sampled once a second ---- */
function sceneTrace(id, n, ind) {
  const W = world({ w: 1920, h: 1080 });
  W.build(n, id, ind);
  const e = W.e, T = W.g.THREE;
  let meshes = 0, verts = 0;
  e.root.traverse(o => { if (o.isMesh || o.isInstancedMesh) { meshes++; verts += o.geometry.attributes.position ? o.geometry.attributes.position.count : 0; } });
  const P = e._fitPts; let fs = 0, fw = 0;
  for (let i = 0; i < P.length; i++) { fs += P[i]; fw += P[i] * ((i % 7) + 1); }
  const build = {
    n: e.n, meshes, verts, box: [...vec(e.box.min), ...vec(e.box.max)], fit: [P.length, r(fs), r(fw)], baseY: r(e.baseY),
    cam: vec(e.camera.position), cyls: e.cyls.map(c => [r(c.phase), c.period || 720]), stacks: (e.stacks || []).length,
    spinners: e.spinners.length, compressors: e.compressors.length,
  };
  const st = { beat: -1 }, samples = [];
  const nF = Math.round(14 / DT);
  const psum = ps => { let a = 0, s = 0, c = 0; for (let i = 0; i < ps.max; i++) if (ps.life[i] > 0) { a++; s += ps.pos[i * 3] + 2 * ps.pos[i * 3 + 1] + 3 * ps.pos[i * 3 + 2]; c += ps.col[i * 4] + ps.col[i * 4 + 1] + ps.col[i * 4 + 2] + ps.col[i * 4 + 3] + ps.size[i]; } return [a, r(s), r(c)]; };
  W.frame(nF, DT, (W2, i) => {
    drive(W.audio, W.sim, W.t, st);
    if (i % 30 === 29) {
      // sampled before this frame's update: the state the previous frame left behind
      const eng = e.eng;
      let spin = 0; e.spinners.forEach(s => { spin += s.a; });
      let comp = 0; e.compressors.forEach(c => { comp += c.rotation.x; });
      let em = 0; for (const k of Object.keys(e.mats).sort()) { const m = e.mats[k]; if (m && m.emissiveIntensity !== undefined) em += m.emissiveIntensity * (k.length); }
      const tips = []; (e.stacks || []).slice(0, 4).forEach(c => { if (c.tipW) tips.push(...vec(c.tipW)); });
      samples.push({ t: r(W.t), pos: vec(eng.position), rot: vec(eng.rotation), mountY: r(e.mountY), lift: r(e.lift), crank: r(e.crank), ct: r(e.crankTotal),
        spin: r(spin), comp: r(comp), em: r(em), light: [r(e.flameLight.intensity), ...vec(e.flameLight.position)], flash: r(e.flash), shake: r(e.shake),
        flames: psum(e.flames), smoke: psum(e.smoke), tips, cam: vec(e.camera.position) });
    }
  });
  return { build, samples };
}

function record() {
  const out = { sim: {}, dash: {}, scene: {} };
  for (const s of SIM_CASES) out.sim[JSON.stringify(s)] = simTrace(s);
  for (const k of DASH_KINDS) for (const [w, h] of [[1920, 1080], [1080, 1920]]) for (const radio of [false, true]) out.dash[`${k} ${w}x${h}${radio ? ' radio' : ''}`] = dashTrace(k, w, h, radio);
  for (const [id, n, ind] of SCENE_CASES) out.scene[`${id} ${n} ${ind}`] = sceneTrace(id, n, ind);
  return out;
}

/* list of differences (path: expected vs actual), numbers compared with a relative tolerance */
function diff(exp, act, path = '', out = [], tol = 1e-6) {
  if (out.length > 40) return out;
  if (typeof exp === 'number' && typeof act === 'number') {
    if (Math.abs(exp - act) > tol * Math.max(1, Math.abs(exp))) out.push(`${path}: ${exp} vs ${act}`);
  } else if (Array.isArray(exp) || (exp && typeof exp === 'object')) {
    if (!act || typeof act !== 'object') { out.push(`${path}: ${JSON.stringify(exp).slice(0, 80)} vs ${JSON.stringify(act)}`); return out; }
    const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);
    for (const k of keys) diff(exp[k], act[k], path + '/' + k, out, tol);
  } else if (exp !== act) out.push(`${path}: ${JSON.stringify(exp)} vs ${JSON.stringify(act)}`);
  return out;
}

module.exports = { record, diff, simTrace, dashTrace, sceneTrace, SCENE_CASES, SIM_CASES, DASH_KINDS };
