/* Procedural 3D engine (Three.js r149): inline / V / boxer, 2..12 cylinders,
 * fixed three-quarter camera, per-cylinder exhaust stacks with flames. */
(function () {
  'use strict';
  const T = THREE;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // geometry constants (1 unit ~ 10 cm)
  const P = 1.0, CR = 0.34, ROD = 1.05, BORE = 0.36, DECK = 1.65;

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
      this.crank = 0; this.heat = 0; this.flash = 0; this.rock = 0;
      this.sway = 1; this.lean = 0; this.vibA = 0; this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.phI = 0;
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
    build(nCyl, layout, nTurbo = 1) {
      if (this.root) { this.scene.remove(this.root); this._dispose(this.root); }
      this.flames.clear(); this.smoke.clear();
      let n = clamp(nCyl | 0, 1, 16);
      if (layout !== 'inline' && n % 2) n += 1;
      if (layout !== 'inline' && n < 2) n = 2;
      this.n = n; this.layout = layout;
      this.nTurbo = [0, 1, 2, 4].includes(nTurbo) ? nTurbo : 1;

      const root = this.root = new T.Group();
      const eng = this.eng = new T.Group(); root.add(eng);
      const M = this.mats = this._materials();

      // banks
      let banks;
      if (layout === 'inline') banks = [{ tilt: 0, m: n, off: 0, outer: 1 }];
      else {
        const ang = layout === 'boxer' ? 180 : (n === 6 || n === 12) ? 60 : (n === 10 ? 72 : 90);
        const m = n / 2;
        banks = [{ tilt: ang / 2, m, off: -0.21, outer: 1 }, { tilt: -ang / 2, m, off: 0.21, outer: -1 }];
      }
      this.banks = banks;
      const mMax = banks[0].m;
      const len = mMax * P + (banks.length > 1 ? 0.42 : 0) + 0.3;
      this.frontX = len / 2; this.rearX = -len / 2;

      // cylinders list and firing slots
      const cyls = []; const order = firingOrder(mMax);
      banks.forEach((b, bi) => {
        const grp = new T.Group(); grp.rotation.x = b.tilt * DEG; eng.add(grp); b.grp = grp;
        const bl = b.m * P + 0.28;
        // block
        const block = new T.Mesh(new T.BoxGeometry(bl, DECK - 0.3, 1.0), M.block);
        block.position.set(b.off, 0.3 + (DECK - 0.3) / 2, 0); grp.add(block);
        this._edges(block, grp);
        // head + valve cover
        const head = new T.Mesh(new T.BoxGeometry(bl - 0.04, 0.46, 1.02), M.head);
        head.position.set(b.off, DECK + 0.23, 0); head.castShadow = true; grp.add(head);
        const cover = new T.Mesh(this._roundBox(bl - 0.16, 0.32, 0.86, 0.1), M.cover);
        cover.position.set(b.off, DECK + 0.46 + 0.16, 0); cover.castShadow = true; grp.add(cover);
        for (let r = -1; r <= 1; r++) {
          const rib = new T.Mesh(new T.BoxGeometry(bl - 0.4, 0.04, 0.05), M.head);
          rib.position.set(b.off, DECK + 0.795, r * 0.24); grp.add(rib);
        }
        for (let i = 0; i < b.m; i++) {
          const x = (i - (b.m - 1) / 2) * P + b.off;
          // liner
          const liner = new T.Mesh(new T.CylinderGeometry(BORE + 0.03, BORE + 0.03, 0.95, 24, 1, true), M.liner);
          liner.position.set(x, DECK - 0.475, 0); grp.add(liner);
          // piston + rod
          const pm = M.piston.clone();
          const piston = new T.Mesh(new T.CylinderGeometry(BORE, BORE, 0.3, 24), pm);
          grp.add(piston);
          const rod = new T.Mesh(new T.BoxGeometry(0.1, ROD, 0.14), M.steel); grp.add(rod);
          // coil pack
          const coil = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.16, 10), M.dark);
          coil.position.set(x, DECK + 0.86, 0); grp.add(coil);
          const coilGlow = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.03, 8), M.spark.clone());
          coilGlow.position.set(x, DECK + 0.955, 0); grp.add(coilGlow);
          // exhaust port (bank-local)
          const port = new T.Vector3(x, DECK + 0.2, b.outer * 0.52);
          const intake = new T.Vector3(x, DECK + 0.2, -b.outer * 0.52);
          const slot = order.indexOf(i) * banks.length + bi;
          cyls.push({ bank: b, bi, i, x, piston, rod, pm, coilGlow, port, intake, slot, prevCycle: 0 });
        }
      });
      this.cyls = cyls;
      eng.updateMatrixWorld(true);

      // crankcase + oil pan
      const ccW = layout === 'inline' ? 1.1 : layout === 'boxer' ? 1.3 : 1.2 + 0.6 * Math.sin(banks[0].tilt * DEG);
      const cc = new T.Mesh(new T.BoxGeometry(len - 0.05, 0.95, ccW), M.block);
      cc.position.set(0, layout === 'boxer' ? 0 : -0.2, 0); eng.add(cc); this._edges(cc, eng);
      const pan = new T.Mesh(this._roundBox(len - 0.3, 0.42, ccW * 0.85, 0.08), M.dark2);
      pan.position.set(-0.1, layout === 'boxer' ? -0.72 : -0.88, 0); pan.castShadow = true; eng.add(pan);

      // crankshaft
      const shaft = this.shaft = new T.Group(); eng.add(shaft);
      const main = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, len + 0.3, 16), M.steel);
      main.rotation.z = Math.PI / 2; shaft.add(main);
      cyls.forEach(c => {
        const throwG = new T.Group(); throwG.position.x = c.x; eng.add(throwG); c.throwG = throwG;
        const pin = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.26, 12), M.steel);
        pin.rotation.z = Math.PI / 2; pin.position.y = CR; throwG.add(pin);
        for (const s of [-1, 1]) {
          const web = new T.Mesh(new T.BoxGeometry(0.07, CR + 0.42, 0.34), M.steel);
          web.position.set(s * 0.15, (CR - 0.3) / 2, 0); throwG.add(web);
        }
      });

      // intake plenum + runners
      const plen = this._intake(cyls, layout, len, M);
      // front: timing cover, pulleys, turbo
      this._front(layout, len, M, plen);
      // flywheel
      const fw = this.flywheel = new T.Group(); fw.position.x = this.rearX - 0.12; eng.add(fw);
      const disc = new T.Mesh(new T.CylinderGeometry(0.85, 0.85, 0.12, 48), M.steel); disc.rotation.z = Math.PI / 2; disc.castShadow = true; fw.add(disc);
      for (let k = 0; k < 6; k++) {
        const bolt = new T.Mesh(new T.BoxGeometry(0.04, 0.12, 0.12), M.dark);
        bolt.position.set(0.07, Math.cos(k * Math.PI / 3) * 0.55, Math.sin(k * Math.PI / 3) * 0.55); fw.add(bolt);
      }

      // exhaust stacks
      this.stacks = [];
      cyls.forEach(c => this._stack(c, layout, M));

      // center & ground
      eng.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(eng);
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
        edge: new T.LineBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.35 }),
      };
    }

    _edges(mesh, parent) {
      const e = new T.LineSegments(new T.EdgesGeometry(mesh.geometry), this.mats.edge);
      e.position.copy(mesh.position); e.rotation.copy(mesh.rotation); parent.add(e);
      (this._edgeList = this._edgeList || []).push(e);
      mesh.userData.ghost = true;
    }

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

    _intake(cyls, layout, len, M) {
      const eng = this.eng;
      let plenPos, plenSize;
      if (layout === 'inline') { plenPos = new T.Vector3(-0.05, DECK + 0.1, -1.15); plenSize = [len - 0.5, 0.42, 0.5]; }
      else if (layout === 'boxer') { plenPos = new T.Vector3(-0.05, 1.05, 0); plenSize = [len - 0.5, 0.36, 0.7]; }
      else {
        const t = this.banks[0].tilt * DEG;
        plenPos = new T.Vector3(-0.05, Math.cos(t) * (DECK + 0.35) + 0.25, 0); plenSize = [len - 0.4, 0.4, 0.62];
      }
      const plen = new T.Mesh(this._roundBox(plenSize[0], plenSize[1], plenSize[2], 0.12), M.head);
      plen.position.copy(plenPos); plen.castShadow = true; eng.add(plen);
      // throttle body at the front
      const tb = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.3, 24), M.steel);
      tb.rotation.z = Math.PI / 2; tb.position.set(plenPos.x + plenSize[0] / 2 + 0.15, plenPos.y, plenPos.z); eng.add(tb);
      cyls.forEach(c => {
        const a = this._toEng(c.bank, c.intake);
        const outDir = this._toEng(c.bank, new T.Vector3(0, 0, -c.bank.outer)).sub(this._toEng(c.bank, new T.Vector3())).normalize();
        const b = new T.Vector3(a.x, plenPos.y - plenSize[1] * 0.2, plenPos.z + Math.sign(a.z - plenPos.z) * plenSize[2] * 0.35);
        const mid = a.clone().addScaledVector(outDir, 0.25);
        const curve = new T.CatmullRomCurve3([a, mid, b]);
        const tube = new T.Mesh(new T.TubeGeometry(curve, 16, 0.085, 10, false), M.head);
        tube.castShadow = true; eng.add(tube);
      });
      this.tbPos = new T.Vector3(plenPos.x + plenSize[0] / 2 + 0.3, plenPos.y, plenPos.z);
      return { pos: plenPos, size: plenSize };
    }

    _front(layout, len, M, plen) {
      const eng = this.eng, fx = this.frontX;
      const topY = layout === 'boxer' ? 0.5 : (layout === 'inline' ? DECK : Math.cos(this.banks[0].tilt * DEG) * DECK);
      const cover = new T.Mesh(new T.BoxGeometry(0.08, topY + 0.6, layout === 'inline' ? 0.9 : 1.1), M.dark2);
      cover.position.set(fx + 0.02, (topY + 0.6) / 2 - 0.5, 0); eng.add(cover);
      this.pulleys = [];
      const pulley = (r, y, z, ratio) => {
        const g = new T.Group(); g.position.set(fx + 0.14, y, z);
        const d = new T.Mesh(new T.CylinderGeometry(r, r, 0.12, 32), M.pulley); d.rotation.z = Math.PI / 2; g.add(d);
        for (let k = 0; k < 4; k++) {
          const sp = new T.Mesh(new T.BoxGeometry(0.03, r * 1.7, 0.05), M.steel); sp.position.x = 0.065; sp.rotation.x = k * Math.PI / 4; g.add(sp);
        }
        const hub = new T.Mesh(new T.CylinderGeometry(r * 0.25, r * 0.25, 0.16, 16), M.steel); hub.rotation.z = Math.PI / 2; g.add(hub);
        eng.add(g); this.pulleys.push({ g, ratio });
      };
      pulley(0.36, 0, 0, 1);
      pulley(0.22, Math.min(topY, 1.1), 0, 1.6);
      pulley(0.15, 0.55, layout === 'inline' ? -0.62 : -0.7, 2.4);
      this._turbos(layout, M);
    }

    /* Turbos low at the front: one per side on V/boxer (camera side first), all on the exhaust side for inline.
       Size follows the cylinders each turbo feeds (V8 with one turbo = 1.0), so a single turbo on a V12 grows
       and a quad setup gets small ones. No turbos -> an air filter on the throttle body. */
    _turbos(layout, M) {
      const eng = this.eng, nT = this.nTurbo, tb = this.tbPos.clone();
      this.compressors = []; this.bovs = [];
      if (!nT) {
        const f = new T.Group(); f.position.set(tb.x + 0.17, tb.y, tb.z); eng.add(f);
        const el = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.24, 36, 1, true), M.dark2); el.rotation.z = Math.PI / 2; f.add(el);
        for (let k = 0; k < 28; k++) {           // pleats
          const a = k / 28 * Math.PI * 2, p = new T.Mesh(new T.BoxGeometry(0.22, 0.02, 0.03), M.dark);
          p.position.set(0, Math.cos(a) * 0.305, Math.sin(a) * 0.305); p.rotation.x = -a; f.add(p);
        }
        for (const x of [-0.13, 0.13]) {
          const lid = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 0.03, 36), M.steel); lid.rotation.z = Math.PI / 2; lid.position.x = x; f.add(lid);
        }
        const nut = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.05, 6), M.steel); nut.rotation.z = Math.PI / 2; nut.position.x = 0.16; f.add(nut);
        return;
      }
      const s = clamp(this.n / nT / 8, 0.7, 1.6);
      const tz = (layout === 'inline' ? 0.8 : 1.05) + 0.4 * (s - 1), tx = this.frontX + 0.1 + 0.3 * s, gap = 0.85 * s;
      const sides = layout === 'inline' ? [1] : [1, -1];
      const per = nT / sides.length;
      for (let j = 0; j < per; j++) for (const sg of sides) {
        if (sides.length * j + (sg > 0 ? 0 : 1) >= nT) continue;
        const col = j % 2, row = Math.floor(j / 2);
        const x = tx, y = 0.45 + row * gap, z = sg * (tz + col * gap);
        const tg = new T.Group(); tg.position.set(x, y, z); tg.scale.setScalar(s); eng.add(tg);
        const snail = new T.Mesh(new T.TorusGeometry(0.26, 0.13, 14, 32), M.turbo); snail.rotation.y = Math.PI / 2; tg.add(snail);
        const hot = new T.Mesh(new T.TorusGeometry(0.22, 0.12, 12, 28), M.turboHot); hot.rotation.y = Math.PI / 2; hot.position.x = -0.32; tg.add(hot);
        const core = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 0.3, 16), M.steel); core.rotation.z = Math.PI / 2; core.position.x = -0.16; tg.add(core);
        const inlet = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.22, 24, 1, true), M.turbo); inlet.rotation.z = Math.PI / 2; inlet.position.x = 0.16; tg.add(inlet);
        const wheel = new T.Group(); wheel.position.x = 0.18; tg.add(wheel); this.compressors.push(wheel);
        for (let k = 0; k < 8; k++) {
          const bl = new T.Mesh(new T.BoxGeometry(0.02, 0.17, 0.04), M.steel);
          bl.position.set(0, Math.cos(k * Math.PI / 4) * 0.085, Math.sin(k * Math.PI / 4) * 0.085); bl.rotation.x = k * Math.PI / 4 + 0.4; wheel.add(bl);
        }
        // charge pipe turbo -> throttle body
        const a = new T.Vector3(x, y + 0.3 * s, z), m1 = new T.Vector3(x + 0.1, Math.max(1.05, y + 0.6 * s), z * 0.8);
        const curve = new T.CatmullRomCurve3([a, m1, new T.Vector3(tb.x + 0.35, tb.y, tb.z + (z - tb.z) * 0.3), tb]);
        const pipe = new T.Mesh(new T.TubeGeometry(curve, 30, 0.07 + 0.03 * s, 12, false), M.steel); pipe.castShadow = true; eng.add(pipe);
        this.bovs.push(m1);
      }
    }

    _stack(c, layout, M) {
      const b = c.bank;
      const p0 = this._toEng(b, c.port);
      const o = this._toEng(b, new T.Vector3()); // bank origin
      const out = this._toEng(b, new T.Vector3(0, 0, b.outer)).sub(o).normalize();
      const axis = this._toEng(b, new T.Vector3(0, 1, 0)).sub(o).normalize();
      const up = new T.Vector3(0, 1, 0), back = new T.Vector3(-1, 0, 0);
      let p1, p2;
      if (layout === 'boxer') {
        p1 = p0.clone().addScaledVector(out, 0.22);
        p2 = p1.clone().addScaledVector(axis, 0.95).addScaledVector(out, 0.05);
      } else {
        const outH = new T.Vector3(0, 0, Math.sign(out.z) || 1);
        p1 = p0.clone().addScaledVector(outH, 0.24).addScaledVector(up, -0.02);
        p2 = p1.clone().addScaledVector(outH, 0.1).addScaledVector(up, 0.3);
      }
      const rise = Math.max(0.45, (this._topY() + 0.2) - p2.y);
      const p3 = p2.clone().addScaledVector(up, rise * 0.6).addScaledVector(back, 0.06);
      const p4 = p2.clone().addScaledVector(up, rise).addScaledVector(back, 0.2).addScaledVector(p2.clone().sub(p0).setY(0).normalize(), 0.12);
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

    _topY() {
      if (this.layout === 'inline') return DECK + 0.95;
      if (this.layout === 'boxer') return 1.35;
      return Math.cos(this.banks[0].tilt * DEG) * (DECK + 0.9) + 0.4;
    }

    _applyCutaway() {
      const M = this.mats, on = this.cutaway;
      M.block.transparent = on; M.block.opacity = on ? 0.2 : 1; M.block.depthWrite = !on;
      M.block.side = on ? T.DoubleSide : T.FrontSide; M.block.needsUpdate = true;
      (this._edgeList || []).forEach(e => e.visible = on);
      this.cyls.forEach(c => { c.piston.visible = on; c.rod.visible = on; c.throwG.visible = on; });
      M.liner.visible = on;
      this.root.traverse(o => { if (o.isMesh && o.material === M.block) { o.castShadow = !on; o.receiveShadow = !on; } });
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
      const center = box.getCenter(new T.Vector3());
      const radius = box.getSize(new T.Vector3()).length() / 2;
      const tanV = Math.tan(cam.fov * DEG / 2);
      let fw, fh, sx, sy;
      if (landscape) { fw = 0.54; fh = 0.92; sx = -0.2; sy = 0; } else { fw = 0.95; fh = 0.46; sx = 0; sy = 0.25; }
      const shX = -sx * w, shY = -sy * h;
      const fullW = w + 2 * Math.abs(shX), fullH = h + 2 * Math.abs(shY);
      const dist = radius * 0.86 * (fullH / h) / (tanV * Math.min(fh, fw * w / h));
      cam.position.copy(center).addScaledVector(this.camDir, dist);
      cam.lookAt(center);
      this.camBase = cam.position.clone();
      cam.aspect = fullW / fullH;
      // keep vertical fov relative to full height
      cam.setViewOffset(fullW, fullH, shX > 0 ? 2 * shX : 0, shY > 0 ? 0 : 2 * Math.abs(shY), w, h);
      cam.updateProjectionMatrix();
      this.pxScale.value = (fullH * this.renderer.getPixelRatio() / 2) / tanV;
      // shadow camera
      const k = this.key; k.target.position.copy(center); k.position.copy(center).add(new T.Vector3(-3, 11, 6));
      const sc = k.shadow.camera; const R = radius * 1.2;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix();
    }

    /* ------------------------------------------------------------ frame */
    update(dt, sim, animSpeed, quality) {
      if (!this.root) return;
      // one NaN in these accumulators (e.g. from a bad setting) would hide the engine for good
      for (const k of ['crank', 'heat', 'flash', 'rock', 'lean', 'vibA', 'ph1', 'ph2', 'ph3', 'phI']) if (!isFinite(this[k])) this[k] = 0;
      const n = this.n, rpm = sim.rpm;
      const running = sim.state === 'running' || sim.state === 'stalling';
      // crank (visual speed scaled down to avoid aliasing)
      const visK = 0.085 * animSpeed;
      const prevCrank = this.crank;
      this.crank = (this.crank + rpm / 60 * 360 * visK * dt) % 720;
      const crank = this.crank;
      this.cyls.forEach(c => {
        const b = c.bank;
        const cyc = ((crank - c.slot * 720 / n) % 720 + 720) % 720;
        const beta = cyc * DEG;
        const sb = Math.sin(beta), cb = Math.cos(beta);
        const s = CR * cb + Math.sqrt(ROD * ROD - CR * CR * sb * sb);
        c.piston.position.set(c.x, s + 0.08, 0);
        const py = CR * cb, pz = CR * sb;
        const dy = s - py, dz = -pz;
        c.rod.position.set(c.x, (s + py) / 2, pz / 2);
        c.rod.rotation.x = Math.atan2(dz, dy);
        c.throwG.rotation.x = (cyc + b.tilt) * DEG;
        // combustion glow
        const glow = running && cyc < 80 ? (1 - cyc / 80) : 0;
        c.pm.emissiveIntensity = glow * (0.5 + 2.2 * sim.throttle);
        c.coilGlow.material.color.setRGB(0.2 + glow * 1.5, 0.1 + glow * 0.9, 0.05 + glow * 1.8);
        // exhaust valve opening -> pulse of flame
        if (c.prevCycle < 170 && cyc >= 170 && rpm > 200) this._pulse(c, sim);
        c.prevCycle = cyc;
      });
      this.shaft.rotation.x = crank * DEG;
      this.pulleys.forEach(p => p.g.rotation.x = crank * DEG * p.ratio);
      this.flywheel.rotation.x = crank * DEG;
      this.compressors.forEach(w => w.rotation.x += dt * Math.max(0, sim.boost + 0.7) * 40);

      // events
      for (const e of sim.takeEvents()) {
        if (e.type === 'backfire') this._backfire(e.k);
        else if (e.type === 'smoke') this.stacks.forEach(c => this._smoke(c.tipW || c.tip, c.dirW || c.dir, 3 + 4 * e.k, 0));
        else if (e.type === 'bov') this.bovs.forEach(p => { for (let i = 0; i < 26 / this.bovs.length + 4; i++) this.smoke.spawn(p.x, p.y + (this.baseY || 0), p.z, 0.8 + Math.random() * 1.5, 0.6 + Math.random(), (Math.random() - 0.3) * 1.2 * Math.sign(p.z || 1), 0.5 + Math.random() * 0.4, 0.25, 2); });
        else if (e.type === 'start') this.rock = 1;
      }
      this.flames.update(dt); this.smoke.update(dt);

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
      this.eng.position.set(0, (this.baseY || 0) + bounce * 0.6, 0);
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

  window.Engine3D = Engine3D;
})();
