/* Forced induction: the option registry (the WE `turbos` combo) and the 3D parts.
 *
 * Every part is a class with build(e, layout, plen), called by Engine3D.build() after the layout's
 * front end. Parts attach to mount points the layout provides (turboMount(), blowerMount()); a layout
 * that returns null there simply doesn't get that part. The boost behaviour lives in js/sim.js.
 *
 * To add an option: add it to OPTIONS (and the combo in project.json / dev panel), then to parts(). */
(function () {
  'use strict';
  const T = THREE;
  const { clamp } = Engine3D.GEO;

  const OPTIONS = {
    '0': { turbos: 0, blower: false },
    '1': { turbos: 1, blower: false },
    '2': { turbos: 2, blower: false },
    '4': { turbos: 4, blower: false },
    sc: { turbos: 0, blower: true },     // Roots blower on top
    sc2: { turbos: 2, blower: true },    // twincharged: blower + twin turbos
  };

  /* ------------------------------------------------------------ naturally aspirated: air filter */
  class AirFilter {
    build(e, lay) {
      if (!lay.airFilter || !e.tbPos) return;
      const M = e.mats, tb = e.tbPos;
      const f = new T.Group(); f.position.set(tb.x + 0.17, tb.y, tb.z); e.eng.add(f);
      const el = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.24, 36, 1, true), M.dark2); el.rotation.z = Math.PI / 2; f.add(el);
      for (let k = 0; k < 28; k++) {           // pleats
        const a = k / 28 * Math.PI * 2, p = new T.Mesh(new T.BoxGeometry(0.22, 0.02, 0.03), M.dark);
        p.position.set(0, Math.cos(a) * 0.305, Math.sin(a) * 0.305); p.rotation.x = -a; f.add(p);
      }
      for (const x of [-0.13, 0.13]) {
        const lid = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 0.03, 36), M.steel); lid.rotation.z = Math.PI / 2; lid.position.x = x; f.add(lid);
      }
      const nut = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.05, 6), M.steel); nut.rotation.z = Math.PI / 2; nut.position.x = 0.16; f.add(nut);
    }
  }

  /* ------------------------------------------------------------ turbos
     Low at the front, laid out by the layout's turboMount(): 2 columns x rows per side. Size follows the
     engine (V8 = 1.0, V12 = 1.5); twin/quad use the same size as a single, they just multiply.
     Each gets a charge pipe to e.tbPos (the throttle body, or the blower hat when twincharged). */
  class TurboSet {
    constructor(n) { this.n = n; }
    build(e, lay) {
      const mt = lay.turboMount(); if (!mt || !e.tbPos) return;
      const M = e.mats, nT = this.n, tb = e.tbPos.clone(), { s, tx, tz, gap, sides, inline: inl } = mt;
      const per = nT / sides.length;
      for (let j = 0; j < per; j++) for (const sg of sides) {
        if (sides.length * j + (sg > 0 ? 0 : 1) >= nT) continue;
        const col = j % 2, row = Math.floor(j / 2);
        // second column: outward on V/boxer; along the block on inline (outward would hide it behind the first)
        const x = inl ? tx - col * gap : tx, y = 0.45 + row * gap, z = sg * (tz + (inl ? 0 : col * gap));
        const tg = new T.Group(); tg.position.set(x, y, z); tg.scale.setScalar(s); e.eng.add(tg);
        const snail = new T.Mesh(new T.TorusGeometry(0.26, 0.13, 14, 32), M.turbo); snail.rotation.y = Math.PI / 2; tg.add(snail);
        const hot = new T.Mesh(new T.TorusGeometry(0.22, 0.12, 12, 28), M.turboHot); hot.rotation.y = Math.PI / 2; hot.position.x = -0.32; tg.add(hot);
        const core = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 0.3, 16), M.steel); core.rotation.z = Math.PI / 2; core.position.x = -0.16; tg.add(core);
        const inlet = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.22, 24, 1, true), M.turbo); inlet.rotation.z = Math.PI / 2; inlet.position.x = 0.16; tg.add(inlet);
        const wheel = new T.Group(); wheel.position.x = 0.18; tg.add(wheel); e.compressors.push(wheel);
        for (let k = 0; k < 8; k++) {
          const bl = new T.Mesh(new T.BoxGeometry(0.02, 0.17, 0.04), M.steel);
          bl.position.set(0, Math.cos(k * Math.PI / 4) * 0.085, Math.sin(k * Math.PI / 4) * 0.085); bl.rotation.x = k * Math.PI / 4 + 0.4; wheel.add(bl);
        }
        // charge pipe turbo -> throttle body / blower hat
        const a = new T.Vector3(x, y + 0.3 * s, z), m1 = new T.Vector3(x + 0.1, Math.max(1.05, y + 0.6 * s), z * 0.8);
        const curve = new T.CatmullRomCurve3([a, m1, new T.Vector3(tb.x + 0.35, tb.y, tb.z + (z - tb.z) * 0.3), tb]);
        const pipe = new T.Mesh(new T.TubeGeometry(curve, 30, 0.07 + 0.03 * s, 12, false), M.steel); pipe.castShadow = true; e.eng.add(pipe);
        e.bovs.push(m1);
      }
    }
  }

  /* ------------------------------------------------------------ Roots blower
     Finned case on the intake manifold, two 3-lobe rotors (visible in cutaway), belt from the crank
     pulley. Blower only: a bug-catcher scoop on top. Twincharged: a closed hat the turbos blow into. */
  class RootsBlower {
    constructor(hat) { this.hat = hat; }
    build(e, lay, plen) {
      const mt = lay.blowerMount(plen); if (!mt) return;
      const M = e.mats, eng = e.eng, L = mt.len, cp = lay.crankPulley;
      const H = 0.52, W = 0.78, base = 0.12, top = base + H, cy = base + H / 2;
      // the pulley sits in the crank pulley's plane; keep a short snout in front of the case
      const px = cp.x, bx = Math.max(mt.x, px - 0.6 - L / 2);
      const bp = { y: mt.y + cy, z: mt.z, r: 0.26 }, ratio = cp.r / bp.r;   // belt drive: overdriven
      const g = new T.Group(); g.position.set(bx, mt.y, mt.z); eng.add(g);
      const plate = new T.Mesh(new T.BoxGeometry(L + 0.1, base, W + 0.08), M.dark2); plate.position.y = base / 2; g.add(plate);
      const cs = new T.Mesh(e._roundBox(L, H, W, 0.12), M.blowerCase); cs.position.y = cy; g.add(cs);
      for (const sx of [-1, 1]) {
        const end = new T.Mesh(e._roundBox(0.07, H + 0.04, W + 0.04, 0.12), M.blower); end.position.set(sx * (L / 2 + 0.02), cy, 0); g.add(end);
      }
      for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) {   // side ribs
        const rib = new T.Mesh(new T.BoxGeometry(L - 0.2, 0.025, 0.035), M.blower);
        rib.position.set(0, base + 0.1 + k * 0.1, sz * (W / 2 + 0.045)); g.add(rib);
      }
      // rotors: 3-lobe profile extruded along X, counter-rotating, lobes interleaved
      const lobe = new T.Shape(), N = 60;
      for (let k = 0; k <= N; k++) {
        const a = k / N * Math.PI * 2, r = 0.105 + 0.068 * Math.cos(3 * a);
        if (k === 0) lobe.moveTo(Math.cos(a) * r, Math.sin(a) * r); else lobe.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const rl = L - 0.16, rg = new T.ExtrudeGeometry(lobe, { depth: rl, bevelEnabled: false, curveSegments: 4 });
      rg.translate(0, 0, -rl / 2); rg.rotateY(Math.PI / 2);
      for (const sz of [-1, 1]) {
        const rot = new T.Group(); rot.position.set(0, cy, sz * 0.172); g.add(rot);
        rot.add(new T.Mesh(rg, M.steel));
        e.spin(rot, sz * ratio, sz > 0 ? Math.PI / 3 : 0);
      }
      // snout, pulley and belt
      const fx = bx + L / 2 + 0.05, sn = new T.Mesh(new T.CylinderGeometry(0.1, 0.13, px - fx, 16), M.blower);
      sn.rotation.z = Math.PI / 2; sn.position.set((fx + px) / 2 - bx, cy, 0); g.add(sn);
      e._pulley(bp.r, px, bp.y, bp.z, ratio);
      this._belt(e, px, cp, bp);
      // top: scoop or pressure hat
      if (this.hat) {
        const hx = L / 2 - 0.5, hat = new T.Mesh(e._roundBox(0.8, 0.28, 0.62, 0.1), M.blower);
        hat.position.set(hx, top + 0.14, 0); g.add(hat);
        const inl = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 0.26, 20), M.blower);
        inl.rotation.z = Math.PI / 2; inl.position.set(hx + 0.5, top + 0.14, 0); g.add(inl);
        e.tbPos = new T.Vector3(bx + hx + 0.62, mt.y + top + 0.14, mt.z);
      } else this._scoop(e, g, top);
    }

    /* two straight belt runs tangent to both pulleys (in the YZ plane, so a slanted belt works too) */
    _belt(e, x, a, b) {
      const dy = b.y - a.y, dz = b.z - a.z, D = Math.hypot(dy, dz);
      if (D <= Math.abs(a.r - b.r)) return;
      const phi = Math.atan2(dz, dy), al = Math.acos((a.r - b.r) / D);
      for (const sg of [-1, 1]) {
        const t = phi + sg * al, ny = Math.cos(t), nz = Math.sin(t);
        const y1 = a.y + a.r * ny, z1 = a.z + a.r * nz, y2 = b.y + b.r * ny, z2 = b.z + b.r * nz;
        const len = Math.hypot(y2 - y1, z2 - z1);
        const strip = new T.Mesh(new T.BoxGeometry(0.1, len, 0.028), e.mats.dark);
        strip.position.set(x, (y1 + y2) / 2, (z1 + z2) / 2); strip.rotation.x = Math.atan2(z2 - z1, y2 - y1);
        e.eng.add(strip);
      }
    }

    /* butterfly injector hat ("shotgun" scoop): a polished stadium-shaped mouth facing forward and a bit up,
       three big round butterflies in a row on one cross shaft, a linkage lever outside. They open with the
       throttle (update). The butterflies use the valve cover colour. */
    _scoop(e, g, top) {
      const M = e.mats;
      const stadium = (w, h) => {               // rounded-end rectangle in the shape's XY plane (X -> engine z)
        const r = h / 2, sh = new T.Shape();
        sh.moveTo(-w / 2 + r, -r); sh.lineTo(w / 2 - r, -r); sh.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
        sh.lineTo(-w / 2 + r, r); sh.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
        return sh;
      };
      // shape XY + extrusion Z  ->  engine z/y + extrusion running back from the mouth plane (x = 0)
      const alongX = (geo, depth, x0) => { geo.rotateY(Math.PI / 2); geo.translate(x0 - depth, 0, 0); return geo; };
      // proportions as on a real hat: the three butterflies almost touch, the mouth is one disc tall
      const rb = 0.15, sp = 0.32, Hm = 2 * rb + 0.03, Wm = 2 * sp + Hm, wall = 0.05, Lh = 0.5, zs = [-sp, 0, sp];
      // neck from the blower top up into the hat
      const neck = new T.Mesh(e._roundBox(0.5, 0.44, 0.7, 0.1), M.blower); neck.position.set(0.0, top + 0.2, 0); g.add(neck);
      const hat = new T.Group(); hat.position.set(0.28, top + 0.5, 0); hat.rotation.z = 0.28; g.add(hat);
      // hollow body: outer stadium with the inner one as a hole, rolled edges
      const body = stadium(Wm + 2 * wall, Hm + 2 * wall); body.holes.push(stadium(Wm, Hm));
      hat.add(new T.Mesh(alongX(new T.ExtrudeGeometry(body, { depth: Lh, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 20 }), Lh, 0), M.blower));
      hat.add(new T.Mesh(alongX(new T.ShapeGeometry(stadium(Wm + 2 * wall, Hm + 2 * wall), 20), 0, -Lh), M.blower)); // back cap
      // throttle plate with three bores, set back a little inside the mouth
      const px = -0.05, plate = stadium(Wm, Hm);
      for (const z of zs) { const hole = new T.Path(); hole.absarc(z, 0, rb + 0.006, 0, Math.PI * 2, true); plate.holes.push(hole); }
      hat.add(new T.Mesh(alongX(new T.ExtrudeGeometry(plate, { depth: 0.03, bevelEnabled: false, curveSegments: 24 }), 0.03, px), M.blower));
      const boreMat = M.dark.clone(); boreMat.side = T.DoubleSide;
      this.flaps = []; this.open = 0;
      for (const z of zs) {
        const bore = new T.Mesh(new T.CylinderGeometry(rb + 0.006, rb + 0.006, 0.28, 28, 1, true), boreMat);
        bore.rotation.z = Math.PI / 2; bore.position.set(px - 0.03 - 0.14, 0, z); hat.add(bore);
        const piv = new T.Group(); piv.position.set(px - 0.015, 0, z); hat.add(piv);
        const disc = new T.Mesh(new T.CylinderGeometry(rb, rb, 0.014, 32), M.cover); disc.rotation.z = Math.PI / 2; piv.add(disc);
        for (const dz of [-0.05, 0.05]) {          // the two screws holding the butterfly on the shaft
          const sc = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.012, 8), M.steel);
          sc.rotation.z = Math.PI / 2; sc.position.set(0.012, 0, dz); piv.add(sc);
        }
        this.flaps.push(piv);
      }
      // cross shaft through all three, poking out of the side, with the linkage lever on it
      const shaft = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, Wm + 2 * wall + 0.12, 8), M.steel);
      shaft.rotation.x = Math.PI / 2; shaft.position.set(px, 0, 0); hat.add(shaft);
      const lever = new T.Group(); lever.position.set(px, 0, Wm / 2 + wall + 0.06); hat.add(lever); this.flaps.push(lever);
      const arm = new T.Mesh(new T.BoxGeometry(0.03, 0.2, 0.02), M.steel); arm.position.y = -0.08; lever.add(arm);
      const hub = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.035, 12), M.steel); hub.rotation.x = Math.PI / 2; lever.add(hub);
      const rod = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 0.48, 6), M.steel);
      rod.position.set(px - 0.04, -0.4, Wm / 2 + wall + 0.08); rod.rotation.z = 0.25; hat.add(rod);
    }

    /* butterflies follow the throttle (music load or the pedal), closed when the engine isn't running */
    update(dt, sim) {
      if (!this.flaps || !this.flaps.length) return;
      const running = sim.state === 'running' || sim.state === 'stalling';
      const tgt = running ? clamp(sim.throttle * 1.15, 0, 1) : 0;
      this.open += (tgt - this.open) * (1 - Math.exp(-dt / 0.06));
      if (!isFinite(this.open)) this.open = 0;
      const a = Math.pow(this.open, 0.8) * 85 * Math.PI / 180;
      for (const f of this.flaps) f.rotation.z = a;
    }
  }

  window.Induction = {
    OPTIONS,
    /* combo value -> {key, turbos, blower}; unknown values fall back to one turbo */
    parse(v) {
      const k = String(v === undefined ? '' : v).trim().toLowerCase(), key = OPTIONS[k] ? k : '1';
      return Object.assign({ key }, OPTIONS[key]);
    },
    /* what the layout can actually carry (a radial has no turbos) */
    effective(cfg, L) { return { key: cfg.key, turbos: L.turbos ? cfg.turbos : 0, blower: !!cfg.blower }; },
    suffix(cfg) {
      if (cfg.blower) return cfg.turbos ? ' TWINCHARGED' : ' SUPERCHARGED';
      return ['', ' TURBO', ' TWIN TURBO', '', ' QUAD TURBO'][cfg.turbos] || '';
    },
    /* parts in build order: the blower first, so a twincharged hat becomes the turbos' target */
    parts(cfg) {
      const out = [];
      if (cfg.blower) out.push(new RootsBlower(cfg.turbos > 0));
      if (cfg.turbos) out.push(new TurboSet(cfg.turbos));
      if (!cfg.blower && !cfg.turbos) out.push(new AirFilter());
      return out;
    },
    AirFilter, TurboSet, RootsBlower,
  };
})();
