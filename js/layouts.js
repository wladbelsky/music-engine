/* Engine layouts. Each layout is a class that builds the engine-specific geometry through hooks called
 * by Engine3D.build(); the cylinders, kinematics, stacks and flames are shared (js/engine3d.js).
 *
 * To add a layout: subclass EngineLayout (or a close relative), set `static id`, `normCyl`, `label`,
 * override the hooks that differ, add it to LAYOUTS below and to the `layout` combo in project.json
 * and the dev panel in index.html.
 *
 * Coordinates: crank axis = X (front = +X), up = +Y. A bank is a group rotated about X by `tilt`;
 * inside it the bores point along +Y and `outer` (+1/-1) is the exhaust side along bank-local Z. */
(function () {
  'use strict';
  const T = THREE;
  const { P, CR, BORE, DECK, DEG, clamp, firingOrder } = Engine3D.GEO;
  const MAX_CYL = 32;
  // any input -> integer 1..MAX_CYL (non-numeric -> 8)
  const cap = n => { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 1, MAX_CYL) : 8; };
  const evenUp = n => Math.max(2, n + (n % 2));
  const ROTOR_TDC = 270;   // rotary: shaft angle at which a rotor face is at TDC on the spark plug side

  class EngineLayout {
    static normCyl(n) { return cap(n); }
    static label(n) { return String(n); }

    constructor(e, n) {
      this.e = e; this.n = n; this.M = e.mats;
      this.pitch = P;         // cylinder spacing along the crank
      this.lift = 0;          // extra bore height (longer rods), used by the radial
      this.airFilter = true;  // naturally aspirated -> air filter on the throttle body
    }
    get eng() { return this.e.eng; }

    /* ---- geometry description ---- */
    banks() { throw new Error('banks() not implemented'); }
    dims(banks) {
      this.len = banks[0].m * this.pitch + (banks.length > 1 ? 0.42 : 0) + 0.3;
      this.frontX = this.len / 2; this.rearX = -this.len / 2;
    }
    zOffset(i) { return 0; }            // bore offset from the crank plane (staggered rows)
    cylinders(b, bi) {
      const order = firingOrder(this.e.banks[0].m), nb = this.e.banks.length, out = [];
      for (let i = 0; i < b.m; i++) {
        const slot = order.indexOf(i) * nb + bi;
        out.push({ i, x: (i - (b.m - 1) / 2) * this.pitch + b.off, zo: this.zOffset(i), phase: slot * 720 / this.n });
      }
      return out;
    }

    /* ---- numbers the generic builders use ---- */
    ccW() { return 1.1; }               // crankcase width
    get caseY() { return -0.2; }
    get panY() { return -0.88; }
    plenum() { throw new Error('plenum() not implemented'); } // {pos, size}
    frontTopY() { return DECK; }
    coverD() { return 0.9; }            // timing cover depth
    sidePulleyZ() { return -0.62; }
    topY() { return DECK + 0.95; }      // height the exhaust stacks rise to
    turboMount() { return null; }       // {s, tx, tz, gap, sides, along: second column along the block (else outward)}
    blowerMount(plen) {                 // bottom centre of a Roots blower sitting on the plenum
      if (!plen) return null;
      return { x: plen.pos.x, y: plen.pos.y + plen.size[1] / 2, z: plen.pos.z, len: clamp(this.len * 0.55, 1.1, 3.2) };
    }

    /* ---- builders ---- */
    buildCylinder(b, bi, cd) { return this.e._cylinder(b, bi, cd, this); } // liner, piston, rod, coil

    /* per-frame motion of one cylinder: slider-crank; zo = bore offset from the crank plane (W rows) */
    animate(c, cyc) {
      const beta = cyc * DEG;
      const py = CR * Math.cos(beta), pz = CR * Math.sin(beta);
      const dz = c.zo - pz, dy = Math.sqrt(c.rodL * c.rodL - dz * dz), s = py + dy;
      c.piston.position.set(c.x, s + 0.08, c.zo);
      c.rod.position.set(c.x, (s + py) / 2, (pz + c.zo) / 2);
      c.rod.rotation.x = Math.atan2(dz, dy);
      c.throwG.rotation.x = (cyc + c.bank.tilt) * DEG;
    }

    buildBank(b) {
      const e = this.e, M = this.M, grp = b.grp, bl = b.m * this.pitch + 0.28, W = 2 * b.hw;
      const block = new T.Mesh(new T.BoxGeometry(bl, DECK - 0.3, W), M.block);
      block.position.set(b.off, 0.3 + (DECK - 0.3) / 2, 0); grp.add(block);
      e._edges(block, grp);
      const head = new T.Mesh(new T.BoxGeometry(bl - 0.04, 0.46, W + 0.02), M.head);
      head.position.set(b.off, DECK + 0.23, 0); head.castShadow = true; grp.add(head);
      const cover = new T.Mesh(e._roundBox(bl - 0.16, 0.32, W - 0.14, 0.1), M.cover);
      cover.position.set(b.off, DECK + 0.46 + 0.16, 0); cover.castShadow = true; grp.add(cover);
      for (let r = -1; r <= 1; r++) {
        const rib = new T.Mesh(new T.BoxGeometry(bl - 0.4, 0.04, 0.05), M.head);
        rib.position.set(b.off, DECK + 0.795, r * b.hw * 0.48); grp.add(rib);
      }
    }

    buildCase() {
      const e = this.e, M = this.M, len = this.len, ccW = this.ccW();
      const cc = new T.Mesh(new T.BoxGeometry(len - 0.05, 0.95, ccW), M.block);
      cc.position.set(0, this.caseY, 0); this.eng.add(cc); e._edges(cc, this.eng);
      const pan = new T.Mesh(e._roundBox(len - 0.3, 0.42, ccW * 0.85, 0.08), M.dark2);
      pan.position.set(-0.1, this.panY, 0); pan.castShadow = true; this.eng.add(pan);
    }

    /* crank / eccentric shaft along X, turning with the crank */
    _mainShaft(len, x = 0) {
      const shaft = new T.Group(); this.eng.add(shaft); this.e.spin(shaft, 1);
      const main = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, len, 16), this.M.steel);
      main.rotation.z = Math.PI / 2; main.position.x = x; shaft.add(main);
    }
    buildCrank(cyls) {
      this._mainShaft(this.len + 0.3);
      cyls.forEach(c => { c.throwG = this._throw(c.x); c.moving.push(c.throwG); });
    }
    _throw(x) {
      const M = this.M, throwG = new T.Group(); throwG.position.x = x; this.eng.add(throwG);
      const pin = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.26, 12), M.steel);
      pin.rotation.z = Math.PI / 2; pin.position.y = CR; throwG.add(pin);
      for (const s of [-1, 1]) {
        const web = new T.Mesh(new T.BoxGeometry(0.07, CR + 0.42, 0.34), M.steel);
        web.position.set(s * 0.15, (CR - 0.3) / 2, 0); throwG.add(web);
      }
      return throwG;
    }

    buildIntake(cyls) {
      const e = this.e, M = this.M, eng = this.eng;
      const { pos: plenPos, size: plenSize } = this.plenum();
      const plen = new T.Mesh(e._roundBox(plenSize[0], plenSize[1], plenSize[2], 0.12), this.plenumMat());
      plen.position.copy(plenPos); plen.castShadow = true; eng.add(plen);
      // throttle body at the front (a blower carries its own throttles on top)
      if (!e.ind.blower) {
        const tb = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.3, 24), M.steel);
        tb.rotation.z = Math.PI / 2; tb.position.set(plenPos.x + plenSize[0] / 2 + 0.15, plenPos.y, plenPos.z); eng.add(tb);
      }
      cyls.forEach(c => {
        const a = e._toEng(c.bank, c.intake);
        const outDir = e._toEng(c.bank, new T.Vector3(0, 0, -c.bank.outer)).sub(e._toEng(c.bank, new T.Vector3())).normalize();
        const b = new T.Vector3(a.x, plenPos.y - plenSize[1] * 0.2, plenPos.z + Math.sign(a.z - plenPos.z) * plenSize[2] * 0.35);
        const curve = new T.CatmullRomCurve3(this.runnerPath(a, outDir, b));
        const tube = new T.Mesh(new T.TubeGeometry(curve, 16, 0.085, 10, false), M.head);
        tube.castShadow = true; eng.add(tube);
      });
      e.tbPos = new T.Vector3(plenPos.x + plenSize[0] / 2 + 0.3, plenPos.y, plenPos.z);
      return { pos: plenPos, size: plenSize };
    }

    runnerPath(a, outDir, b) { return [a, a.clone().addScaledVector(outDir, 0.25), b]; } // port -> plenum
    plenumMat() { return this.M.head; }

    buildFront() {
      const e = this.e, M = this.M, fx = this.frontX, topY = this.frontTopY();
      const cover = new T.Mesh(new T.BoxGeometry(0.08, topY + 0.6, this.coverD()), M.dark2);
      cover.position.set(fx + 0.02, (topY + 0.6) / 2 - 0.5, 0); this.eng.add(cover);
      e._pulley(0.36, fx + 0.14, 0, 0, 1);
      this.crankPulley = { x: fx + 0.14, y: 0, z: 0, r: 0.36 };
      if (!e.ind.blower) e._pulley(0.22, fx + 0.14, Math.min(topY, 1.1), 0, 1.6); // the blower belt runs there
      e._pulley(0.15, fx + 0.14, 0.55, this.sidePulleyZ(), 2.4);
    }

    buildRear() {
      const e = this.e, M = this.M;
      const fw = new T.Group(); fw.position.x = this.rearX - 0.12; this.eng.add(fw); e.spin(fw, 1);
      const disc = new T.Mesh(new T.CylinderGeometry(0.85, 0.85, 0.12, 48), M.steel); disc.rotation.z = Math.PI / 2; disc.castShadow = true; fw.add(disc);
      for (let k = 0; k < 6; k++) {
        const bolt = new T.Mesh(new T.BoxGeometry(0.04, 0.12, 0.12), M.dark);
        bolt.position.set(0.07, Math.cos(k * Math.PI / 3) * 0.55, Math.sin(k * Math.PI / 3) * 0.55); fw.add(bolt);
      }
    }

    /* zoomie stack: out of the port, up past the top of the engine, tip slightly back */
    stackPath(c) {
      const e = this.e, b = c.bank, p0 = e._toEng(b, c.port);
      const o = e._toEng(b, new T.Vector3());
      const out = e._toEng(b, new T.Vector3(0, 0, b.outer)).sub(o).normalize();
      const up = new T.Vector3(0, 1, 0);
      const outH = new T.Vector3(0, 0, Math.sign(out.z) || 1);
      const p1 = p0.clone().addScaledVector(outH, 0.24).addScaledVector(up, -0.02);
      const p2 = p1.clone().addScaledVector(outH, 0.1).addScaledVector(up, 0.3);
      return this._stackTail(p0, p1, p2);
    }
    _stackTail(p0, p1, p2) {
      const up = new T.Vector3(0, 1, 0), back = new T.Vector3(-1, 0, 0);
      const rise = Math.max(0.45, (this.topY() + 0.2) - p2.y);
      const p3 = p2.clone().addScaledVector(up, rise * 0.6).addScaledVector(back, 0.06);
      const p4 = p2.clone().addScaledVector(up, rise).addScaledVector(back, 0.2).addScaledVector(p2.clone().sub(p0).setY(0).normalize(), 0.12);
      return [p0, p1, p2, p3, p4];
    }

    finish() {}
  }

  /* ------------------------------------------------------------ inline */
  class InlineLayout extends EngineLayout {
    static label(n) { return 'I' + n; }
    banks() { return [{ tilt: 0, m: this.n, off: 0, outer: 1, hw: 0.5 }]; }
    plenum() { return { pos: new T.Vector3(-0.05, DECK + 0.1, -1.15), size: [this.len - 0.5, 0.42, 0.5] }; }
    // with a blower on the intake side the belt runs where the side pulley was
    sidePulleyZ() { return this.e.ind.blower ? 0.62 : -0.62; }
    turboMount() {
      const s = clamp(this.n / 8, 0.7, 1.6);
      // exhaust side only, clear of the block side; the second turbo goes along the block
      return { s, tx: this.frontX + 0.1 + 0.3 * s, tz: Math.max(0.8 + 0.4 * (s - 1), 0.58 + 0.39 * s), gap: 0.85 * s, sides: [1], along: true };
    }
  }
  InlineLayout.id = 'inline';

  /* ------------------------------------------------------------ V (two banks) */
  class VLayout extends EngineLayout {
    static normCyl(n) { return evenUp(cap(n)); }
    static label(n) { return 'V' + n; }
    bankAngle(m) { return m % 3 === 0 ? 60 : m % 5 === 0 ? 72 : 90; }
    bankHalfWidth() { return 0.5; }
    banks() {
      const m = this.n / 2, ang = this.bankAngle(m), hw = this.bankHalfWidth();
      return [{ tilt: ang / 2, m, off: -0.21, outer: 1, hw }, { tilt: -ang / 2, m, off: 0.21, outer: -1, hw }];
    }
    get tilt() { return this.e.banks[0].tilt * DEG; }
    ccW() { return 1.2 + 0.6 * Math.sin(this.tilt); }
    plenum() {
      return { pos: new T.Vector3(-0.05, Math.cos(this.tilt) * (DECK + 0.35) + 0.25, 0), size: [this.len - 0.4, 0.4, 0.62] };
    }
    frontTopY() { return Math.cos(this.tilt) * DECK; }
    coverD() { return 1.1; }
    sidePulleyZ() { return -0.7; }
    topY() { return Math.cos(this.tilt) * (DECK + 0.9) + 0.4; }
    turboZ(s) { return 1.05 + 0.4 * (s - 1); }
    turboMount() {
      const s = clamp(this.n / 8, 0.7, 1.6);
      // one per side, camera side first; the second column goes outward
      return { s, tx: this.frontX + 0.1 + 0.3 * s, tz: this.turboZ(s), gap: 0.85 * s, sides: [1, -1], along: false };
    }
  }
  VLayout.id = 'v';

  /* ------------------------------------------------------------ boxer (flat, 180 deg) */
  class BoxerLayout extends VLayout {
    static label(n) { return 'BOXER ' + n; }
    bankAngle() { return 180; }
    ccW() { return 1.3; }
    get caseY() { return 0; }
    get panY() { return -0.72; }
    plenum() { return { pos: new T.Vector3(-0.05, 1.05, 0), size: [this.len - 0.5, 0.36, 0.7] }; }
    frontTopY() { return 0.5; }
    topY() { return 1.35; }
    stackPath(c) {
      const e = this.e, b = c.bank, p0 = e._toEng(b, c.port);
      const o = e._toEng(b, new T.Vector3());
      const out = e._toEng(b, new T.Vector3(0, 0, b.outer)).sub(o).normalize();
      const axis = e._toEng(b, new T.Vector3(0, 1, 0)).sub(o).normalize();
      const p1 = p0.clone().addScaledVector(out, 0.22);
      const p2 = p1.clone().addScaledVector(axis, 0.95).addScaledVector(out, 0.05);
      return this._stackTail(p0, p1, p2);
    }
  }
  BoxerLayout.id = 'boxer';

  /* ------------------------------------------------------------ W: two VR banks (VW W8/W12, Bugatti W16) */
  class WLayout extends VLayout {
    static normCyl(n) { return clamp(Math.ceil(cap(n) / 4) * 4, 8, MAX_CYL); }
    static label(n) { return 'W' + n; }
    constructor(e, n) { super(e, n); this.pitch = 0.64 * P; }
    bankAngle(m) { return m >= 8 ? 90 : 72; }
    bankHalfWidth() { return 0.78; }
    zOffset(i) { return (i % 2 ? 1 : -1) * 0.24; }   // zig-zag rows under one head
    ccW() { return super.ccW() + 0.5; }
    plenum() { const p = super.plenum(); p.pos.y += 0.3; return p; }
    turboZ(s) { return super.turboZ(s) + 0.4; }
  }
  WLayout.id = 'w';

  /* ------------------------------------------------------------ radial (aircraft star, 1..4 rows) */
  class RadialLayout extends EngineLayout {
    // odd count per row (even firing with a single crank pin), at most 9 per row
    static split(n) {
      n = cap(n);
      const rows = Math.ceil(n / 9);
      let per = Math.max(3, Math.ceil(n / rows)); if (per % 2 === 0) per++;
      while (rows * per > MAX_CYL) per -= 2;
      return { rows, per };
    }
    static normCyl(n) { const s = RadialLayout.split(n); return s.rows * s.per; }
    static label(n) { return 'RADIAL ' + n; }

    constructor(e, n) {
      super(e, n);
      Object.assign(this, RadialLayout.split(n));
      this.airFilter = false;
      // push the barrels out (longer rods) until they fit side by side around the crankcase
      this.lift = Math.max(0.15, 0.85 * this.per / (2 * Math.PI) - 0.6);
      this.rowGap = 1.35;
      this.rc = 0.66 + this.lift;                        // crankcase radius
      this.framePad = 0.5;                               // the stubs fire outward all round
    }
    rowX(r) { return ((this.rows - 1) / 2 - r) * this.rowGap; }  // row 0 at the front
    banks() {
      const out = [];
      for (let r = 0; r < this.rows; r++) for (let k = 0; k < this.per; k++)
        out.push({ tilt: k * 360 / this.per + r * 180 / this.per, m: 1, off: this.rowX(r), outer: 1, hw: 0.5, row: r, k });
      return out;
    }
    dims() {
      this.frontX = this.rowX(0) + 0.6; this.rearX = this.rowX(this.rows - 1) - 0.6;
      this.len = this.frontX - this.rearX;
      this.xh = this.rearX - 0.45;                       // rear induction housing
      this.rh = 0.5 + 0.35 * this.lift;
    }
    cylinders(b) {
      const D = DECK + this.lift, x = b.off;
      // one pin per row (rows 360/rows apart), every other cylinder fires: odd count -> even 720/per spacing
      const pinOff = this.rows > 1 ? b.row * 360 / this.rows : 0;
      return [{ i: 0, x, zo: 0, phase: b.tilt + pinOff + 360 * (b.k % 2),
        port: new T.Vector3(x + 0.46, D + 0.18, 0), intake: new T.Vector3(x - 0.46, D + 0.1, 0) }];
    }

    buildBank(b) {
      const e = this.e, M = this.M, grp = b.grp, x = b.off, D = DECK + this.lift;
      // finned barrel as one lathe (cheap even with 28 cylinders); M.block ghosts in cutaway
      const r0 = BORE + 0.05, rf = BORE + 0.17, y0 = this.rc - 0.08, pts = [new T.Vector2(r0, y0)];
      for (let y = y0 + 0.08; y + 0.03 < D - 0.02; y += 0.075) pts.push(new T.Vector2(r0, y), new T.Vector2(rf, y), new T.Vector2(rf, y + 0.028), new T.Vector2(r0, y + 0.028));
      pts.push(new T.Vector2(r0, D));
      const barrel = new T.Mesh(new T.LatheGeometry(pts, 20), M.block);
      barrel.position.x = x; grp.add(barrel);
      const head = new T.Mesh(new T.CylinderGeometry(BORE + 0.13, BORE + 0.17, 0.46, 20), M.head);
      head.position.set(x, D + 0.23, 0); grp.add(head);
      const boss = new T.Mesh(new T.BoxGeometry(0.16, 0.32, 0.16), M.head);
      boss.position.set(x, D + 0.62, 0); grp.add(boss);
      for (const s of [-1, 1]) {                         // rocker boxes in the accent colour
        const rk = new T.Mesh(e._roundBox(0.22, 0.2, 0.26, 0.06), M.cover);
        rk.position.set(x + s * 0.25, D + 0.56, 0); rk.rotation.z = -s * 0.3; grp.add(rk);
      }
    }

    buildCase() {
      const e = this.e, M = this.M, eng = this.eng, rc = this.rc;
      const dl = (this.rows - 1) * this.rowGap + 0.9;
      const drum = new T.Mesh(new T.CylinderGeometry(rc, rc, dl, Math.max(12, this.per * 2)), M.block);
      drum.rotation.z = Math.PI / 2; eng.add(drum); e._edges(drum, eng, 20);
      const nose = new T.Mesh(new T.CylinderGeometry(0.42, rc * 0.85, 0.55, 28), M.dark2);
      nose.rotation.z = -Math.PI / 2; nose.position.x = this.rowX(0) + 0.45 + 0.27; eng.add(nose);
    }

    buildCrank(cyls) {
      this._mainShaft(this.len + 1.2, 0.3);                // runs forward into the prop hub
      const throws = [];
      for (let r = 0; r < this.rows; r++) throws.push(this._throw(this.rowX(r)));
      cyls.forEach(c => { c.throwG = throws[c.bank.row]; c.moving.push(c.throwG); }); // master-rod style: the whole row on one pin
    }

    buildIntake(cyls) {
      const e = this.e, M = this.M, eng = this.eng, xh = this.xh, rh = this.rh;
      // rear induction housing feeding every cylinder
      const hsg = new T.Mesh(new T.CylinderGeometry(rh, rh, 0.6, 36), M.dark2);
      hsg.rotation.z = Math.PI / 2; hsg.position.x = xh; eng.add(hsg);
      cyls.forEach(c => {
        const t = c.bank.tilt * DEG, rv = new T.Vector3(0, Math.cos(t), Math.sin(t));
        const port = e._toEng(c.bank, c.intake);
        const pr = Math.hypot(port.y, port.z);
        const a = new T.Vector3(xh + 0.2, 0, 0).addScaledVector(rv, rh * 0.85);
        const m1 = new T.Vector3(xh + 0.4, 0, 0).addScaledVector(rv, rh + 0.25);
        const m2 = new T.Vector3(port.x - 0.3, 0, 0).addScaledVector(rv, pr - 0.1);
        const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([a, m1, m2, port]), 16, 0.06, 8, false), M.head);
        eng.add(tube);
      });
      // carburettor air scoop on top of the housing
      const sh = 0.55;
      const scoop = new T.Mesh(e._roundBox(0.5, sh, 0.38, 0.07), M.dark2);
      scoop.position.set(xh - 0.05, rh + sh / 2 - 0.05, 0); eng.add(scoop);
      const mouth = new T.Mesh(new T.PlaneGeometry(0.3, sh * 0.6), M.dark);
      mouth.rotation.y = Math.PI / 2; mouth.position.set(xh + 0.21, rh + sh * 0.55, 0); eng.add(mouth);
      return null;
    }

    buildFront() {
      const e = this.e, M = this.M, x = this.rowX(0) + 1.05;
      const hub = new T.Group(); hub.position.x = x; this.eng.add(hub); e.spin(hub, 0.6); // reduction gear
      const flange = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 0.08, 32), M.steel); flange.rotation.z = Math.PI / 2; hub.add(flange);
      const dome = new T.Mesh(new T.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.cover);
      dome.rotation.z = -Math.PI / 2; dome.position.x = 0.04; hub.add(dome);
      for (let k = 0; k < 3; k++) {                      // blade roots only; full blades would dwarf the engine
        const root = new T.Mesh(new T.BoxGeometry(0.08, 0.42, 0.17), M.dark);
        const a = k * Math.PI * 2 / 3;
        root.position.set(0.02, Math.cos(a) * 0.46, Math.sin(a) * 0.46); root.rotation.x = -a; root.rotation.y = 0.5; hub.add(root);
      }
    }

    buildRear() {
      const M = this.M, eng = this.eng, xh = this.xh, rh = this.rh;
      const acc = new T.Mesh(new T.CylinderGeometry(rh * 0.7, rh * 0.8, 0.3, 28), M.dark2);
      acc.rotation.z = Math.PI / 2; acc.position.x = xh - 0.45; eng.add(acc);
      for (const s of [-1, 1]) {                         // magnetos
        const mg = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.34, 14), M.dark);
        mg.rotation.z = Math.PI / 2; mg.position.set(xh - 0.62, rh * 0.45, s * rh * 0.45); eng.add(mg);
      }
    }

    /* short stubs out of the front of each head, pointing outward and back: a crown of flames */
    stackPath(c) {
      const e = this.e, b = c.bank, x = b.off, D = DECK + this.lift, V = (dx, dy) => e._toEng(b, new T.Vector3(x + dx, D + dy, 0));
      return [V(0.46, 0.18), V(0.66, 0.26), V(0.74, 0.62), V(0.7, 0.95), V(0.58, 1.2)];
    }

    /* engine stand: a ring round the rear housing and two legs, so the lower stubs clear the floor */
    finish() {
      const M = this.M, eng = this.eng, xh = this.xh, rh = this.rh;
      eng.updateMatrixWorld(true);
      const fy = new T.Box3().setFromObject(eng).min.y - 0.3;
      const ring = new T.Mesh(new T.TorusGeometry(rh + 0.06, 0.07, 8, 40), M.dark2);
      ring.rotation.y = Math.PI / 2; ring.position.x = xh; eng.add(ring);
      const tube = (a, b, r) => eng.add(new T.Mesh(new T.TubeGeometry(new T.LineCurve3(a, b), 1, r, 8, false), M.dark2));
      const a0 = 130 * DEG, fz = rh + 0.9;
      for (const s of [-1, 1]) tube(new T.Vector3(xh, Math.cos(a0) * (rh + 0.06), s * Math.sin(a0) * (rh + 0.06)), new T.Vector3(xh - 0.2, fy, s * fz), 0.08);
      tube(new T.Vector3(xh - 0.2, fy, -fz - 0.1), new T.Vector3(xh - 0.2, fy, fz + 0.1), 0.07);
      tube(new T.Vector3(xh - 0.2, fy, 0), new T.Vector3(this.frontX, fy, 0), 0.07);
    }
  }
  RadialLayout.id = 'radial';
  RadialLayout.turbos = false;   // no forced induction on the radial: every option acts as none
  RadialLayout.blower = false;

  /* ------------------------------------------------------------ rotary (Wankel), one "cylinder" = one rotor
     Housing bore = epitrochoid (long axis vertical), triangular rotor orbiting the eccentric shaft:
     rotor centre at ecc·(cos θ, sin θ) in (y, z), rotor turned by θ/3, each rotor fires once per shaft turn. */
  class RotaryLayout extends EngineLayout {
    static label(n) { return n + '-ROTOR'; }
    constructor(e, n) {
      super(e, n);
      this.pitch = 0.62;                                  // rotor housing + side housing
      this.R = 0.72; this.ecc = 0.105; this.wall = 0.16;  // generating radius, eccentricity (~R/7 like a 13B), wall
      this.hz = this.R + this.wall - this.ecc;            // housing half width (engine z) ...
      this.hy = this.R + this.wall + this.ecc;            // ... and half height
    }
    banks() { return [{ tilt: 0, m: this.n, off: 0, outer: 1, hw: this.hz }]; }
    cylinders(b) {
      const out = [];
      for (let i = 0; i < b.m; i++) {
        const x = (i - (b.m - 1) / 2) * this.pitch;
        // like a real Wankel the intake and exhaust are on one side (+z, low and high), the plugs opposite (-z)
        out.push({ i, x, zo: 0, phase: i * 360 / b.m,   // firing: rotors evenly spread over one shaft turn
          port: new T.Vector3(x, -0.12, this.surfZ(-0.12, 1)), intake: new T.Vector3(x, 0.5, this.surfZ(0.5, 1)) });
      }
      return out;
    }

    /* z of the housing's outer surface at height y on one side (side = +1 / -1) */
    surfZ(y, side) {
      const pts = this._outer || (this._outer = this._troch(this.R + this.wall, 1440));
      let z = 0;
      for (const q of pts) if (Math.sign(q.x) === side && Math.abs(q.y - y) < 0.006) z = Math.max(z, Math.abs(q.x));
      return side * z;
    }
    /* housing bore in the shape plane (shape x -> engine z, shape y -> engine y) */
    _troch(r, N = 96) {
      const e = this.ecc, pts = [];
      for (let k = 0; k < N; k++) { const t = k / N * Math.PI * 2; pts.push(new T.Vector2(e * Math.sin(3 * t) + r * Math.sin(t), e * Math.cos(3 * t) + r * Math.cos(t))); }
      return pts;
    }
    /* a shape extruded along X, centred on x = 0; identical parts share it and only move (mesh.position.x) */
    _slab(shape, depth) { return this.e._alongX(new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 }), depth, depth / 2); }

    buildBank(b) {
      const e = this.e, M = this.M, grp = b.grp, n = this.n, p = this.pitch, tp = 0.1;
      const troch = r => new T.Shape(this._troch(r)), ro = this.R + this.wall;
      const ring = troch(ro); ring.holes.push(new T.Path(this._troch(this.R + 0.012)));
      const housingG = this._slab(ring, p - tp), endG = this._slab(troch(ro), tp + 0.04), sideG = this._slab(ring, tp);
      const boltG = new T.CylinderGeometry(0.035, 0.035, 0.05, 6), bolts = this._troch(this.R + this.wall * 0.5, 12);
      const add = (geo, mat, x, edges) => { const m = new T.Mesh(geo, mat); m.position.x = x; grp.add(m); if (edges) e._edges(m, grp, 25); };
      for (let i = 0; i < n; i++) add(housingG, M.block, (i - (n - 1) / 2) * p, true);   // rotor housings ghost in cutaway
      for (let i = 0; i <= n; i++) {
        const x = (i - n / 2) * p;
        if (i > 0 && i < n) { add(sideG, M.head, x, false); continue; }   // side housings between rotors: rings, the rotors show through
        add(endG, M.block, x, true);                                        // end housings, front and rear
        const out = i ? 1 : -1;                                             // bolt heads on the outer face
        for (const q of bolts) {
          const bolt = new T.Mesh(boltG, M.steel);
          bolt.rotation.z = Math.PI / 2; bolt.position.set(x + out * 0.095, q.y, q.x); grp.add(bolt);
        }
      }
    }

    /* rotor: flanks flatter than a Reuleaux triangle so it clears the waist of the bore */
    /* geometry shared by all rotors, built on first use */
    _rotorGeo() {
      if (this._rg) return this._rg;
      const R = this.R - 0.012, f = 0.19 * R, th = this.pitch - 0.18;
      const ap = k => { const a = k * Math.PI * 2 / 3; return [R * Math.sin(a), R * Math.cos(a)]; };
      const sh = new T.Shape(); sh.moveTo(...ap(0));
      for (let k = 0; k < 3; k++) {
        const [x0, y0] = ap(k), [x1, y1] = ap(k + 1), mx = (x0 + x1) / 2, my = (y0 + y1) / 2, ml = Math.hypot(mx, my);
        sh.quadraticCurveTo(mx / ml * (ml + 2 * f), my / ml * (ml + 2 * f), x1, y1);   // ~circular arc bulging by f
      }
      const hole = new T.Path(); hole.absarc(0, 0, 0.26, 0, Math.PI * 2, true); sh.holes.push(hole);
      return (this._rg = {
        ap, body: this._slab(sh, th), gear: new T.TorusGeometry(0.255, 0.025, 6, 36), seal: new T.BoxGeometry(th + 0.02, 0.035, 0.035),
        coil: new T.CylinderGeometry(0.06, 0.06, 0.16, 10), glow: new T.CylinderGeometry(0.03, 0.03, 0.03, 8),
      });
    }
    /* rotor: flanks flatter than a Reuleaux triangle so it clears the waist of the bore */
    buildCylinder(b, bi, cd) {
      const M = this.M, grp = b.grp, x = cd.x, G = this._rotorGeo(), pm = M.piston.clone();
      const rotor = new T.Group(); rotor.position.x = x; grp.add(rotor);
      rotor.add(new T.Mesh(G.body, pm));
      const gear = new T.Mesh(G.gear, M.steel); gear.rotation.y = Math.PI / 2; rotor.add(gear);
      for (let k = 0; k < 3; k++) {                       // apex seals
        const [u, v] = G.ap(k), seal = new T.Mesh(G.seal, M.steel);
        seal.position.set(0, v, u); seal.rotation.x = k * Math.PI * 2 / 3; rotor.add(seal);
      }
      // leading and trailing spark plugs on the -z side, opposite the ports, seated on the housing
      let coilGlow = null;
      for (const y of [-0.17, 0.17]) {
        const zs = this.surfZ(y, -1), coil = new T.Mesh(G.coil, M.dark);
        coil.rotation.x = Math.PI / 2; coil.position.set(x, y, zs - 0.08); grp.add(coil);
        if (coilGlow) continue;                           // the leading plug carries the ignition glow
        coilGlow = new T.Mesh(G.glow, M.spark.clone());
        coilGlow.rotation.x = Math.PI / 2; coilGlow.position.set(x, y, zs - 0.165); grp.add(coilGlow);
      }
      return { bank: b, bi, i: cd.i, x, zo: 0, phase: cd.phase, period: 360, rotor, moving: [rotor], pm, coilGlow, port: cd.port, intake: cd.intake };
    }
    /* cyc 0 (combustion) = a face at TDC on the plug side (-z): the rotor centre points there at shaft angle 270 */
    animate(c, cyc, crank) {
      const th = (crank - c.phase + ROTOR_TDC) * DEG, e = this.ecc; // crank wraps at 720: th/3 jumps 240 deg, same look
      c.rotor.position.set(c.x, e * Math.cos(th), e * Math.sin(th));
      c.rotor.rotation.x = th / 3;
      c.throwG.rotation.x = th;
    }

    buildCase() {
      const e = this.e, pan = new T.Mesh(e._roundBox(this.len - 0.2, 0.36, this.hz * 1.5, 0.08), this.M.dark2);
      pan.position.set(0, -this.hy - 0.1, 0); pan.castShadow = true; this.eng.add(pan);
    }
    buildCrank(cyls) {
      const M = this.M, eng = this.eng;
      this._mainShaft(this.len + 0.3);
      const lobeG = new T.CylinderGeometry(0.21, 0.21, this.pitch - 0.2, 20);
      cyls.forEach(c => {                                 // eccentric journal under each rotor
        const g = new T.Group(); g.position.x = c.x; eng.add(g); c.throwG = g; c.moving.push(g);
        const lobe = new T.Mesh(lobeG, M.steel);
        lobe.rotation.z = Math.PI / 2; lobe.position.y = this.ecc; g.add(lobe);
      });
    }

    plenum() { return { pos: new T.Vector3(-0.05, this.hy + 0.3, 0), size: [this.len - 0.25, 0.36, 0.62] }; }
    plenumMat() { return this.M.cover; }                 // no valve covers here: the accent goes on the intake
    runnerPath(a, outDir, b) {                            // up the +z flank, round the top edge, into the plenum
      return [a, new T.Vector3(a.x, a.y + 0.2, a.z + 0.1), new T.Vector3(a.x, this.hy * 0.95, this.hz * 0.75), b];
    }
    frontTopY() { return this.hy - 0.2; }
    coverD() { return 0.55; }
    buildFront(plen) {
      super.buildFront(plen);
      // the narrow cover leaves the accessory pulley in the air: put an alternator behind it on the housing
      const face = this.n / 2 * this.pitch + 0.07, px = this.frontX + 0.08, L = px - face;
      const alt = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, L, 18), this.M.dark2);
      alt.rotation.z = Math.PI / 2; alt.position.set(face + L / 2, 0.55, this.sidePulleyZ()); this.eng.add(alt);
    }
    topY() { return this.hy + 0.75; }
    turboMount() {
      const s = clamp(0.55 + 0.25 * this.n, 0.8, 1.6);    // a 2-rotor gets a proper-size turbo
      // exhaust side only; the second column goes outward, along the block it would sit on the stacks
      return { s, tx: this.frontX + 0.1 + 0.3 * s, tz: this.hz + 0.35 + 0.2 * s, gap: 0.85 * s, sides: [1], along: false };
    }
  }
  RotaryLayout.id = 'rotary';

  EngineLayout.turbos = true;    // which forced induction a layout can carry (see Induction.effective)
  EngineLayout.blower = true;
  const LAYOUTS = { inline: InlineLayout, v: VLayout, boxer: BoxerLayout, w: WLayout, radial: RadialLayout, rotary: RotaryLayout };
  window.EngineLayouts = Object.assign({}, LAYOUTS, {
    MAX_CYL,
    base: EngineLayout,
    get(id) { return LAYOUTS[id] || VLayout; },   // unknown values fall back to V
  });
})();
