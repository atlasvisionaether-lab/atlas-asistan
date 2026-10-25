"use strict";
/* Rehber ekranı (#rehber): klinik sahibine ELI10 tarzında adım adım kurulum rehberi.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 *
 * Konular ve adımlar sunucudan gelir (GET https://atlasasistan.com/api/atlas-guide,
 * tek kaynak: api/_atlas/guide-content.js). Her adımın anlatımı ve sorulara
 * cevap DeepSeek'ten (POST, oturum jetonuyla). Model cevap veremezse (anahtar
 * yok, günlük sınır, sağlayıcı düştü) adımın doğrulanmış bilgileri düz liste
 * olarak gösterilir — rehber hiçbir durumda boş kalmaz.
 * Anlatımlar sayfa açıkken bellekte tutulur: geri dönülen adım için yeniden
 * istek atılmaz (maliyet). */
(function(){
 var ui = window.ATLAS_UI;
 var API = "https://atlasasistan.com/api/atlas-guide";
 var SCREEN_LABELS = {
  onboarding: "Kurulum", ai: "AI Asistan Ayarları", automations: "Otomasyonlar", odeme: "Paket / Ödeme",
  services: "Hizmetler / Fiyatlar", knowledge: "Bilgi Bankası", inbox: "Gelen Kutusu", appointments: "Randevular"
 };

 var topics = null;            // GET cevabı
 var current = null;           // { topic, step }
 var pendingTopic = null;      // Kurulum ekranından "Nasıl yapılır?" ile gelen konu
 var cache = {};               // "konu:adım" → { text | facts, error?, thread: [{role, content}] }

 function key(t, s){ return t + ":" + s; }

 function token(){
  return window.ATLAS_SUPABASE.auth.getSession().then(function(s){
   return s.data && s.data.session ? s.data.session.access_token : null;
  });
 }

 function ask(topicId, step, question, history){
  return token().then(function(t){
   if (!t) return { status: 401, data: null };
   return fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + t },
    body: JSON.stringify({ topic: topicId, step: step, question: question || undefined, history: history || [] })
   }).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(d){ return { status: r.status, data: d }; });
   });
  }).catch(function(){ return { status: 0, data: null }; });
 }

 function failText(status){
  if (status === 429) return "Bugünlük rehber soru sınırına ulaştınız. Aşağıda bu adımın özeti var; yarın tekrar sorabilirsiniz.";
  if (status === 401) return "Oturumunuzun süresi dolmuş. Çıkış yapıp tekrar giriş yapın.";
  if (status === 503) return "Yapay zekâ rehberi şu an kapalı. Bu adımın özeti aşağıda.";
  return "Rehber şu an cevap veremedi. Bu adımın özeti aşağıda; biraz sonra tekrar deneyebilirsiniz.";
 }

 function bubble(role, text){
  return ui.el("div", { class: "g-bubble " + (role === "user" ? "user" : "bot"), text: text });
 }

 function typing(){
  var b = ui.el("div", { class: "g-bubble bot g-typing", "aria-label": "Rehber yazıyor" });
  b.appendChild(ui.el("span")); b.appendChild(ui.el("span")); b.appendChild(ui.el("span"));
  return b;
 }

 function factsList(facts){
  var ol = ui.el("ol", { class: "g-facts" });
  (facts || []).forEach(function(f){ ol.appendChild(ui.el("li", { text: f })); });
  return ol;
 }

 /* ---- Konu listesi ---- */
 function renderTopics(wrap){
  ui.clear(wrap);
  var intro = ui.el("div", { class: "card" });
  intro.appendChild(ui.el("p", { text: "Neyi öğrenmek istersiniz? Bir konu seçin; rehber her adımı sade bir dille, sırayla anlatır. Takıldığınız yerde soru sorabilirsiniz." }));
  var start = ui.el("button", { class: "btn", type: "button", text: "Baştan başla" });
  start.addEventListener("click", function(){ openTopic(wrap, topics[0].id, 0); });
  intro.appendChild(start);
  wrap.appendChild(intro);
  var grid = ui.el("div", { class: "grid g-topics" });
  topics.forEach(function(t){
   var c = ui.el("button", { class: "card g-topic", type: "button" });
   c.appendChild(ui.el("b", { text: t.title }));
   c.appendChild(ui.el("span", { class: "muted", text: t.steps.length + " adım" }));
   c.addEventListener("click", function(){ openTopic(wrap, t.id, 0); });
   grid.appendChild(c);
  });
  wrap.appendChild(grid);
 }

 function topicById(id){ return topics.filter(function(t){ return t.id === id; })[0] || null; }

 /* ---- Adım görünümü ---- */
 function openTopic(wrap, topicId, step){
  current = { topic: topicId, step: step };
  renderStep(wrap);
 }

 function renderStep(wrap){
  var t = topicById(current.topic);
  var s = t.steps[current.step];
  var k = key(t.id, current.step);
  ui.clear(wrap);

  var bar = ui.el("div", { class: "g-bar" });
  var back = ui.el("button", { class: "btn ghost", type: "button", text: "← Konular" });
  back.addEventListener("click", function(){ current = null; renderTopics(wrap); });
  bar.appendChild(back);
  bar.appendChild(ui.el("span", { class: "muted", text: t.title }));
  wrap.appendChild(bar);

  var card = ui.el("div", { class: "card g-step" });
  var dots = ui.el("div", { class: "g-dots", role: "progressbar", "aria-valuemin": "1", "aria-valuemax": String(t.steps.length), "aria-valuenow": String(current.step + 1) });
  t.steps.forEach(function(_, i){ dots.appendChild(ui.el("span", { class: i < current.step ? "done" : (i === current.step ? "on" : "") })); });
  card.appendChild(dots);
  card.appendChild(ui.el("p", { class: "kpi-label", text: "Adım " + (current.step + 1) + " / " + t.steps.length }));
  card.appendChild(ui.el("h2", { text: s.title }));

  var thread = ui.el("div", { class: "g-thread", "aria-live": "polite" });
  card.appendChild(thread);

  if (s.screen && SCREEN_LABELS[s.screen]){
   card.appendChild(ui.el("a", { class: "btn ghost g-open", href: "#" + s.screen, text: "Şimdi aç: " + SCREEN_LABELS[s.screen] }));
  }

  var form = ui.el("form", { class: "g-ask" });
  var input = ui.el("input", { type: "text", maxlength: "500", placeholder: "Bu adımla ilgili sorunuzu yazın…", "aria-label": "Rehbere soru" });
  var askBtn = ui.el("button", { class: "btn ghost", type: "submit", text: "Sor" });
  form.appendChild(input); form.appendChild(askBtn);
  card.appendChild(form);

  var nav = ui.el("div", { class: "g-nav" });
  var prev = ui.el("button", { class: "btn ghost", type: "button", text: "← Önceki" });
  prev.disabled = current.step === 0;
  prev.addEventListener("click", function(){ current.step -= 1; renderStep(wrap); });
  var last = current.step === t.steps.length - 1;
  var next = ui.el("button", { class: "btn", type: "button", text: last ? "Anladım, bitir ✓" : "Anladım, sonraki adım →" });
  next.addEventListener("click", function(){
   if (last) renderDone(wrap, t); else { current.step += 1; renderStep(wrap); }
  });
  nav.appendChild(prev); nav.appendChild(next);
  card.appendChild(nav);
  wrap.appendChild(card);

  var entry = cache[k];
  function paint(){
   ui.clear(thread);
   if (entry.error){
    thread.appendChild(ui.el("p", { class: "notice", text: entry.error }));
    thread.appendChild(factsList(entry.facts || s.facts));
   }
   entry.thread.forEach(function(m){ thread.appendChild(bubble(m.role, m.content)); });
  }

  if (entry){ paint(); }
  else {
   entry = cache[k] = { thread: [] };
   thread.appendChild(typing());
   ask(t.id, current.step).then(function(r){
    if (r.status === 200 && r.data && r.data.text) entry.thread.push({ role: "assistant", content: r.data.text });
    else { entry.error = failText(r.status); entry.facts = (r.data && r.data.facts) || s.facts; }
    if (current && key(current.topic, current.step) === k) paint();
   });
  }

  form.addEventListener("submit", function(e){
   e.preventDefault();
   var q = input.value.trim();
   if (!q) return;
   input.value = ""; askBtn.disabled = true; input.disabled = true;
   var history = entry.thread.slice(-6);
   entry.thread.push({ role: "user", content: q });
   paint();
   thread.appendChild(typing());
   ask(t.id, current.step, q, history).then(function(r){
    askBtn.disabled = false; input.disabled = false;
    if (r.status === 200 && r.data && r.data.text) entry.thread.push({ role: "assistant", content: r.data.text });
    else entry.thread.push({ role: "assistant", content: failText(r.status) });
    if (current && key(current.topic, current.step) === k){ paint(); input.focus(); }
   });
  });
 }

 function renderDone(wrap, t){
  ui.clear(wrap);
  var c = ui.el("div", { class: "card" });
  c.appendChild(ui.el("h2", { text: "Tebrikler, \"" + t.title + "\" konusunu bitirdiniz 🎉" }));
  c.appendChild(ui.el("p", { class: "muted", text: "Kurulum ekranından ilerlemenizi görebilir ya da başka bir konuya geçebilirsiniz." }));
  var row = ui.el("div", { class: "g-nav" });
  row.appendChild(ui.el("a", { class: "btn", href: "#onboarding", text: "Kurulum ekranına dön" }));
  var other = ui.el("button", { class: "btn ghost", type: "button", text: "Başka konu seç" });
  other.addEventListener("click", function(){ current = null; renderTopics(wrap); });
  row.appendChild(other);
  c.appendChild(row);
  wrap.appendChild(c);
 }

 function mount(f){
  var wrap = ui.el("div", { class: "g-wrap" }); f.appendChild(wrap);
  if (!window.ATLAS_SUPABASE){ wrap.appendChild(ui.el("div", { class: "card", text: "Oturum hazır değil." })); return; }
  function go(){
   if (pendingTopic && topicById(pendingTopic.id)){ var p = pendingTopic; pendingTopic = null; openTopic(wrap, p.id, p.step || 0); }
   else if (current) renderStep(wrap);
   else renderTopics(wrap);
  }
  if (topics){ go(); return; }
  wrap.appendChild(ui.el("p", { class: "muted", text: "Rehber yükleniyor…" }));
  fetch(API).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }).then(function(d){
   if (!d || !Array.isArray(d.topics) || !d.topics.length){
    ui.clear(wrap);
    wrap.appendChild(ui.el("div", { class: "card", text: "Rehber yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin." }));
    return;
   }
   topics = d.topics;
   go();
  });
 }

 /** Başka ekrandan belirli konuyu açmak için (ör. Kurulum → "Nasıl yapılır?"). */
 function open(topicId, step){
  pendingTopic = { id: topicId, step: step || 0 };
  if (location.hash === "#rehber") window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = "#rehber";
 }

 window.ATLAS_GUIDE = { mount: mount, open: open };
})();
