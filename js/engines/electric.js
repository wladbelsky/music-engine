/* Electric: an industrial brushed DC motor on a bedplate.
 *
 * Axis = X like every layout; the commutator end faces the camera (+X, towards the dash) behind an open cage,
 * so the brushes are in view; the drive end with its coupling is at the back. `n` = brushes (2..12, even): one
 * per main pole, set in the neutral zone between the poles. The brushes are the "cylinders": each commutator
 * segment passing a brush is an exhaust pulse of the core's crank counter (period = the segment pitch), which
 * makes the commutation sparks. Music peaks light blue arcs from brush to commutator, big beats a flashover
 * (a ring of fire round the commutator). sim.boost is the armature current (the dash's ARMATURE A gauge); the
 * starting current surges while it runs up. Beats twist the frame on its feet (torque reaction, e.jolt). */
(function () {
  'use strict';
  const T = THREE;
  const { DEG, clamp } = Engine3D.GEO;
  const FX = EngineFX, L = EngineLayouts;

  const HC = 1.45;                              // shaft height above the floor
  const R_Y = 1.18, R_YI = 1.03;                // yoke (frame) outer / inner radius
  const X_Y0 = -1.3, X_Y1 = 0.9;                // yoke, back to front
  const R_A = 0.72, X_A0 = -1.0, X_A1 = 0.7;    // armature core
  const R_C = 0.46, X_C0 = 0.95, X_C1 = 1.6;    // commutator
  const SEG = 40, SLOTS = 32;                   // commutator segments (spinner pitch 9 deg), armature slots
  const X_BR = 1.3, R_RK = 0.98;                // brush line, brush rocker ring
  const X_ES = 1.85;                            // front end shield (open spider)
  const ARC_N = 8;                              // points per lightning arc

  // electric sparks: blue-white points that fall; arc plasma: short blue puffs (in the smoke pool: ozone haze)
  const P_SPARK = FX.particleKind({ dot: true, add: { drag: 0.9, lift: -5.5,
    paint(u, c, k, s0) { const f = 1 - u; c[k] = 0.75 + 0.5 * f; c[k + 1] = 0.85 + 0.35 * f; c[k + 2] = 1.4; c[k + 3] = f; return s0 * (0.6 + 0.4 * f); } } });
  const P_ARC = FX.particleKind({
    add: { drag: 5, lift: 0.6,
      paint(u, c, k, s0) { const f = 1 - u; c[k] = 0.45 + 0.5 * f * f; c[k + 1] = 0.6 + 0.35 * f * f; c[k + 2] = 1.3; c[k + 3] = f * 0.9; return s0 * (0.7 + 0.8 * u); } },
    norm: { drag: 1.2, lift: 0.5,
      paint(u, c, k, s0) { c[k] = 0.7; c[k + 1] = 0.72; c[k + 2] = 0.78; c[k + 3] = 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.3)); return s0 * (0.5 + 2.5 * u); } },
  });

  /* additive, unlit, for glows that must add light on the transparent canvas (Engine3D.FX.addBlend) */
  const glowMat = (r, g, b) => { const m = new T.MeshBasicMaterial({ color: new T.Color(r, g, b), transparent: true, depthWrite: false }); FX.addBlend(m); m.toneMapped = false; return m; };

  class ElectricLayout extends L.base {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v + Math.abs(v % 2), 2, 12) : 4; }
    static label(n) { return 'DC MOTOR ' + n + '-BRUSH'; }

    constructor(e, n) {
      super(e, n);
      this.animK = 0.3;                   // like the turbojet: real speed visible from idle, blur above that
      this.swayK = 0.25; this.beatK = 0.5; this.smooth = true;
      this.spark = 0; this.ring = 0; this.arcT = 0; this.arcI = 0; this.q = 'high'; this.ozone = 0;
    }

    get B() {                            // the motor body on its axis; beats twist it on its feet (the bedplate stays)
      if (!this._B) { this._B = new T.Group(); this._B.position.y = HC; this.eng.add(this._B); }
      return this._B;
    }
    _latheX(pts, mat, seg, parent) {       // a lathe along X from (x, r) points, front to back
      const g = new T.LatheGeometry(pts.slice().reverse().map(([x, r]) => new T.Vector2(r, x)), seg); g.rotateZ(-Math.PI / 2);
      return this._add(g, mat, 0, 0, 0, parent || this.B);
    }
    _ringX(x, r, tube, mat, parent, seg = 48) { const m = this._add(new T.TorusGeometry(r, tube, 8, seg), mat, x, 0, 0, parent || this.B); m.rotation.y = Math.PI / 2; return m; }
    /* a group at x turned about X so that its local +Y points radially at angle a (from +Y towards +Z) */
    _radial(x, a, parent) { const g = new T.Group(); g.position.x = x; g.rotation.x = a; (parent || this.B).add(g); return g; }
    _mats() {
      if (this.copper) return;
      this.copper = new T.MeshStandardMaterial({ color: 0xc27a3e, metalness: 1, roughness: 0.3 });
      this.comm = new T.MeshStandardMaterial({ color: 0xc8804a, metalness: 1, roughness: 0.25, emissive: new T.Color(0.35, 0.55, 1), emissiveIntensity: 0 });   // commutator: glows with a flashover
      this.coil = new T.MeshStandardMaterial({ color: 0x9a4a1c, metalness: 0.7, roughness: 0.45 });   // enamelled wire
      this.carbon = new T.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.2, roughness: 0.55 });
    }

    banks() { return [{ tilt: 0, m: this.n, off: 0, outer: 1, hw: 0.5 }]; }
    dims() { this.frontX = X_ES + 0.5; this.rearX = -2.3; this.len = this.frontX - this.rearX; }
    cylinders() { const out = []; for (let i = 0; i < this.n; i++) out.push({ i, x: X_BR, zo: 0, phase: i * 360 / this.n }); return out; }

    /* one brush: carbon in its holder on the rocker ring, pressed on by a spring, a copper pigtail to a bus ring */
    buildCylinder(b, bi, cd) {
      this._mats();
      const M = this.M, a = (cd.i + 0.5) * 2 * Math.PI / this.n, g = this._radial(X_BR, a);   // between two poles
      const brush = this._box(0.2, 0.2, 0.14, this.carbon, 0, R_C + 0.1, 0, g);
      this._box(0.26, 0.2, 0.2, M.steel, 0, R_C + 0.27, 0, g);                                  // holder
      this._box(0.07, 0.035, 0.26, M.brass, 0, R_C + 0.4, 0.02, g);                             // spring finger
      this._cylZ(0.05, 0.14, M.brass, 0, R_C + 0.43, -0.1, g, 10);                              // spring barrel
      this._box(0.08, R_RK - (R_C + 0.36), 0.08, M.dark2, 0, (R_RK + R_C + 0.36) / 2, 0, g);    // stud to the rocker
      const side = cd.i % 2 ? 1 : -1;                                                           // + / - bus ring
      this._tube([new T.Vector3(0, R_C + 0.21, 0.06), new T.Vector3(side * 0.08, R_C + 0.4, 0.12), new T.Vector3(side * 0.16, R_RK + 0.09, 0.02)], 0.024, this.copper, g);
      const gm = glowMat(0, 0, 0), glow = this._add(new T.SphereGeometry(0.1, 12, 8), gm, 0, R_C + 0.01, 0.07, g);
      return { bank: b, bi, i: cd.i, x: X_BR, zo: 0, phase: cd.phase, period: 360 / SEG, moving: [], g, brush, glowMat: gm,
        tip: new T.Vector3(0, R_C + 0.01, 0.08) };   // the trailing edge (the surface runs towards local +Z), where it sparks
    }
    animate(c, cyc) { c.brush.position.y = R_C + 0.1 + 0.004 * Math.sin(cyc * DEG * 3); }    // chatter

    /* bedplate, feet, yoke with cooling ribs, main poles with field coils, terminal box and cables, name plate */
    buildCase() {
      this._mats();
      const e = this.e, M = this.M, B = this.B, fy = -HC;
      this._add(e._roundBox(3.9, 0.14, 2.3, 0.05), M.dark2, -0.2, 0.07, 0);                     // bedplate (fixed, on eng)
      for (const x of [-0.85, 0.45]) for (const s of [-1, 1]) {
        const top = -Math.sqrt(R_Y * R_Y - 0.7 * 0.7) + 0.12, h = top - (fy + 0.14);
        this._box(0.46, h, 0.36, M.block, x, fy + 0.14 + h / 2, s * 0.72, B);
        this._box(0.56, 0.06, 0.46, M.dark2, x, fy + 0.17, s * 0.74, B);                      // foot pad
        for (const dx of [-0.18, 0.18]) this._cylY(0.035, 0.08, M.steel, x + dx, fy + 0.22, s * 0.86, B, 8); // hold-down bolts
      }
      // yoke: a thick shell (ghosts in cutaway), cooling ribs
      const yoke = this._latheX([[X_Y1, R_YI], [X_Y1, R_Y], [X_Y0, R_Y], [X_Y0, R_YI], [X_Y1, R_YI]], M.block, 64);
      e._edges(yoke, B, 30);
      for (let k = 0; k < 7; k++) this._ringX(X_Y0 + 0.2 + k * (X_Y1 - X_Y0 - 0.4) / 6, R_Y + 0.005, 0.03, M.block);
      this._ringX(X_Y1 - 0.02, R_Y + 0.02, 0.05, M.cover); this._ringX(X_Y0 + 0.02, R_Y + 0.02, 0.05, M.cover);
      // main poles between the yoke and the armature, a field coil round each
      const pl = X_A1 - X_A0 - 0.1, px = (X_A0 + X_A1) / 2, r0 = R_A + 0.07, w = Math.min(0.46, 2 * Math.PI * R_A / this.n * 0.42);
      for (let i = 0; i < this.n; i++) {
        const g = this._radial(0, i * 2 * Math.PI / this.n);
        this._box(pl, R_YI - r0, w, M.dark2, px, (R_YI + r0) / 2, 0, g);                       // pole core
        this._box(pl, 0.06, Math.min(w * 1.7, 2 * Math.PI * R_A / this.n * 0.8), M.dark2, px, r0 + 0.03, 0, g);   // pole shoe
        const ch = (R_YI - r0) * 0.55, cy = R_YI - ch / 2 - 0.02;
        for (const s of [-1, 1]) {
          this._box(pl + 0.16, ch, 0.08, this.coil, px, cy, s * (w / 2 + 0.05), g);
          this._box(0.08, ch, w + 0.18, this.coil, px + s * (pl / 2 + 0.04), cy, 0, g);
        }
      }
      // lifting eye, name plate (on the camera side), terminal box with its cables down to the floor
      const eye = this._add(new T.TorusGeometry(0.12, 0.035, 8, 20), M.steel, -0.2, R_Y + 0.14, 0, B); eye.rotation.y = Math.PI / 2;
      const np = this._radial(-0.35, 100 * DEG); this._box(0.55, 0.02, 0.32, M.brass, 0, R_Y + 0.01, 0, np);
      const tb = this._radial(-0.2, 45 * DEG);
      this._box(0.5, 0.3, 0.42, M.dark2, 0, R_Y + 0.13, 0, tb);
      this._box(0.54, 0.04, 0.46, M.cover, 0, R_Y + 0.3, 0, tb);                                 // lid
      this.tbL = new T.Vector3(0, R_Y + 0.15, 0.22); this.tbG = tb;
      const X = new T.Vector3(1, 0, 0);
      for (const dx of [-0.14, 0.14]) {
        const p0 = new T.Vector3(0, R_Y + 0.06, 0.22).applyAxisAngle(X, 45 * DEG).add(new T.Vector3(-0.2 + dx, 0, 0));   // out of the box's lower face
        this._tube([p0, p0.clone().add(new T.Vector3(0, -0.2, 0.25)), new T.Vector3(-0.2 + dx, -0.4, R_Y + 0.55), new T.Vector3(-0.3 + dx, fy + 0.08, R_Y + 0.65),
          new T.Vector3(-1.6 + dx, fy + 0.08, R_Y + 0.7), new T.Vector3(-2.5 + dx, fy + 0.08, R_Y + 0.72)], 0.07, M.dark, B);
      }
    }

    /* the armature: shaft, laminated core with copper bars in the slots, end windings, risers, commutator, coupling */
    buildCrank() {
      this._mats();
      const e = this.e, M = this.M, rot = this.rot = new T.Group(); this.B.add(rot);
      this.rotS = e.spin(rot, 1, 0, 360 / SEG);   // capped step per frame in commutator segments (Engine3D.spin)
      this._cylX(0.16, X_ES + 0.5 + 2.25, M.steel, (X_ES + 0.5 - 2.25) / 2, 0, 0, rot, 16);
      this._cylX(R_A, X_A1 - X_A0, M.dark2, (X_A0 + X_A1) / 2, 0, 0, rot, 48);
      const inst = (geo, mat, count, place) => {
        const im = new T.InstancedMesh(geo, mat, count), m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1), ax = new T.Vector3(1, 0, 0);
        for (let k = 0; k < count; k++) { const a = k * 2 * Math.PI / count; q.setFromAxisAngle(ax, a); place(p, a); m.compose(p, q, one); im.setMatrixAt(k, m); }   // geometry points up (+Y)
        rot.add(im); return im;
      };
      inst(new T.BoxGeometry(X_A1 - X_A0 + 0.02, 0.05, 0.075).translate(0, R_A - 0.012, 0), this.coil, SLOTS, p => p.set((X_A0 + X_A1) / 2, 0, 0));
      for (const x of [X_A1 + 0.09, X_A0 - 0.09]) this._ringX(x, R_A * 0.78, 0.12, this.coil, rot, 40);    // end windings
      const rl = X_C0 - (X_A1 + 0.12);                                                         // risers: winding ends to the segments
      this._add(new T.CylinderGeometry(R_A * 0.72, R_C - 0.02, rl, 40), this.copper, X_A1 + 0.12 + rl / 2, 0, 0, rot).rotation.z = Math.PI / 2;
      this._cylX(R_C - 0.01, X_C1 - X_C0, M.dark, (X_C0 + X_C1) / 2, 0, 0, rot, 40);           // mica / core
      inst(new T.BoxGeometry(X_C1 - X_C0, 0.05, 2 * Math.PI * R_C / SEG * 0.8).translate(0, R_C - 0.015, 0), this.comm, SEG, p => p.set((X_C0 + X_C1) / 2, 0, 0));
      for (const x of [X_C0 - 0.03, X_C1 + 0.03]) this._ringX(x, R_C - 0.01, 0.035, M.steel, rot, 32);   // clamp rings
      // blur shells: copper at speed (a real step past the capped one, in segment pitches: Engine3D.spin)
      const bm = c => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false });
      this.blurC = this._cylX(R_C + 0.012, X_C1 - X_C0 - 0.01, bm(0xb07048), (X_C0 + X_C1) / 2, 0, 0, this.B, 40);
      this.blurA = this._cylX(R_A + 0.02, X_A1 - X_A0, bm(0x7a4020), (X_A0 + X_A1) / 2, 0, 0, this.B, 48);
      this.blurC.material.side = this.blurA.material.side = T.DoubleSide;
      this.blurC.visible = this.blurA.visible = false;
      // coupling half on the drive end, bolts and a key stripe so it shows turning
      const cp = this._cylX(0.5, 0.2, M.steel, -2.05, 0, 0, rot, 36);
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; this._cylX(0.045, 0.24, M.dark, -2.05, Math.cos(a) * 0.36, Math.sin(a) * 0.36, rot, 8); }
      this._box(0.22, 0.08, 0.06, M.cover, -2.05, 0.46, 0, rot);
      this._box(0.1, 0.05, 0.05, M.cover, X_ES + 0.45, 0.14, 0, rot);                          // key on the free shaft end
    }

    buildIntake() { return null; }

    /* commutator end: brush rocker ring with brackets, bus rings, an open cage to the end shield spider */
    buildFront() {
      const M = this.M;
      this._ringX(X_BR, R_RK, 0.045, M.dark2);
      for (let k = 0; k < 4; k++) {
        const g = this._radial(X_BR, (k + 0.5) * Math.PI / 2 + Math.PI / this.n / 2);
        this._box(0.1, R_YI - R_RK + 0.05, 0.1, M.dark2, -0.15, (R_YI + R_RK) / 2, 0, g);
      }
      for (const dx of [-0.15, 0.15]) this._ringX(X_BR + dx, R_RK + 0.09, 0.025, this.copper);  // + / - bus rings
      // end bracket: three slim arms from the yoke rim to the bearing hub, none on the camera's side, so the
      // commutator and the brushes stay in view
      for (const a of [150, 240, 330]) {
        const g = this._radial(0, a * DEG), p0 = new T.Vector3(X_Y1 - 0.05, R_Y - 0.12, 0), p1 = new T.Vector3(X_ES - 0.05, 0.26, 0);
        const d = p1.clone().sub(p0), arm = this._box(0.12, d.length(), 0.12, M.dark2, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0, g);
        arm.rotation.z = Math.atan2(-d.x, d.y);
      }
      this._cylX(0.3, 0.3, M.dark2, X_ES, 0, 0, this.B, 28);
      this._cylX(0.24, 0.08, M.cover, X_ES + 0.18, 0, 0, this.B, 28);                           // bearing cap
    }

    /* drive end shield: a shallow dome with the bearing housing */
    buildRear() {
      const M = this.M;
      this._latheX([[X_Y0 + 0.02, R_Y], [X_Y0 - 0.12, R_Y - 0.08], [X_Y0 - 0.3, 0.55], [X_Y0 - 0.34, 0.3], [X_Y0 - 0.6, 0.28], [X_Y0 - 0.62, 0.17]], M.dark2, 48);
    }

    /* lightning arcs (world-space ribbons, rebuilt a few times a second) and the flashover ring */
    buildExhaust(cyls) {
      this.arcMat = glowMat(0, 0, 0); this.arcMat.side = T.DoubleSide;
      this.arcs = cyls.map(() => {
        const g = new T.BufferGeometry(), pos = new Float32Array(ARC_N * 2 * 3), idx = [];
        for (let k = 0; k < ARC_N - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
        g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx);
        const m = new T.Mesh(g, this.arcMat); m.frustumCulled = false; m.visible = false; m.renderOrder = 12; this.e.root.add(m);
        return m;
      });
      this.ringMat = glowMat(0, 0, 0);
      this.rings = [0, 1].map(k => { const m = this._ringX(X_BR + (k - 0.5) * 0.16, R_C + 0.06, 0.055, this.ringMat, this.B, 40); m.visible = false; return m; });
    }

    /* ---- effects ---- */
    _bw(v) { return this.B.localToWorld(v.clone()); }
    glowPoint() { return this._bw(new T.Vector3(X_C1, R_C + 0.35, 0.3)); }

    /* sparks thrown off the commutator: at brush c (trailing edge), or anywhere round it (c null) */
    _sparks(c, m, k) {
      const e = this.e, q = this.B.getWorldQuaternion(new T.Quaternion());
      for (let i = 0; i < m; i++) {
        let p, t, r;
        if (c) { p = c.g.localToWorld(c.tip.clone()); const gq = c.g.getWorldQuaternion(new T.Quaternion()); t = new T.Vector3(0, 0, 1).applyQuaternion(gq); r = new T.Vector3(0, 1, 0).applyQuaternion(gq); }
        else {
          const a = Math.random() * Math.PI * 2, x = X_C0 + 0.08 + Math.random() * (X_C1 - X_C0 - 0.16);
          r = new T.Vector3(0, Math.cos(a), Math.sin(a)); t = new T.Vector3(0, -Math.sin(a), Math.cos(a));
          p = this._bw(new T.Vector3(x, 0, 0).addScaledVector(r, R_C + 0.02)); r.applyQuaternion(q); t.applyQuaternion(q);
        }
        const sp = (2.5 + Math.random() * 3.5) * k, out = 0.6 + Math.random() * 1.8;
        e.flames.spawn(p.x, p.y, p.z, t.x * sp + r.x * out + (Math.random() - 0.5) * 0.6, t.y * sp + r.y * out + Math.random() * 0.8, t.z * sp + r.z * out + (Math.random() - 0.5) * 0.6,
          0.25 + Math.random() * 0.35, 0.035 + Math.random() * 0.03, P_SPARK);
      }
    }
    _plasma(p, m, s) {
      const e = this.e;
      for (let i = 0; i < m; i++) e.flames.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.8, Math.random() * 0.6, (Math.random() - 0.5) * 0.8, 0.12 + Math.random() * 0.12, s * (0.7 + Math.random() * 0.6), P_ARC);
    }

    /* every commutator segment passing a brush: a spark now and then, more under load */
    exhaustPulse(c, sim) {
      const lo = this.q === 'low' ? 0.4 : 1;
      if (Math.random() < 0.5 * this.spark * lo) this._sparks(c, 1 + (Math.random() < this.spark * 0.5 ? 1 : 0), 0.8 + this.spark * 0.5);
      if (Math.random() < 0.12 * this.spark * lo) this._plasma(c.g.localToWorld(c.tip.clone()), 1, 0.22);
    }
    /* the brush's contact glow (glow = the core's pulse envelope) */
    cylinderFx(c, glow) {
      const I = this.spark * (0.5 + 0.9 * glow) * (0.6 + 0.4 * Math.random()) + this.ring * 0.8;
      c.glowMat.color.setRGB(0.5 * I, 0.75 * I, 1.6 * I);
      c.glowMat.visible = I > 0.01;
    }

    onEvent(ev, sim) {
      const e = this.e;
      if (ev.type === 'backfire') {
        if (ev.k > 0.4) {                               // flashover: an arc runs right round the commutator
          this.ring = Math.max(this.ring, 0.5 + 0.8 * ev.k);
          this._sparks(null, Math.round(14 + 26 * ev.k), 1 + ev.k);
          for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.random(); this._plasma(this._bw(new T.Vector3(X_BR, Math.cos(a) * (R_C + 0.08), Math.sin(a) * (R_C + 0.08))), 1, 0.45); }
          e.flash = Math.max(e.flash, 0.45 + 0.6 * ev.k); e.shake = Math.max(e.shake, 0.12 + 0.25 * ev.k);
        } else this._sparks(null, Math.round(4 + 10 * ev.k), 0.7);   // arcing while it coasts down
      } else if (ev.type === 'start') {                  // the line contactor pulls in: a flash in the terminal box
        e.rock = 1; e.flash = Math.max(e.flash, 0.35);
        const p = this.tbG.localToWorld(this.tbL.clone());
        this._plasma(p, 2, 0.25);
        for (let i = 0; i < 8; i++) e.flames.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, 1 + Math.random() * 2, 0.3 + Math.random() * 0.3, 0.02, P_SPARK);
      } else if (ev.type === 'smoke') this.ozone = Math.max(this.ozone, 0.6 + ev.k);   // warm insulation and ozone out of the cage
    }

    /* jagged ribbons from a brush's trailing edge to the commutator surface a little further round */
    _arcs(sim) {
      const e = this.e, cam = e.camera.position, v = new T.Vector3(), side = new T.Vector3(), d = new T.Vector3();
      const pts = []; for (let k = 0; k < ARC_N; k++) pts.push(new T.Vector3());
      e.cyls.forEach((c, i) => {
        const arc = this.arcs[i];
        arc.visible = Math.random() < clamp(0.25 + 0.5 * sim.flame + this.ring, 0, 1);
        if (!arc.visible) return;
        const a0 = (c.i + 0.5) * 2 * Math.PI / this.n, a1 = a0 + (0.45 + Math.random() * 0.6), x1 = X_BR + (Math.random() - 0.5) * 0.5;
        const p0 = c.g.localToWorld(c.tip.clone()), p1 = this._bw(new T.Vector3(x1, Math.cos(a1) * (R_C + 0.01), Math.sin(a1) * (R_C + 0.01)));
        const pos = arc.geometry.attributes.position.array;
        for (let k = 0; k < ARC_N; k++) {
          const u = k / (ARC_N - 1), j = k === 0 || k === ARC_N - 1 ? 0 : 0.07;
          pts[k].lerpVectors(p0, p1, u).add(v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(j * 2));
          pts[k].addScaledVector(v.copy(p0).sub(this._bw(new T.Vector3(X_BR, 0, 0))).normalize(), Math.sin(u * Math.PI) * 0.14);   // bows outwards
        }
        for (let k = 0; k < ARC_N; k++) {
          d.subVectors(pts[Math.min(k + 1, ARC_N - 1)], pts[Math.max(k - 1, 0)]).normalize();
          side.crossVectors(d, v.subVectors(cam, pts[k]).normalize()).normalize().multiplyScalar(0.022 + 0.022 * Math.sin((k / (ARC_N - 1)) * Math.PI));
          pos.set([pts[k].x + side.x, pts[k].y + side.y, pts[k].z + side.z, pts[k].x - side.x, pts[k].y - side.y, pts[k].z - side.z], k * 6);
        }
        arc.geometry.attributes.position.needsUpdate = true;
      });
    }

    updateFx(dt, sim, quality) {
      const e = this.e, run = sim.state === 'running' || sim.state === 'stalling';
      e.time += dt; this.q = quality;
      // sparking level: light at idle, heavy with load and music peaks; the run-up draws a lot
      const lvl = run ? clamp(0.12 + 0.55 * sim.throttle + 1.1 * sim.flame, 0, 2) : sim.state === 'cranking' ? 0.7 : 0;
      this.spark += (lvl - this.spark) * (1 - Math.exp(-dt / 0.08));
      this.ring *= Math.exp(-dt / 0.12);
      if (!isFinite(this.spark)) this.spark = 0;
      const flick = 0.75 + 0.25 * Math.random();
      this.comm.emissiveIntensity = this.spark * 0.04 + this.ring * 0.9;
      e.flameLight.intensity = Math.max(e.flameLight.intensity, (this.spark * 1.1 + this.ring * 4) * flick);
      // flashover ring
      this.ringMat.color.setRGB(0.9 * this.ring * flick, 1.2 * this.ring * flick, 2.4 * this.ring * flick);
      this.rings.forEach((m, k) => { m.visible = this.ring > 0.03; m.rotation.x = Math.random() * 6.28; m.scale.setScalar(1 + (Math.random() - 0.5) * 0.08 * (k + 1)); });
      // arcs, rebuilt every 50 ms while the music peaks
      this.arcT -= dt;
      const arcOn = run && (sim.flame > 0.45 || this.ring > 0.15);
      this.arcI += ((arcOn ? 1 : 0) - this.arcI) * (1 - Math.exp(-dt / 0.05));
      if (arcOn && this.arcT <= 0) { this.arcT = 0.05; this._arcs(sim); }
      if (!arcOn && this.arcI < 0.05) this.arcs.forEach(a => { a.visible = false; });
      const ai = this.arcI * (0.7 + 0.6 * sim.flame) * flick;
      this.arcMat.color.setRGB(0.9 * ai, 1.1 * ai, 2.2 * ai);
      // blur shells over the commutator and the armature bars
      const over = this.rotS.over || 0;
      this.blurC.material.opacity = clamp((over - 0.3) / 0.4, 0, 0.8);
      this.blurA.material.opacity = clamp((over * SEG / SLOTS - 0.35) / 0.5, 0, 0.55);
      this.blurC.visible = this.blurC.material.opacity > 0.01; this.blurA.visible = this.blurA.material.opacity > 0.01;
      // warm insulation / ozone haze out of the cage after a hard stop or start
      if (this.ozone > 0) {
        this.ozone -= dt;
        if (Math.random() < dt * 25) {
          const p = this._bw(new T.Vector3(X_ES - 0.3, R_Y * 0.6 * (Math.random() - 0.3), R_Y * 0.7));
          e.smoke.spawn(p.x, p.y, p.z, (Math.random() - 0.3) * 0.4, 0.4 + Math.random() * 0.4, 0.3 + Math.random() * 0.3, 1.4 + Math.random(), 0.3, P_ARC);
        }
      }
      // torque reaction: every beat twists the frame on its feet about the shaft (e.jolt, sway setting included)
      this.B.rotation.x = -0.012 * e.jolt;
      this.B.updateMatrixWorld(true);
    }
  }
  ElectricLayout.id = 'electric';
  ElectricLayout.kind = 'electric';
  ElectricLayout.title = 'Electric (DC motor)';
  ElectricLayout.turbos = false; ElectricLayout.blower = false;
  L.register(ElectricLayout);

  /* armature current, A (the dash's right gauge): the run-up draws a surge, then it follows the load */
  class ArmatureCurrent {
    constructor() { this.v = 0; this.rise = 0.1; this.fall = 0.25; }
    target(sim) { return 55 + 210 * sim.throttle + 110 * sim.flame + 0.03 * Math.max(0, sim.target - sim.rpm); }
    rest(sim) {
      if (sim.state === 'cranking') return 60 + 330 * Math.exp(-sim.stateT / 0.45);   // starting current through the resistors
      return sim.state === 'stalling' ? 15 : 0;
    }
  }
  EngineTypes.register({
    id: 'electric',
    redline: 7000,                     // internal scale; the dash shows 3500 rpm at its redline
    glow: { color: 0x6fa8ff, css: [110, 160, 255] },
    sim: {
      maxBoost: 360,                   // OVERCURRENT from 335 A
      sources: () => [new ArmatureCurrent()],
      crank: { time: 1.2, rpm: 1200, wobble: 0, rise: 2.2, fire: 1100 },   // no starter: it runs up on the starting resistors
      stall: { rpm: 300, stumble: 0, pops: false },
    },
    dash: red => ({
      tach: { max: 40, red: 35, minor: 1, half: 5, major: 5, text: String, title: 'RPM × 100',
        map: r => r * 35 / red, digits: v => String(Math.round(v * 10) * 10).padStart(4, ' ') },
      left: EngineTypes.tempGauge('WINDING °C'),
      right: { min: 0, max: 400, labels: [0, 100, 200, 300, 400], danger: 340, title: 'ARMATURE A', value: s => s.boost, text: v => String(Math.round(v)), rate: 10 },
      lamps: { stall: 'BREAKER', battery: 'CONTACTOR', overboost: 'OVERCURRENT', oil: 'FIELD LOSS', redline: 'OVERSPEED', check: 'GROUND FLT' },
    }),
  });
})();
