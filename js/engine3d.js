/* Procedural 3D engine (Three.js r149): scene, camera, cylinders, kinematics, stacks and flames.
 * The engine shape comes from a layout class (js/layouts.js), induction parts from js/induction.js. */
(function () {
  'use strict';
  const T = THREE;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // geometry constants (1 unit ~ 10 cm)
  const P = 1.0, CR = 0.34, ROD = 1.05, BORE = 0.36, DECK = 1.65;
  const FLOOR_GAP = 0.012;  // lowest engine point above the floor while it rocks (rest clearance is 0.02)
  const FIT_RIGHT = 0.14; // landscape: rightmost engine part in NDC (= the old inline 8), keeps it off the dash

  const FIRING = {
    1: [0], 2: [0, 1], 3: [0, 2, 1], 4: [0, 2, 3, 1], 5: [0, 1, 3, 4, 2], 6: [0, 4, 2, 5, 1, 3],
  };
  function firingOrder(m) {
    if (FIRING[m]) return FIRING[m];
    const o = []; for (let i = 0; i < m; i += 2) o.push(i); for (let i = 1; i < m; i += 2) o.push(i); return o;
  }

  /* tileable fBm noise baked once into a texture (R,G = two independent fields) */
  function makeNoiseTexture(N = 256) {
    const lat = (seed, G) => { const a = new Float32Array(G * G); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; } return a; };
    const field = (seed) => {
      const out = new Float32Array(N * N); let amp = 0.5, tot = 0;
      for (let o = 0, G = 8; o < 5; o++, G *= 2) {
        const L = lat(seed + o * 101, G), cell = N / G;
        for (let y = 0; y < N; y++) {
          const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
          const r0 = (y0 % G) * G, r1 = ((y0 + 1) % G) * G;
          for (let x = 0; x < N; x++) {
            const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
            const c0 = x0 % G, c1 = (x0 + 1) % G;
            const a = L[r0 + c0] + (L[r0 + c1] - L[r0 + c0]) * sx, b = L[r1 + c0] + (L[r1 + c1] - L[r1 + c0]) * sx;
            out[y * N + x] += (a + (b - a) * sy) * amp;
          }
        }
        tot += amp; amp *= 0.5;
      }
      for (let i = 0; i < out.length; i++) out[i] /= tot;
      return out;
    };
    const A = field(12345), B = field(777), data = new Uint8Array(N * N * 4);
    const norm = f => { let mn = 1, mx = 0; for (const v of f) { if (v < mn) mn = v; if (v > mx) mx = v; } return v => (v - mn) / (mx - mn); };
    const nA = norm(A), nB = norm(B);
    for (let i = 0; i < N * N; i++) { data[i * 4] = nA(A[i]) * 255; data[i * 4 + 1] = nB(B[i]) * 255; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255; }
    const t = new T.DataTexture(data, N, N, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter; t.needsUpdate = true;
    return t;
  }

  /* additive light that also works on a transparent canvas: add RGB, leave destination alpha untouched */
  function addBlend(m) {
    m.blending = T.CustomBlending; m.blendEquation = T.AddEquation;
    m.blendSrc = T.OneFactor; m.blendDst = T.OneFactor;
    m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneFactor;
  }

  const FIRE_RAMP = `
    vec3 fireRamp(float t){
      vec3 c = mix(vec3(0.35,0.03,0.0), vec3(1.0,0.28,0.03), smoothstep(0.02,0.35,t));
      c = mix(c, vec3(1.0,0.62,0.16), smoothstep(0.3,0.65,t));
      c = mix(c, vec3(1.0,0.9,0.55), smoothstep(0.6,0.95,t));
      return mix(c, vec3(1.0,0.98,0.92), smoothstep(0.95,1.4,t));
    }`;

  const JET_VS = `
    uniform vec3 uOrigin; uniform vec3 uDir; uniform float uLen; uniform float uWidth; uniform float uBend;
    varying vec2 vUv;
    void main(){
      float y = position.y;
      vec3 up = vec3(0.0,1.0,0.0);
      vec3 p = uOrigin + uDir * (y * uLen) + up * (y * y * uLen * uBend);
      vec3 tng = normalize(uDir * uLen + up * (2.0 * y * uLen * uBend));
      vec3 side = normalize(cross(tng, normalize(cameraPosition - p)));
      p += side * position.x * uWidth * (0.55 + 0.9 * y);
      vUv = vec2(position.x + 0.5, y);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`;

  const JET_FS = `
    uniform sampler2D uNoise; uniform float uTime; uniform float uInt; uniform float uSeed;
    varying vec2 vUv;
    ${FIRE_RAMP}
    void main(){
      float y = vUv.y;
      float x = (vUv.x - 0.5) * 2.0;
      float spd = 1.6 + uInt * 1.4;
      vec2 q = vec2(vUv.x * 0.55 + uSeed, y * 0.8 - uTime * spd);
      float n1 = texture2D(uNoise, q).r;
      float n2 = texture2D(uNoise, q * 2.1 + vec2(0.31 + uSeed, -uTime * spd * 0.7)).g;
      float n = n1 * 0.6 + n2 * 0.4;
      x += (n2 - 0.5) * 0.9 * y;                              // turbulent sideways lick
      float width = mix(0.28, 0.85, smoothstep(0.0, 0.3, y)) * (1.0 - 0.45 * smoothstep(0.5, 1.0, y));
      float shape = 1.0 - smoothstep(width * 0.35, width, abs(x));
      float tip = 1.0 - smoothstep(0.25, 0.95, y + (n - 0.5) * 0.7); // ragged, breaking-up tip
      float d = shape * tip * (0.35 + 1.15 * n) * smoothstep(0.0, 0.05, y);
      d = clamp(d * (0.3 + 0.8 * uInt), 0.0, 1.4);
      float temp = d * (1.1 - y * 0.9);
      vec3 col = fireRamp(temp) * d;
      float core = (1.0 - smoothstep(0.0, 0.22, y)) * (1.0 - smoothstep(0.0, 0.45, abs(x))) * uInt;
      col += vec3(0.25, 0.45, 1.0) * core * 0.9;               // blue-white nozzle core
      gl_FragColor = vec4(col, 0.0);
    }`;

  class ParticleSystem {
    constructor(max, additive, pxScaleRef, noiseTex) {
      this.max = max; this.n = 0;
      this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
      this.age = new Float32Array(max); this.life = new Float32Array(max);
      this.s0 = new Float32Array(max); this.kind = new Uint8Array(max);
      this.col = new Float32Array(max * 4); this.size = new Float32Array(max); this.seed = new Float32Array(max * 3);
      this.cursor = 0; this.additive = additive;
      const g = new T.BufferGeometry();
      this.aPos = new T.BufferAttribute(this.pos, 3); this.aPos.setUsage(T.DynamicDrawUsage);
      this.aCol = new T.BufferAttribute(this.col, 4); this.aCol.setUsage(T.DynamicDrawUsage);
      this.aSize = new T.BufferAttribute(this.size, 1); this.aSize.setUsage(T.DynamicDrawUsage);
      this.aSeed = new T.BufferAttribute(this.seed, 3); this.aSeed.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSize); g.setAttribute('aSeed', this.aSeed);
      this.mat = new T.ShaderMaterial({
        uniforms: { uScale: pxScaleRef, uNoise: { value: noiseTex } },
        vertexShader: `attribute float aSize; attribute vec4 aCol; attribute vec3 aSeed; varying vec4 vCol; varying vec3 vSeed; uniform float uScale;
          void main(){ vCol=aCol; vSeed=aSeed; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
          gl_PointSize = aSize*uScale/max(0.1,-mv.z); }`,
        fragmentShader: `uniform sampler2D uNoise; varying vec4 vCol; varying vec3 vSeed;
          void main(){
            vec2 d = gl_PointCoord - 0.5;
            float cs = cos(vSeed.z), sn = sin(vSeed.z);
            vec2 rd = vec2(cs*d.x - sn*d.y, sn*d.x + cs*d.y);
            float r = length(d) * 2.0;
            float n = texture2D(uNoise, rd * 0.45 + vSeed.xy).r;
            float n2 = texture2D(uNoise, rd * 0.9 + vSeed.yx * 1.7).g;
            float edge = r + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.35;   // ragged, billowy outline
            float a = 1.0 - smoothstep(0.35, 1.0, edge);
            if (vSeed.z > 20.0) a = 1.0 - smoothstep(0.2, 1.0, r); // sparks: clean dot
            if (a <= 0.003) discard;
            float body = mix(0.55, 1.25, n);                        // brighter/darker blotches inside
            #ifdef ADDITIVE
            gl_FragColor = vec4(vCol.rgb * body * vCol.a * a, 0.0);
            #else
            gl_FragColor = vec4(vCol.rgb * body, vCol.a * a);
            #endif
          }`,
        transparent: true, depthWrite: false,
        defines: additive ? { ADDITIVE: 1 } : {},
        blending: additive ? T.CustomBlending : T.NormalBlending,
      });
      if (additive) addBlend(this.mat);
      this.mat.toneMapped = false;
      this.points = new T.Points(g, this.mat); this.points.frustumCulled = false;
      this.points.renderOrder = additive ? 10 : 9;
    }
    spawn(x, y, z, vx, vy, vz, life, s0, kind) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.kind[i] = kind;
      this.seed[i * 3] = Math.random(); this.seed[i * 3 + 1] = Math.random(); this.seed[i * 3 + 2] = kind === 3 ? 30 : Math.random() * 6.28;
      this.aSeed.needsUpdate = true;
    }
    update(dt) {
      const p = this.pos, v = this.vel, c = this.col;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.size[i] = 0; continue; }
        this.age[i] += dt;
        const u = this.age[i] / this.life[i];
        if (u >= 1) { this.life[i] = 0; this.size[i] = 0; continue; }
        const kd = this.kind[i], spark = kd === 3;
        const j = i * 3, drag = Math.exp(-dt * (spark ? 0.6 : this.additive ? 3.2 : 1.2));
        v[j] *= drag; v[j + 1] = v[j + 1] * drag + dt * (spark ? -6.5 : this.additive ? 2.8 : 0.9); v[j + 2] *= drag;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
        const k = i * 4;
        if (spark) {
          const f = 1 - u; c[k] = 1.3; c[k + 1] = 0.75 + 0.25 * f; c[k + 2] = 0.35 * f; c[k + 3] = f;
          this.size[i] = this.s0[i];
        } else if (this.additive) {
          // white-blue core -> yellow -> orange -> red -> gone
          let r, g, b;
          if (u < 0.12) { const t = u / 0.12; r = 0.65 + 0.35 * t; g = 0.75 + 0.1 * t; b = 1.0 - 0.55 * t; }
          else if (u < 0.35) { const t = (u - 0.12) / 0.23; r = 1; g = 0.85 - 0.4 * t; b = 0.45 - 0.37 * t; }
          else if (u < 0.7) { const t = (u - 0.35) / 0.35; r = 1 - 0.35 * t; g = 0.45 - 0.33 * t; b = 0.08 - 0.06 * t; }
          else { const t = (u - 0.7) / 0.3; r = 0.65 - 0.4 * t; g = 0.12 - 0.1 * t; b = 0.02; }
          const a = (1 - u) * (this.kind[i] === 1 ? 1.25 : 0.95);
          c[k] = r * 1.05; c[k + 1] = g * 0.95; c[k + 2] = b; c[k + 3] = a * 0.8;
          this.size[i] = this.s0[i] * (0.55 + 1.7 * u);
        } else {
          const base = this.kind[i] === 2 ? 0.85 : 0.22; // 2 = BOV vapor, else smoke
          c[k] = base; c[k + 1] = base; c[k + 2] = base * 1.05;
          c[k + 3] = (this.kind[i] === 2 ? 0.35 : 0.42) * Math.sin(Math.PI * Math.min(1, u * 1.3)) ;
          this.size[i] = this.s0[i] * (0.5 + 2.2 * u);
        }
      }
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.size.fill(0); this.aSize.needsUpdate = true; }
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
      this.smoke = new ParticleSystem(500, false, this.pxScale, this.noise);
      this.time = 0;
      this.scene.add(this.flames.points, this.smoke.points);

      this.accent = new T.Color(0.75, 0.08, 0.06);
      this.cutaway = true; this.quality = 'high';
      this.crank = 0; this.crankTotal = 0; this.heat = 0; this.flash = 0; this.rock = 0;
      this._rotM = new T.Matrix4(); this.sway = 1; this.lean = 0; this.vibA = 0; this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.phI = 0;
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
    /* Orchestrates the build; the shape itself comes from a layout class (js/layouts.js) and the
       induction parts (js/induction.js). `ind` is a config from Induction.parse(). */
    build(nCyl, layoutId, ind) {
      if (this.root) { this.scene.remove(this.root); this._dispose(this.root); }
      this.flames.clear(); this.smoke.clear();
      const L = window.EngineLayouts.get(layoutId);
      this.ind = window.Induction.effective(ind && typeof ind === 'object' ? ind : window.Induction.parse(ind), L);
      const n = this.n = L.normCyl(nCyl);
      this.layout = L.id;

      const root = this.root = new T.Group();
      const eng = this.eng = new T.Group(); root.add(eng);
      this.mats = this._materials();
      this.spinners = []; this.compressors = []; this.bovs = []; this.stacks = []; this._edgeGeo = new Map();
      const lay = this.lay = new L(this, n);

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
      cyls.forEach(c => this._stack(c, lay.stackPath(c)));
      lay.finish();

      // center & ground
      eng.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(eng);
      this.foot = this._footPoints(eng, box);
      eng.position.y = -box.min.y + 0.02;
      root.updateMatrixWorld(true);
      this.box = new T.Box3().setFromObject(eng);
      this.ground.position.y = 0;
      this.baseY = eng.position.y;
      // soft contact shadow (works on any background, also on 'low' quality)
      const sz = this.box.getSize(new T.Vector3());
      const cs = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ alphaMap: this._blobTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.6 }));
      cs.rotation.x = -Math.PI / 2; cs.scale.set(sz.x * 1.45, sz.z * 1.6, 1);
      const cc0 = this.box.getCenter(new T.Vector3()); cs.position.set(cc0.x, 0.012, cc0.z); cs.renderOrder = 1;
      root.add(cs);
      eng.traverse(o => { if (o.isMesh) { const tr = o.material.transparent; o.castShadow = !tr; o.receiveShadow = !tr; } });
      this.scene.add(root);
      this._applyCutaway();
      this._frame();
    }

    /* the lowest vertex per (x, z) cell, engine-local: a small rolled/pitched block can't put anything else lower,
       so _sway keeps these above the floor instead of letting the rocking engine sink through it */
    _footPoints(eng, box) {
      const N = 32, sx = Math.max(1e-6, box.max.x - box.min.x) / N, sz = Math.max(1e-6, box.max.z - box.min.z) / N;
      const low = new Float32Array(N * N * 3).fill(NaN), v = new T.Vector3();
      eng.traverse(o => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
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

    /* one cylinder: liner, piston, rod, coil (bank-local). cd = {i, x, zo, phase, port?, intake?} from the layout */
    _cylinder(b, bi, cd, lay) {
      const M = this.mats, grp = b.grp, lift = lay.lift || 0, D = DECK + lift, x = cd.x, zo = cd.zo || 0;
      const liner = new T.Mesh(new T.CylinderGeometry(BORE + 0.03, BORE + 0.03, 0.95, 24, 1, true), M.liner);
      liner.position.set(x, D - 0.475, zo); grp.add(liner);
      const pm = M.piston.clone();
      const piston = new T.Mesh(new T.CylinderGeometry(BORE, BORE, 0.3, 24), pm);
      grp.add(piston);
      const rodL = ROD + lift;
      const rod = new T.Mesh(new T.BoxGeometry(0.1, rodL, 0.14), M.steel); grp.add(rod);
      const coil = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.16, 10), M.dark);
      coil.position.set(x, D + 0.86, zo); grp.add(coil);
      const coilGlow = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.03, 8), M.spark.clone());
      coilGlow.position.set(x, D + 0.955, zo); grp.add(coilGlow);
      // exhaust / intake ports (bank-local)
      const port = cd.port || new T.Vector3(x, D + 0.2, b.outer * (b.hw + 0.02));
      const intake = cd.intake || new T.Vector3(x, D + 0.2, -b.outer * (b.hw + 0.02));
      // moving: the parts only shown in cutaway (the layout's buildCrank adds the throw)
      return { bank: b, bi, i: cd.i, x, zo, rodL, phase: cd.phase, piston, rod, moving: [piston, rod], pm, coilGlow, port, intake };
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
    spin(obj, ratio, off = 0) { this.spinners.push({ obj, ratio, a: 0, off }); obj.rotation.x = off; }

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

    /* exhaust stack along the layout's path (engine space); the tip points along p4 - p3 */
    _stack(c, pts) {
      const M = this.mats, [p0, p1, p2, p3, p4] = pts;
      const curve = new T.CatmullRomCurve3([p0, p1, p2, p3, p4]);
      const tube = new T.Mesh(new T.TubeGeometry(curve, 36, 0.085, 10, false), M.header);
      tube.castShadow = true; this.eng.add(tube);
      const dir = p4.clone().sub(p3).normalize();
      const tip = new T.Mesh(new T.CylinderGeometry(0.115, 0.095, 0.16, 16, 1, true), M.header);
      tip.position.copy(p4).addScaledVector(dir, -0.04);
      tip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); this.eng.add(tip);
      // inside of the stack: sooty liner + throat disc (otherwise the open end shows through), rolled lip on the rim
      const liner = new T.Mesh(new T.CylinderGeometry(0.104, 0.086, 0.16, 16, 1, true), M.soot);
      liner.position.copy(tip.position); liner.quaternion.copy(tip.quaternion); this.eng.add(liner);
      const throat = new T.Mesh(new T.CircleGeometry(0.09, 16), M.soot);
      throat.position.copy(p4).addScaledVector(dir, -0.09);
      throat.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir); this.eng.add(throat);
      const lip = new T.Mesh(new T.TorusGeometry(0.11, 0.009, 6, 24), M.header);
      lip.position.copy(p4).addScaledVector(dir, 0.04);
      lip.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir); this.eng.add(lip);
      c.tip = p4.clone().addScaledVector(dir, 0.02); c.dir = dir;
      c.pulse = 0; c.burst = 0; c.jetI = 0;
      const jg = new T.BufferGeometry();
      const verts = [], idx = [], SEG = 12;
      for (let k = 0; k <= SEG; k++) { verts.push(-0.5, k / SEG, 0, 0.5, k / SEG, 0); if (k < SEG) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); }
      jg.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); jg.setIndex(idx);
      const jm = new T.ShaderMaterial({
        uniforms: { uNoise: { value: this.noise }, uTime: { value: 0 }, uInt: { value: 0 }, uSeed: { value: Math.random() },
          uOrigin: { value: new T.Vector3() }, uDir: { value: new T.Vector3(0, 1, 0) }, uLen: { value: 1 }, uWidth: { value: 0.3 }, uBend: { value: 0.25 } },
        vertexShader: JET_VS, fragmentShader: JET_FS,
        transparent: true, depthWrite: false, blending: T.CustomBlending, side: T.DoubleSide,
      });
      addBlend(jm); jm.toneMapped = false;
      c.jet = new T.Mesh(jg, jm); c.jet.frustumCulled = false; c.jet.renderOrder = 11; c.jet.visible = false;
      this.root.add(c.jet);
      this.stacks.push(c);
    }

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
      cam.updateProjectionMatrix();
      // long engines (inline 32, V32...) reach under the dash with the sphere fit: back off until the
      // projected parts stay left of FIT_RIGHT
      for (let it = 0; landscape && it < 4; it++) {
        const c0 = center.clone().project(cam), k = (this._extent().maxX - c0.x) / (FIT_RIGHT - c0.x);
        if (!(k > 1.005)) break;
        dist *= k;
        cam.position.copy(center).addScaledVector(this.camDir, dist); cam.lookAt(center);
      }
      this.camBase = cam.position.clone();
      this.pxScale.value = (fullH * this.renderer.getPixelRatio() / 2) / tanV;
      // shadow camera
      const k = this.key; k.target.position.copy(center); k.position.copy(center).add(new T.Vector3(-3, 11, 6));
      const sc = k.shadow.camera; const R = radius * 1.2;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix();
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
      for (const k of ['crank', 'crankTotal', 'heat', 'flash', 'rock', 'lean', 'vibA', 'ph1', 'ph2', 'ph3', 'phI']) if (!isFinite(this[k])) this[k] = 0;
      for (const s of this.spinners) if (!isFinite(s.a)) s.a = 0;
      const rpm = sim.rpm;
      const running = sim.state === 'running' || sim.state === 'stalling';
      // crank (visual speed scaled down to avoid aliasing)
      const visK = 0.085 * animSpeed;
      const dCrank = rpm / 60 * 360 * visK * dt;
      this.crank = (this.crank + dCrank) % 720;
      this.crankTotal += dCrank;                   // unwrapped, for counting firings (see below)
      const crank = this.crank;
      const lay = this.lay;
      this.cyls.forEach(c => {
        // cyc = position in the firing cycle, normalised to 0..720 (a rotor's cycle is one shaft turn, period 360)
        const per = c.period || 720, cyc = (((crank - c.phase) % per + per) % per) * 720 / per;
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
        c.pm.emissiveIntensity = glow * (0.5 + 2.2 * sim.throttle);
        c.coilGlow.material.color.setRGB(0.2 + glow * 1.5, 0.1 + glow * 0.9, 0.05 + glow * 1.8);
        // exhaust valve / port opening -> pulse of flame
        if (rpm > 200) for (let k = 0; k < opened; k++) this._pulse(c, sim);
      });
      // accumulated per part, so ratios != 1 don't jump when the 720 deg crank angle wraps
      this.spinners.forEach(s => { s.a = (s.a + dCrank * s.ratio) % 360; s.obj.rotation.x = s.a * DEG + s.off; });
      this.compressors.forEach(w => w.rotation.x += dt * Math.max(0, sim.boost + 0.7) * 40);

      // events
      for (const e of sim.takeEvents()) {
        if (e.type === 'backfire') this._backfire(e.k);
        else if (e.type === 'smoke') this.stacks.forEach(c => this._smoke(c.tipW || c.tip, c.dirW || c.dir, 3 + 4 * e.k, 0));
        else if (e.type === 'bov') this.bovs.forEach(p => { for (let i = 0; i < 26 / this.bovs.length + 4; i++) this.smoke.spawn(p.x, p.y + (this.baseY || 0), p.z, 0.8 + Math.random() * 1.5, 0.6 + Math.random(), (Math.random() - 0.3) * 1.2 * Math.sign(p.z || 1), 0.5 + Math.random() * 0.4, 0.25, 2); });
        else if (e.type === 'start') this.rock = 1;
      }
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
      const tipC = this._tipCenter();
      this.flameLight.position.copy(tipC).add(new T.Vector3(0, 0.4, 0));
      this.flameLight.intensity = (sim.flame * 2.2 + this.flash * 4) * (0.85 + Math.random() * 0.3);

      // vibration / camera shake
      this._sway(dt, sim);
      this._jets(dt, sim, quality);
      this.shake *= Math.exp(-dt / 0.12);
      if (this.camBase) {
        this.camera.position.copy(this.camBase);
        if (this.shake > 0.001) this.camera.position.add(new T.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shake * 0.06));
      }
    }

    _sway(dt, sim) {
      const TAU = Math.PI * 2, rpm = sim.rpm, red = Math.max(500, sim.settings.redline || 7000);
      const rn = clamp(rpm / red, 0, 1.1), on = rpm > 60, k = this.sway;
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
      if (on && rpm < 1400) roll += 0.006 * k * (Math.sin(this.phI) + 0.5 * Math.sin(this.phI * 2.3 + 0.7)) * (1 - rpm / 1400);
      roll += (sim.kick / red) * 0.03 * k;                              // beat jolts
      if (sim.state === 'stalling') { roll += (Math.random() - 0.5) * 0.025 * k; pitch += (Math.random() - 0.5) * 0.01 * k; }
      if (sim.state === 'cranking') roll += Math.sin(sim.stateT * 38) * 0.012 * k;
      this.rock *= Math.exp(-dt / 0.35);
      roll += Math.sin(performance.now() / 45) * this.rock * 0.035 * k;
      this.eng.rotation.set(roll, 0, pitch);
      // rest on the floor: the lowest foot point after the rotation stays at the grounding clearance or above
      let y = (this.baseY || 0) + bounce * 0.6;
      const f = this.foot;
      if (f && f.length) {
        const e = this._rotM.makeRotationFromEuler(this.eng.rotation).elements;
        let lo = Infinity;
        for (let i = 0; i < f.length; i += 3) { const wy = e[1] * f[i] + e[5] * f[i + 1] + e[9] * f[i + 2]; if (wy < lo) lo = wy; }
        y = Math.max(y, FLOOR_GAP - lo);
      }
      this.eng.position.set(0, y, 0);
      this.eng.updateMatrixWorld(true);
      const q = this.eng.quaternion;
      this.stacks.forEach(c => { c.tipW = this.eng.localToWorld(c.tip.clone()); c.dirW = c.dir.clone().applyQuaternion(q); });
    }

    _jets(dt, sim, quality) {
      this.time += dt;
      const fl = sim.flame;
      this.stacks.forEach((c, i) => {
        c.pulse *= Math.exp(-dt / 0.07); c.burst *= Math.exp(-dt / 0.2);
        const flick = 0.8 + 0.2 * Math.sin(this.time * 31 + i * 1.7) * Math.sin(this.time * 17.3 + i);
        const target = fl * 0.7 * flick + c.pulse + c.burst;
        c.jetI += (target - c.jetI) * (1 - Math.exp(-dt / 0.03));
        const I = c.jetI, u = c.jet.material.uniforms;
        c.jet.visible = I > 0.02;
        if (!c.jet.visible) return;
        u.uTime.value = this.time; u.uInt.value = Math.min(1.6, I);
        u.uOrigin.value.copy(c.tipW || c.tip); u.uDir.value.copy(c.dirW || c.dir);
        u.uLen.value = 0.35 + 1.35 * Math.min(1.5, I);
        u.uWidth.value = 0.2 + 0.16 * Math.min(1.5, I);
        u.uBend.value = 0.18 + 0.12 * (1 - Math.abs(c.dir.y));
        // occasional embers
        if (quality !== 'low' && Math.random() < dt * (2 + 10 * fl)) this._spark(c, 0.6 + fl);
      });
    }

    _spark(c, k) {
      const tp = c.tipW || c.tip, d = c.dirW || c.dir, sp = (2.5 + Math.random() * 3) * k;
      this.flames.spawn(tp.x, tp.y, tp.z, d.x * sp + (Math.random() - 0.5) * 1.5, d.y * sp + Math.random() * 1.5, d.z * sp + (Math.random() - 0.5) * 1.5,
        0.4 + Math.random() * 0.5, 0.025 + Math.random() * 0.02, 3);
    }

    _tipCenter() {
      const v = new T.Vector3(); this.stacks.forEach(c => v.add(c.tipW || c.tip)); v.divideScalar(Math.max(1, this.stacks.length));
      return v;
    }

    _flameP(c, speed, kind) {
      const tp = c.tipW || c.tip, d = c.dirW || c.dir, j = 0.35;
      const sp = (2.2 + Math.random() * 1.4) * speed;
      this.flames.spawn(tp.x, tp.y, tp.z,
        d.x * sp + (Math.random() - 0.5) * j, d.y * sp + (Math.random() - 0.5) * j, d.z * sp + (Math.random() - 0.5) * j,
        (0.16 + Math.random() * 0.18) * (kind ? 1.3 : 1) * (0.7 + speed * 0.3), 0.3 + Math.random() * 0.18 + (kind ? 0.12 : 0), kind);
    }
    _pulse(c, sim) {
      if (sim.flame > 0.04) { c.pulse = Math.max(c.pulse, 0.3 + 0.55 * sim.flame); if (Math.random() < 0.35 * sim.flame) this._flameP(c, 0.9 + sim.flame, 0); }
      else if (sim.limiter && Math.random() < 0.5) { c.pulse = Math.max(c.pulse, 0.45); }
      else if (sim.state === 'running' && sim.rpm < 1100 && Math.random() < 0.08) this._smoke(c.tipW || c.tip, c.dirW || c.dir, 1, 0);
    }
    _backfire(k) {
      const list = k > 0.7 ? this.stacks : this.stacks.filter(() => Math.random() < 0.5);
      (list.length ? list : [this.stacks[0]]).forEach(c => {
        c.burst = Math.max(c.burst, 0.6 + 0.8 * k);
        const m = Math.round(2 + 5 * k); for (let i = 0; i < m; i++) this._flameP(c, 1.1 + k, 1);
        const sp = Math.round(3 + 8 * k); for (let i = 0; i < sp; i++) this._spark(c, 1 + k);
      });
      this.flash = Math.max(this.flash, 0.6 + 0.6 * k);
      this.shake = Math.max(this.shake, 0.4 + 0.8 * k);
      if (k > 0.5 && Math.random() < 0.5) this.stacks.forEach(c => this._smoke(c.tipW || c.tip, c.dirW || c.dir, 1, 0));
    }
    _smoke(tip, dir, count, kind) {
      for (let i = 0; i < count; i++) this.smoke.spawn(tip.x, tip.y, tip.z,
        dir.x * 0.8 + (Math.random() - 0.5) * 0.4, dir.y * 0.8 + Math.random() * 0.4, dir.z * 0.8 + (Math.random() - 0.5) * 0.4,
        1.4 + Math.random() * 1.2, 0.35 + Math.random() * 0.2, kind);
    }

    glowScreen() { // screen position of flame area for the 2D glow overlay
      if (!this.stacks || !this.stacks.length) return null;
      const v = this._tipCenter().add(new T.Vector3(0, 0.5, 0)).project(this.camera);
      return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h };
    }

    render() { this.renderer.render(this.scene, this.camera); }
  }

  // shared with js/layouts.js and js/induction.js
  Engine3D.GEO = { P, CR, ROD, BORE, DECK, DEG, clamp, firingOrder };
  window.Engine3D = Engine3D;
})();
