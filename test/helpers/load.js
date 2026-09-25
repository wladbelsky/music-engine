/* Loads the wallpaper's plain scripts (IIFEs that export to `window`) into a Node vm context.
 * No DOM and no WebGL: THREE.WebGLRenderer / PMREMGenerator are replaced by stubs, 2D canvases get a
 * context that accepts every call, localStorage is an in-memory Map. Everything else (the THREE scene
 * graph, matrices, geometry, the sim, the dash layout) is the real code. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* every layout id, from the WE `layout` combo (project.test.js checks it against the registry) */
const LAYOUT_IDS = JSON.parse(read('project.json')).general.properties.layout.options.map(o => o.value);

/* script order from index.html (js/…), so the tests load exactly what the page loads */
function scriptOrder() {
  return [...read('index.html').matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
}

/* 2D context that swallows everything; enough for Dash/Background to lay out and "draw" */
function null2d(canvas) {
  const store = { canvas };
  const special = {
    measureText: s => ({ width: String(s).length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const noop = () => {};
  return new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : k in special ? special[k] : typeof k === 'string' ? noop : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

function fakeCanvas() {
  const c = { width: 300, height: 150, style: {}, addEventListener() {} };
  const ctx = null2d(c);
  c.getContext = () => ctx;
  return c;
}

class MemoryStorage {
  constructor() { this.m = new Map(); this.broken = false; }
  _chk() { if (this.broken) throw new Error('SecurityError: storage disabled'); }
  getItem(k) { this._chk(); return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this._chk(); this.m.set(k, String(v)); }
  removeItem(k) { this._chk(); this.m.delete(k); }
  clear() { this._chk(); this.m.clear(); }
}

/* deterministic Math.random (mulberry32) so failures reproduce */
const SEEDED = `(function(){ let a = __SEED__ >>> 0; Math.random = function(){ a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;

const STUBS = `
  THREE.WebGLRenderer = class {
    constructor(o) { this.domElement = (o && o.canvas) || {}; this.shadowMap = { enabled: false }; this.pr = 1;
      this.info = { render: { calls: 0, triangles: 0 }, programs: [] }; this.renders = 0; }
    setClearColor() {} setPixelRatio(p) { this.pr = p; } getPixelRatio() { return this.pr; }
    setSize(w, h) { this.size = [w, h]; } render() { this.renders++; } dispose() {}
  };
  THREE.PMREMGenerator = class { fromScene() { return { texture: null }; } dispose() {} };
`;

/**
 * load({ scripts, seed }) -> the vm global (also `window`).
 * scripts: list of paths (default: everything index.html loads except main.js, which needs the page).
 * The returned context has helpers: ctx.clock.ms (performance.now), ctx.localStorage (MemoryStorage),
 * ctx.run(code, timeoutMs) to evaluate code inside it.
 */
function load({ scripts, seed = 12345 } = {}) {
  const clock = { ms: 0 };
  const g = {
    console, clock,
    performance: { now: () => clock.ms },
    localStorage: new MemoryStorage(),
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0,
    document: { createElement: () => fakeCanvas(), addEventListener() {}, getElementById: () => null },
    Image: class { set src(v) { this._src = v; } },
  };
  g.window = g; g.self = g; g.globalThis = g;
  vm.createContext(g);
  vm.runInContext(SEEDED.replace('__SEED__', String(seed)), g);
  const list = scripts || scriptOrder().filter(s => !/main\.js$/.test(s));
  for (const f of list) {
    new vm.Script(read(f), { filename: path.join(ROOT, f) }).runInContext(g);
    if (/three(\.min)?\.js$/.test(f)) vm.runInContext(STUBS, g);
  }
  g.run = (code, timeout) => vm.runInContext(code, g, timeout ? { timeout } : undefined); // timeout (ms) also stops endless loops
  g.fakeCanvas = fakeCanvas;
  return g;
}

module.exports = { load, scriptOrder, fakeCanvas, MemoryStorage, ROOT, read, LAYOUT_IDS };
