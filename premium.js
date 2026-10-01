/* Atlas Asistan — Premium effects layer (Talimat 37A) */
(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = window.matchMedia('(max-width: 768px)').matches;

  /* Panelim nav button (panel/ is an untouchable separate project — href placeholder) */
  document.querySelectorAll('.nav-links').forEach(function (nav) {
    if (!nav.querySelector('.btn-panelim')) {
      var a = document.createElement('a');
      a.href = '#';
      a.className = 'btn blue btn-panelim';
      a.title = 'Panel (yakında)';
      a.style.marginLeft = '.35rem';
      a.textContent = 'Panelim';
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var t = document.createElement('div');
        t.textContent = 'Panel çok yakında';
        t.setAttribute('role', 'status');
        t.style.cssText = 'position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);z-index:99999;background:rgba(5,7,10,.92);color:#E2E8F0;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:.65rem 1.1rem;font-size:.875rem;box-shadow:0 12px 40px rgba(0,0,0,.5);backdrop-filter:blur(12px);pointer-events:none;opacity:0;transition:opacity .25s ease';
        document.body.appendChild(t);
        requestAnimationFrame(function(){ t.style.opacity = '1'; });
        setTimeout(function(){ t.style.opacity = '0'; setTimeout(function(){ t.remove(); }, 300); }, 2200);
      });
      var demo = nav.querySelector('.demo-al');
      if (demo && demo.nextSibling) nav.insertBefore(a, demo.nextSibling);
      else nav.appendChild(a);
    }
  });

  /* Aurora blobs into hero */
  if (!reduced) {
    document.querySelectorAll('header.hero, .hero').forEach(function (hero) {
      if (hero.querySelector('.aurora')) return;
      var wrap = document.createElement('div');
      wrap.className = 'aurora';
      wrap.innerHTML = '<i></i><i></i><i></i><i></i>';
      hero.style.position = 'relative';
      hero.insertBefore(wrap, hero.firstChild);
    });
    /* Grid pattern into hero + demo panel sections */
    document.querySelectorAll('header.hero, .hero, section:has(.demo-panel)').forEach(function (sec) {
      if (sec.querySelector('.bg-grid')) return;
      var g = document.createElement('div');
      g.className = 'bg-grid';
      sec.style.position = 'relative';
      sec.insertBefore(g, sec.firstChild);
    });
  }

  /* Film grain — single static frame SVG noise (no canvas loop; cheap) */
  if (!reduced && !isMobile) {
    var grain = document.createElement('div');
    grain.className = 'grain-overlay';
    grain.style.backgroundImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
    document.body.appendChild(grain);
  }

  /* Scroll reveal */
  var revealEls = document.querySelectorAll('section, footer .foot-grid');
  if ('IntersectionObserver' in window && !reduced) {
    revealEls.forEach(function (el) {
      el.classList.add('reveal');
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
        });
      }, { threshold: 0.08 }).observe(el);
    });
  }

  /* Hero parallax (background layers move slower) */
  if (!reduced && !isMobile) {
    var hero = document.querySelector('header.hero, .hero');
    if (hero) {
      var aurora = hero.querySelector('.aurora');
      var grid = hero.querySelector('.bg-grid');
      window.addEventListener('scroll', function () {
        var y = window.scrollY;
        if (y > hero.offsetHeight) return;
        if (aurora) aurora.style.transform = 'translateY(' + (y * 0.25) + 'px)';
        if (grid) grid.style.transform = 'translateY(' + (y * 0.12) + 'px)';
      }, { passive: true });
    }
  }

  /* Package cards: mouse-follow radial glow via CSS vars */
  document.querySelectorAll('.price-card, .card').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
    });
  });

  /* Magnetic hover on Demo Al (max 4px) */
  if (!reduced) {
    document.querySelectorAll('.demo-al').forEach(function (btn) {
      btn.classList.add('is-magnetic');
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var x = ((e.clientX - r.left) / r.width - 0.5) * 8;
        var y = ((e.clientY - r.top) / r.height - 0.5) * 8;
        btn.style.transform = 'translate(' + Math.max(-4, Math.min(4, x)) + 'px,' + Math.max(-4, Math.min(4, y)) + 'px)';
      });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
    });
  }
})();
