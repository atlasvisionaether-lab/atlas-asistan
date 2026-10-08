/* İzinsiz tarama bildirim formu (/pages/tarama-yetkisi). POST /api/abuse-report.
   Metinler formun data-* özniteliklerinde (TR/EN blokları ayrı formlar). */
(function () {
  'use strict';
  function bind(form) {
    var msg = form.querySelector('.abuse-form__msg');
    var btn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var domain = form.elements.domain.value.trim();
      var reason = form.elements.reason.value.trim();
      var email = form.elements.email.value.trim();
      if (!domain || !reason) { msg.textContent = msg.getAttribute('data-invalid'); return; }
      btn.disabled = true;
      fetch('/api/abuse-report', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ domain: domain, reason: reason, email: email || undefined })
      }).then(function (r) {
        if (!r.ok) throw new Error('http_' + r.status);
        msg.textContent = msg.getAttribute('data-ok');
        form.reset();
      }).catch(function () {
        msg.textContent = msg.getAttribute('data-err');
      }).then(function () { btn.disabled = false; });
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-abuse-form]'), bind);
  });
})();
