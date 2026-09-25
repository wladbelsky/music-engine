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
  const BLOW_P = 0.1;          // cylinder cock blow-outs per turn at full flame, on top of the beats (like the marine relief valves)

  class SteamLayout extends L.base {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 1, 8) : 2; }
    static label(n) { return 'STEAM ' + (['', 'SINGLE', 'TWIN'][n] || n + '-CYL'); }

    constructor(e, n) {
      super(e, n);
      this.pitch = 1.35;
      this.airFilter = false;
      this.animK = 200 / 7000 / 0.085;   // the shaft turns at the rpm the dash shows (200 at the redline)
      this.swayK = 0.2; this.smooth = true;   // a heavy engine on a foundation: it shows the beat otherwise (updateFx)
      this.acc = { smoke: 0, spark: 0, drain: 0, vent: 0, ember: 0 };
      this.vent = 0; this.fireK = 0; this.cj = 0; this.rn = 0;
      this.blows = [];
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
      // cranks spread round the turn; double acting = two exhausts per turn, so for an even count the second half is
      // shifted by 180/n: the chuffs come evenly (twin: 0/270, quartered as usual)
      return this.xs.map((x, i) => ({ i, x, zo: 0, phase: i * 360 / n + (n % 2 === 0 && i >= n / 2 ? 180 / n : 0) }));
    }


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
      // the boiler rocks on the ash pit and the chimney whips on top of it (updateFx): pivot groups whose inner
      // group undoes the offset, so the parts inside keep engine coordinates
      const piv = (x, y, z, parent) => { const p = new T.Group(); p.position.set(x, y, z); parent.add(p); const i = new T.Group(); i.position.set(-x, -y, -z); p.add(i); return [p, i]; };
      const [bp, B] = piv(xb, 0.35, zb, this.eng), [cp, C] = piv(xb, 2.95, zb, B);
      this.boilerP = bp; this.boilerI = B; this.chimP = cp; this.chimI = C;
      const shell = this._cylY(R, 2.5, M.dark2, xb, 0.35 + 1.25, zb, B, 40);
      for (const y of [0.55, 1.35, 2.15, 2.8]) this._add(new T.TorusGeometry(R + 0.005, 0.02, 6, 48), M.steel, xb, y, zb, B).rotation.x = Math.PI / 2;
      const top = this._add(new T.SphereGeometry(R, 40, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), M.dark2, xb, 2.85 - R * Math.cos(Math.PI * 0.32), zb, B);
      // chimney with a flared cap
      this._cylY(0.19, 1.55, M.dark, xb, 2.95 + 0.77, zb, C, 24);
      this._add(new T.CylinderGeometry(0.3, 0.21, 0.18, 24, 1, true), M.dark, xb, 4.55, zb, C).material = M.dark;
      this._add(new T.TorusGeometry(0.3, 0.025, 6, 24), M.dark, xb, 4.64, zb, C).rotation.x = Math.PI / 2;
      this.tipL = new T.Vector3(xb, 4.66, zb);
      // steam dome + brass safety valve (towards the engine)
      const dx = xb + 0.42;
      this._cylY(0.22, 0.34, M.dark2, dx, 3.0, zb, B, 24);
      this._add(new T.SphereGeometry(0.22, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.dark2, dx, 3.17, zb, B);
      this._cylY(0.06, 0.26, M.brass, dx, 3.42, zb, B, 12);
      this._cylY(0.085, 0.05, M.brass, dx, 3.56, zb, B, 12);
      const lever = this._box(0.4, 0.03, 0.03, M.brass, dx - 0.15, 3.6, zb, B); lever.rotation.z = -0.08;
      this.valveL = new T.Vector3(dx, 3.62, zb);
      // firebox door facing the camera side, open a crack onto the glowing grate
      const dir = new T.Vector3(0.78, 0, 1).normalize(), door = new T.Group();
      door.position.set(xb + dir.x * (R - 0.02), 0.72, zb + dir.z * (R - 0.02)); door.rotation.y = Math.atan2(dir.x, dir.z); B.add(door);
      this._box(0.62, 0.54, 0.08, M.dark, 0, 0, 0.02, door);
      const fireMat = M.fire; this.fireMat = fireMat;
      this._add(new T.PlaneGeometry(0.44, 0.36), fireMat, 0, 0, 0.065, door);
      for (let k = -2; k <= 2; k++) this._box(0.03, 0.36, 0.02, M.dark, k * 0.085, 0, 0.07, door);   // grate bars
      const hinge = new T.Group(); hinge.position.set(-0.24, 0, 0.08); hinge.rotation.y = -1.25; door.add(hinge);
      this._box(0.48, 0.4, 0.04, M.dark2, 0.24, 0, 0.02, hinge);
      this._cylZ(0.035, 0.06, M.steel, 0.4, 0, 0.06, hinge, 8);                          // handle
      this.doorL = door.position.clone().addScaledVector(dir, 0.35);
      this.door = door;                                  // embers fly out of the grate (_embers)
      // pressure gauge and water glass on the front
      const gp = new T.Vector3(xb, 2.3, zb).addScaledVector(dir, R + 0.03), gauge = new T.Group();
      gauge.position.copy(gp); gauge.rotation.y = door.rotation.y; B.add(gauge);
      this._cylZ(0.15, 0.05, M.brass, 0, 0, 0, gauge, 24);
      this._add(new T.CircleGeometry(0.125, 24), new T.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.5 }), 0, 0, 0.03, gauge);
      this.gaugeNeedle = this._box(0.012, 0.1, 0.005, M.dark, 0, 0, 0.035, gauge); this.gaugeNeedle.geometry.translate(0, 0.045, 0);
      const wg = new T.Vector3(xb, 1.55, zb).addScaledVector(new T.Vector3(1, 0, 0.35).normalize(), R + 0.05);
      this._cylY(0.03, 0.5, new T.MeshStandardMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.55, roughness: 0.1 }), wg.x, wg.y, wg.z, B, 8);
      for (const s of [-1, 1]) this._cylY(0.045, 0.06, M.brass, wg.x, wg.y + s * 0.28, wg.z, B, 8);
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
      const sp = new T.Group(); up.add(sp); e.spin(sp, 1.6, 0, 180);   // two arms
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
    glowPoint() { return this._w(this.doorL, this.boilerI); }

    _chuff(k) {                                       // a puff of exhaust steam out of the chimney
      const e = this.e, tp = this._w(this.tipL, this.chimI), m = Math.max(1, Math.round((2 + 3 * k) * Math.min(1, 3 / this.n))); // fewer per chuff with more cylinders
      for (let i = 0; i < m; i++) e.smoke.spawn(tp.x, tp.y, tp.z,
        (Math.random() - 0.5) * 0.6, 2.2 + 3.5 * k + Math.random(), (Math.random() - 0.5) * 0.6,
        1.3 + Math.random() * 0.9, 0.3 + 0.2 * k + Math.random() * 0.1, 4);
    }
    _sparks(m, k) {
      const e = this.e, tp = this._w(this.tipL, this.chimI);
      for (let i = 0; i < m; i++) e.flames.spawn(tp.x, tp.y, tp.z, (Math.random() - 0.5) * 2.2, 3 + Math.random() * 4 * k, (Math.random() - 0.5) * 2.2,
        0.6 + Math.random() * 0.7, 0.025 + Math.random() * 0.02, 3);
    }
    _coal(m, dark) {
      const e = this.e, tp = this._w(this.tipL, this.chimI);
      for (let i = 0; i < m; i++) e.smoke.spawn(tp.x, tp.y, tp.z, (Math.random() - 0.5) * 0.4, 1.0 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4,
        2.4 + Math.random() * 1.5, dark ? 0.5 : 0.38, 0);
    }

    /* music: a cylinder's cocks blow out, a burst of steam from under the barrel (like a locomotive's), lingering a moment */
    _blow(c, k) {
      const e = this.e;
      for (const d of c.drains) {
        const w = this._w(d);
        for (let i = 0; i < Math.round(6 + 8 * k); i++) {
          const sp = 2.5 + Math.random() * 3 * (0.6 + k);   // out from under the barrel towards the crank end (the camera), fanning sideways
          e.smoke.spawn(w.x, w.y, w.z, 0.4 + (Math.random() - 0.5) * 2.4, 0.2 + Math.random() * 0.9, -DZ * sp,
            0.9 + Math.random() * 0.6, 0.28 + Math.random() * 0.2 + 0.12 * k, 4);
        }
      }
      this.blows.push({ c, t: 0.45 });
    }

    /* embers out of the firebox door: along the door's normal, up and fanning out, then falling (the boiler rocks, so via the door) */
    _embers(m, k) {
      const e = this.e, p = this._w(new T.Vector3(0, 0, 0.1), this.door), d = this._w(new T.Vector3(0, 0, 1.1), this.door).sub(p);
      for (let i = 0; i < m; i++) {
        const sp = 1.5 + Math.random() * 3 * k, up = 1.2 + Math.random() * 2.8 * k, sd = (Math.random() - 0.5) * 1.6;
        e.flames.spawn(p.x + (Math.random() - 0.5) * 0.3, p.y + (Math.random() - 0.5) * 0.25, p.z,
          d.x * sp - d.z * sd, up, d.z * sp + d.x * sd, 0.6 + Math.random() * 0.8, 0.04 + Math.random() * 0.035, 3);
      }
    }

    exhaustPulse(c, sim) {
      if (sim.state === 'running' || sim.state === 'stalling' || sim.state === 'cranking') this._chuff(clamp(0.25 + sim.throttle * 0.9 + sim.flame * 0.3, 0, 1.2));
      // hard running: now and then the cylinder that just exhausted blows its cocks (two chuffs per turn per cylinder)
      if (sim.state === 'running' && sim.flame > 0.5 && Math.random() < BLOW_P * sim.flame / (2 * this.n)) this._blow(c, 0.3 + 0.4 * sim.flame);
    }

    onEvent(ev, sim) {
      const e = this.e;
      if (ev.type === 'backfire') {
        if (ev.k > 0.4 && e.time - (this.blowT ?? -9) > 0.25) {   // beats blow a cylinder's cocks (two on a big beat)
          this.blowT = e.time;
          for (let r = 0; r < (ev.k > 0.8 ? 2 : 1); r++) this._blow(e.cyls[Math.floor(Math.random() * e.cyls.length)], ev.k);
        }
        this._chuff(1.3); this._sparks(Math.round(6 + 12 * ev.k), 1 + ev.k); this._embers(Math.round(12 + 20 * ev.k), 0.6 + ev.k); e.flash = Math.max(e.flash, 0.5 + 0.5 * ev.k); e.shake = Math.max(e.shake, 0.2 * ev.k);
      } else if (ev.type === 'smoke') this._coal(Math.round(6 + 10 * ev.k), true);
      else if (ev.type === 'vent') this.vent = 1.8;
      else if (ev.type === 'start') e.rock = 1;
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
      acc.ember += dt * (run ? 16 * sim.flame : 0) * (lo ? 0.5 : 1);   // the roaring fire spits embers out of the door
      for (; acc.ember >= 1; acc.ember--) this._embers(1, 0.5 + 0.5 * sim.flame);
      // drain cocks blowing while starting from cold
      const draining = sim.state === 'cranking' || (sim.state === 'running' && sim.stateT < 2.5);
      acc.drain += dt * (draining ? 30 * Math.min(this.n, 3) : 0);   // puffs/s for the whole engine, a random cock each
      for (; acc.drain >= 1; acc.drain--) {
        const c = e.cyls[Math.floor(Math.random() * e.cyls.length)], w = this._w(c.drains[Math.random() < 0.5 ? 0 : 1]);
        e.smoke.spawn(w.x, w.y, w.z, 1.6 + Math.random(), -0.7 - Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 0.7 + Math.random() * 0.5, 0.12, 4);
      }
      // blown cocks keep hissing for a moment
      this.blows = this.blows.filter(b => (b.t -= dt) > 0);
      for (const b of this.blows) if (!lo && Math.random() < 0.7) {
        const w = this._w(b.c.drains[Math.random() < 0.5 ? 0 : 1]);
        e.smoke.spawn(w.x, w.y, w.z, (Math.random() - 0.5) * 1.2, Math.random() * 0.6, -DZ * (1.8 + Math.random() * 1.5), 0.7 + Math.random() * 0.4, 0.2, 4);
      }
      // safety valve
      if (this.vent > 0) {
        this.vent -= dt; acc.vent += dt * 70;
        const w = this._w(this.valveL, this.boilerI);
        for (; acc.vent >= 1; acc.vent--) e.smoke.spawn(w.x, w.y, w.z, (Math.random() - 0.5) * 0.7, 6 + Math.random() * 3, (Math.random() - 0.5) * 0.7, 1.0 + Math.random() * 0.7, 0.3, 4);
      }
      // governor balls fly out with the revs, the sleeve rides up
      const rn = clamp(sim.rpm / Math.max(500, sim.settings.redline || 7000), 0, 1.05);
      this.gov += ((0.25 + 0.75 * Math.sqrt(rn)) - this.gov) * (1 - Math.exp(-dt / 0.5));
      const phi = (18 + 40 * this.gov) * DEG;
      // rhythm: a mill engine on its foundation doesn't rock, so the boiler rocks on the ash pit and the chimney whips
      // with every beat (e.jolt, the core's beat spring, sway setting included; the chimney lags a little), the governor balls jump, the
      // gauge needle twitches; the bed shudders along the cylinders (afterSway)
      const j = e.jolt;   // already scaled by the sway setting
      this.cj += (j - this.cj) * (1 - Math.exp(-dt / 0.07));
      this.boilerP.rotation.set(0.005 * j, 0, -0.008 * j);
      this.chimP.rotation.set(0.012 * this.cj, 0, -0.028 * this.cj);
      this.rn = rn;
      const phi2 = phi + clamp(0.09 * j, -0.15, 0.15);
      this.govArms.forEach(a => { a.rotation.z = a.userData.s * phi2; });
      this.govSleeve.position.x = this.govLen - 0.47 * Math.cos(phi2) * 0.6;
      // boiler pressure gauge follows the dash's STEAM gauge
      this.gaugeNeedle.rotation.z = (135 - 270 * clamp(sim.boost / 16, 0, 1)) * DEG - 0.06 * j;
    }

    /* the bed shudders along the cylinders: the reciprocating masses at shaft speed, and a shove on every beat */
    afterSway() {
      const e = this.e, sw = isFinite(e.sway) ? Math.max(0, e.sway) : 1;
      const dz = sw * 0.012 * this.rn * Math.sin(e.crank * DEG) + 0.015 * e.jolt;   // e.jolt carries the sway setting
      if (dz) { e.eng.position.z += dz; e.eng.updateMatrixWorld(true); }
    }
  }
  SteamLayout.id = 'steam';
  SteamLayout.kind = 'steam';
  SteamLayout.title = 'Steam';
  SteamLayout.turbos = false; SteamLayout.blower = false;   // no forced induction
  L.register(SteamLayout);

  /* boiler pressure, bar (the dash's STEAM gauge): the fire raises it, the engine draws it down */
  class SteamPressure {
    constructor() { this.v = 0; this.rise = 2.2; this.fall = 3.5; }
    target(sim, red) {
      const draw = sim.throttle * clamp(sim.rpm / red, 0, 1.1);
      return 10 + 6 * sim.flame + 1.6 * clamp(sim.pw - 0.4, 0, 0.6) - 1.6 * draw;   // strong peaks reach the safety valve
    }
    rest(sim) { return sim.state === 'off' ? 0 : 7.5; }   // a banked fire keeps some pressure up
  }
  EngineTypes.register({
    id: 'steam',
    redline: 7000,                   // the sim runs on the internal scale; the dash shows 200 rpm at its redline
    glow: { color: 0xff7a2a, css: [255, 120, 30] },
    sim: {
      maxBoost: 14,
      sources: () => [new SteamPressure()],
      after(sim, dt, t) {            // the safety valve lifts near the top of the gauge; blowing off drops the pressure
        if (sim.boost > sim.maxBoost * 0.97 && t - (sim._ventT ?? -99) > 3) { sim._ventT = t; sim.emit('vent', 1); for (const b of sim._src) b.v -= 1.2; }
      },
    },
    // a mill engine: redline = 200 rpm
    dash: red => ({
      tach: { max: 250, red: 200, minor: 10, half: 50, major: 50, text: String,
        title: 'RPM', map: r => r * 200 / red, digits: v => String(Math.round(v)).padStart(3, ' ') },
      left: EngineTypes.tempGauge(),
      right: { min: 0, max: 16, labels: [0, 4, 8, 12, 16], danger: 13, title: 'STEAM bar', value: s => s.boost, text: v => v.toFixed(1), rate: 10 },
      lamps: { overboost: 'SAFETY VLV' },
    }),
  });
})();
