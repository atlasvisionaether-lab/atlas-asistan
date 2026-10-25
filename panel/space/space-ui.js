/* Atlas — uzay arayüz katmanı: yıldız imleç, düğme partikül patlaması, ekran geçişi.
 *
 * TEK KAYNAK: /space/space-ui.js (panel/space/space-ui.js birebir kopya;
 * tools/space-sync-test.js). Bağımlılık yok, düz betik (defer).
 *
 *   window.ATLAS_SPACE_UI.transition(fn)  fn'i ekran geçişiyle çalıştırır
 *                                         (View Transitions API; yoksa doğrudan)
 *   window.ATLAS_SPACE_UI.burst(x, y, n)  (x, y)'de n parçacık
 *
 * Erişilebilirlik: prefers-reduced-motion'da imleç, patlama ve geçiş KAPALI;
 * dokunmatik cihazda imleç yok. Metin alanlarında sistem imleci geri gelir.
 */
(function () {
  "use strict";
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = matchMedia("(pointer: fine)").matches;
  var root = document.documentElement;
  var BURST_TARGET = ".btn, button:not(:disabled), [role=button], .g-topic";
  var TEXT_TARGET = "input, textarea, select, [contenteditable=true]";
  var HOT_TARGET = "a, button, [role=button], label, summary, .btn, .g-topic, input[type=checkbox], input[type=radio]";

  /* ---------------- Parçacık patlaması ---------------- */
  var fx = null, ctx = null, parts = [], running = false, dpr = 1;
  var COLORS = ["253,230,138", "251,191,36", "34,211,238", "255,255,255", "232,121,249"];

  function ensureCanvas() {
    if (fx) return;
    fx = document.createElement("canvas");
    fx.className = "sx-fx";
    fx.setAttribute("aria-hidden", "true");
    document.body.appendChild(fx);
    ctx = fx.getContext("2d");
    sizeCanvas();
    addEventListener("resize", sizeCanvas);
  }
  function sizeCanvas() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    fx.width = innerWidth * dpr;
    fx.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst(x, y, n) {
    if (reduced) return;
    ensureCanvas();
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 3.4;
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
        life: 1, decay: 0.018 + Math.random() * 0.02,
        r: 0.8 + Math.random() * 1.8, c: COLORS[(Math.random() * COLORS.length) | 0], star: Math.random() < 0.25
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function drawStar(x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var rr = i % 2 ? r * 0.35 : r * 2.4, a = i * Math.PI / 4;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = "lighter";
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy = p.vy * 0.96 + 0.05; p.life -= p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.fillStyle = "rgba(" + p.c + "," + (p.life * 0.9).toFixed(3) + ")";
      ctx.shadowColor = "rgba(" + p.c + ",0.9)";
      ctx.shadowBlur = 8;
      if (p.star) drawStar(p.x, p.y, p.r);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    }
    if (parts.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  var lastBurst = new WeakMap();
  if (!reduced) {
    document.addEventListener("pointerover", function (e) {
      if (e.pointerType !== "mouse") return;
      var el = e.target.closest && e.target.closest(BURST_TARGET);
      if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      var now = performance.now();
      if (now - (lastBurst.get(el) || 0) < 600) return;
      lastBurst.set(el, now);
      burst(e.clientX, e.clientY, 10);
    }, { passive: true });
    document.addEventListener("pointerdown", function (e) {
      var el = e.target.closest && e.target.closest(BURST_TARGET);
      if (el) burst(e.clientX, e.clientY, 24);
    }, { passive: true });
  }

  /* ---------------- Yıldız imleç ---------------- */
  function initCursor() {
    if (reduced || !fine) return;
    var star = document.createElement("div");
    star.className = "sx-cursor";
    star.setAttribute("aria-hidden", "true");
    star.innerHTML = '<svg viewBox="0 0 32 32" width="32" height="32"><defs><radialGradient id="sxg" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></radialGradient></defs>' +
      '<path d="M16 1.5 L18.6 13.4 L30.5 16 L18.6 18.6 L16 30.5 L13.4 18.6 L1.5 16 L13.4 13.4 Z" fill="url(#sxg)"/></svg>';
    var halo = document.createElement("div");
    halo.className = "sx-cursor-halo";
    halo.setAttribute("aria-hidden", "true");
    document.body.appendChild(halo);
    document.body.appendChild(star);
    root.classList.add("sx-cursor-on");

    var x = -100, y = -100, hx = -100, hy = -100, visible = false;
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      x = e.clientX; y = e.clientY;
      if (!visible) { visible = true; hx = x; hy = y; root.classList.add("sx-cursor-in"); }
      var t = e.target;
      root.classList.toggle("sx-cursor-text", !!(t.closest && t.closest(TEXT_TARGET)));
      root.classList.toggle("sx-cursor-hot", !!(t.closest && t.closest(HOT_TARGET)));
    }, { passive: true });
    document.addEventListener("pointerleave", function () { visible = false; root.classList.remove("sx-cursor-in"); });
    document.addEventListener("pointerdown", function () { root.classList.add("sx-cursor-down"); });
    document.addEventListener("pointerup", function () { root.classList.remove("sx-cursor-down"); });
    (function loop() {
      hx += (x - hx) * 0.18; hy += (y - hy) * 0.18;
      star.style.transform = "translate3d(" + x + "px," + y + "px,0)";
      halo.style.transform = "translate3d(" + hx + "px," + hy + "px,0)";
      requestAnimationFrame(loop);
    })();
  }

  /* ---------------- Ekran geçişi ---------------- */
  function transition(update) {
    if (reduced || typeof document.startViewTransition !== "function") { update(); return; }
    document.startViewTransition(update);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCursor);
  else initCursor();

  window.ATLAS_SPACE_UI = { transition: transition, burst: burst };
})();
