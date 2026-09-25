/* Rocket: liquid-fuel rocket engines on a horizontal test stand.
 *
 * Axis = X like every layout: the thrust plate faces the dash (+X side), the nozzles point to -X, so the plumes
 * run off to the left like the turbojet's. `n` = engines in the cluster (1..12): one, a ring (2..4), a centre
 * engine inside a ring (5..9, 9 = 8 + 1), or an inner and an outer ring (10..12, 12 = 3 + 9; more looked silly
 * small); the engines get smaller as there are more. Each engine: bell nozzle (glows with heat), combustion chamber, injector dome,
 * gimbal block and actuators, turbopump with its gas generator exhaust beside the bell (dark, fuel-rich smoke).
 * No pistons: banks() is empty, the engines hang off the cluster group. Plumes = EngineFX.plume with shock
 * diamonds, tinted green for a moment at ignition (TEA-TEB); the start sequence chills down first (vapour),
 * the shutdown blows an oxidiser-rich cloud. Beats swing the engines on their gimbals (e.jolt).
 * sim.boost = chamber pressure (x30 bar on the dash's CHAMBER gauge). */
(function () {
  'use strict';
  const T = THREE;
  const { DEG, clamp } = Engine3D.GEO;
  const FX = EngineFX, L = EngineLayouts;

  const R_T = 0.18, R_E = 0.62, L_B = 1.6;        // throat radius, exit radius, bell length (one engine at scale 1)
  const X_GIM = 0.95;                             // gimbal point, engine-local
  const bellR = t => R_T + (R_E - R_T) * (1 - Math.pow(1 - t, 1.9));   // t = 0 throat .. 1 exit

  /* cluster positions in engine pitches: rings from the inside out, the outer ring as tight as it can be */
  function cluster(n) {
    const rings = n === 1 ? [1] : n <= 4 ? [n] : n <= 9 ? [1, n - 1] : [3, n - 3];
    const out = []; let prev = -1;
    rings.forEach((m, j) => {
      let r = m === 1 ? 0 : Math.max(prev + 1, 1 / (2 * Math.sin(Math.PI / m)));
      if (j === 0 && m > 1) r = 1 / (2 * Math.sin(Math.PI / m));
      for (let k = 0; k < m; k++) { const a = (k + (j % 2 ? 0.5 : 0)) * 2 * Math.PI / m + Math.PI / 2; out.push({ y: Math.sin(a) * r, z: Math.cos(a) * r, ring: j, outer: j === rings.length - 1 && rings.length > 1 }); }
      prev = r;
    });
    return { pos: out, R: prev };
  }

  class RocketLayout extends L.base {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 1, 12) : 1; }
    static label(n) { return n === 1 ? 'ROCKET ENGINE' : 'ROCKET ' + n + '-ENGINE'; }

    constructor(e, n) {
      super(e, n);
      this.swayK = 0.3; this.smooth = true;
      this.I = 0; this.burst = 0; this.heat = 0; this.green = 0; this.acc = { vap: 0, gg: 0 };
      this.dim = 1 / Math.sqrt(1 + 0.15 * (n - 1));
    }
    static cluster(n) { return cluster(n); }

    banks() { return []; }
    dims() {
      const c = cluster(this.n);
      this.s = this.n <= 4 ? 1 : Math.min(1, 2.3 / Math.sqrt(this.n));      // engine scale
      this.pitch = 2 * R_E * this.s * 1.1;                                   // between engine axes
      this.pos = c.pos; this.cR = c.R * this.pitch + R_E * this.s;           // cluster radius
      this.HC = this.cR + 0.7;                                               // axis height: the lowest bell clears the floor
      this.X_TP = X_GIM * this.s + 0.15;                                     // thrust frame
      this.frontX = this.X_TP + 2.4; this.rearX = -(L_B + 0.1) * this.s;   // the stand and feed lines at the front
      this.len = this.frontX - this.rearX;
    }
    get C() {                                     // the cluster group on the thrust axis
      if (!this._C) { this._C = new T.Group(); this._C.position.y = this.HC; this.eng.add(this._C); }
      return this._C;
    }
    _latheX(pts, mat, seg, parent) {             // a lathe along X from (x, r) points, front to back
      const g = new T.LatheGeometry(pts.slice().reverse().map(([x, r]) => new T.Vector2(r, x)), seg); g.rotateZ(-Math.PI / 2);
      return this._add(g, mat, 0, 0, 0, parent);
    }
    _ringX(x, r, tube, mat, parent) { const m = this._add(new T.TorusGeometry(r, tube, 6, 40), mat, x, 0, 0, parent); m.rotation.y = Math.PI / 2; return m; }

    /* the engines: shared geometry, each in a gimbal group (pivot at the gimbal block) */
    buildCrank() {
      const M = this.M, s = this.s;
      this.nozzleMat = new T.MeshStandardMaterial({ color: 0x4a3f38, metalness: 0.85, roughness: 0.45, side: T.DoubleSide, emissive: new T.Color(1.0, 0.36, 0.1), emissiveIntensity: 0 });
      this.chamberMat = new T.MeshStandardMaterial({ color: 0x3a2c24, metalness: 0.8, roughness: 0.5 });
      this.loxMat = new T.MeshStandardMaterial({ color: 0xaab4bc, metalness: 0.3, roughness: 0.75 });   // frosted oxidiser line
      const bell = []; for (let k = 0; k <= 24; k++) { const t = k / 24; bell.push([-t * L_B, bellR(t)]); }
      bell.unshift([0.02, R_T]);
      this.engines = this.pos.map((p, j) => {
        const g = new T.Group(); g.position.set(X_GIM * s, p.y * this.pitch, p.z * this.pitch); this.C.add(g);
        const k = new T.Group(); k.position.x = -X_GIM * s; k.scale.setScalar(s); g.add(k);
        this._latheX(bell, this.nozzleMat, 40, k);
        for (const t of [0.3, 0.62]) this._ringX(-t * L_B, bellR(t) + 0.012, 0.022, M.dark2, k);
        this._ringX(-L_B, R_E + 0.01, 0.035, M.steel, k);                                      // exit lip
        this._latheX([[0.66, 0.2], [0.6, 0.27], [0.22, 0.27], [0.1, 0.22], [0.02, R_T]], this.chamberMat, 28, k);   // chamber + throat
        this._add(new T.SphereGeometry(0.21, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.steel, 0.64, 0, 0, k).rotation.z = -Math.PI / 2;   // injector dome
        this._box(0.16, 0.2, 0.2, M.dark2, X_GIM - 0.08, 0, 0, k);                              // gimbal block
        const e = { g, k, p, j, ggL: null };
        {
          // turbopump beside the chamber, its gas generator exhaust along the bell, propellant lines, actuators
          const side = p.y >= 0 ? 1 : -1;
          this._cylX(0.11, 0.42, M.steel, 0.42, side * 0.42, 0, k, 16);
          this._cylX(0.15, 0.12, M.turboHot, 0.18, side * 0.42, 0, k, 18);
          const gg = [new T.Vector3(0.12, side * 0.42, 0), new T.Vector3(-0.2, side * 0.48, 0.06), new T.Vector3(-L_B * 0.55, side * (bellR(0.55) + 0.1), 0.1), new T.Vector3(-L_B * 0.95, side * (R_E + 0.1), 0.12)];
          this._tube(gg, 0.05, M.dark2, k);
          e.ggL = gg[3].clone().add(new T.Vector3(-0.05, 0, 0));
          this._tube([new T.Vector3(X_GIM, side * 0.14, 0.18), new T.Vector3(0.75, side * 0.3, 0.2), new T.Vector3(0.55, side * 0.38, 0.1)], 0.045, this.loxMat, k);
          this._tube([new T.Vector3(X_GIM, side * 0.14, -0.18), new T.Vector3(0.7, side * 0.3, -0.2), new T.Vector3(0.36, side * 0.4, -0.08)], 0.04, M.dark2, k);
          this._tube([new T.Vector3(0.62, side * 0.4, -0.05), new T.Vector3(0.62, side * 0.25, -0.15), new T.Vector3(0.5, 0.18, -0.2)], 0.03, M.steel, k);
          for (const [ay, az] of [[0.36, 0], [0, 0.36]]) this._tube([new T.Vector3(X_GIM, ay, az), new T.Vector3(0.28, ay * 0.8, az * 0.8)], 0.028, M.cover, k);   // gimbal actuators
        }
        return e;
      });
    }

    /* open thrust frame (a ring with spokes to the thrust cone, so the engines show through), the stand, and the
       feed lines coming in from the tank farm behind (+X), on the far side */
    buildCase() {
      const M = this.M, C = this.C, X = this.X_TP, R = this.cR + 0.25, hub = Math.max(0.35, R * 0.28);
      this._ringX(X, R, 0.09, M.dark2, C);
      this._ringX(X + 0.02, R + 0.07, 0.03, M.cover, C);
      for (let k = 0; k < 6; k++) {                                                            // spokes
        const a = (k + 0.5) * Math.PI / 3, g = new T.Group(); g.position.x = X; g.rotation.x = a; C.add(g);
        this._box(0.12, R - hub, 0.14, M.dark2, 0, (R + hub) / 2, 0, g);
      }
      this._cylX(hub, 0.24, M.dark2, X, 0, 0, C, 24);
      this._latheX([[X + 1.0, hub * 0.9], [X + 0.12, hub * 1.25]], M.steel, 28, C);              // thrust cone
      this._cylX(hub, 0.45, M.dark2, X + 1.22, 0, 0, C, 24);                                     // take-out block / load cell
      const fy = -this.HC, zp = R + 0.35, top = R * 0.55 + 0.3, x = X + 0.9;
      for (const s of [-1, 1]) {
        this._box(0.2, this.HC + top, 0.2, M.dark, x, fy + (this.HC + top) / 2, s * zp, C);    // posts
        this._box(0.9, 0.16, 0.16, M.dark, x - 0.45, 0, s * (R + 0.1), C);                      // arms to the ring
        this._box(0.16, 0.16, zp - R, M.dark, x, 0, s * (R + (zp - R) / 2), C);
        this._box(2.6, 0.14, 0.26, M.dark, x + 0.6, fy + 0.07, s * zp, C);                      // base beams
        const h = this.HC + top - 0.1, br = this._box(0.13, Math.hypot(1.5, h), 0.13, M.dark, x + 0.75, fy + h / 2 + 0.05, s * zp, C);
        br.rotation.z = Math.atan2(1.5, h);                                                     // diagonal brace
      }
      this._box(0.2, 0.2, 2 * zp + 0.2, M.dark, x, top, 0, C);                                  // top beam
      this._box(0.45, this.HC - hub, 0.55, M.dark2, X + 1.22, fy + (this.HC - hub) / 2, 0, C);  // load cell pedestal
      // feed lines from behind, on the far side: oxidiser (frosted) and fuel into the thrust cone
      const r = 0.1 * Math.max(1, R / 2.5);
      this._tube([new T.Vector3(X + 1.6, fy + r, -zp - 0.2), new T.Vector3(X + 1.55, -hub * 0.2, -zp * 0.75), new T.Vector3(X + 0.9, hub * 0.2, -hub * 1.1), new T.Vector3(X + 0.6, hub * 0.3, -hub * 0.4)], r, this.loxMat, C);
      this._tube([new T.Vector3(X + 2.0, fy + r, -zp - 0.2), new T.Vector3(X + 1.95, -hub * 0.5, -zp * 0.7), new T.Vector3(X + 1.1, -hub * 0.35, -hub * 1.1), new T.Vector3(X + 0.6, -hub * 0.3, -hub * 0.4)], r * 0.85, M.dark2, C);
    }

    /* one plume per engine (world space) */
    buildExhaust() {
      this.plumes = this.engines.map(() => FX.plume(this.e.noise, this.e.root, { len: 3, width: 1.8 * this.s, diam: 1.1 * this.s }));
    }

    /* ---- effects ---- */
    frameBox(box) { box.min.x -= 0.6; }                 // a little room for the plumes
    _exitW(en, d = 0) { return en.k.localToWorld(new T.Vector3(-L_B - d, 0, 0)); }
    _dirW(en) { return new T.Vector3(-1, 0, 0).applyQuaternion(en.g.getWorldQuaternion(new T.Quaternion())); }
    glowPoint() {
      const en = this.engines[0], p = this._exitW(en);
      return this.I > 0.02 ? p.addScaledVector(this._dirW(en), 1.2 * this.s) : p;
    }

    _spawnAt(en, m, fn) { for (let i = 0; i < m; i++) fn(this._exitW(en), this._dirW(en)); }
    _vapour(en, m) {                              // chill-down / oxidiser-rich vapour out of a nozzle
      const e = this.e, s = this.s;
      this._spawnAt(en, m, (p, d) => e.smoke.spawn(p.x + (Math.random() - 0.5) * R_E * s, p.y + (Math.random() - 0.5) * R_E * s, p.z + (Math.random() - 0.5) * R_E * s,
        d.x * (0.4 + Math.random()), -0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5, 1.2 + Math.random(), (0.3 + Math.random() * 0.2) * Math.max(0.6, s), FX.P.STEAM));
    }
    _debris(en, m, k) {
      const e = this.e;
      this._spawnAt(en, m, (p, d) => e.flames.spawn(p.x, p.y, p.z, d.x * (5 + Math.random() * 6) * k, (Math.random() - 0.4) * 2.5, (Math.random() - 0.5) * 2.5,
        0.4 + Math.random() * 0.4, 0.03 + Math.random() * 0.02, FX.P.SPARK));
    }

    onEvent(ev, sim) {
      const e = this.e, few = this.engines.length > 9 ? this.engines.filter((x, i) => i % 3 === 0) : this.engines;
      if (ev.type === 'backfire') {                 // chamber pressure spike: the plumes flare, debris flies
        this.burst = Math.max(this.burst, 0.35 + 0.6 * ev.k);
        if (ev.k > 0.5) { few.forEach(en => this._debris(en, Math.round(2 + 4 * ev.k), 1 + ev.k)); e.flash = Math.max(e.flash, 0.4 + 0.5 * ev.k); e.shake = Math.max(e.shake, 0.15 + 0.35 * ev.k); }
      } else if (ev.type === 'start') {            // TEA-TEB ignition: a green flash, the plume lights hard
        e.rock = 1; this.green = 1; this.burst = Math.max(this.burst, 0.8); e.flash = Math.max(e.flash, 0.6);
      } else if (ev.type === 'smoke') few.forEach(en => this._vapour(en, Math.round(3 + 5 * ev.k)));   // oxidiser-rich cutoff cloud
    }

    updateFx(dt, sim, quality) {
      const e = this.e, st = sim.state, sw = isFinite(e.sway) ? Math.max(0, e.sway) : 1;
      e.time += dt;
      const crankT = (EngineTypes.get('rocket').sim.crank || {}).time || 1.6;
      // thrust: minimum throttle at idle, full with load, flares with music peaks; ignition at the end of the start
      const tgt = st === 'running' ? 0.42 + 0.5 * sim.throttle + 0.9 * sim.flame + this.burst
        : st === 'stalling' ? 0.3 * clamp(1 - sim.stateT / 1.2, 0, 1) : st === 'cranking' && sim.stateT > crankT - 0.2 ? 0.5 : 0;
      this.burst *= Math.exp(-dt / 0.22);
      this.I += (tgt - this.I) * (1 - Math.exp(-dt / (tgt > this.I ? 0.06 : 0.3)));
      if (!isFinite(this.I)) this.I = 0;
      this.green *= Math.exp(-dt / 0.35);
      this.heat += ((this.I > 0.05 ? 0.25 + 0.55 * clamp(this.I, 0, 1.4) : 0) - this.heat) * (1 - Math.exp(-dt / 2));
      this.nozzleMat.emissiveIntensity = this.heat;
      const I = this.I, flick = 0.9 + 0.1 * Math.sin(e.time * 31) * Math.sin(e.time * 12.7), s = this.s;
      // gimbals: every beat swings the engines (outer ones more), with a slow steering wander while firing
      this.engines.forEach(en => {
        const w = en.p.ring === 0 && this.engines.length > 1 && !en.p.outer ? 0.5 : 1, ph = en.j * 1.7;
        en.g.rotation.set(0, (0.03 * e.jolt * Math.cos(ph) + 0.01 * sw * I * Math.sin(e.time * 0.9 + ph)) * w, (0.03 * e.jolt * Math.sin(ph) + 0.01 * sw * I * Math.sin(e.time * 0.7 + ph * 1.3)) * w);
      });
      this.C.updateMatrixWorld(true);
      // plumes
      const tint = [1 - 0.65 * this.green, 1 + 0.7 * this.green, 1 - 0.55 * this.green];
      this.engines.forEach((en, i) => {
        const pl = this.plumes[i], u = pl.material.uniforms;
        pl.visible = I > 0.02;
        if (!pl.visible) return;
        u.uOrigin.value.copy(this._exitW(en, -0.02)); u.uDir.value.copy(this._dirW(en)); u.uTime.value = e.time + i * 0.37;
        u.uInt.value = Math.min(1.6, I) * flick * this.dim;      // overlapping plumes add up: dimmer each in a big cluster
        u.uLen.value = (2.4 + 4.2 * Math.min(1.4, I)) * s;
        u.uWidth.value = 1.9 * 2 * R_E * s * (1 + 0.08 * Math.min(1.4, I));
        u.uDiam.value = 1.15 * s;
        u.uTint.value.setRGB(tint[0], tint[1], tint[2]);
        if (quality !== 'low' && i % 3 === 0 && Math.random() < dt * 5 * I) this._debris(en, 1, 0.7 + I * 0.5);
      });
      e.flameLight.intensity = Math.max(e.flameLight.intensity, I * 3.2 * flick);
      if (this.green > 0.05) e.flameLight.color.setRGB(1 - 0.7 * this.green, 1, 1 - 0.6 * this.green); else e.flameLight.color.setHex(0xffa050);
      // start sequence: chill-down vapour out of the nozzles until ignition
      const acc = this.acc, few = this.engines.length > 9 ? 4 : this.engines.length;
      acc.vap += dt * (st === 'cranking' && sim.stateT < crankT - 0.3 ? 18 : 0);
      for (; acc.vap >= 1; acc.vap--) this._vapour(this.engines[Math.floor(Math.random() * few)], 1);
      // gas generator exhaust: dark, fuel-rich smoke beside each bell
      acc.gg += dt * (st === 'running' ? (2 + 4 * I) * this.engines.length : 0) * (quality === 'low' ? 0.4 : 1);
      for (; acc.gg >= 1; acc.gg--) {
        const en = this.engines[Math.floor(Math.random() * this.engines.length)]; if (!en.ggL) continue;
        const p = en.k.localToWorld(en.ggL.clone()), d = this._dirW(en);
        e.smoke.spawn(p.x, p.y, p.z, d.x * (1.5 + Math.random()), 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 0.8, (0.22 + Math.random() * 0.1) * s, FX.P.FIRE);
      }
    }
  }
  RocketLayout.id = 'rocket';
  RocketLayout.kind = 'rocket';
  RocketLayout.title = 'Rocket';
  RocketLayout.turbos = false; RocketLayout.blower = false;
  L.register(RocketLayout);

  /* chamber pressure, x30 bar (the dash's CHAMBER gauge): quick; a little overshoot as it lights */
  class ChamberPressure {
    constructor() { this.v = 0; this.rise = 0.15; this.fall = 0.4; }
    target(sim) { return 3.2 + 5.2 * sim.throttle + 1.2 * sim.flame; }
    rest(sim) {
      if (sim.state === 'cranking') return sim.stateT > 1.3 ? 4 + 8 * (sim.stateT - 1.3) : 0;   // lights just before the start
      return sim.state === 'stalling' ? 0.6 : 0;
    }
  }
  const IDLE = () => window.ENGINE_IDLE || 850;
  EngineTypes.register({
    id: 'rocket',
    redline: 7000,                     // internal scale; the dash shows thrust in %
    glow: { color: 0xffa050, css: [255, 150, 70] },
    sim: {
      maxBoost: 9.2,                   // CHAMBER HIGH from 257 bar
      sources: () => [new ChamberPressure()],
      crank: { time: 1.6, rpm: 300, wobble: 0, rise: 3, fire: 1400 },   // chill-down, then ignition
      stall: { rpm: 200, stumble: 0, pops: false },
    },
    // thrust: minimum throttle 40 % at idle, 100 % at the (internal) redline
    dash: red => ({
      tach: { max: 110, red: 100, minor: 2, half: 10, major: 20, text: String, title: 'THRUST %',
        map: r => r <= IDLE() ? r / IDLE() * 40 : 40 + (r - IDLE()) / Math.max(1, red - IDLE()) * 60, digits: v => String(Math.round(v)).padStart(3, ' ') },
      left: EngineTypes.tempGauge('TURBOPUMP °C'),
      right: { min: 0, max: 10, labels: [0, 2, 4, 6, 8, 10], danger: 8.8, title: 'CHAMBER bar', value: s => s.boost,
        label: v => String(v * 30), text: v => String(Math.round(v * 30)), rate: 10 },
      lamps: { stall: 'CUTOFF', battery: 'IGNITER', overboost: 'CHAMBER HIGH', oil: 'TANK PRESS', redline: 'MAX THRUST', lowrpm: 'LOW THRUST', check: 'HOLD' },
    }),
  });
})();
