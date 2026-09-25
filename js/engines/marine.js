/* Marine diesel: a slow two-stroke crosshead engine, as in a ship's engine room.
 *
 * Crank axis = X like every layout (front = +X, the chain case end). Bottom to top: bedplate with the main
 * bearings, the frame box (ghosts in cutaway) with A-frames between the cylinders and the crosshead guides,
 * the cylinder frame, the jackets, the covers (accent colour) with the exhaust valves and their hydraulic
 * actuators. Each cylinder is a vertical slider-crank with a crosshead: crank pin -> connecting rod -> crosshead
 * in its guides -> piston rod -> piston. Two-stroke: period 360, every cylinder fires once per turn.
 * The exhaust valves feed a receiver on the far side (-Z), which drives the turbocharger at the front end; the
 * compressor feeds the scavenge air receiver below it through the air cooler, with two auxiliary blowers that
 * run while the scavenge air is low. Platforms with yellow railings on the camera side give it scale.
 * sim.boost = scavenge air pressure (the dash's SCAV AIR gauge). Starting on air blows the indicator cocks;
 * music peaks make black smoke and soot sparks, big beats lift a cylinder relief valve (a flame out sideways). */
(function () {
  'use strict';
  const T = THREE;
  const { DEG, clamp, firingOrder } = Engine3D.GEO;
  const FX = EngineFX, L = EngineLayouts;

  const PITCH = 1.05;                 // cylinder spacing
  const H = 1.3, CRK = 0.5, ROD = 2.0, PROD = 2.15;  // crank axis height, crank radius, connecting rod, piston rod
  const Y_BED = 0.95, Y_FR = 4.25, Y_CF = 5.0, Y_JK = 6.6;    // tops of: bedplate, frame box, cylinder frame, jackets
  const R_CYL = 0.38, R_JK = 0.46;    // bore, jacket
  const Y_COV = Y_JK + 0.28;          // top of the cylinder covers
  const Z_R = -1.5;                   // receivers on the far side
  const Y_EXR = 6.35, R_EXR = 0.44;   // exhaust receiver
  const Y_SCR = 4.65, R_SCR = 0.46;   // scavenge air receiver
  const Z_PL = 1.25, W_PL = 0.62;     // platforms on the camera side (inner edge, width)

  /* firing order: a cycle through all cylinders in which no two neighbours fire one after the other (none exists
     for 4: then the usual order), found by depth-first search from cylinder 0 */
  function marineOrder(n) {
    const seq = [0], used = new Array(n).fill(false); used[0] = true;
    const go = () => {
      if (seq.length === n) return Math.abs(seq[n - 1] - seq[0]) !== 1;
      for (let i = 0; i < n; i++) if (!used[i] && Math.abs(i - seq[seq.length - 1]) !== 1) {
        used[i] = true; seq.push(i); if (go()) return true; seq.pop(); used[i] = false;
      }
      return false;
    };
    return n >= 5 && go() ? seq : firingOrder(n);
  }

  class MarineLayout extends L.base {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 4, 12) : 6; }
    static label(n) { return 'MARINE DIESEL ' + n + '-CYL'; }

    constructor(e, n) {
      super(e, n);
      this.animK = 120 / 7000 / 0.085;    // the shaft turns at the rpm the dash shows (120 at the redline)
      this.swayK = 0.12; this.smooth = true;
      this.acc = { smoke: 0, cock: 0, spark: 0 };
      this.rn = 0; this.aux = 0; this.relief = 0;
    }
    _mats() {
      if (this.paint) return;
      this.paint = new T.MeshStandardMaterial({ color: 0x2c3731, metalness: 0.15, roughness: 0.7 });   // engine-room green-grey
      this.yellow = new T.MeshStandardMaterial({ color: 0xe8b516, metalness: 0.2, roughness: 0.5 });
      this.grating = new T.MeshStandardMaterial({ color: 0x121315, metalness: 0.2, roughness: 0.9 });
      this.lagging = new T.MeshStandardMaterial({ color: 0x8f938f, metalness: 0.5, roughness: 0.55 });  // clad exhaust piping
    }

    banks() { return [{ tilt: 0, m: this.n, off: 0, outer: 1, hw: 0.9 }]; }
    dims() {
      this.xs = []; for (let i = 0; i < this.n; i++) this.xs.push((i - (this.n - 1) / 2) * PITCH);
      this.x0 = this.xs[0] - PITCH / 2; this.x1 = this.xs[this.n - 1] + PITCH / 2;   // ends of the cylinder row
      this.frontX = this.x1 + 0.45; this.rearX = this.x0 - 0.55;
      this.len = this.frontX - this.rearX;
    }
    cylinders() {
      const order = marineOrder(this.n);
      return this.xs.map((x, i) => ({ i, x, zo: 0, phase: order.indexOf(i) * 360 / this.n }));
    }

    /* one cylinder: jacket, piston + rod + crosshead + connecting rod, cover with exhaust valve and actuator,
       indicator cock, relief valve; the throw comes in buildCrank */
    buildCylinder(b, bi, cd) {
      this._mats();
      const e = this.e, M = this.M, x = cd.x;
      const jk = this._cylY(R_JK, Y_JK - Y_CF, M.block, x, (Y_CF + Y_JK) / 2, 0, null, 28); e._edges(jk, this.eng, 30);
      this._add(new T.TorusGeometry(R_JK + 0.005, 0.025, 6, 28), M.steel, x, Y_JK - 0.25, 0).rotation.x = Math.PI / 2;
      // cover: accent, exhaust valve housing, actuator on top, fuel valves, indicator cock and relief valve on the camera side
      this._cylY(R_JK + 0.04, 0.28, M.cover, x, Y_JK + 0.14, 0, null, 28);
      this._cylY(0.2, 0.42, M.dark2, x, Y_COV + 0.21, 0, null, 18);
      const act = this._box(0.26, 0.2, 0.3, M.dark2, x, Y_COV + 0.52, 0);
      const spindle = this._cylY(0.05, 0.3, M.steel, x, Y_COV + 0.72, 0, null, 10);
      for (const s of [-1, 1]) this._cylY(0.045, 0.22, M.steel, x + s * 0.24, Y_COV + 0.08, -0.12, null, 8);
      this._cylZ(0.035, 0.18, M.brass, x - 0.12, Y_COV - 0.06, R_JK + 0.1, null, 8);             // indicator cock
      this._cylZ(0.07, 0.2, M.steel, x + 0.14, Y_COV - 0.1, R_JK + 0.12, null, 12);              // relief valve
      // exhaust branch to the receiver, lagged
      this._tube([new T.Vector3(x, Y_COV + 0.3, -0.16), new T.Vector3(x, Y_COV + 0.3, -0.7), new T.Vector3(x, Y_EXR + 0.2, Z_R + 0.3)], 0.13, this.lagging);
      // moving: piston, piston rod, crosshead, connecting rod (shown in cutaway)
      const piston = this._cylY(R_CYL, 0.34, M.piston, x, 0, 0, null, 24);
      const prod = this._cylY(0.07, PROD, M.steel, x, 0, 0, null, 12);
      const xh = new T.Group(); this.eng.add(xh);
      this._box(0.3, 0.26, 0.9, M.steel, 0, 0, 0, xh);                                            // crosshead with its shoes
      for (const s of [-1, 1]) this._box(0.34, 0.34, 0.1, M.dark2, 0, 0, s * 0.47, xh);
      const rod = new T.Group(); this.eng.add(rod);
      this._box(0.14, ROD - 0.2, 0.2, M.steel, 0, 0, 0, rod);
      this._cylX(0.16, 0.24, M.steel, 0, -ROD / 2, 0, rod, 14);                                   // big end
      this._cylX(0.12, 0.34, M.steel, 0, ROD / 2, 0, rod, 12);                                     // small end at the crosshead pin
      return { bank: b, bi, i: cd.i, x, zo: 0, phase: cd.phase, period: 360, moving: [piston, prod, xh, rod], piston, prod, xh, rod, spindle, act,
        cock: new T.Vector3(x - 0.12, Y_COV - 0.06, R_JK + 0.2), reliefL: new T.Vector3(x + 0.14, Y_COV - 0.1, R_JK + 0.24) };
    }

    /* vertical slider-crank with a crosshead; the exhaust valve lifts by its cam (open ~110..250 deg after TDC) */
    animate(c, cyc) {
      const b = cyc / 2 * DEG, py = CRK * Math.cos(b), pz = CRK * Math.sin(b);
      const dy = Math.sqrt(ROD * ROD - pz * pz), y = H + py + dy;                  // crosshead pin height
      c.xh.position.set(c.x, y, 0);
      c.prod.position.set(c.x, y + PROD / 2, 0);
      c.piston.position.set(c.x, y + PROD + 0.17, 0);
      c.rod.position.set(c.x, H + py + dy / 2, pz / 2);
      c.rod.rotation.x = Math.atan2(-pz, dy);
      c.throwG.rotation.x = b;
      const deg = cyc / 2, lift = deg > 110 && deg < 250 ? Math.sin(Math.PI * (deg - 110) / 140) : 0;
      c.spindle.position.y = Y_COV + 0.72 + 0.12 * lift;
    }

    /* bedplate, frame box (ghost), A-frames, crosshead guides, cylinder frame, chain case, platforms, ladder */
    buildCase() {
      this._mats();
      const e = this.e, M = this.M, len = this.x1 - this.x0, xm = (this.x0 + this.x1) / 2;
      this._add(e._roundBox(len + 0.9, Y_BED, 2.5, 0.06), this.paint, xm - 0.05, Y_BED / 2, 0);
      for (const s of [-1, 1]) this._box(len + 0.9, 0.12, 0.25, this.paint, xm - 0.05, 0.06, s * 1.35);   // holding-down flanges
      const fb = this._box(len + 0.1, Y_FR - Y_BED, 2.0, M.block, xm, (Y_BED + Y_FR) / 2, 0); e._edges(fb, this.eng, 30);
      const cf = this._box(len + 0.1, Y_CF - Y_FR, 1.9, M.block, xm, (Y_FR + Y_CF) / 2, 0); e._edges(cf, this.eng, 30);
      // A-frames between the cylinders (and at both ends) on both sides, crosshead guides per cylinder
      for (let i = 0; i <= this.n; i++) for (const s of [-1, 1]) {
        const x = this.x0 + i * PITCH;
        this._box(0.18, Y_FR - Y_BED, 0.16, this.paint, x, (Y_BED + Y_FR) / 2, s * 1.02);
        const d = this._box(0.12, 1.3, 0.14, this.paint, x, Y_BED + 0.75, s * 0.9); d.rotation.x = s * 0.18;
      }
      const gy0 = H + ROD - CRK - 0.25, gy1 = H + ROD + CRK + 0.3;
      this.xs.forEach(x => { for (const s of [-1, 1]) this._box(0.44, gy1 - gy0, 0.06, M.steel, x, (gy0 + gy1) / 2, s * 0.56); });
      // crankcase doors on the camera side
      this.xs.forEach(x => { const d = this._cylZ(0.26, 0.04, M.dark2, x, 1.9, 1.02, null, 20); d.scale.set(1, 1.35, 1); });
      // chain case at the front end
      this._box(0.42, Y_CF - Y_BED + 0.2, 1.6, this.paint, this.x1 + 0.24, (Y_BED + Y_CF) / 2 + 0.1, 0);
      this._box(0.05, 1.8, 1.0, M.cover, this.x1 + 0.47, Y_BED + 1.8, 0);
      // platforms with gratings and railings on the camera side, a ladder at the back end
      for (const y of [H + ROD + 0.1, Y_CF + 0.05]) {
        this._box(len + 0.4, 0.05, W_PL, this.grating, xm, y, Z_PL + W_PL / 2);
        const zr = Z_PL + W_PL - 0.03, posts = Math.max(2, Math.round((len + 0.4) / 1.1)) + 1;
        for (let k = 0; k < posts; k++) this._cylY(0.025, 0.95, this.yellow, this.x0 - 0.2 + k * (len + 0.4) / (posts - 1), y + 0.5, zr, null, 6);
        for (const hy of [0.5, 0.95]) this._cylX(0.025, len + 0.4, this.yellow, xm, y + hy, zr, null, 6);
        for (let k = 0; k < this.n; k++) this._box(0.04, 0.2, W_PL - 0.05, this.grating, this.xs[k], y - 0.12, Z_PL + W_PL / 2);   // brackets
      }
      const lx = this.x0 - 0.3, lz = Z_PL + W_PL / 2, ltop = Y_CF + 0.05;
      for (const s of [-1, 1]) this._box(0.05, ltop + 0.9, 0.05, this.yellow, lx, (ltop + 0.9) / 2, lz + s * 0.22);
      for (let y = 0.3; y < ltop; y += 0.3) this._cylZ(0.018, 0.44, this.yellow, lx, y, lz, null, 6);
    }

    /* crankshaft: main shaft, big webs per throw, the flywheel and the turning gear at the back end */
    buildCrank(cyls) {
      const M = this.M;
      this._mainShaft(this.frontX - this.rearX + 0.2, (this.frontX + this.rearX) / 2 - 0.1, H);
      const webG = new T.BoxGeometry(0.12, CRK + 0.6, 0.62), pinG = new T.CylinderGeometry(0.15, 0.15, 0.4, 14);
      cyls.forEach(c => {
        const g = new T.Group(); g.position.set(c.x, H, 0); this.eng.add(g); c.throwG = g; c.moving.push(g);
        for (const s of [-1, 1]) { const w = new T.Mesh(webG, M.steel); w.position.set(s * 0.2, (CRK - 0.35) / 2, 0); g.add(w); }
        const pin = new T.Mesh(pinG, M.steel); pin.rotation.z = Math.PI / 2; pin.position.y = CRK; g.add(pin);
      });
      // flywheel with its turning gear
      const fw = new T.Group(); fw.position.set(this.x0 - 0.3, H, 0); this.eng.add(fw); this.e.spin(fw, 1);
      const disc = new T.Mesh(new T.CylinderGeometry(1.15, 1.15, 0.3, 64), M.steel); disc.rotation.z = Math.PI / 2; fw.add(disc);
      for (let k = 0; k < 12; k++) {                                                          // turning holes / marks
        const a = k * Math.PI / 6, m = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.32, 10), M.dark); m.rotation.z = Math.PI / 2; m.position.set(0, Math.cos(a) * 0.95, Math.sin(a) * 0.95); fw.add(m);
      }
      const mark = new T.Mesh(new T.BoxGeometry(0.32, 0.3, 0.06), M.cover); mark.position.y = 0.55; fw.add(mark);
      this._box(0.4, 0.4, 0.5, this.paint, this.x0 - 0.3, 0.2, -1.2);
      this._cylX(0.18, 0.5, M.dark2, this.x0 - 0.3, 0.55, -1.2, null, 16);                       // turning gear motor
    }

    /* receivers, turbocharger, air cooler, auxiliary blowers, uptake */
    buildIntake() {
      const e = this.e, M = this.M, len = this.x1 - this.x0, xm = (this.x0 + this.x1) / 2, xt = this.x1 + 0.95;
      // exhaust receiver (lagged) and scavenge air receiver on the far side, on brackets
      this._cylX(R_EXR, len + 0.3, this.lagging, xm, Y_EXR, Z_R, null, 28);
      for (const x of [this.x0 - 0.15, this.x1 + 0.15]) this._add(new T.SphereGeometry(R_EXR, 20, 12), this.lagging, x, Y_EXR, Z_R);
      this._cylX(R_SCR, len + 0.2, this.paint, xm, Y_SCR, Z_R, null, 28);
      this.xs.forEach(x => { this._box(0.12, Y_EXR - Y_SCR - R_EXR - R_SCR + 0.1, 0.12, this.paint, x, (Y_EXR + Y_SCR) / 2, Z_R); this._box(0.12, 0.12, 0.5, this.paint, x, Y_SCR, Z_R + 0.55); });
      // turbocharger at the front end: turbine (hot), compressor, intake silencer facing the camera end
      this._tube([new T.Vector3(this.x1 + 0.1, Y_EXR, Z_R), new T.Vector3(this.x1 + 0.5, Y_EXR + 0.1, Z_R), new T.Vector3(xt - 0.1, Y_EXR + 0.45, Z_R)], 0.3, this.lagging);
      this._cylX(0.52, 0.55, M.turboHot, xt, Y_EXR + 0.45, Z_R, null, 28);
      this._cylX(0.4, 0.3, M.dark2, xt + 0.42, Y_EXR + 0.45, Z_R, null, 24);                     // bearing casing
      this._cylX(0.62, 0.5, M.turbo, xt + 0.82, Y_EXR + 0.45, Z_R, null, 32);                     // compressor housing
      const sil = this._cylX(0.72, 0.6, M.dark2, xt + 1.35, Y_EXR + 0.45, Z_R, null, 32);
      for (let k = 0; k < 4; k++) this._add(new T.TorusGeometry(0.72, 0.02, 6, 32), M.steel, xt + 1.1 + k * 0.16, Y_EXR + 0.45, Z_R).rotation.y = Math.PI / 2;
      // compressor wheel in the silencer mouth, spun by the scavenge air (Engine3D.compressors)
      const wheel = new T.Group(); wheel.position.set(xt + 1.66, Y_EXR + 0.45, Z_R); this.eng.add(wheel); e.compressors.push(wheel);
      for (let k = 0; k < 8; k++) { const bl = new T.Mesh(new T.BoxGeometry(0.03, 0.5, 0.14), M.steel); bl.position.y = 0.3; const p = new T.Group(); p.rotation.x = k * Math.PI / 4; p.add(bl); bl.rotation.y = 0.5; wheel.add(p); }
      this._cylX(0.14, 0.08, M.cover, 0.02, 0, 0, wheel, 14);
      this._cylX(0.66, 0.02, M.dark, xt + 1.62, Y_EXR + 0.45, Z_R, null, 32);                    // dark throat behind the wheel
      // compressor outlet -> air cooler -> scavenge receiver
      this._tube([new T.Vector3(xt + 0.82, Y_EXR, Z_R + 0.35), new T.Vector3(xt + 0.7, Y_SCR + 0.8, Z_R + 0.4), new T.Vector3(this.x1 + 0.5, Y_SCR + 0.35, Z_R + 0.1)], 0.26, M.turbo);
      this._box(0.9, 0.9, 1.0, this.paint, this.x1 + 0.5, Y_SCR - 0.1, Z_R);
      // auxiliary blowers on the scavenge receiver: fan wheels in a scroll, turned by their own motors
      this.auxFans = [];
      for (const x of [xm - len * 0.25, xm + len * 0.25]) {
        this._cylZ(0.34, 0.22, M.dark2, x, Y_SCR - R_SCR - 0.2, Z_R - 0.45, null, 24);
        this._cylZ(0.16, 0.34, this.paint, x, Y_SCR - R_SCR - 0.2, Z_R - 0.8, null, 16);
        const f = new T.Group(); f.position.set(x, Y_SCR - R_SCR - 0.2, Z_R - 0.33); this.eng.add(f);
        for (let k = 0; k < 6; k++) { const bl = new T.Mesh(new T.BoxGeometry(0.03, 0.26, 0.04), M.steel); bl.position.y = 0.15; const p = new T.Group(); p.rotation.z = k * Math.PI / 3; p.add(bl); f.add(p); }
        this.auxFans.push(f);
      }
      // uptake: turbine outlet up to the funnel
      const ux = xt - 0.05, uy0 = Y_EXR + 0.95;
      this._cylY(0.36, 0.3, M.dark2, ux, uy0 - 0.15, Z_R, null, 20);
      this._cylY(0.42, 1.6, this.lagging, ux, uy0 + 0.8, Z_R, null, 24);
      this._add(new T.TorusGeometry(0.42, 0.04, 6, 24), M.dark, ux, uy0 + 1.6, Z_R).rotation.x = Math.PI / 2;
      this.tipL = new T.Vector3(ux, uy0 + 1.62, Z_R);
      return null;
    }

    buildFront() {}
    buildRear() {}
    buildExhaust() {}

    /* ---- effects ---- */
    glowPoint() { return this._w(this.tipL); }

    _puff(m, k, kind, dark) {                          // smoke out of the funnel
      const e = this.e, tp = this._w(this.tipL);
      for (let i = 0; i < m; i++) e.smoke.spawn(tp.x, tp.y, tp.z, (Math.random() - 0.5) * 0.5, 1.4 + 2.2 * k + Math.random() * 0.6, (Math.random() - 0.5) * 0.5,
        2.2 + Math.random() * 1.4, (dark ? 0.55 : 0.4) + 0.25 * k + Math.random() * 0.12, kind);
    }
    _soot(m, k) {
      const e = this.e, tp = this._w(this.tipL);
      for (let i = 0; i < m; i++) e.flames.spawn(tp.x, tp.y, tp.z, (Math.random() - 0.5) * 1.6, 2.5 + Math.random() * 3.5 * k, (Math.random() - 0.5) * 1.6,
        0.6 + Math.random() * 0.7, 0.025 + Math.random() * 0.02, FX.P.SPARK);
    }

    /* every exhaust valve opening: a puff up the funnel, heavier and darker with load and music peaks */
    exhaustPulse(c, sim) {
      if (!(sim.state === 'running' || sim.state === 'stalling')) return;
      const k = clamp(0.2 + 0.6 * sim.throttle + 0.8 * sim.flame, 0, 1.4), m = Math.max(1, Math.round((1 + 2 * k) * Math.min(1, 6 / this.n)));
      this._puff(m, k, FX.P.FIRE, sim.flame > 0.3);
      if (sim.flame > 0.3 && Math.random() < 0.4 * sim.flame) this._soot(1 + Math.round(2 * sim.flame), 1 + sim.flame);
    }

    onEvent(ev, sim) {
      const e = this.e;
      if (ev.type === 'backfire') {
        if (ev.k > 0.4) {                               // a cylinder relief valve lifts: a flame out sideways, a bang
          const c = e.cyls[Math.floor(Math.random() * e.cyls.length)], p = this._w(c.reliefL), d = new T.Vector3(0.2, 0.25, 1).applyQuaternion(this.eng.quaternion).normalize();
          for (let i = 0; i < Math.round(6 + 10 * ev.k); i++) {
            const sp = 2 + Math.random() * 3 * (1 + ev.k);
            e.flames.spawn(p.x, p.y, p.z, d.x * sp + (Math.random() - 0.5), d.y * sp + (Math.random() - 0.5), d.z * sp + (Math.random() - 0.5) * 0.5,
              0.3 + Math.random() * 0.25, 0.35 + Math.random() * 0.25, FX.P.FIREBALL);
          }
          for (let i = 0; i < 4; i++) e.smoke.spawn(p.x, p.y, p.z, d.x * 1.5, 0.8 + Math.random(), d.z * 1.5, 1.6 + Math.random(), 0.45, FX.P.FIRE);
          e.flash = Math.max(e.flash, 0.5 + 0.5 * ev.k); e.shake = Math.max(e.shake, 0.2 + 0.4 * ev.k);
          this.reliefC = c; this.relief = 0.5;
        }
        this._puff(Math.round(2 + 4 * ev.k), 1, FX.P.FIRE, true);
        this._soot(Math.round(3 + 6 * ev.k), 1 + ev.k);
      } else if (ev.type === 'smoke') this._puff(Math.round(5 + 8 * ev.k), 0.6, FX.P.FIRE, true);
      else if (ev.type === 'start') {                   // the starting air shuts off, fuel on: a white burst from every cock
        e.rock = 1;
        e.cyls.forEach(c => { const p = this._w(c.cock); for (let i = 0; i < 2; i++) e.smoke.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 1.5 + Math.random(), 0.8 + Math.random() * 0.5, 0.18, FX.P.STEAM); });
      }
    }

    updateFx(dt, sim, quality) {
      const e = this.e, on = sim.state !== 'off', run = sim.state === 'running' || sim.state === 'stalling';
      e.time += dt;
      const acc = this.acc, lo = quality === 'low';
      // a haze of exhaust from the funnel while it runs
      acc.smoke += dt * (run ? 1 + 5 * sim.flame : 0) * (lo ? 0.5 : 1);
      for (; acc.smoke >= 1; acc.smoke--) this._puff(1, 0.3, FX.P.FIRE, sim.flame > 0.4);
      acc.spark += dt * (run ? 18 * Math.max(0, sim.flame - 0.2) : 0) * (lo ? 0 : 1);
      for (; acc.spark >= 1; acc.spark--) this._soot(1, 1);
      // starting on air: the indicator cocks blow (a random cock each puff)
      acc.cock += dt * (sim.state === 'cranking' ? 28 : 0);
      for (; acc.cock >= 1; acc.cock--) {
        const c = e.cyls[Math.floor(Math.random() * e.cyls.length)], p = this._w(c.cock);
        e.smoke.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.3, 0.2 + Math.random() * 0.3, 1.2 + Math.random() * 0.8, 0.6 + Math.random() * 0.4, 0.12, FX.P.STEAM);
      }
      // the relief valve's flame licks on for a moment
      if (this.relief > 0) {
        this.relief -= dt;
        if (!lo && Math.random() < 0.6) {
          const p = this._w(this.reliefC.reliefL);
          e.flames.spawn(p.x, p.y, p.z, (Math.random() - 0.3) * 0.6, 0.6 + Math.random(), 1.5 + Math.random() * 1.5, 0.25, 0.25 + Math.random() * 0.15, FX.P.FIRE);
        }
      }
      // auxiliary blowers: run while the scavenge air is low, coast down after (step capped: 6 blades)
      const auxT = on && sim.boost < 0.45 ? 1 : 0;
      this.aux += (auxT - this.aux) * (1 - Math.exp(-dt / (auxT > this.aux ? 0.8 : 1.5)));
      this.auxFans.forEach(f => { f.rotation.z += Math.min(dt * this.aux * 30, 0.4 * Math.PI / 3); });
      this.rn = clamp(sim.rpm / Math.max(500, sim.settings.redline || 7000), 0, 1.1);
    }

    /* axial shudder: the crankshaft's axial vibration at shaft speed, and a shove along the shaft on every beat */
    afterSway() {
      const e = this.e, sw = isFinite(e.sway) ? Math.max(0, e.sway) : 1;
      const dx = sw * 0.01 * this.rn * Math.sin(e.crank * DEG * 2) + 0.02 * e.jolt;   // e.jolt carries the sway setting
      if (dx) { e.eng.position.x += dx; e.eng.updateMatrixWorld(true); }
    }
  }
  MarineLayout.id = 'marine';
  MarineLayout.kind = 'marine';
  MarineLayout.title = 'Marine diesel';
  MarineLayout.turbos = false; MarineLayout.blower = false;   // it has its own turbocharger and blowers
  L.register(MarineLayout);

  /* scavenge air pressure, bar (the dash's SCAV AIR gauge): turbocharged, so it lags and needs revs and load;
     the auxiliary blowers hold a little while the key is on */
  class ScavengeAir {
    constructor() { this.v = 0; this.rise = 1.5; this.fall = 0.7; }
    target(sim, red) { return 0.25 + 3.2 * clamp(sim.throttle * 1.1, 0, 1) * clamp((sim.rpm - 1200) / Math.max(500, red * 0.8 - 1200), 0, 1) + 0.3 * sim.flame; }
    rest(sim) { return sim.state === 'off' ? 0 : 0.2; }
  }
  EngineTypes.register({
    id: 'marine',
    redline: 7000,                     // internal scale; the dash shows 120 rpm at its redline
    glow: { color: 0xff7a2a, css: [255, 120, 30] },
    sim: {
      maxBoost: 3.6,                   // SCAV HIGH from 3.35 bar
      sources: () => [new ScavengeAir()],
      crank: { time: 1.8, rpm: 900, wobble: 60, rise: 4, fire: 1100 },   // turned over on starting air, slowly
      stall: { rpm: 300, stumble: 200, pops: false },
    },
    dash: red => ({
      tach: { max: 140, red: 120, minor: 5, half: 10, major: 20, text: String, title: 'RPM',
        map: r => r * 120 / red, digits: v => String(Math.round(v)).padStart(3, ' ') },
      left: EngineTypes.tempGauge('JACKET °C'),
      right: { min: 0, max: 4, labels: [0, 1, 2, 3, 4], danger: 3.4, title: 'SCAV AIR bar', value: s => s.boost, text: v => v.toFixed(2), rate: 6 },
      lamps: { stall: 'SHUTDOWN', battery: 'START AIR', oil: 'LUB OIL', redline: 'OVERSPEED', overboost: 'SCAV HIGH', check: 'ALARM' },
    }),
  });
})();
