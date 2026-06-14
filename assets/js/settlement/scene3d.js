/* ════════════════════════════════════════════════════════════
   PathFinder — Settlement 3D helpers (Part A & B visualisations)

   Restrained, on-brand isometric data-viz built on Three.js, loaded
   lazily via a dynamic import('three') resolved through the importmap
   in app.html — no bundler, no npm. Every scene has a guaranteed 2D
   fallback (the caller always renders a table/bars first); Three.js
   is layered on top only when the device can take it.

   Exposes window.PFScene3D. Classic script — attaches to global scope
   like the rest of the app (see comment at the top of app.js).
   ════════════════════════════════════════════════════════════ */

window.PFScene3D = (() => {
  /* every live scene registers a dispose fn here so the router can tear
     them all down on navigation (app.js calls disposeAll on each
     renderSettlement and on hashchange — the canvas would otherwise leak
     a WebGL context + rAF loop after main.innerHTML is cleared). */
  const live = new Set();
  function disposeAll() { live.forEach(fn => { try { fn(); } catch {} }); live.clear(); }

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowEnd = () => (navigator.hardwareConcurrency || 4) <= 2;

  function webglOk() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch { return false; }
  }

  /* 3D is a progressive enhancement: skip it entirely on reduced-motion,
     low-core devices, or anything without WebGL — the 2D fallback covers
     those cases as a real code path, not an afterthought. */
  const supported = () => !reduceMotion() && !lowEnd() && webglOk();

  /* read the live design tokens so the 3D palette always tracks the CSS
     (and any future theme) — never hard-code the cartographic colours */
  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const t = k => cs.getPropertyValue(k).trim() || '#888';
    return {
      route:  t('--route'), pine: t('--pine'), sea: t('--sea'),
      ochre:  t('--ochre'), paper2: t('--paper-2'), ink: t('--ink'),
    };
  }

  /* shared scene scaffolding: orthographic (isometric) camera, soft
     two-light setup, capped pixel ratio, ResizeObserver sizing, and
     render-loop gating via Intersection + visibility observers. */
  async function makeStage(canvas) {
    const THREE = await import('three');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    cam.position.set(9, 10, 12);
    cam.lookAt(0, 2.5, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(6, 12, 8);
    scene.add(key);

    let w = 1, h = 1;
    function resize() {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
      const aspect = w / h, view = 9;
      cam.left = -view * aspect; cam.right = view * aspect;
      cam.top = view; cam.bottom = -view;
      cam.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    resize();

    return { THREE, renderer, scene, cam, resize, dims: () => ({ w, h }) };
  }

  /* drive a render loop that only runs while the canvas is on-screen and
     the tab is visible; `step(dt)` returns true while still animating */
  function runLoop(canvas, renderer, scene, cam, step) {
    let raf = 0, visible = true, onScreen = true, last = performance.now();
    const active = () => visible && onScreen;

    function frame(now) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const more = step(dt);
      renderer.render(scene, cam);
      if (active() && more) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && active()) { last = performance.now(); raf = requestAnimationFrame(frame); } }

    const io = new IntersectionObserver(es => { onScreen = es[0].isIntersecting; onScreen ? kick() : stop(); }, { threshold: 0.05 });
    io.observe(canvas);
    const onVis = () => { visible = !document.hidden; visible ? kick() : stop(); };
    document.addEventListener('visibilitychange', onVis);
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

    return {
      kick,
      teardown() { stop(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); },
    };
  }

  /* ── Cost-breakdown "skyline" (Part B) ───────────────────────
     One extruded box per category, heights lerp when inputs change.
     `getBars()` → [{ label, value, color }]; call ctl.update() after
     edits. Returns null if 3D isn't supported (caller keeps the 2D view). */
  function mountBars(canvas, getBars) {
    if (!supported()) return null;
    let disposed = false, ctl = { update() {}, dispose() {} };

    makeStage(canvas).then(stage => {
      if (disposed) { stage.renderer.dispose(); return; }
      const { THREE, renderer, scene, cam } = stage;
      const group = new THREE.Group(); scene.add(group);
      const bars = [];
      const geo = new THREE.BoxGeometry(1, 1, 1);

      function build() {
        bars.forEach(b => { group.remove(b.mesh); b.mesh.material.dispose(); });
        bars.length = 0;
        const data = getBars();
        const n = data.length || 1;
        const gap = 2.4, span = (n - 1) * gap;
        data.forEach((d, i) => {
          const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color), roughness: 0.85, metalness: 0 });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.x = i * gap - span / 2;
          mesh.scale.set(1.4, 0.01, 1.4);
          group.add(mesh);
          bars.push({ mesh, target: 0.01, cur: 0.01 });
        });
        retarget(data);
      }
      function retarget(data) {
        const max = Math.max(1, ...data.map(d => d.value));
        data.forEach((d, i) => { if (bars[i]) bars[i].target = Math.max(0.04, (d.value / max) * 6); });
        loop.kick();
      }
      function step() {
        let moving = false;
        bars.forEach(b => {
          b.cur += (b.target - b.cur) * 0.16;
          if (Math.abs(b.target - b.cur) > 0.01) moving = true;
          b.mesh.scale.y = b.cur;
          b.mesh.position.y = b.cur / 2;
        });
        group.rotation.y = -0.0; // fixed isometric — no spin
        return moving;
      }
      const loop = runLoop(canvas, renderer, scene, cam, step);
      build();

      ctl = {
        update() { retarget(getBars()); },
        rebuild() { build(); },
        dispose() {
          loop.teardown(); geo.dispose();
          bars.forEach(b => b.mesh.material.dispose());
          renderer.dispose();
        },
      };
    }).catch(err => { console.warn('PathFinder 3D (bars) unavailable —', err); });

    const handle = { update: () => ctl.update(), rebuild: () => ctl.rebuild && ctl.rebuild(), dispose() { disposed = true; ctl.dispose(); } };
    live.add(handle.dispose);
    return handle;
  }

  /* ── Balance "funds tank" (Part A & B) ───────────────────────
     A stack of flat blocks (one per spending bucket) inside a wire
     outline; the fill drains as the simulator spends. `getState()` →
     { fraction:0..1, segments:[{ value, color }], over:bool }. */
  function mountTank(canvas, getState) {
    if (!supported()) return null;
    let disposed = false, ctl = { update() {}, dispose() {} };

    makeStage(canvas).then(stage => {
      if (disposed) { stage.renderer.dispose(); return; }
      const { THREE, renderer, scene, cam } = stage;
      cam.position.set(7, 8, 11); cam.lookAt(0, 3.5, 0);
      const group = new THREE.Group(); scene.add(group);

      const R = 3, H = 7.5;
      // hairline outline cylinder (the "tank")
      const outline = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, H, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(tokens().ink), wireframe: true, transparent: true, opacity: 0.12 }));
      outline.position.y = H / 2; group.add(outline);

      const fillGeo = new THREE.CylinderGeometry(R * 0.92, R * 0.92, 1, 40);
      const fillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(tokens().pine), roughness: 0.8 });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      group.add(fill);

      let cur = 1;
      function step() {
        const s = getState();
        const target = Math.max(0, Math.min(1, s.fraction));
        cur += (target - cur) * 0.16;
        const hh = Math.max(0.02, cur * H);
        fill.scale.y = hh; fill.position.y = hh / 2;
        fillMat.color.set(s.over ? tokens().route : (cur < 0.2 ? tokens().ochre : tokens().pine));
        return Math.abs(target - cur) > 0.005;
      }
      const loop = runLoop(canvas, renderer, scene, cam, step);
      loop.kick();

      ctl = {
        update() { loop.kick(); },
        dispose() { loop.teardown(); outline.geometry.dispose(); outline.material.dispose(); fillGeo.dispose(); fillMat.dispose(); renderer.dispose(); },
      };
    }).catch(err => { console.warn('PathFinder 3D (tank) unavailable —', err); });

    const handle = { update: () => ctl.update(), dispose() { disposed = true; ctl.dispose(); } };
    live.add(handle.dispose);
    return handle;
  }

  return { supported, tokens, mountBars, mountTank, disposeAll };
})();
