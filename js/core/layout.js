/* Engine registries and the layout base class. The core (sim, 3D, dash, main) knows no engine by name: an
 * engine *type* describes behaviour and instruments, a *layout* class builds and animates the 3D model.
 *
 * Adding an engine = one file in js/engines/ that calls EngineTypes.register({...}) (unless it reuses a type)
 * and EngineLayouts.register(cls), a <script> line in index.html before dash.js, and `npm run sync:project`
 * (the `layout` combo and the property conditions in project.json come from these registries).
 *
 * Type description (EngineTypes.register):
 *   id              the key: layout static `kind`, sim.settings.kind, Dash.set({kind})
 *   redline         fixed internal redline the sim runs at (the dash converts), or null = the user's rev limiter
 *   glow            { color: 0xrrggbb (flame light), css: [r, g, b] (glow on the background) }
 *   sim.maxBoost    top of the right gauge's channel (sim.boost); the OVERBOOST lamp lights at 0.93 of it
 *   sim.sources(settings, maxBoost) -> [{v, rise, fall, target(sim, red), rest?(sim)}]  what drives sim.boost
 *   sim.after(sim, dt, t)   optional, once per update after the boost (extra events: steam's safety valve)
 *   sim.crank / sim.stall   optional overrides of the start and stall behaviour (js/core/sim.js CRANK / STALL)
 *   dash(red) -> { tach, left, right, lamps }  scales and labels (js/core/dash.js draws them)
 *
 * Layout class (EngineLayouts.register): extends BaseLayout (or a relative) with statics
 *   id, kind, title (combo label), normCyl(n), label(n) (dash plate), turbos/blower (forced induction it can carry). */
(function () {
  'use strict';
  const T = THREE;
  const MAX_CYL = 32;

  /* ------------------------------------------------------------ engine types */
  const TYPES = {};
  const EngineTypes = {
    register(desc) { TYPES[desc.id] = desc; return desc; },
    get(id) { return TYPES[id] || TYPES.piston; },     // unknown kinds behave like a piston engine
    ids() { return Object.keys(TYPES); },
    /* the usual left gauge: coolant temperature 60..130, red from 110 */
    tempGauge(title = 'TEMP °C') {
      return { title, min: 60, max: 130, labels: [60, 80, 100, 120], danger: 110, value: s => s.temp, text: v => Math.round(v), rate: 4 };
    },
  };

  /* ------------------------------------------------------------ layout base */
  /* Every hook Engine3D calls, with do-nothing defaults, plus small builders. Coordinates: crank / main axis
     = X (front = +X, towards the dash), up = +Y. */
  class BaseLayout {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? Math.max(1, Math.min(MAX_CYL, v)) : 8; }
    static label(n) { return String(n); }

    constructor(e, n) {
      this.e = e; this.n = n; this.M = e.mats;
      this.airFilter = false; // an air filter on the throttle body (induction.js)
      this.animK = 1;         // visual shaft speed factor (a steam engine turns slowly)
      this.swayK = 1;         // vibration / roll factor
      this.smooth = false;    // true: no lumpy idle (turbine)
    }
    get eng() { return this.e.eng; }

    /* ---- build (in this order, see Engine3D.build) ---- */
    banks() { return []; }              // [{tilt, m, off, outer, hw}]: groups of cylinders rotated about X
    dims(banks) {}                      // must set frontX, rearX
    buildBank(b, bi) {}
    cylinders(b, bi) { return []; }     // [{i, x, zo, phase}]
    buildCylinder(b, bi, cd) { throw new Error('buildCylinder() not implemented'); } // -> the cylinder record (see Engine3D.update)
    buildCase() {}
    buildCrank(cyls) {}
    buildIntake(cyls) { return null; }
    buildFront(plen) {}
    buildRear() {}
    buildExhaust(cyls) {}
    finish() {}

    /* ---- per frame ---- */
    animate(c, cyc, crank) {}           // pose cylinder c at cycle angle cyc (0..720)
    cylinderFx(c, glow, sim) {}         // combustion glow of cylinder c (0..1)
    exhaustPulse(c, sim) {}             // an exhaust opening of cylinder c
    onEvent(ev, sim) {                  // sim events: backfire, smoke, bov, start, vent...
      if (ev.type === 'start') this.e.rock = 1;
    }
    updateFx(dt, sim, quality) { this.e.time += dt; }   // effects; must advance e.time
    afterSway() {}                      // world-space positions of effect origins, after the rocking
    glowPoint() { return null; }        // world space: flame light, background glow
    frameBox(box) {}                    // widen the framing box for effects

    /* ---- small builders (engine space) ---- */
    _add(geo, mat, x, y, z, parent) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); (parent || this.eng).add(m); return m; }
    _box(w, h, d, mat, x, y, z, parent) { return this._add(new T.BoxGeometry(w, h, d), mat, x, y, z, parent); }
    _cylX(r, len, mat, x, y, z, parent, seg = 20) { const m = this._add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); m.rotation.z = Math.PI / 2; return m; }
    _cylZ(r, len, mat, x, y, z, parent, seg = 20) { const m = this._add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); m.rotation.x = Math.PI / 2; return m; }
    _cylY(r, len, mat, x, y, z, parent, seg = 20) { return this._add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); }
    _tube(pts, r, mat, parent) { const t = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, r, 10, false), mat); (parent || this.eng).add(t); return t; }
    _w(v, obj) { return (obj || this.eng).localToWorld(v.clone()); }   // local point -> world
    /* crank / eccentric shaft along X, turning with the crank */
    _mainShaft(len, x = 0, y = 0) {
      const shaft = new T.Group(); shaft.position.y = y; this.eng.add(shaft); this.e.spin(shaft, 1);
      const main = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, len, 16), this.M.steel);
      main.rotation.z = Math.PI / 2; main.position.x = x; shaft.add(main);
      return main;
    }
  }
  BaseLayout.kind = 'piston';
  BaseLayout.turbos = false; BaseLayout.blower = false;

  /* ------------------------------------------------------------ layouts */
  const LAYOUTS = {}, ORDER = [];
  const DEFAULT = 'v';
  const EngineLayouts = {
    MAX_CYL,
    base: BaseLayout,
    get(id) { return (Object.prototype.hasOwnProperty.call(LAYOUTS, id) && LAYOUTS[id]) || LAYOUTS[DEFAULT]; }, // unknown values fall back to V
    register(cls) { if (!LAYOUTS[cls.id]) ORDER.push(cls.id); LAYOUTS[cls.id] = cls; this[cls.id] = cls; return cls; },
    ids() { return ORDER.slice(); },                 // registration order = the combo order
    list() { return ORDER.map(id => LAYOUTS[id]); },
    type(id) { return EngineTypes.get(this.get(id).kind); },
  };

  window.EngineTypes = EngineTypes;
  window.EngineLayouts = EngineLayouts;
})();
