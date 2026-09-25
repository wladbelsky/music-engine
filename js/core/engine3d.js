/* Procedural 3D engine (Three.js r149): scene, lights, materials, particles, camera fit, grounding and rocking,
 * crank timing (firings / exhaust pulses per cylinder) and spinners. Everything engine-specific (the shape, the
 * motion of its parts, the flames or steam) comes from a layout class (js/core/layout.js, js/engines/*). */
(function () {
  'use strict';
  const T = THREE;
  const { makeNoiseTexture, ParticleSystem } = window.EngineFX;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // geometry constants (1 unit ~ 10 cm)
  const P = 1.0, CR = 0.34, ROD = 1.05, BORE = 0.36, DECK = 1.65;
  const FLOOR_GAP = 0.012;  // lowest engine point above the floor while it rocks (rest clearance is 0.02)
  const FIT_RIGHT = 0.14; // landscape fallback until the dash reports its areas (Dash.keepOut): rightmost engine part in NDC

  const FIRING = {
    1: [0], 2: [0, 1], 3: [0, 2, 1], 4: [0, 2, 3, 1], 5: [0, 1, 3, 4, 2], 6: [0, 4, 2, 5, 1, 3],
  };
  function firingOrder(m) {
    if (FIRING[m]) return FIRING[m];
    const o = []; for (let i = 0; i < m; i += 2) o.push(i); for (let i = 1; i < m; i += 2) o.push(i); return o;
  }

  class Engine3D {
    constructor(canvas) {
      this.canvas = canvas;
      const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      r.setClearColor(0x000000, 0);
      r.outputEncoding = T.sRGBEncoding;
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;

      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(30, 16 / 9, 0.1, 200);
      this.camDir = new T.Vector3(0.78, 0.52, 1.0).normalize();
      this.shake = 0;

      this._env();
      this._lights();

      this.pxScale = { value: 500 };
      this.noise = makeNoiseTexture(256);
      this.flames = new ParticleSystem(900, true, this.pxScale, this.noise);
      this.smoke = new ParticleSystem(800, false, this.pxScale, this.noise);
      this.time = 0;
      this.scene.add(this.flames.points, this.smoke.points);

      this.accent = new T.Color(0.75, 0.08, 0.06);
      this.cutaway = true; this.quality = 'high';
      this.crank = 0; this.crankTotal = 0; this.heat = 0; this.flash = 0; this.rock = 0; this.jolt = 0; this.joltV = 0; this._kick0 = 0;
      this._rotM = new T.Matrix4(); this._eul = new T.Euler(); this.lift = 0; this.mountY = 0; this.sway = 1; this.lean = 0; this.vibA = 0; this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.phI = 0;
      this.root = null;
      this.w = 1; this.h = 1;
    }

    _env() {
      const pm = new T.PMREMGenerator(this.renderer);
      const es = new T.Scene();
      const room = new T.Mesh(new T.BoxGeometry(20, 12, 20), new T.MeshBasicMaterial({ color: 0x0c0d10, side: T.BackSide }));
      es.add(room);
      const panel = (w, h, x, y, z, ry, rx, c) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
        m.position.set(x, y, z); m.rotation.y = ry; m.rotation.x = rx; es.add(m);
      };
      panel(10, 1.2, 0, 5.8, 0, 0, Math.PI / 2, new T.Color(4, 3.8, 3.5));     // overhead strip
      panel(4, 6, 9.9, 1, 3, -Math.PI / 2, 0, new T.Color(2.2, 2.1, 2.0));      // front softbox
      panel(3, 5, -9.9, 2, -4, Math.PI / 2, 0, new T.Color(0.6, 0.9, 1.6));     // cool rim
      panel(6, 1, 0, -1, 9.9, Math.PI, 0, new T.Color(1.4, 0.7, 0.3));          // warm low
      this.scene.environment = pm.fromScene(es, 0.03).texture;
      pm.dispose();
    }

    _lights() {
      const s = this.scene;
      s.add(new T.HemisphereLight(0x8090a0, 0x201810, 0.35));
      const key = this.key = new T.DirectionalLight(0xfff1e0, 1.6);
      key.position.set(6, 10, 7); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.035;
      s.add(key); s.add(key.target);
      const rim = new T.DirectionalLight(0x88aaff, 0.9); rim.position.set(-8, 5, -6); s.add(rim);
      this.flameLight = new T.PointLight(0xff7a2a, 0, 9, 2); s.add(this.flameLight);
      this.ground = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShadowMaterial({ opacity: 0.55 }));
      this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; s.add(this.ground);
    }

    setQuality(q) {
      this.quality = q;
      const dpr = window.devicePixelRatio || 1;
      this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.7 : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = q !== 'low';
      this.key.castShadow = q !== 'low';
      const ms = q === 'high' ? 2048 : 1024;
      if (this.key.shadow.mapSize.x !== ms) { this.key.shadow.mapSize.set(ms, ms); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
      this.ground.visible = q !== 'low';
      this.resize(this.w, this.h);
    }

    /* ------------------------------------------------------------ build */
    /* Orchestrates the build; the shape itself comes from a layout class (js/engines/*) and the
       induction parts (js/engines/induction.js). `ind` is a config from Induction.parse(). */
    build(nCyl, layoutId, ind) {
      if (this.root) { this.scene.remove(this.root); this._dispose(this.root); }
      this.flames.clear(); this.smoke.clear();
      this.crank = this.crankTotal = 0;             // every build is grounded and framed in the same pose
      const L = window.EngineLayouts.get(layoutId);
      this.ind = window.Induction.effective(ind && typeof ind === 'object' ? ind : window.Induction.parse(ind), L);
      const n = this.n = L.normCyl(nCyl);
      this.layout = L.id;

      const root = this.root = new T.Group();
      const eng = this.eng = new T.Group(); root.add(eng);
      this.mats = this._materials();
      this.spinners = []; this.compressors = []; this.bovs = []; this.stacks = []; this._edgeGeo = new Map();
      const lay = this.lay = new L(this, n);
      this.type = window.EngineTypes.get(L.kind);
      this.flameLight.color.setHex(this.type.glow ? this.type.glow.color : 0xff7a2a);

      // banks and cylinders
      const banks = this.banks = lay.banks();
      lay.dims(banks);
      this.frontX = lay.frontX; this.rearX = lay.rearX;
      const cyls = this.cyls = [];
      banks.forEach((b, bi) => {
        const grp = new T.Group(); grp.rotation.x = b.tilt * DEG; eng.add(grp); b.grp = grp;
        lay.buildBank(b, bi);
        lay.cylinders(b, bi).forEach(cd => cyls.push(lay.buildCylinder(b, bi, cd)));
      });
      eng.updateMatrixWorld(true);

      lay.buildCase();
      lay.buildCrank(cyls);
      const plen = lay.buildIntake(cyls);
      lay.buildFront(plen);
      this.parts = window.Induction.parts(this.ind);
      this.parts.forEach(p => p.build(this, lay, plen));
      lay.buildRear();
      lay.buildExhaust(cyls);
      // pose the moving parts before grounding: until the first animate() they sit at their origins, and the steam
      // engine's rods hung below the floor there, so the whole engine was grounded on them and floated after one frame
      cyls.forEach(c => lay.animate(c, this._cyc(c, 0), 0));
      lay.finish();

      // center & ground
      eng.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(eng);
      this.foot = this._footPoints(eng, box);
      eng.position.y = -box.min.y + 0.02;
      root.updateMatrixWorld(true);
      this.box = new T.Box3().setFromObject(eng);
      this.ground.position.y = 0;
      this.baseY = this.mountY = eng.position.y; this.lift = 0;
      // soft contact shadow (works on any background, also on 'low' quality)
      const sz = this.box.getSize(new T.Vector3());
      const cs = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ alphaMap: this._blobTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.6 }));
      cs.rotation.x = -Math.PI / 2; cs.scale.set(sz.x * 1.45, sz.z * 1.6, 1);
      const cc0 = this.box.getCenter(new T.Vector3()); cs.position.set(cc0.x, 0.012, cc0.z); cs.renderOrder = 1;
      root.add(cs);
      eng.traverse(o => { if (o.isMesh) { const tr = o.material.transparent; o.castShadow = !tr; o.receiveShadow = !tr; } });
      this.scene.add(root);
      this._applyCutaway();
      this._fitPts = this._fitPoints();
      this._frame();
    }

    /* the lowest vertex per (x, z) cell, engine-local: a small rolled/pitched block can't put anything else lower,
       so _sway keeps these above the floor instead of letting the rocking engine sink through it */
    _footPoints(eng, box) {
      const N = 32, sx = Math.max(1e-6, box.max.x - box.min.x) / N, sz = Math.max(1e-6, box.max.z - box.min.z) / N;
      const low = new Float32Array(N * N * 3).fill(NaN), v = new T.Vector3(), bb = new T.Box3();
      const cutY = box.min.y + 0.5 * (box.max.y - box.min.y);
      eng.traverse(o => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        // a part whose bottom is in the upper half can't become the lowest point under a few degrees of rock
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).min.y > cutY) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);  // eng is at the origin, unrotated, here
          const c = Math.min(N - 1, Math.floor((v.x - box.min.x) / sx)) * N + Math.min(N - 1, Math.floor((v.z - box.min.z) / sz));
          if (!(low[c * 3 + 1] <= v.y)) { low[c * 3] = v.x; low[c * 3 + 1] = v.y; low[c * 3 + 2] = v.z; }
        }
      });
      const pts = [];
      for (let c = 0; c < N * N; c++) if (low[c * 3 + 1] === low[c * 3 + 1]) pts.push(low[c * 3], low[c * 3 + 1], low[c * 3 + 2]);
      return new Float32Array(pts);
    }

    // lowest foot point (engine-local, relative to the pivot) after rotating by roll (X) and pitch (Z)
    _lowest(roll, pitch) {
      const f = this.foot, e = this._rotM.makeRotationFromEuler(this._eul.set(roll, 0, pitch)).elements;
      let lo = Infinity;
      for (let i = 0; i < f.length; i += 3) { const wy = e[1] * f[i] + e[5] * f[i + 1] + e[9] * f[i + 2]; if (wy < lo) lo = wy; }
      return lo;
    }
    // mount height: clearance for the swing the current motion can reach (its envelope, not its phase), so the
    // engine sits on the floor when still and rises on its mounts only as much as it actually rocks
    _mountTarget(rEnv, pEnv, bEnv) {
      if (!this.foot || !this.foot.length) return this.baseY;
      const lo = Math.min(this._lowest(rEnv, pEnv), this._lowest(rEnv, -pEnv), this._lowest(-rEnv, pEnv), this._lowest(-rEnv, -pEnv));
      return Math.max(this.baseY, FLOOR_GAP + bEnv - lo);
    }

    /* pulley group spinning about the crank axis at `ratio` x crank speed */
    _pulley(r, x, y, z, ratio) {
      const M = this.mats, g = new T.Group(); g.position.set(x, y, z);
      const d = new T.Mesh(new T.CylinderGeometry(r, r, 0.12, 32), M.pulley); d.rotation.z = Math.PI / 2; g.add(d);
      for (let k = 0; k < 4; k++) {
        const sp = new T.Mesh(new T.BoxGeometry(0.03, r * 1.7, 0.05), M.steel); sp.position.x = 0.065; sp.rotation.x = k * Math.PI / 4; g.add(sp);
      }
      const hub = new T.Mesh(new T.CylinderGeometry(r * 0.25, r * 0.25, 0.16, 16), M.steel); hub.rotation.z = Math.PI / 2; g.add(hub);
      this.eng.add(g); this.spin(g, ratio);
      return g;
    }
    /* position of cylinder c in its firing cycle at crank angle `crank`, normalised to 0..720
       (period 720; a rotor's cycle is one shaft turn, 360; a double-acting steam cylinder's 180) */
    _cyc(c, crank) { const per = c.period || 720; return (((crank - c.phase) % per + per) % per) * 720 / per; }
    /* pitch (deg, optional) = blade/spoke spacing of a part not tied to the crank: its step per frame is capped at
       0.4 pitch so it never strobes (frozen or running backwards); s.over = the real step in pitches, for blur */
    spin(obj, ratio, off = 0, pitch = 0) { const s = { obj, ratio, a: 0, off, pitch, over: 0 }; this.spinners.push(s); obj.rotation.x = off; return s; }

    _blobTex() {
      if (this._blob) return this._blob;
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      this._blob = new T.CanvasTexture(c); return this._blob;
    }

    _materials() {
      const std = (c, m, r, extra) => new T.MeshStandardMaterial(Object.assign({ color: c, metalness: m, roughness: r }, extra || {}));
      return {
        block: std(0x2c2f34, 0.85, 0.45),
        liner: std(0x9aa0a8, 0.9, 0.3, { transparent: true, opacity: 0.25, depthWrite: false, side: T.DoubleSide }),
        head: std(0x70757d, 0.92, 0.34),
        cover: std(this.accent.clone(), 0.55, 0.28),
        steel: std(0xa9adb3, 1.0, 0.25),
        piston: std(0xb0b4ba, 1.0, 0.3, { emissive: new T.Color(1.0, 0.45, 0.12), emissiveIntensity: 0 }),
        dark: std(0x141518, 0.3, 0.65),
        dark2: std(0x202226, 0.7, 0.45),
        spark: new T.MeshBasicMaterial({ color: 0x331a0a }),
        header: std(0xa89a8e, 1.0, 0.28, { emissive: new T.Color(1.0, 0.32, 0.06), emissiveIntensity: 0 }),
        soot: std(0x17120f, 0.4, 0.85, { side: T.DoubleSide, emissive: new T.Color(1.0, 0.38, 0.08), emissiveIntensity: 0 }),
        pulley: std(0x2b2d31, 0.9, 0.35),
        turbo: std(0x9a9ea5, 0.95, 0.3),
        turboHot: std(0x6b5e55, 0.9, 0.4, { emissive: new T.Color(1.0, 0.3, 0.05), emissiveIntensity: 0 }),
        blower: std(0xc4c8ce, 0.95, 0.28),
        blowerCase: std(0xb4b8be, 0.95, 0.3),   // ghosts in cutaway mode so the rotors show
        brass: std(0xc8a24a, 1.0, 0.3),
        fire: std(0x2a1208, 0.2, 0.8, { emissive: new T.Color(1.0, 0.42, 0.1), emissiveIntensity: 0 }), // firebox door, combustor cans
        edge: new T.LineBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.35 }),
      };
    }

    _edges(mesh, parent, thresholdDeg) {
      // one EdgesGeometry per source geometry (layouts share geometry between identical parts)
      const key = mesh.geometry.uuid + '|' + thresholdDeg, cache = this._edgeGeo || (this._edgeGeo = new Map());
      if (!cache.has(key)) cache.set(key, new T.EdgesGeometry(mesh.geometry, thresholdDeg));
      const e = new T.LineSegments(cache.get(key), this.mats.edge);
      e.position.copy(mesh.position); e.rotation.copy(mesh.rotation); parent.add(e);
      (this._edgeList = this._edgeList || []).push(e);
      mesh.userData.ghost = true;
    }

    /* run a shape extrusion along engine X: shape x -> +z, shape y -> y, the extrusion occupies
       [xFront - depth, xFront] (angles in the shape run +Y -> +Z, the same way as rotation.x) */
    _alongX(geo, depth, xFront) { geo.rotateY(-Math.PI / 2); geo.translate(xFront, 0, 0); return geo; }

    _roundBox(w, h, d, r) {
      const shape = new T.Shape(); const x = -d / 2, y = -h / 2;
      shape.moveTo(x + r, y); shape.lineTo(x + d - r, y); shape.quadraticCurveTo(x + d, y, x + d, y + r);
      shape.lineTo(x + d, y + h - r); shape.quadraticCurveTo(x + d, y + h, x + d - r, y + h);
      shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
      shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
      const g = new T.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 6 });
      g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2);
      return g;
    }

    _toEng(bank, v) { return v.clone().applyMatrix4(bank.grp.matrix); }

    _applyCutaway() {
      const M = this.mats, on = this.cutaway, ghosts = [[M.block, 0.2], [M.blowerCase, 0.3]];
      for (const [m, op] of ghosts) {
        m.transparent = on; m.opacity = on ? op : 1; m.depthWrite = !on;
        m.side = on ? T.DoubleSide : T.FrontSide; m.needsUpdate = true;
      }
      (this._edgeList || []).forEach(e => e.visible = on);
      this.cyls.forEach(c => c.moving.forEach(o => { o.visible = on; }));
      M.liner.visible = on;
      this.root.traverse(o => { if (o.isMesh && (o.material === M.block || o.material === M.blowerCase)) { o.castShadow = !on; o.receiveShadow = !on; } });
    }
    setCutaway(on) { this.cutaway = on; if (this.root) this._applyCutaway(); }
    setAccent(c) { this.accent.copy(c); if (this.mats) this.mats.cover.color.copy(c); }

    _dispose(o) {
      o.traverse(x => {
        if (x.geometry) x.geometry.dispose();
        if (x.material && x.material !== this.mats?.edge) { (Array.isArray(x.material) ? x.material : [x.material]).forEach(m => m.dispose()); }
      });
      this._edgeList = [];
    }

    /* ------------------------------------------------------------ camera */
    resize(w, h, dashSide) {
      this.w = w; this.h = h; if (dashSide) this.dashSide = dashSide;
      this.renderer.setSize(w, h, false);
      this._frame();
    }
    _frame() {
      if (!this.box) return;
      const w = this.w, h = this.h, cam = this.camera;
      const landscape = w / h >= 1.25;
      const box = this.box.clone(); box.max.y += 1.1; // headroom for flames
      if (this.lay) this.lay.frameBox(box);            // e.g. the afterburner plume
      if (this.lay && this.lay.framePad) box.expandByScalar(this.lay.framePad); // flames in every direction (radial)
      const center = box.getCenter(new T.Vector3());
      const radius = box.getSize(new T.Vector3()).length() / 2;
      const tanV = Math.tan(cam.fov * DEG / 2);
      let fw, fh, sx, sy;
      if (landscape) { fw = 0.54; fh = 0.92; sx = -0.2; sy = 0; } else { fw = 0.95; fh = 0.46; sx = 0; sy = 0.25; }
      const shX = -sx * w, shY = -sy * h;
      const fullW = w + 2 * Math.abs(shX), fullH = h + 2 * Math.abs(shY);
      let dist = radius * 0.86 * (fullH / h) / (tanV * Math.min(fh, fw * w / h));
      cam.position.copy(center).addScaledVector(this.camDir, dist);
      cam.lookAt(center);
      cam.aspect = fullW / fullH;
      // keep vertical fov relative to full height
      cam.setViewOffset(fullW, fullH, shX > 0 ? 2 * shX : 0, shY > 0 ? 0 : 2 * Math.abs(shY), w, h);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      // long engines (inline 32, W32...) and low front ends (jet, steam) reach into the dash with the sphere fit:
      // back off until no part covers what the dash draws (bisection: parts near the camera shrink slower than 1/k)
      const place = d => { cam.position.copy(center).addScaledVector(this.camDir, d); cam.lookAt(center); cam.updateMatrixWorld(); };
      if (!this._clear(landscape)) {
        let lo = dist, hi = dist;
        for (let it = 0; it < 12; it++) { hi *= 1.25; place(hi); if (this._clear(landscape)) break; lo = hi; }
        for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; place(mid); if (this._clear(landscape)) hi = mid; else lo = mid; }
        dist = hi; place(dist);
      }
      this.camBase = cam.position.clone();
      this.pxScale.value = (fullH * this.renderer.getPixelRatio() / 2) / tanV;
      // shadow camera
      const k = this.key; k.target.position.copy(center); k.position.copy(center).add(new T.Vector3(-3, 11, 6));
      const sc = k.shadow.camera; const R = radius * 1.2;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix();
    }

    /* the dash's covered areas (CSS px, circles {x, y, r} / rects {x, y, w, h}) from Dash.keepOut(); reframes on change */
    setKeepOut(list) {
      const key = JSON.stringify(list || []);
      if (key === this._koKey) return;
      this._koKey = key; this.keepOut = list || [];
      this._frame();
    }

    /* probe points for the fit: 26 points per mesh (bbox corners, edge and face centres), world space at rest */
    _fitPoints() {
      const pts = [], v = new T.Vector3();
      this.eng.updateMatrixWorld(true);
      this.eng.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox, X = [b.min.x, (b.min.x + b.max.x) / 2, b.max.x], Y = [b.min.y, (b.min.y + b.max.y) / 2, b.max.y], Z = [b.min.z, (b.min.z + b.max.z) / 2, b.max.z];
        for (let i = 0; i < 27; i++) {
          if (i === 13) continue;                        // the centre is inside anyway
          v.set(X[i % 3], Y[Math.floor(i / 3) % 3], Z[Math.floor(i / 9)]).applyMatrix4(o.matrixWorld);
          pts.push(v.x, v.y, v.z);
        }
      });
      return new Float32Array(pts);
    }

    /* true when no probe point lands on the dash (or, before the dash reported its areas, right of FIT_RIGHT) */
    _clear(landscape) {
      const P = this._fitPts; if (!P) return true;
      const cam = this.camera, v = new T.Vector3(), w = this.w, h = this.h, m = 0.012 * w, K = this.keepOut;
      for (let i = 0; i < P.length; i += 3) {
        v.set(P[i], P[i + 1], P[i + 2]).project(cam);
        if (!K) { if (landscape && v.x > FIT_RIGHT) return false; continue; }
        const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
        for (const s of K) {
          if (s.r !== undefined ? Math.hypot(x - s.x, y - s.y) < s.r + m
            : x > s.x - m && x < s.x + s.w + m && y > s.y - m && y < s.y + s.h + m) return false;
        }
      }
      return true;
    }

    /* NDC extent of the engine, from the corners of every mesh's bounding box */
    _extent() {
      const cam = this.camera, ex = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 }, v = new T.Vector3();
      cam.updateMatrixWorld();
      this.eng.updateMatrixWorld(true);
      this.eng.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).project(cam);
          if (v.x < ex.minX) ex.minX = v.x; if (v.x > ex.maxX) ex.maxX = v.x; if (v.y < ex.minY) ex.minY = v.y; if (v.y > ex.maxY) ex.maxY = v.y;
        }
      });
      return ex;
    }

    /* ------------------------------------------------------------ frame */
    update(dt, sim, animSpeed, quality) {
      if (!this.root) return;
      // one NaN in these accumulators (e.g. from a bad setting) would hide the engine for good
      for (const k of ['crank', 'crankTotal', 'heat', 'flash', 'rock', 'lean', 'vibA', 'ph1', 'ph2', 'ph3', 'phI', 'lift', 'jolt', 'joltV', '_kick0']) if (!isFinite(this[k])) this[k] = 0;
      if (!isFinite(this.mountY)) this.mountY = this.baseY || 0;
      for (const s of this.spinners) if (!isFinite(s.a)) s.a = 0;
      const rpm = sim.rpm;
      const running = sim.state === 'running' || sim.state === 'stalling';
      // crank (visual speed scaled down to avoid aliasing)
      const visK = 0.085 * animSpeed * (this.lay.animK || 1);
      const dCrank = rpm / 60 * 360 * visK * dt;
      this.crank = (this.crank + dCrank) % 720;
      this.crankTotal += dCrank;                   // unwrapped, for counting firings (see below)
      const crank = this.crank;
      const lay = this.lay;
      this.cyls.forEach(c => {
        const per = c.period || 720, cyc = this._cyc(c, crank);
        lay.animate(c, cyc, crank);                // pistons/rods (slider-crank) or rotors, from the layout
        // firings (cyc 0) and exhaust openings (cyc 170) since the last frame, counted on the unwrapped crank
        // angle: a frame step bigger than the cycle window (low fps, high rpm, a rotor's 360 period) can't skip them
        const u = (this.crankTotal - c.phase) / per, nFire = Math.floor(u), nExh = Math.floor(u - 170 / 720);
        const fired = c.nFire !== undefined && nFire > c.nFire, opened = c.nExh === undefined ? 0 : Math.min(3, nExh - c.nExh);
        c.nFire = nFire; c.nExh = nExh;
        c.fireGlow = fired ? 1 : (c.fireGlow || 0) * Math.exp(-dt / 0.04);
        // combustion glow; with big steps sampling cyc < 80 would strobe, so use the counted firing instead
        const step = dCrank / per * 720;
        const glow = running ? Math.max(cyc < 80 ? 1 - cyc / 80 : 0, step > 80 ? c.fireGlow : 0) : 0;
        lay.cylinderFx(c, glow, sim);
        // exhaust valve / port opening -> pulse of flame (steam: a chuff)
        if (rpm > 200) for (let k = 0; k < opened; k++) lay.exhaustPulse(c, sim);
      });
      // accumulated per part, so ratios != 1 don't jump when the 720 deg crank angle wraps
      this.spinners.forEach(s => {
        let d = dCrank * s.ratio;
        if (s.pitch) { s.over = Math.abs(d) / s.pitch; d = clamp(d, -0.4 * s.pitch, 0.4 * s.pitch); }
        s.a = (s.a + d) % 360; s.obj.rotation.x = s.a * DEG + s.off;
      });
      this.compressors.forEach(w => w.rotation.x += Math.min(dt * Math.max(0, sim.boost + 0.7) * 40, 0.4 * Math.PI / 4)); // 8 blades: no strobing

      // events
      for (const ev of sim.takeEvents()) lay.onEvent(ev, sim);
      this.flames.update(dt); this.smoke.update(dt);
      this.parts.forEach(p => p.update && p.update(dt, sim));

      // header heat glow
      const heatT = clamp(sim.flame * 0.7 + Math.max(0, rpm / Math.max(500, sim.settings.redline || 7000) - 0.55) * 0.6 + Math.max(0, sim.temp - 100) / 40, 0, 1);
      this.heat += (heatT - this.heat) * (1 - Math.exp(-dt / 1.8));
      this.mats.header.emissiveIntensity = this.heat * 0.9;
      this.mats.soot.emissiveIntensity = clamp(sim.flame * 1.2 + this.flash * 2 + this.heat * 0.3, 0, 1.6);
      this.mats.turboHot.emissiveIntensity = clamp(this.heat * 0.7 + Math.max(0, sim.boost) * 0.25, 0, 1);

      // flame light
      this.flash *= Math.exp(-dt / 0.08);
      // vibration / camera shake
      this._jolt(dt, sim);
      this._sway(dt, sim);
      const gp = lay.glowPoint();
      if (gp) this.flameLight.position.copy(gp).add(new T.Vector3(0, 0.4, 0));
      this.flameLight.intensity = gp ? (sim.flame * 2.2 + this.flash * 4) * (0.85 + Math.random() * 0.3) : 0;
      lay.updateFx(dt, sim, quality);             // the layout's effects (flame jets, steam, plume...)
      this.shake *= Math.exp(-dt / 0.12);
      if (this.camBase) {
        this.camera.position.copy(this.camBase);
        if (this.shake > 0.001) this.camera.position.add(new T.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shake * 0.06));
      }
    }

    /* beat spring for the layouts: a damped oscillator (~4.5 Hz, dies out in ~0.4 s) kicked by every beat (the rise
       of sim.kick), about 1 on a typical beat, up to 2.5; the sway setting is already in it. Engines that don't rock on their mounts
       (on a stand, on a foundation) show the rhythm with it in their own way (js/engines/jet.js, steam.js) */
    _jolt(dt, sim) {
      const kick = sim.kick || 0, dk = Math.max(0, kick - this._kick0), sw = isFinite(this.sway) ? Math.max(0, this.sway) : 1;
      this._kick0 = kick;
      const w = 2 * Math.PI * 4.5, z = 0.3, n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      this.joltV += Math.min(3, dk / 500 * sw) * w;
      for (let i = 0; i < n; i++) { this.joltV += (-w * w * this.jolt - 2 * z * w * this.joltV) * h; this.jolt += this.joltV * h; }
      if (Math.abs(this.jolt) > 2.5) { this.jolt = Math.sign(this.jolt) * 2.5; this.joltV = 0; }
    }

    _sway(dt, sim) {
      const TAU = Math.PI * 2, rpm = sim.rpm, red = Math.max(500, sim.settings.redline || 7000);
      const rn = clamp(rpm / red, 0, 1.1), on = rpm > 60, k = (isFinite(this.sway) ? Math.max(0, this.sway) : 1) * (this.lay.swayK ?? 1);
      // torque reaction: block leans against crank rotation under load
      this.lean += ((on ? sim.throttle : 0) * 0.05 - this.lean) * (1 - Math.exp(-dt / 0.25));
      // vibration amplitude grows with rpm
      const amp = on ? 0.003 + 0.018 * Math.pow(rn, 1.5) : 0;
      this.vibA += (amp - this.vibA) * (1 - Math.exp(-dt / 0.3));
      this.ph1 += dt * (1.0 + 2.4 * rn) * TAU;      // slow sway
      this.ph2 += dt * (5.0 + 10 * rn) * TAU;       // buzz
      this.ph3 += dt * (6.8 + 13 * rn) * TAU;
      this.phI += dt * (rpm / 60) * 0.5 * TAU * 0.25; // lumpy idle
      const A = this.vibA * k;
      let roll = this.lean * k + A * (0.9 * Math.sin(this.ph1) + 0.3 * Math.sin(this.ph2));
      let pitch = A * (0.35 * Math.sin(this.ph1 * 0.71 + 1.3) + 0.18 * Math.sin(this.ph3));
      let bounce = A * 0.9 * Math.sin(this.ph2 * 1.13) + A * 0.4 * Math.sin(this.ph3);
      if (on && rpm < 1400 && !this.lay.smooth) roll += 0.006 * k * (Math.sin(this.phI) + 0.5 * Math.sin(this.phI * 2.3 + 0.7)) * (1 - rpm / 1400);
      const kb = (isFinite(this.sway) ? Math.max(0, this.sway) : 1) * (this.lay.beatK ?? this.lay.swayK ?? 1);
      roll += (sim.kick / red) * 0.03 * kb;                             // beat jolts
      if (sim.state === 'stalling') { roll += (Math.random() - 0.5) * 0.025 * k; pitch += (Math.random() - 0.5) * 0.01 * k; }
      if (sim.state === 'cranking') roll += Math.sin(sim.stateT * 38) * 0.012 * k;
      this.rock *= Math.exp(-dt / 0.35);
      roll += Math.sin(performance.now() / 45) * this.rock * 0.035 * k;
      this.eng.rotation.set(roll, 0, pitch);
      // the pivot stays the engine's own axis; the mounts hold it up by the clearance its current rocking needs
      // (envelope of the terms above). A swing past that (random stall jolts) lifts it
      // at once and lets it settle back slowly, so nothing sinks through the floor
      let rEnv = Math.abs(this.lean * k) + A * 1.2 + Math.abs(sim.kick / red) * 0.03 * kb + this.rock * 0.035 * k;
      if (on && rpm < 1400 && !this.lay.smooth) rEnv += 0.009 * k * (1 - rpm / 1400);
      if (sim.state === 'cranking') rEnv += 0.012 * k;
      const mt = this._mountTarget(rEnv, A * 0.53, A * 0.78);
      this.mountY += (mt - this.mountY) * (1 - Math.exp(-dt / 0.12));
      const y = this.mountY + bounce * 0.6;
      const need = this.foot ? Math.max(0, FLOOR_GAP - (y + this._lowest(roll, pitch))) : 0;
      this.lift = need > this.lift ? need : this.lift + (need - this.lift) * (1 - Math.exp(-dt / 0.4));
      this.eng.position.set(0, y + this.lift, 0);
      this.eng.updateMatrixWorld(true);
      this.lay.afterSway();                        // e.g. the stack tips in world space (tipW/dirW)
    }

    _spark(c, k) {
      const tp = c.tipW || c.tip, d = c.dirW || c.dir, sp = (2.5 + Math.random() * 3) * k;
      this.flames.spawn(tp.x, tp.y, tp.z, d.x * sp + (Math.random() - 0.5) * 1.5, d.y * sp + Math.random() * 1.5, d.z * sp + (Math.random() - 0.5) * 1.5,
        0.4 + Math.random() * 0.5, 0.025 + Math.random() * 0.02, 3);
    }

    _flameP(c, speed, kind) {
      const tp = c.tipW || c.tip, d = c.dirW || c.dir, j = 0.35;
      const sp = (2.2 + Math.random() * 1.4) * speed;
      this.flames.spawn(tp.x, tp.y, tp.z,
        d.x * sp + (Math.random() - 0.5) * j, d.y * sp + (Math.random() - 0.5) * j, d.z * sp + (Math.random() - 0.5) * j,
        (0.16 + Math.random() * 0.18) * (kind ? 1.3 : 1) * (0.7 + speed * 0.3), 0.3 + Math.random() * 0.18 + (kind ? 0.12 : 0), kind);
    }
    _smoke(tip, dir, count, kind) {
      for (let i = 0; i < count; i++) this.smoke.spawn(tip.x, tip.y, tip.z,
        dir.x * 0.8 + (Math.random() - 0.5) * 0.4, dir.y * 0.8 + Math.random() * 0.4, dir.z * 0.8 + (Math.random() - 0.5) * 0.4,
        1.4 + Math.random() * 1.2, 0.35 + Math.random() * 0.2, kind);
    }

    glowScreen() { // screen position of flame area for the 2D glow overlay
      const gp = this.lay && this.lay.glowPoint();
      if (!gp) return null;
      const v = gp.clone().add(new T.Vector3(0, 0.5, 0)).project(this.camera);
      return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h };
    }

    render() { this.renderer.render(this.scene, this.camera); }
  }

  // shared with the layouts and js/engines/induction.js
  Engine3D.GEO = { P, CR, ROD, BORE, DECK, DEG, clamp, firingOrder };
  Engine3D.FX = window.EngineFX;   // shaders, particle kinds, plume (js/core/fx.js)
  window.Engine3D = Engine3D;
})();
