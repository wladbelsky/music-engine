/* Steam engine: a horizontal mill engine with a vertical boiler.
 *
 * Crank axis = X like every layout; the double-acting cylinders lie horizontally along +Z, each with its
 * crosshead in guide bars, connecting rod, disc crank and a slide valve worked by an eccentric. A spoked
 * flywheel sits at the rear end of the shaft, a Watt flyball governor next to the first main bearing, the
 * boiler behind and to the side with the chimney. The exhaust goes up the chimney, so every stroke is a
 * chuff of steam there; music peaks stoke the fire (sparks, thick smoke), the safety valve lifts when the
 * pressure (the dash's STEAM gauge, sim.boost) reaches the top.
 *
 * One cylinder = one entry in cyls; period 180 (two exhaust strokes per turn), so Engine3D.update counts
 * the chuffs with the same counter it uses for the exhaust pulses of a piston engine. */
(function () {
  'use strict';
  const T = THREE;
  const { DEG, clamp } = Engine3D.GEO;
  const L = EngineLayouts;

  const H = 1.65;              // shaft height (the flywheel clears the plinth)
  const CRK = 0.42, ROD = 1.55;  // crank radius, connecting rod length
  const PROD = 1.35;           // piston rod: crosshead -> piston
  const CYL_Z0 = 2.2, CYL_Z1 = 3.45, CYL_R = 0.5;
  const ECC = 0.075, LEAD = 120; // eccentric throw, angle ahead of the crank
  const VALVE_Y = H + 0.72, VALVE_Z = 1.25;
  const DZ = -1, Z = z => DZ * z;  // the cylinders lie towards -Z: crank, rods and flywheel face the camera

  class SteamLayout extends L.base {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 1, 8) : 2; }
    static label(n) { return 'STEAM ' + (['', 'SINGLE', 'TWIN'][n] || n + '-CYL'); }

    constructor(e, n) {
      super(e, n);
      this.pitch = 1.35;
      this.airFilter = false;
      this.animK = 200 / 7000 / 0.085;   // the shaft turns at the rpm the dash shows (200 at the redline)
      this.swayK = 0.2; this.smooth = true;   // a heavy engine on a foundation
      this.fitRight = 0.02;              // the front corner (cranks, plinth) is low, level with the small gauges
      this.acc = { smoke: 0, spark: 0, drain: 0, vent: 0 };
      this.vent = 0; this.fireK = 0;
    }

    banks() { return [{ tilt: 0, m: this.n, off: 0, outer: 1, hw: 0.5 }]; }
    dims() {
      this.x0 = 0.5;                                   // first cylinder line
      this.xs = []; for (let i = 0; i < this.n; i++) this.xs.push(this.x0 + i * this.pitch);
      this.xf = this.x0 - 1.05;                        // flywheel
      this.xb = this.xf - 1.65; this.zb = 1.8;         // boiler, front left
      this.frontX = this.xs[this.n - 1] + 0.4; this.rearX = this.xb - 0.9;
      this.len = this.frontX - this.rearX;
    }
    cylinders(b) {
      const n = this.n;
      // quartered cranks for a twin, evenly spread otherwise
      return this.xs.map((x, i) => ({ i, x, zo: 0, phase: i * (n === 2 ? 90 : 360 / n) }));
    }

    /* ---- small builders (engine space) ---- */
    _add(geo, mat, x, y, z, parent) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); (parent || this.eng).add(m); return m; }
    _box(w, h, d, mat, x, y, z, parent) { return this._add(new T.BoxGeometry(w, h, d), mat, x, y, z, parent); }
    _cylX(r, len, mat, x, y, z, parent, seg = 20) { const m = this._add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); m.rotation.z = Math.PI / 2; return m; }
    _cylZ(r, len, mat, x, y, z, parent, seg = 20) { const m = this._add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); m.rotation.x = Math.PI / 2; return m; }
    _cylY(r, len, mat, x, y, z, parent, seg = 20) { return this._add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z, parent); }
    _tube(pts, r, mat) { const t = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, r, 10, false), mat); this.eng.add(t); return t; }

    buildBank() {}

    /* cylinder with its valve chest, guides, crosshead, rods; the crank itself comes in buildCrank */
    buildCylinder(b, bi, cd) {
      const e = this.e, M = this.M, x = cd.x, zc = (CYL_Z0 + CYL_Z1) / 2, cl = CYL_Z1 - CYL_Z0;
      // cast bed under guides and cylinder, main bearing pedestal beside the crank
      const bh = H - CYL_R - 0.22, gh = H - 0.42 - 0.18;
      this._add(e._roundBox(0.66, bh, cl + 0.1, 0.06), M.dark2, x, 0.18 + bh / 2, Z(zc));           // cylinder saddle
      this._add(e._roundBox(0.34, gh, CYL_Z0 - 0.6, 0.05), M.dark2, x, 0.18 + gh / 2, Z((0.6 + CYL_Z0) / 2)); // girder under the guides
      this._box(0.2, H - 0.05, 0.62, M.dark2, x - 0.45, (H - 0.05) / 2 + 0.1, 0);
      this._cylX(0.15, 0.24, M.steel, x - 0.45, H, 0);
      // barrel ghosts in cutaway (edges on), covers and valve chest in the accent colour, brass lagging bands
      const barrel = this._cylZ(CYL_R, cl, M.block, x, H, Z(zc), null, 28); e._edges(barrel, this.eng, 30);
      for (const z of [CYL_Z0 - 0.05, CYL_Z1 + 0.05]) this._cylZ(CYL_R + 0.06, 0.1, M.cover, x, H, Z(z), null, 28);
      for (const z of [CYL_Z0 + 0.3, CYL_Z1 - 0.3]) this._add(new T.TorusGeometry(CYL_R + 0.005, 0.022, 6, 32), M.brass, x, H, Z(z));
      this._cylZ(0.13, 0.18, M.brass, x, H, Z(CYL_Z0 - 0.19));                         // gland
      this._box(0.46, 0.26, cl - 0.3, M.cover, x - 0.06, H + CYL_R + 0.1, Z(zc));         // valve chest
      this._box(0.5, 0.05, cl - 0.24, M.steel, x - 0.06, H + CYL_R + 0.25, Z(zc));
      for (const z of [CYL_Z0 + 0.1, CYL_Z1 - 0.1]) this._cylY(0.035, 0.12, M.brass, x, H - CYL_R - 0.03, Z(z), null, 8); // drain cocks
      // guide bars and their end brackets
      for (const s of [-1, 1]) this._box(0.14, 0.05, CYL_Z0 - 0.85, M.steel, x, H + s * 0.2, Z((0.85 + CYL_Z0) / 2));
      this._box(0.3, 0.52, 0.08, M.dark2, x, H, Z(0.85));
      // moving parts
      const piston = this._cylZ(CYL_R - 0.04, 0.18, M.piston, x, H, Z(zc), null, 24);
      const prod = this._cylZ(0.045, PROD, M.steel, x, H, 0);
      const xh = this._box(0.24, 0.34, 0.3, M.steel, x, H, 0);
      const rod = new T.Group(); this.eng.add(rod);
      this._box(0.1, ROD - 0.1, 0.13, M.steel, 0, 0, 0, rod);
      this._cylX(0.11, 0.16, M.steel, 0, -ROD / 2, 0, rod);                           // big end (at the pin)
      this._cylX(0.08, 0.14, M.steel, 0, ROD / 2, 0, rod);                            // small end (crosshead)
      // valve spindle, its guide and the eccentric rod (the sheave is on the shaft, buildCrank)
      const xv = x - 0.24;
      const spindle = this._cylZ(0.025, CYL_Z0 + 0.2 - VALVE_Z, M.steel, xv, VALVE_Y, 0);
      this._box(0.08, VALVE_Y - H + 0.1, 0.08, M.dark2, xv, (VALVE_Y + H - 0.4) / 2, Z(VALVE_Z + 0.35));
      const erod = new T.Group(); this.eng.add(erod);
      this._box(0.05, 1, 0.07, M.steel, 0, 0, 0, erod);
      return { bank: b, bi, i: cd.i, x, zo: 0, phase: cd.phase, period: 180, moving: [piston],
        piston, prod, xh, rod, spindle, erod, xv, drains: [new T.Vector3(x, H - CYL_R - 0.1, Z(CYL_Z0 + 0.1)), new T.Vector3(x, H - CYL_R - 0.1, Z(CYL_Z1 - 0.1))] };
    }

    animate(c, cyc, crank) {
      const b = (crank - c.phase) * DEG, py = CRK * Math.cos(b), pz = CRK * Math.sin(b);
      const zx = pz + DZ * Math.sqrt(ROD * ROD - py * py);                   // crosshead
      c.xh.position.z = zx;
      c.prod.position.z = zx + DZ * PROD / 2;
      c.piston.position.z = zx + DZ * PROD;
      c.rod.position.set(c.x, H + py / 2, (pz + zx) / 2);
      c.rod.rotation.x = Math.atan2(zx - pz, -py);
      c.crank.rotation.x = b;
      // slide valve: the eccentric leads the crank
      const be = b + LEAD * DEG, ey = ECC * Math.cos(be), ez = ECC * Math.sin(be);
      const vz = Z(VALVE_Z) + ez * 1.6;
      c.spindle.position.z = vz + Z(CYL_Z0 + 0.2 - VALVE_Z) / 2;
      const dy = VALVE_Y - (H + ey), dz = vz - ez;
      c.erod.position.set(c.xv, H + ey + dy / 2, ez + dz / 2);
      c.erod.rotation.x = Math.atan2(dz, dy); c.erod.scale.y = Math.hypot(dy, dz);
      c.sheave.rotation.x = be;
    }

    /* foundation plinth */
    buildCase() {
      const x0 = this.xf - 0.55, x1 = this.frontX + 0.25, z0 = Z(CYL_Z1 + 0.35), z1 = 1.3;
      this._add(this.e._roundBox(x1 - x0, 0.18, z1 - z0, 0.04), this.M.dark2, (x0 + x1) / 2, 0.09, (z0 + z1) / 2);
    }

    /* shaft, disc cranks, eccentric sheaves, flywheel with its outboard bearing */
    buildCrank(cyls) {
      const e = this.e, M = this.M, xl = this.xs[this.n - 1];
      this._mainShaft(xl + 0.3 - (this.xf - 0.6), (xl + 0.3 + this.xf - 0.6) / 2);
      const discG = new T.CylinderGeometry(0.55, 0.55, 0.12, 36), cwG = new T.CylinderGeometry(0.5, 0.5, 0.05, 24, 1, false, Math.PI / 2, Math.PI);
      cyls.forEach(c => {
        const g = new T.Group(); g.position.set(c.x + 0.16, H, 0); this.eng.add(g); c.crank = g;
        const disc = new T.Mesh(discG, M.steel); disc.rotation.z = Math.PI / 2; g.add(disc);
        const cw = new T.Mesh(cwG, M.dark2); cw.rotation.z = Math.PI / 2; cw.position.x = 0.085; g.add(cw);  // counterweight
        const pin = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.26, 12), M.steel);
        pin.rotation.z = Math.PI / 2; pin.position.set(-0.13, CRK, 0); g.add(pin);
        const sh = new T.Group(); sh.position.set(c.xv, H, 0); this.eng.add(sh); c.sheave = sh;  // eccentric
        const sv = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.09, 24), M.dark2); sv.rotation.z = Math.PI / 2; sv.position.y = ECC; sh.add(sv);
      });
      // flywheel: rim (lathe), spokes and hub in the accent colour
      const fw = new T.Group(); fw.position.set(this.xf, H, 0); this.eng.add(fw); e.spin(fw, 1);
      const rimPts = [[1.27, -0.18], [1.45, -0.16], [1.47, 0], [1.45, 0.16], [1.27, 0.18]].map(([r, y]) => new T.Vector2(r, y));
      rimPts.push(rimPts[0].clone());
      const rim = new T.Mesh(new T.LatheGeometry(rimPts, 72), M.steel); rim.rotation.z = Math.PI / 2; fw.add(rim);
      const inner = new T.Mesh(new T.CylinderGeometry(1.27, 1.27, 0.34, 72, 1, true), M.dark2); inner.rotation.z = Math.PI / 2; inner.material = M.dark2; fw.add(inner);
      for (let k = 0; k < 6; k++) {
        const sp = new T.Mesh(new T.BoxGeometry(0.1, 1.05, 0.15), M.cover);
        const a = k * Math.PI / 3; sp.position.set(0, Math.cos(a) * 0.75, Math.sin(a) * 0.75); sp.rotation.x = -a; fw.add(sp);
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.26, 0.26, 0.42, 24), M.cover); hub.rotation.z = Math.PI / 2; fw.add(hub);
      for (const s of [-1, 1]) {                         // outboard bearing and the main bearing's twin on the other side
        this._box(0.2, H - 0.05, 0.56, M.dark2, this.xf + s * 0.42, (H - 0.05) / 2 + 0.1, 0);
        this._cylX(0.15, 0.24, M.steel, this.xf + s * 0.42, H, 0);
      }
    }

    /* the boiler (the engine's "intake"): shell, firebox door, dome with the safety valve, chimney, gauge */
    buildIntake() {
      const e = this.e, M = this.M, xb = this.xb, zb = this.zb, R = 0.85;
      this._cylY(R + 0.06, 0.35, M.dark, xb, 0.175, zb, null, 36);                     // ash pit
      const shell = this._cylY(R, 2.5, M.dark2, xb, 0.35 + 1.25, zb, null, 40);
      for (const y of [0.55, 1.35, 2.15, 2.8]) this._add(new T.TorusGeometry(R + 0.005, 0.02, 6, 48), M.steel, xb, y, zb).rotation.x = Math.PI / 2;
      const top = this._add(new T.SphereGeometry(R, 40, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), M.dark2, xb, 2.85 - R * Math.cos(Math.PI * 0.32), zb);
      // chimney with a flared cap
      this._cylY(0.19, 1.55, M.dark, xb, 2.95 + 0.77, zb, null, 24);
      this._add(new T.CylinderGeometry(0.3, 0.21, 0.18, 24, 1, true), M.dark, xb, 4.55, zb).material = M.dark;
      this._add(new T.TorusGeometry(0.3, 0.025, 6, 24), M.dark, xb, 4.64, zb).rotation.x = Math.PI / 2;
      this.tipL = new T.Vector3(xb, 4.66, zb);
      // steam dome + brass safety valve (towards the engine)
      const dx = xb + 0.42;
      this._cylY(0.22, 0.34, M.dark2, dx, 3.0, zb, null, 24);
      this._add(new T.SphereGeometry(0.22, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.dark2, dx, 3.17, zb);
      this._cylY(0.06, 0.26, M.brass, dx, 3.42, zb, null, 12);
      this._cylY(0.085, 0.05, M.brass, dx, 3.56, zb, null, 12);
      const lever = this._box(0.4, 0.03, 0.03, M.brass, dx - 0.15, 3.6, zb); lever.rotation.z = -0.08;
      this.valveL = new T.Vector3(dx, 3.62, zb);
      // firebox door facing the camera side, open a crack onto the glowing grate
      const dir = new T.Vector3(0.78, 0, 1).normalize(), door = new T.Group();
      door.position.set(xb + dir.x * (R - 0.02), 0.72, zb + dir.z * (R - 0.02)); door.rotation.y = Math.atan2(dir.x, dir.z); this.eng.add(door);
      this._box(0.62, 0.54, 0.08, M.dark, 0, 0, 0.02, door);
      const fireMat = M.fire; this.fireMat = fireMat;
      this._add(new T.PlaneGeometry(0.44, 0.36), fireMat, 0, 0, 0.065, door);
      for (let k = -2; k <= 2; k++) this._box(0.03, 0.36, 0.02, M.dark, k * 0.085, 0, 0.07, door);   // grate bars
      const hinge = new T.Group(); hinge.position.set(-0.24, 0, 0.08); hinge.rotation.y = -1.25; door.add(hinge);
      this._box(0.48, 0.4, 0.04, M.dark2, 0.24, 0, 0.02, hinge);
      this._cylZ(0.035, 0.06, M.steel, 0.4, 0, 0.06, hinge, 8);                          // handle
      this.doorL = door.position.clone().addScaledVector(dir, 0.35);
      // pressure gauge and water glass on the front
      const gp = new T.Vector3(xb, 2.3, zb).addScaledVector(dir, R + 0.03), gauge = new T.Group();
      gauge.position.copy(gp); gauge.rotation.y = door.rotation.y; this.eng.add(gauge);
      this._cylZ(0.15, 0.05, M.brass, 0, 0, 0, gauge, 24);
      this._add(new T.CircleGeometry(0.125, 24), new T.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.5 }), 0, 0, 0.03, gauge);
      this.gaugeNeedle = this._box(0.012, 0.1, 0.005, M.dark, 0, 0, 0.035, gauge); this.gaugeNeedle.geometry.translate(0, 0.045, 0);
      const wg = new T.Vector3(xb, 1.55, zb).addScaledVector(new T.Vector3(1, 0, 0.35).normalize(), R + 0.05);
      this._cylY(0.03, 0.5, new T.MeshStandardMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.55, roughness: 0.1 }), wg.x, wg.y, wg.z, null, 8);
      for (const s of [-1, 1]) this._cylY(0.045, 0.06, M.brass, wg.x, wg.y + s * 0.28, wg.z, null, 8);
      // steam main: dome -> over the flywheel -> a header along the valve chests, a drop into each
      const sz = Z(CYL_Z1 - 0.4), sy = H + 1.05, hx0 = this.x0 - 0.45, hx1 = this.xs[this.n - 1] + 0.1;
      this._tube([new T.Vector3(dx + 0.2, 3.05, zb), new T.Vector3(dx + 0.7, 3.3, zb - 0.5), new T.Vector3(this.xf + 0.3, 3.35, Z(1.2)),
        new T.Vector3(hx0 - 0.1, sy + 0.1, sz + 0.25), new T.Vector3(hx0 + 0.05, sy, sz)], 0.06, M.brass);
      this._cylX(0.06, hx1 - hx0, M.brass, (hx0 + hx1) / 2, sy, sz, null, 12);
      this.xs.forEach(x => this._cylY(0.05, sy - (H + CYL_R + 0.27), M.brass, x - 0.06, (sy + H + CYL_R + 0.27) / 2, sz, null, 12));
      return null;
    }

    buildFront() {}

    /* Watt governor on a column beside the first main bearing: a spinning spindle, balls fly out with the revs */
    buildRear() {
      const e = this.e, M = this.M, gx = this.x0 - 0.2, gz = Z(-0.95), y0 = 0.18, top = H + 1.3;
      this._box(0.22, H - y0, 0.22, M.dark2, gx, y0 + (H - y0) / 2, gz);               // column
      this._box(0.3, 0.3, 0.3, M.dark2, gx, H, gz);                                    // bevel box
      this._cylZ(0.05, Math.abs(gz) - 0.15, M.steel, gx, H, gz / 2, null, 10);            // drive from the shaft
      const up = new T.Group(); up.position.set(gx, H + 0.15, gz); up.rotation.z = Math.PI / 2; this.eng.add(up); // local +X = up
      const sp = new T.Group(); up.add(sp); e.spin(sp, 1.6);
      const len = top - H - 0.15;
      const spindle = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, len, 10), M.steel); spindle.rotation.z = Math.PI / 2; spindle.position.x = len / 2; sp.add(spindle);
      const cap = new T.Mesh(new T.SphereGeometry(0.06, 12, 8), M.brass); cap.position.x = len; sp.add(cap);
      this.govArms = [];
      for (const s of [-1, 1]) {
        const arm = new T.Group(); arm.position.x = len - 0.02; sp.add(arm);
        const bar = new T.Mesh(new T.BoxGeometry(0.46, 0.025, 0.025), M.steel); bar.position.x = -0.23; arm.add(bar);
        const ball = new T.Mesh(new T.SphereGeometry(0.1, 16, 12), M.brass); ball.position.x = -0.47; arm.add(ball);
        arm.userData.s = s; this.govArms.push(arm);
      }
      this.govSleeve = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.1, 12), M.brass); this.govSleeve.rotation.z = Math.PI / 2; sp.add(this.govSleeve);
      this.govLen = len; this.gov = 0.25;
    }

    /* exhaust: one pipe per cylinder from the valve chest up into the chimney (blast pipe) */
    buildExhaust() {
      const M = this.M, xb = this.xb, zb = this.zb;
      const ez = Z(CYL_Z0 + 0.35), ey = H + 1.3, hx0 = this.x0 - 0.5, hx1 = this.xs[this.n - 1] + 0.1;
      this.xs.forEach(x => this._cylY(0.065, ey - (H + CYL_R + 0.25), M.dark2, x - 0.06, (ey + H + CYL_R + 0.25) / 2, ez, null, 12));
      this._cylX(0.08, hx1 - hx0, M.dark2, (hx0 + hx1) / 2, ey, ez, null, 12);
      this._tube([new T.Vector3(hx0 + 0.05, ey, ez), new T.Vector3(hx0 - 0.15, ey + 0.1, ez + 0.2), new T.Vector3(this.xf + 0.2, 3.75, Z(0.6)),
        new T.Vector3(xb + 0.9, 3.75, zb - 0.4), new T.Vector3(xb + 0.2, 3.55, zb)], 0.08, M.dark2);
    }

    /* ---- effects ---- */
    _w(v) { return this.eng.localToWorld(v.clone()); }
    glowPoint() { return this._w(this.doorL); }

    _chuff(k) {                                       // a puff of exhaust steam out of the chimney
      const e = this.e, tp = this._w(this.tipL), m = Math.round(2 + 3 * k);
      for (let i = 0; i < m; i++) e.smoke.spawn(tp.x, tp.y, tp.z,
        (Math.random() - 0.5) * 0.6, 2.2 + 3.5 * k + Math.random(), (Math.random() - 0.5) * 0.6,
        1.3 + Math.random() * 0.9, 0.3 + 0.2 * k + Math.random() * 0.1, 4);
    }
    _sparks(m, k) {
      const e = this.e, tp = this._w(this.tipL);
      for (let i = 0; i < m; i++) e.flames.spawn(tp.x, tp.y, tp.z, (Math.random() - 0.5) * 2.2, 3 + Math.random() * 4 * k, (Math.random() - 0.5) * 2.2,
        0.6 + Math.random() * 0.7, 0.025 + Math.random() * 0.02, 3);
    }
    _coal(m, dark) {
      const e = this.e, tp = this._w(this.tipL);
      for (let i = 0; i < m; i++) e.smoke.spawn(tp.x, tp.y, tp.z, (Math.random() - 0.5) * 0.4, 1.0 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4,
        2.4 + Math.random() * 1.5, dark ? 0.5 : 0.38, 0);
    }

    exhaustPulse(c, sim) {
      if (sim.state === 'running' || sim.state === 'stalling' || sim.state === 'cranking') this._chuff(clamp(0.25 + sim.throttle * 0.9 + sim.flame * 0.3, 0, 1.2));
    }

    fxEvent(ev, sim) {
      const e = this.e;
      if (ev.type === 'backfire') { this._chuff(1.3); this._sparks(Math.round(6 + 12 * ev.k), 1 + ev.k); e.flash = Math.max(e.flash, 0.5 + 0.5 * ev.k); e.shake = Math.max(e.shake, 0.2 * ev.k); }
      else if (ev.type === 'smoke') this._coal(Math.round(6 + 10 * ev.k), true);
      else if (ev.type === 'vent') this.vent = 1.8;
      else if (ev.type === 'start') e.rock = 1;
      return true;
    }

    updateFx(dt, sim, quality) {
      const e = this.e, on = sim.state !== 'off', run = sim.state === 'running' || sim.state === 'stalling';
      // fire: banked while the key is on, roaring with the music peaks
      const fk = on ? 0.35 + 0.45 * sim.throttle + 1.8 * sim.flame : 0.08;
      this.fireK += (fk - this.fireK) * (1 - Math.exp(-dt / 0.4));
      const flick = on ? 0.85 + 0.15 * Math.sin(e.time * 23) * Math.sin(e.time * 9.7 + 1) : 1;
      this.fireMat.emissiveIntensity = (this.fireK + e.flash * 1.5) * 1.6 * flick;
      e.flameLight.intensity = Math.max(e.flameLight.intensity, this.fireK * 1.6 * flick);
      e.time += dt;
      const acc = this.acc, lo = quality === 'low';
      // coal smoke and sparks from the chimney
      acc.smoke += dt * (on ? 1.2 + 9 * sim.flame + 2 * sim.throttle : 0) * (lo ? 0.5 : 1);
      for (; acc.smoke >= 1; acc.smoke--) this._coal(1, sim.flame > 0.3);
      acc.spark += dt * (run ? 28 * sim.flame : 0) * (lo ? 0 : 1);
      for (; acc.spark >= 1; acc.spark--) this._sparks(1, 1);
      // drain cocks blowing while starting from cold
      const draining = sim.state === 'cranking' || (sim.state === 'running' && sim.stateT < 2.5);
      acc.drain += dt * (draining ? 30 : 0);
      for (; acc.drain >= 1; acc.drain--) this.e.cyls.forEach(c => c.drains.forEach(p => {
        if (Math.random() < 0.5) return;
        const w = this._w(p);
        e.smoke.spawn(w.x, w.y, w.z, 1.6 + Math.random(), -0.7 - Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 0.7 + Math.random() * 0.5, 0.12, 4);
      }));
      // safety valve
      if (this.vent > 0) {
        this.vent -= dt; acc.vent += dt * 70;
        const w = this._w(this.valveL);
        for (; acc.vent >= 1; acc.vent--) e.smoke.spawn(w.x, w.y, w.z, (Math.random() - 0.5) * 0.7, 6 + Math.random() * 3, (Math.random() - 0.5) * 0.7, 1.0 + Math.random() * 0.7, 0.3, 4);
      }
      // governor balls fly out with the revs, the sleeve rides up
      const rn = clamp(sim.rpm / Math.max(500, sim.settings.redline || 7000), 0, 1.05);
      this.gov += ((0.25 + 0.75 * Math.sqrt(rn)) - this.gov) * (1 - Math.exp(-dt / 0.5));
      const phi = (18 + 40 * this.gov) * DEG;
      this.govArms.forEach(a => { a.rotation.z = a.userData.s * phi; });
      this.govSleeve.position.x = this.govLen - 0.47 * Math.cos(phi) * 0.6;
      // boiler pressure gauge follows the dash's STEAM gauge
      this.gaugeNeedle.rotation.z = (135 - 270 * clamp(sim.boost / 16, 0, 1)) * DEG;
    }
  }
  SteamLayout.id = 'steam';
  SteamLayout.kind = 'steam';
  SteamLayout.turbos = false; SteamLayout.blower = false;   // no forced induction
  L.register(SteamLayout);
})();
