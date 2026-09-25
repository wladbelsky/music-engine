/* Shared effects: the noise texture, additive blending for a transparent canvas, the fire colour ramp, flame-jet
 * and plume shaders, and the particle pools with their registry of particle kinds (EngineFX.particleKind). */
(function () {
  'use strict';
  const T = THREE;

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

  /* ---- particle kinds ----
     A kind = how a particle moves and looks over its life u (0..1). Each has a variant for the additive pool
     (`add`, Engine3D.flames: light) and the normal one (`norm`, Engine3D.smoke); one missing = the other is used.
     {drag (1/s), lift (up acceleration, negative = falls), paint(u, col, k, s0) -> size (writes rgba at col[k]),
      bounce: optional, the particle hits the floor (ParticleSystem.floorY, the ground plane) and bounces back up
      with this fraction of its speed, sliding on at half its speed along the floor (no bounce = falls through it),
      dot: a clean round point instead of a billowy sprite}. particleKind(def) registers one, returns its id. */
  const KINDS = [];
  const fireAdd = alphaK => ({                  // white-blue core -> yellow -> orange -> red -> gone
    drag: 3.2, lift: 2.8,
    paint(u, c, k, s0) {
      let r, g, b;
      if (u < 0.12) { const t = u / 0.12; r = 0.65 + 0.35 * t; g = 0.75 + 0.1 * t; b = 1.0 - 0.55 * t; }
      else if (u < 0.35) { const t = (u - 0.12) / 0.23; r = 1; g = 0.85 - 0.4 * t; b = 0.45 - 0.37 * t; }
      else if (u < 0.7) { const t = (u - 0.35) / 0.35; r = 1 - 0.35 * t; g = 0.45 - 0.33 * t; b = 0.08 - 0.06 * t; }
      else { const t = (u - 0.7) / 0.3; r = 0.65 - 0.4 * t; g = 0.12 - 0.1 * t; b = 0.02; }
      const a = (1 - u) * alphaK;
      c[k] = r * 1.05; c[k + 1] = g * 0.95; c[k + 2] = b; c[k + 3] = a * 0.8;
      return s0 * (0.55 + 1.7 * u);
    },
  });
  const puff = (base, alpha, grow, fade) => ({   // grey-to-white puff: smoke, vapour, steam
    drag: 1.2, lift: 0.9,
    paint(u, c, k, s0) {
      c[k] = base; c[k + 1] = base; c[k + 2] = base * 1.05;
      c[k + 3] = alpha * Math.sin(Math.PI * Math.min(1, u * 1.3)) * (fade ? 1 - fade * u : 1);
      return s0 * (0.5 + grow * u);
    },
  });
  function particleKind(def) { KINDS.push(def); return KINDS.length - 1; }
  const P_FIRE = particleKind({ add: fireAdd(0.95), norm: puff(0.22, 0.42, 2.2) });       // 0: flame / coal smoke
  const P_FIREBALL = particleKind({ add: fireAdd(1.25), norm: puff(0.22, 0.42, 2.2) });   // 1: backfire fireball
  const P_VAPOR = particleKind({ add: fireAdd(0.95), norm: puff(0.85, 0.35, 2.2) });      // 2: BOV vapour
  const P_SPARK = particleKind({ dot: true, add: {                                        // 3: glowing ember, falls
    drag: 0.6, lift: -6.5,
    paint(u, c, k, s0) { const f = 1 - u; c[k] = 1.3; c[k + 1] = 0.75 + 0.25 * f; c[k + 2] = 0.35 * f; c[k + 3] = f; return s0; },
  } });
  const P_STEAM = particleKind({ add: fireAdd(0.95), norm: puff(0.93, 0.5, 3.2, 0.6) });  // 4: steam
  const NONE = KINDS[P_FIRE];

  class ParticleSystem {
    constructor(max, additive, pxScaleRef, noiseTex) {
      this.max = max; this.n = 0;
      this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
      this.age = new Float32Array(max); this.life = new Float32Array(max);
      this.s0 = new Float32Array(max); this.kind = new Uint8Array(max);
      this.col = new Float32Array(max * 4); this.size = new Float32Array(max); this.seed = new Float32Array(max * 3);
      this.cursor = 0; this.additive = additive;
      this.floorY = 0;                              // the ground plane (Engine3D.ground), for kinds that bounce
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
      this.seed[i * 3] = Math.random(); this.seed[i * 3 + 1] = Math.random(); this.seed[i * 3 + 2] = (KINDS[kind] || NONE).dot ? 30 : Math.random() * 6.28;   // dots: a clean round spark (shader)
      this.aSeed.needsUpdate = true;
    }
    update(dt) {
      const p = this.pos, v = this.vel, c = this.col, add = this.additive;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.size[i] = 0; continue; }
        this.age[i] += dt;
        const u = this.age[i] / this.life[i];
        if (u >= 1) { this.life[i] = 0; this.size[i] = 0; continue; }
        const K = KINDS[this.kind[i]] || NONE, d = (add ? K.add : K.norm) || K.add || K.norm;
        const j = i * 3, drag = Math.exp(-dt * d.drag);
        v[j] *= drag; v[j + 1] = v[j + 1] * drag + dt * d.lift; v[j + 2] *= drag;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
        if (d.bounce !== undefined && p[j + 1] < this.floorY) { p[j + 1] = this.floorY; v[j + 1] = -v[j + 1] * d.bounce; v[j] *= 0.5; v[j + 2] *= 0.5; }
        this.size[i] = d.paint(u, c, i * 4, this.s0[i]);
      }
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.size.fill(0); this.aSize.needsUpdate = true; }
  }

  /* afterburner / rocket plume: a camera-facing ribbon along uDir from uOrigin (world space) with a noisy
     body, shock diamonds every uDiam and a blue sheath; uTint colours the whole of it */
  const PLUME_VS = `
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
  const PLUME_FS = `
    uniform sampler2D uNoise; uniform float uTime; uniform float uInt; uniform float uSeed; uniform float uLen; uniform float uDiam;
    uniform vec3 uTint;
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
      gl_FragColor = vec4(col * uTint * uInt, 0.0);
    }`;

  /* a strip of 2 x (seg + 1) vertices, x in -0.5..0.5, y in 0..1 (flame jets, plumes) */
  function ribbon(seg) {
    const g = new T.BufferGeometry(), verts = [], idx = [];
    for (let k = 0; k <= seg; k++) { verts.push(-0.5, k / seg, 0, 0.5, k / seg, 0); if (k < seg) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); }
    g.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); g.setIndex(idx);
    return g;
  }
  /* a flame jet mesh (the piston stacks' zoomies, the marine funnel): hidden, not culled, added to `parent`;
     drive it through .material.uniforms (uOrigin/uDir in world space, uLen, uWidth, uInt, uTime, uBend) */
  function flameJet(noise, parent) {
    const m = new T.ShaderMaterial({
      uniforms: { uNoise: { value: noise }, uTime: { value: 0 }, uInt: { value: 0 }, uSeed: { value: Math.random() },
        uOrigin: { value: new T.Vector3() }, uDir: { value: new T.Vector3(0, 1, 0) }, uLen: { value: 1 }, uWidth: { value: 0.3 }, uBend: { value: 0.25 } },
      vertexShader: JET_VS, fragmentShader: JET_FS,
      transparent: true, depthWrite: false, blending: T.CustomBlending, side: T.DoubleSide,
    });
    addBlend(m); m.toneMapped = false;
    const mesh = new T.Mesh(ribbon(12), m); mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.visible = false;
    parent.add(mesh);
    return mesh;
  }
  /* a plume mesh (hidden, not culled, added to `parent`); drive it through .material.uniforms */
  function plume(noise, parent, { len = 3, width = 1.2, diam = 1.1, dir = new T.Vector3(-1, 0, 0) } = {}) {
    const m = new T.ShaderMaterial({
      uniforms: { uNoise: { value: noise }, uTime: { value: 0 }, uInt: { value: 0 }, uSeed: { value: Math.random() },
        uOrigin: { value: new T.Vector3() }, uDir: { value: dir.clone() }, uLen: { value: len }, uWidth: { value: width }, uDiam: { value: diam },
        uTint: { value: new T.Color(1, 1, 1) } },
      vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, side: T.DoubleSide,
    });
    addBlend(m); m.toneMapped = false;
    const mesh = new T.Mesh(ribbon(24), m); mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.visible = false;
    parent.add(mesh);
    return mesh;
  }

  window.EngineFX = {
    makeNoiseTexture, addBlend, FIRE_RAMP, JET_VS, JET_FS, PLUME_VS, PLUME_FS, ribbon, plume, flameJet,
    ParticleSystem, particleKind,
    P: { FIRE: P_FIRE, FIREBALL: P_FIREBALL, VAPOR: P_VAPOR, SPARK: P_SPARK, STEAM: P_STEAM },
  };
})();
