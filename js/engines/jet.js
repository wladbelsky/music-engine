/* Turbojet with afterburner, on a display stand.
 *
 * Axis = X like every layout: intake at the front (+X, towards the dash), nozzle at the back, so the plume
 * runs off to the left of the screen. No pistons: banks() is empty and the whole spool (spinner, 9
 * compressor stages, 2 turbine stages) is one group in Engine3D.spinners. `n` = combustor cans (6..16),
 * seen through the ghosted casing in cutaway mode. Music peaks light the afterburner: a shader plume with
 * shock diamonds, the nozzle petals open; sim.boost is the EGT (the dash's right gauge). */
(function () {
  'use strict';
  const T = THREE;
  const { DEG, clamp } = Engine3D.GEO;
  const { addBlend, FIRE_RAMP } = Engine3D.FX;
  const L = EngineLayouts;

  const HC = 1.3;                                   // axis height above the floor
  const X_IN = 3.2, X_C0 = 2.75, X_C1 = 0.75, X_B1 = -0.7, X_T1 = -1.35, X_N = -3.1; // station x
  const STAGES = 9, PETALS = 14, PETAL_L = 0.55, R_PIPE = 0.62;

  /* casing radius along the engine (front to back) */
  const casingR = x => x > X_C0 ? 0.8 : x > X_C1 ? 0.7 + 0.1 * (x - X_C1) / (X_C0 - X_C1) : x > X_B1 ? 0.74 : 0.68;
  const hubR = x => 0.27 + 0.15 * (X_C0 - x) / (X_C0 - X_C1);

  const AB_VS = `
    uniform vec3 uOrigin; uniform vec3 uDir; uniform float uLen; uniform float uWidth;
    varying vec2 vUv;
    void main(){
      float y = position.y;
      vec3 p = uOrigin + uDir * (y * uLen);
      vec3 side = normalize(cross(uDir, normalize(cameraPosition - p)));
      p += side * position.x * uWidth * (1.0 + 0.7 * y);
      vUv = vec2(position.x + 0.5, y);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`;
  const AB_FS = `
    uniform sampler2D uNoise; uniform float uTime; uniform float uInt; uniform float uSeed; uniform float uLen; uniform float uDiam;
    varying vec2 vUv;
    ${FIRE_RAMP}
    void main(){
      float y = vUv.y, x = (vUv.x - 0.5) * 2.0, z = y * uLen;
      vec2 q = vec2(vUv.x * 0.7 + uSeed, z * 0.3 - uTime * 3.2);
      float n = texture2D(uNoise, q).r;
      float n2 = texture2D(uNoise, q * 2.3 + vec2(0.37, -uTime * 2.1)).g;
      x += (n2 - 0.5) * 0.35 * y;
      // plume: nozzle-wide at first, narrowing into a ragged tip
      float r = mix(0.62, 0.3, smoothstep(0.2, 1.0, y));
      float body = (1.0 - smoothstep(r * 0.45, r, abs(x))) * (1.0 - smoothstep(0.35, 1.0, y + (n - 0.5) * 0.45));
      body *= smoothstep(0.0, 0.03, y) * (0.3 + 0.6 * n);
      // shock diamonds: pinched bright knots at a fixed spacing, fading downstream
      float ph = fract(z / uDiam - 0.35);
      float pinch = 0.22 + 0.5 * abs(ph - 0.5);
      float knot = exp(-pow((ph - 0.5) * 4.5, 2.0)) * (1.0 - smoothstep(pinch * 0.3, pinch, abs(x))) * (1.0 - smoothstep(0.05, 0.7, y));
      // between the knots a translucent orange body, the knots themselves yellow-white
      float temp = body * (0.9 - 0.6 * y) + knot * 0.8;
      vec3 col = fireRamp(temp) * body * 1.1;
      col += vec3(1.0, 0.85, 0.55) * knot * 1.8;
      // blue-violet sheath near the nozzle
      float sheath = smoothstep(r * 0.2, r * 0.8, abs(x)) * (1.0 - smoothstep(r * 0.8, r * 1.05, abs(x))) * (1.0 - smoothstep(0.0, 0.45, y));
      col += vec3(0.35, 0.4, 1.0) * sheath * (0.5 + n);
      gl_FragColor = vec4(col * uInt, 0.0);
    }`;

  class JetLayout extends L.base {
    static normCyl(n) { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 6, 16) : 8; }
    static label(n) { return 'TURBOJET ' + n + '-CAN'; }

    constructor(e, n) {
      super(e, n);
      this.airFilter = false;
      this.animK = 0.3;                   // real speed visible from idle up; above that the blur discs take over
      this.swayK = 0.35; this.smooth = true;
      this.I = 0; this.burst = 0; this.open = 0; this.burn = 0; this.acc = 0;
    }

    banks() { return []; }
    dims() { this.frontX = X_IN + 0.35; this.rearX = X_N - PETAL_L; this.len = this.frontX - this.rearX; }

    get J() {                            // everything hangs off one group on the engine axis
      if (!this._J) { this._J = new T.Group(); this._J.position.y = HC; this.eng.add(this._J); }
      return this._J;
    }
    _mesh(geo, mat, parent) { const m = new T.Mesh(geo, mat); (parent || this.J).add(m); return m; }
    /* a lathe along X from (x, r) points, front to back (built back to front: rising y keeps the normals outward) */
    _latheX(pts, mat, seg = 48, parent) {
      const g = new T.LatheGeometry(pts.slice().reverse().map(([x, r]) => new T.Vector2(r, x)), seg); g.rotateZ(-Math.PI / 2);
      return this._mesh(g, mat, parent);
    }
    _ring(x, r, tube, mat, parent) { const m = this._mesh(new T.TorusGeometry(r, tube, 8, 48), mat, parent); m.rotation.y = Math.PI / 2; m.position.x = x; return m; }
    /* a ring of identical blades (instanced): radial from r0 to r1, twisted by `twist` */
    _blades(x, r0, r1, count, chord, twist, mat, parent) {
      const g = new T.BoxGeometry(0.035, r1 - r0, chord); g.translate(0, (r0 + r1) / 2, 0);
      const im = new T.InstancedMesh(g, mat, count), m = new T.Matrix4(), q = new T.Quaternion(), qa = new T.Quaternion(), qt = new T.Quaternion();
      const one = new T.Vector3(1, 1, 1), pos = new T.Vector3(x, 0, 0);
      qt.setFromAxisAngle(new T.Vector3(0, 1, 0), twist);
      for (let k = 0; k < count; k++) {
        qa.setFromAxisAngle(new T.Vector3(1, 0, 0), k * Math.PI * 2 / count);
        q.copy(qa).multiply(qt); m.compose(pos, q, one); im.setMatrixAt(k, m);
      }
      (parent || this.J).add(im); return im;
    }

    /* casing (ghosts in cutaway), flanges, fuel manifold, gearbox, stand */
    buildCase() {
      const e = this.e, M = this.M, J = this.J;
      // titanium jet pipe and petals that glow with the afterburner, darker blades (less glitter through the casing)
      this.pipeMat = new T.MeshStandardMaterial({ color: 0x8d9197, metalness: 1, roughness: 0.35, emissive: new T.Color(1.0, 0.35, 0.08), emissiveIntensity: 0 });
      this.bladeMat = new T.MeshStandardMaterial({ color: 0x80858c, metalness: 0.9, roughness: 0.5 });
      const pts = []; for (let x = X_C0 + 0.1; x >= X_T1 - 0.001; x -= 0.05) pts.push([x, casingR(x)]);
      const cs = this._latheX(pts, M.block, 48); e._edges(cs, J, 20);
      for (const x of [X_C0 + 0.1, 1.7, X_C1, X_B1, X_T1]) this._ring(x, casingR(x) + 0.01, 0.03, M.steel);
      this._ring(X_C0 + 0.1, 0.815, 0.045, M.cover);
      // fuel manifold ring and feed stubs, igniter plugs
      this._ring(X_C1 - 0.12, 0.8, 0.025, M.brass);
      for (let k = 0; k < this.n; k++) {
        const a = (k + 0.5) * Math.PI * 2 / this.n, stub = this._mesh(new T.CylinderGeometry(0.015, 0.015, 0.08, 6), M.brass);
        stub.position.set(X_C1 - 0.12, Math.cos(a) * 0.76, Math.sin(a) * 0.76); stub.rotation.x = a;
      }
      // accessory gearbox under the compressor, tower shaft housing, oil tank
      const gb = this._mesh(e._roundBox(1.3, 0.28, 0.5, 0.08), M.dark2); gb.position.set(1.7, -0.98, 0);
      const tw = this._mesh(new T.CylinderGeometry(0.06, 0.06, 0.25, 10), M.dark2); tw.position.set(1.7, -0.78, 0);
      const tank = this._mesh(new T.CylinderGeometry(0.16, 0.16, 0.9, 16), M.dark2); tank.rotation.z = Math.PI / 2; tank.position.set(1.2, -0.62, 0.52);
      for (const [x, z] of [[1.4, -0.3], [2.1, 0.3]]) {
        const pump = this._mesh(new T.CylinderGeometry(0.1, 0.1, 0.22, 12), M.steel); pump.position.set(x, -1.2, z);
      }
      // stand: two cradles on rails, the engine hangs in them
      const fy = -HC;
      for (const x of [1.9, -2.3]) {
        const r = (x > 0 ? casingR(x) : R_PIPE) + 0.06;
        const cr = this._mesh(new T.TorusGeometry(r, 0.05, 8, 32, Math.PI), M.dark); cr.rotation.set(Math.PI, Math.PI / 2, 0); cr.position.x = x;
        for (const s of [-1, 1]) {
          const leg = this._mesh(new T.BoxGeometry(0.1, -fy - 0.05, 0.1), M.dark); leg.position.set(x, fy / 2, s * (r + 0.05));
        }
        const foot = this._mesh(new T.BoxGeometry(0.18, 0.06, 2 * r + 0.5), M.dark); foot.position.set(x, fy + 0.03, 0);
      }
      for (const s of [-1, 1]) { const rail = this._mesh(new T.BoxGeometry(4.8, 0.08, 0.1), M.dark); rail.position.set(-0.2, fy + 0.04, s * 0.7); }
    }

    /* the spool: shaft, compressor, turbine; cans are static */
    buildCrank() {
      const e = this.e, M = this.M, rot = this.rot = new T.Group(); this.J.add(rot);
      this.spoolS = e.spin(rot, 1, 0, 360 / 20);   // capped step per frame (first stage: 20 blades), see Engine3D.spin
      const shaft = this._mesh(new T.CylinderGeometry(0.09, 0.09, X_C0 - X_T1 + 0.3, 12), M.steel, rot); shaft.rotation.z = Math.PI / 2; shaft.position.x = (X_C0 + X_T1) / 2;
      // compressor drum (lathe) and stages
      this._latheX([[X_C0 + 0.05, 0.15], [X_C0, hubR(X_C0)], [X_C1, hubR(X_C1)], [X_C1 - 0.05, 0.15]], M.steel, 36, rot);
      // blur discs per blade-row group: a denser row steps more of its own pitch per frame, so it blurs earlier.
      // B = blades of the densest row in the group, cap = max opacity (the first stage, seen down the intake, stays see-through)
      const bm = () => new T.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide });
      this.blurs = [{ mat: bm(), B: 20, cap: 0.35, rings: [] }, { mat: bm(), B: 28, cap: 0.85, rings: [] }, { mat: bm(), B: 48, cap: 0.9, rings: [] }];
      const statorMat = M.dark2;
      for (let s = 0; s < STAGES; s++) {
        const x = X_C0 - 0.08 - s * (X_C0 - X_C1 - 0.12) / (STAGES - 1), r0 = hubR(x), r1 = casingR(x) - 0.03;
        this._blades(x, r0, r1, 20 + s, 0.11 - 0.004 * s, 0.6, this.bladeMat, rot);
        if (s % 2 === 0 && s < STAGES - 1) this._blades(x - 0.1, r0 + 0.02, r1 - 0.01, 22, 0.07, -0.5, statorMat);   // stators, on the casing
        const bg = this.blurs[s === 0 ? 0 : 1], blur = this._mesh(new T.RingGeometry(r0, r1, 40), bg.mat);
        blur.rotation.y = Math.PI / 2; blur.position.x = x; bg.rings.push(blur);
      }
      // inlet guide vanes
      this._blades(X_C0 + 0.1, hubR(X_C0) - 0.1, casingR(X_C0) - 0.02, 20, 0.12, 0.15, M.dark2);
      // combustion: inner drum around the shaft, n cans between drum and casing
      const drum = this._mesh(new T.CylinderGeometry(0.3, 0.3, X_C1 - X_B1, 24), M.dark2); drum.rotation.z = Math.PI / 2; drum.position.x = (X_C1 + X_B1) / 2;
      const rc = 0.52, rcan = Math.min(0.15, Math.PI * rc / this.n * 0.8), cl = X_C1 - X_B1 - 0.35;
      const canG = new T.CylinderGeometry(rcan, rcan * 0.85, cl, 16), domeG = new T.SphereGeometry(rcan, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      for (let k = 0; k < this.n; k++) {
        const a = k * Math.PI * 2 / this.n, y = Math.cos(a) * rc, z = Math.sin(a) * rc;
        const can = this._mesh(canG, M.fire); can.rotation.z = Math.PI / 2; can.position.set(X_C1 - 0.2 - cl / 2, y, z);
        const dome = this._mesh(domeG, M.fire); dome.rotation.z = -Math.PI / 2; dome.position.set(X_C1 - 0.2, y, z);
        const noz = this._mesh(new T.CylinderGeometry(0.02, 0.02, 0.14, 6), M.brass); noz.rotation.z = Math.PI / 2; noz.position.set(X_C1 - 0.16 + 0.07 * rcan, y, z);
      }
      // turbine: nozzle guide vanes (static) + two rotor stages, hot metal
      this._blades(X_B1 - 0.1, 0.33, R_PIPE + 0.02, 34, 0.1, -0.7, M.turboHot);
      for (const [x, cnt] of [[X_B1 - 0.28, 44], [X_B1 - 0.52, 48]]) {
        const disc = this._mesh(new T.CylinderGeometry(0.34, 0.34, 0.08, 28), M.turboHot, rot); disc.rotation.z = Math.PI / 2; disc.position.x = x;
        this._blades(x, 0.34, R_PIPE + 0.02, cnt, 0.08, 0.75, M.turboHot, rot);
        const blur = this._mesh(new T.RingGeometry(0.34, R_PIPE + 0.02, 40), this.blurs[2].mat); blur.rotation.y = Math.PI / 2; blur.position.x = x; this.blurs[2].rings.push(blur);
      }
    }

    /* intake lip in the accent colour and a short bellmouth duct */
    buildIntake() {
      const M = this.M;
      this._latheX([[X_IN, 0.84], [X_IN - 0.1, 0.83], [X_C0 + 0.1, 0.8], [X_C0 + 0.1, 0.76], [X_IN - 0.05, 0.76]], M.head, 48);
      this._ring(X_IN, 0.8, 0.06, M.cover);
      return null;
    }

    /* spinning nose cone with a painted spiral (shows the spool turning) */
    buildFront() {
      const M = this.M, nose = new T.Group(); nose.position.x = X_C0 + 0.1; this.rot.add(nose);
      const cone = this._mesh(new T.LatheGeometry([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55].map(t => new T.Vector2(0.28 * Math.sqrt(1 - t / 0.55), t)), 24), M.steel, nose);
      cone.rotation.z = -Math.PI / 2;
      const sp = []; for (let k = 0; k <= 24; k++) { const t = k / 24, a = t * Math.PI * 1.6, h = t * 0.5, r = 0.28 * Math.sqrt(1 - h / 0.55) + 0.004; sp.push(new T.Vector3(h, Math.cos(a) * r, Math.sin(a) * r)); }
      this._mesh(new T.TubeGeometry(new T.CatmullRomCurve3(sp), 40, 0.018, 5, false), new T.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 }), nose);
    }

    /* tail cone, afterburner pipe (hot: M.header glows with heat), variable nozzle petals */
    buildRear() {
      const e = this.e, M = this.M;
      this._latheX([[X_T1 + 0.05, 0.34], [X_T1 - 0.3, 0.3], [X_T1 - 0.75, 0.05], [X_T1 - 0.8, 0]], M.turboHot, 28);
      const pipe = this._mesh(new T.CylinderGeometry(R_PIPE, R_PIPE, X_T1 - X_N, 40, 1, true), this.pipeMat);
      pipe.rotation.z = Math.PI / 2; pipe.position.x = (X_T1 + X_N) / 2;
      const inside = this._mesh(new T.CylinderGeometry(R_PIPE - 0.02, R_PIPE - 0.02, X_T1 - X_N, 32, 1, true), M.soot);
      inside.rotation.z = Math.PI / 2; inside.position.x = (X_T1 + X_N) / 2; inside.material = M.soot;
      for (const x of [X_T1 - 0.05, X_T1 - 0.6, X_N + 0.55, X_N + 0.05]) this._ring(x, R_PIPE + 0.01, 0.03, M.steel);
      this._ring((X_T1 + X_N) / 2, R_PIPE + 0.012, 0.05, M.cover);
      // flame holders (seen down the nozzle)
      for (const r of [0.22, 0.42]) this._ring(X_T1 - 0.9, r, 0.02, M.dark2);
      // exit glow disc deep in the pipe
      this.exitMat = new T.MeshBasicMaterial({ color: 0x000000, side: T.DoubleSide }); this.exitMat.toneMapped = false;
      const disc = this._mesh(new T.CircleGeometry(R_PIPE - 0.03, 32), this.exitMat); disc.rotation.y = Math.PI / 2; disc.position.x = X_T1 - 1.0;
      // petals: hinged on the pipe end, converging (dry) or opened out (afterburner)
      this.petals = [];
      const w = 2 * Math.PI * R_PIPE / PETALS * 1.12, pg = new T.BoxGeometry(PETAL_L, 0.03, w); pg.translate(-PETAL_L / 2, 0, 0);
      for (let k = 0; k < PETALS; k++) {
        const a = (k + 0.5) * Math.PI * 2 / PETALS, h = new T.Group();
        h.position.set(X_N, Math.cos(a) * R_PIPE, Math.sin(a) * R_PIPE); h.rotation.x = a; this.J.add(h);
        const p = new T.Group(); h.add(p); this._mesh(pg, this.pipeMat, p); this.petals.push(p);
      }
      this._ring(X_N + 0.2, R_PIPE + 0.06, 0.035, M.steel);   // actuator ring
      this.nozzleL = new T.Vector3(X_N - PETAL_L * 0.9, HC, 0);
    }

    /* the afterburner plume: a camera-facing ribbon along -X (world space, like the flame jets) */
    buildExhaust() {
      const g = new T.BufferGeometry(), verts = [], idx = [], SEG = 24;
      for (let k = 0; k <= SEG; k++) { verts.push(-0.5, k / SEG, 0, 0.5, k / SEG, 0); if (k < SEG) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); }
      g.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); g.setIndex(idx);
      const m = new T.ShaderMaterial({
        uniforms: { uNoise: { value: this.e.noise }, uTime: { value: 0 }, uInt: { value: 0 }, uSeed: { value: Math.random() },
          uOrigin: { value: new T.Vector3() }, uDir: { value: new T.Vector3(-1, 0, 0) }, uLen: { value: 3 }, uWidth: { value: 1.2 }, uDiam: { value: 1.1 } },
        vertexShader: AB_VS, fragmentShader: AB_FS, transparent: true, depthWrite: false, side: T.DoubleSide,
      });
      addBlend(m); m.toneMapped = false;
      this.plume = new T.Mesh(g, m); this.plume.frustumCulled = false; this.plume.renderOrder = 11; this.plume.visible = false;
      this.e.root.add(this.plume);
    }

    frameBox(box) { box.min.x -= 1.2; }                 // room for the plume
    glowPoint() { return this.I > 0.02 ? this._w(this.nozzleL).add(this._dirW().multiplyScalar(1.2)) : this._w(this.nozzleL); }
    _dirW() { return new T.Vector3(-1, 0, 0).applyQuaternion(this.eng.quaternion); }

    exhaustPulse() {}
    onEvent(ev, sim) {
      const e = this.e;
      if (ev.type === 'backfire') {                   // afterburner light-up / pop
        this.burst = Math.max(this.burst, 0.45 + 0.6 * ev.k);
        e.flash = Math.max(e.flash, 0.5 + 0.5 * ev.k); e.shake = Math.max(e.shake, 0.15 + 0.3 * ev.k);
        this._sparks(Math.round(4 + 8 * ev.k), 1 + ev.k);
      } else if (ev.type === 'start') { e.rock = 1; this.burst = Math.max(this.burst, 0.8); this._smoke(10); } // torching light-off
      else if (ev.type === 'smoke') this._smoke(Math.round(6 + 10 * ev.k));
    }
    _smoke(m) {
      const e = this.e, p = this._w(this.nozzleL), d = this._dirW();
      for (let i = 0; i < m; i++) e.smoke.spawn(p.x, p.y, p.z, d.x * (1.5 + Math.random() * 2), d.y + Math.random() * 0.5, (Math.random() - 0.5) * 0.6,
        1.6 + Math.random(), 0.45 + Math.random() * 0.2, 0);
    }
    _sparks(m, k) {
      const e = this.e, p = this._w(this.nozzleL), d = this._dirW();
      for (let i = 0; i < m; i++) e.flames.spawn(p.x, p.y + (Math.random() - 0.5) * 0.5, p.z + (Math.random() - 0.5) * 0.5,
        d.x * (5 + Math.random() * 5) * k, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.4, 0.025 + Math.random() * 0.02, 3);
    }

    updateFx(dt, sim, quality) {
      const e = this.e, M = this.M, run = sim.state === 'running' || sim.state === 'stalling';
      e.time += dt;
      // combustion: cans glow with the fuel flow
      const burnT = run ? 0.45 + 1.1 * sim.throttle + 0.8 * sim.flame : sim.state === 'cranking' ? 0.25 * clamp(sim.stateT - 0.4, 0, 1) : 0;
      this.burn += (burnT - this.burn) * (1 - Math.exp(-dt / (burnT > this.burn ? 0.15 : 0.8)));
      M.fire.emissiveIntensity = this.burn * 0.6 * (0.9 + 0.1 * Math.sin(e.time * 37) * Math.sin(e.time * 13.3));
      M.turboHot.emissiveIntensity = clamp((sim.boost - 3.2) / 5, 0, 1) * 0.9;
      this.heat = (this.heat || 0) + ((run ? 0.08 * sim.throttle + 0.75 * clamp(this.I, 0, 1) : 0) - (this.heat || 0)) * (1 - Math.exp(-dt / 1.5));
      this.pipeMat.emissiveIntensity = this.heat;
      // afterburner intensity: the flame state plus bursts on beats
      this.burst *= Math.exp(-dt / 0.25);
      const tgt = sim.flame * 1.05 + this.burst;
      this.I += (tgt - this.I) * (1 - Math.exp(-dt / 0.06));
      if (!isFinite(this.I)) this.I = 0;
      const I = this.I, flick = 0.9 + 0.1 * Math.sin(e.time * 29) * Math.sin(e.time * 11.1);
      // petals: converge dry, open with the afterburner
      this.open += ((I > 0.06 ? 1 : 0) - this.open) * (1 - Math.exp(-dt / 0.2));
      const tilt = (12 - 17 * this.open) * DEG;
      this.petals.forEach(p => { p.rotation.z = tilt; });
      // exit glow: dark at rest, warm with dry thrust, white-hot with reheat
      const g = run ? 0.12 + 0.35 * sim.throttle + 1.2 * I : this.burn * 0.3;
      this.exitMat.color.setRGB(1.0 * g, 0.45 * g + 0.2 * I, 0.15 * g + 0.35 * I);
      // the spool is a spinner capped at 0.4 of a first-stage pitch per frame (Engine3D.spin); how far the real step
      // goes past that shows as blur, per row group in its own pitch
      const over = this.spoolS.over || 0;
      for (const b of this.blurs) {
        b.mat.opacity = clamp((over * b.B / 20 - 0.3) / 0.4, 0, b.cap);
        b.rings.forEach(r => { r.visible = b.mat.opacity > 0.01; });
      }
      // plume
      const u = this.plume.material.uniforms;
      this.plume.visible = I > 0.02;
      if (this.plume.visible) {
        const d = this._dirW(), p = this._w(new T.Vector3(X_N - PETAL_L * 0.85, HC, 0));
        u.uOrigin.value.copy(p); u.uDir.value.copy(d); u.uTime.value = e.time;
        u.uInt.value = Math.min(1.5, I) * flick;
        u.uLen.value = 1.8 + 4.0 * Math.min(1.3, I);
        u.uWidth.value = 1.9 + 0.25 * this.open;
        if (quality !== 'low' && Math.random() < dt * 8 * I) this._sparks(1, 0.8 + I);
      }
      e.flameLight.intensity = Math.max(e.flameLight.intensity, I * 3.5 * flick);
    }
  }
  JetLayout.id = 'jet';
  JetLayout.kind = 'jet';
  JetLayout.title = 'Turbojet';
  JetLayout.turbos = false; JetLayout.blower = false;
  L.register(JetLayout);

  /* exhaust gas temperature, x100 deg C (the dash's EGT gauge) */
  class JetEgt {
    constructor() { this.v = 0; this.rise = 0.35; this.fall = 1.4; }
    target(sim) { return 4.4 + 2.3 * sim.throttle + 1.9 * sim.flame; }
    rest(sim) { return sim.state === 'cranking' ? 1.2 + 4 * clamp(sim.stateT - 0.5, 0, 0.4) : 0.25; } // light-off
  }
  const IDLE = () => window.ENGINE_IDLE || 850;
  EngineTypes.register({
    id: 'jet',
    redline: 7000,                   // internal scale; the dash shows % rpm
    glow: { color: 0xff7a2a, css: [255, 120, 30] },
    sim: { maxBoost: 8.5, sources: () => [new JetEgt()] },
    // turbine: % rpm, ground idle ~60 %, 100 % at the (internal) redline
    dash: red => ({
      tach: { max: 110, red: 100, minor: 2, half: 10, major: 20, text: String, title: '% RPM',
        map: r => r <= IDLE() ? r / IDLE() * 60 : 60 + (r - IDLE()) / Math.max(1, red - IDLE()) * 40, digits: v => v.toFixed(1).padStart(5, ' ') },
      left: EngineTypes.tempGauge('OIL °C'),
      right: { min: 0, max: 10, labels: [0, 2, 4, 6, 8, 10], danger: 8.5, title: 'EGT °C', value: s => s.boost,
        label: v => String(v * 100), text: v => String(Math.round(v * 100)), rate: 10 },
      lamps: { stall: 'FLAMEOUT', overboost: 'EGT HIGH', battery: 'STARTER' },
    }),
  });
})();
