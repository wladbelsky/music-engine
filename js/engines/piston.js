/* Piston engines: the type (sim boost from the forced induction, car instruments) and PistonLayout, the base
 * of the piston layouts in js/engines/piston-layouts.js: a straight block with slider-crank cylinders, a crank,
 * intake plenum, timing cover, flywheel, and zoomie stacks with shader flame jets.
 *
 * Coordinates: crank axis = X (front = +X), up = +Y. A bank is a group rotated about X by `tilt`;
 * inside it the bores point along +Y and `outer` (+1/-1) is the exhaust side along bank-local Z. */
(function () {
  'use strict';
  const T = THREE;
  const { P, CR, ROD, BORE, DECK, DEG, clamp, firingOrder } = Engine3D.GEO;
  const MAX_CYL = EngineLayouts.MAX_CYL;
  // any input -> integer 1..MAX_CYL (non-numeric -> 8)
  const cap = n => { const v = Math.round(Number(n)); return isFinite(v) ? clamp(v, 1, MAX_CYL) : 8; };
  // turbo size: the block's height and width don't depend on the cylinder count, only its length does, so the
  // turbo hardly does either (V2 1.3, V8 1.4, V12 1.5, capped at 1.6); twin/quad turbos keep the single's size
  const turboScale = n => clamp(1.25 + n / 48, 1.25, 1.6);

  class PistonLayout extends EngineLayouts.base {
    static normCyl(n) { return cap(n); }
    static label(n) { return String(n); }

    static normCyl(n) { return cap(n); }
    static label(n) { return String(n); }

    constructor(e, n) {
      super(e, n);
      this.pitch = P;         // cylinder spacing along the crank
      this.lift = 0;          // extra bore height (longer rods), used by the radial
      this.airFilter = true;  // naturally aspirated -> air filter on the throttle body
    }

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
    turboMount() { return null; }       // {s, tx, tz, gap, sides, along: 2nd column along the block (else outward), maxTop?}
    blowerMount(plen) {                 // bottom centre of a Roots blower sitting on the plenum
      if (!plen) return null;
      return { x: plen.pos.x, y: plen.pos.y + plen.size[1] / 2, z: plen.pos.z, len: clamp(this.len * 0.55, 1.1, 3.2) };
    }

    /* ---- builders ---- */
    /* one cylinder: liner, piston, rod, coil (bank-local). cd = {i, x, zo, phase, port?, intake?} from cylinders() */
    buildCylinder(b, bi, cd) {
      const M = this.M, grp = b.grp, lift = this.lift || 0, D = DECK + lift, x = cd.x, zo = cd.zo || 0;
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

    /* ---- exhaust effects: zoomie stacks with shader flame jets ---- */
    buildExhaust(cyls) { cyls.forEach(c => this._stack(c, this.stackPath(c))); }
    /* exhaust stack along the layout's path (engine space); the tip points along p4 - p3 */
    _stack(c, pts) {
      const e = this.e, M = this.M, [p0, p1, p2, p3, p4] = pts;
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
      c.jet = EngineFX.flameJet(e.noise, e.root);
      e.stacks.push(c);
    }

    /* combustion glow on the piston crown and the coil's spark */
    cylinderFx(c, glow, sim) {
      c.pm.emissiveIntensity = glow * (0.5 + 2.2 * sim.throttle);
      c.coilGlow.material.color.setRGB(0.2 + glow * 1.5, 0.1 + glow * 0.9, 0.05 + glow * 1.8);
    }
    exhaustPulse(c, sim) { this._pulse(c, sim); }         // an exhaust opening of cylinder c
    _pulse(c, sim) {
      if (sim.flame > 0.04) { c.pulse = Math.max(c.pulse, 0.3 + 0.55 * sim.flame); if (Math.random() < 0.35 * sim.flame) this.e._flameP(c, 0.9 + sim.flame, 0); }
      else if (sim.limiter && Math.random() < 0.5) { c.pulse = Math.max(c.pulse, 0.45); }
      else if (sim.state === 'running' && sim.rpm < 1100 && Math.random() < 0.08) this.e._smoke(c.tipW || c.tip, c.dirW || c.dir, 1, 0);
    }

    onEvent(ev, sim) {
      const e = this.e;
      if (ev.type === 'backfire') this._backfire(ev.k);
      else if (ev.type === 'smoke') e.stacks.forEach(c => e._smoke(c.tipW || c.tip, c.dirW || c.dir, 3 + 4 * ev.k, 0));
      else if (ev.type === 'bov') e.bovs.forEach(p => { for (let i = 0; i < 26 / e.bovs.length + 4; i++) e.smoke.spawn(p.x, p.y + (e.baseY || 0), p.z, 0.8 + Math.random() * 1.5, 0.6 + Math.random(), (Math.random() - 0.3) * 1.2 * Math.sign(p.z || 1), 0.5 + Math.random() * 0.4, 0.25, 2); });
      else if (ev.type === 'start') e.rock = 1;
    }
    _backfire(k) {
      const e = this.e, list = k > 0.7 ? e.stacks : e.stacks.filter(() => Math.random() < 0.5);
      (list.length ? list : [e.stacks[0]]).forEach(c => {
        c.burst = Math.max(c.burst, 0.6 + 0.8 * k);
        const m = Math.round(2 + 5 * k); for (let i = 0; i < m; i++) e._flameP(c, 1.1 + k, 1);
        const sp = Math.round(3 + 8 * k); for (let i = 0; i < sp; i++) e._spark(c, 1 + k);
      });
      e.flash = Math.max(e.flash, 0.6 + 0.6 * k);
      e.shake = Math.max(e.shake, 0.4 + 0.8 * k);
      if (k > 0.5 && Math.random() < 0.5) e.stacks.forEach(c => e._smoke(c.tipW || c.tip, c.dirW || c.dir, 1, 0));
    }

    updateFx(dt, sim, quality) { this._jets(dt, sim, quality); }
    _jets(dt, sim, quality) {
      const e = this.e;
      e.time += dt;
      const fl = sim.flame;
      e.stacks.forEach((c, i) => {
        c.pulse *= Math.exp(-dt / 0.07); c.burst *= Math.exp(-dt / 0.2);
        const flick = 0.8 + 0.2 * Math.sin(e.time * 31 + i * 1.7) * Math.sin(e.time * 17.3 + i);
        const target = fl * 0.7 * flick + c.pulse + c.burst;
        c.jetI += (target - c.jetI) * (1 - Math.exp(-dt / 0.03));
        const I = c.jetI, u = c.jet.material.uniforms;
        c.jet.visible = I > 0.02;
        if (!c.jet.visible) return;
        u.uTime.value = e.time; u.uInt.value = Math.min(1.6, I);
        u.uOrigin.value.copy(c.tipW || c.tip); u.uDir.value.copy(c.dirW || c.dir);
        u.uLen.value = 0.35 + 1.35 * Math.min(1.5, I);
        u.uWidth.value = 0.2 + 0.16 * Math.min(1.5, I);
        u.uBend.value = 0.18 + 0.12 * (1 - Math.abs(c.dir.y));
        // occasional embers
        if (quality !== 'low' && Math.random() < dt * (2 + 10 * fl)) e._spark(c, 0.6 + fl);
      });
    }

    /* flames and particles start from the stack tips in world space (after the rocking) */
    afterSway() {
      const e = this.e, q = e.eng.quaternion;
      e.stacks.forEach(c => { c.tipW = e.eng.localToWorld(c.tip.clone()); c.dirW = c.dir.clone().applyQuaternion(q); });
    }
    _tipCenter() {
      const v = new T.Vector3(); this.e.stacks.forEach(c => v.add(c.tipW || c.tip)); v.divideScalar(Math.max(1, this.e.stacks.length));
      return v;
    }
    glowPoint() { return this.e.stacks.length ? this._tipCenter() : null; } // world space: flame light, background glow

  }
  PistonLayout.kind = 'piston';
  PistonLayout.turbos = true;    // which forced induction a layout can carry (see Induction.effective)
  PistonLayout.blower = true;

  EngineTypes.register({
    id: 'piston',
    redline: null,                                        // the user's rev limiter
    glow: { color: 0xff7a2a, css: [255, 120, 30] },
    sim: {
      maxBoost: 1.6,
      sources: (s, max) => Induction.boostSources(s, max),   // turbo / Roots / manifold vacuum (js/engines/induction.js)
    },
    dash: red => ({
      tach: { max: Math.ceil((red + 1000) / 1000) * 1000, red, minor: 250, half: 500, major: 1000, text: v => String(v / 1000),
        title: 'RPM × 1000', map: r => r, digits: r => String(Math.round(r / 10) * 10).padStart(4, ' ') },
      left: EngineTypes.tempGauge(),
      right: { min: -1, max: 2, labels: [-1, 0, 1, 2], danger: 1.5, title: 'BOOST bar', value: s => s.boost, text: v => (v >= 0 ? '+' : '') + v.toFixed(2), rate: 10 },
      lamps: {},
    }),
  });

  window.PistonLayout = PistonLayout;
  EngineLayouts.turboScale = turboScale;
})();
