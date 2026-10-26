"use strict";
/* Web Sitem ekranı (#site): klinik web sitesi — bilgiler → görseller → metin → önizle ve yayınla.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 *
 * Uç: https://atlasasistan.com/api/atlas-site (CORS, Bearer Supabase jetonu).
 * Görseller tarayıcıda küçültülür (en çok 1600 px, logo 512 px) ve data URL
 * olarak gider; sunucu türü baytlardan doğrular. Yapay zekâ yalnız tanıtım
 * metnini yazar; fiyat/adres/telefon sitede veritabanından basılır. Yayın,
 * sağlık iddiası denetimi temizse ve klinik sahibi açıkça onaylarsa olur. */
(function(){
 var ui = window.ATLAS_UI;
 var API = "https://atlasasistan.com/api/atlas-site";
 var PRESETS = ["#fbbf24", "#22d3ee", "#2dd4bf", "#f9a8d4", "#a78bfa", "#e9c46a"];
 var ERR = {
  subdomain_format: "Adres 3–40 karakter olmalı; yalnız küçük harf, rakam ve tire (tireyle başlayıp bitemez).",
  subdomain_reserved: "Bu adres ayrılmış; başka bir ad seçin.",
  subdomain_taken: "Bu adres başka bir klinikte kullanılıyor.",
  unpublish_first: "Yayındaki sitenin adresi değiştirilemez; önce yayından kaldırın.",
  image_format: "Yalnız JPEG, PNG ya da WebP yükleyebilirsiniz.",
  image_too_large: "Görsel 2 MB'tan büyük.",
  too_many: "En çok 12 fotoğraf yüklenebilir.",
  save_first: "Önce Bilgiler adımını kaydedin.",
  no_services: "Önce Hizmetler / Fiyatlar ekranından en az bir aktif hizmet ekleyin.",
  limit: "Bugünlük metin üretme sınırına ulaştınız; yarın tekrar deneyin ya da metni elle düzenleyin.",
  no_content: "Önce metin üretin ya da yazın.",
  compliance: "Metinde yayına engel ifadeler var; işaretli alanları düzeltin.",
  approval_required: "Yayınlamak için onay kutusunu işaretleyin.",
  role: "Bu işlemi yalnız klinik sahibi ya da yöneticisi yapabilir."
 };

 var state = null;   // GET cevabı

 function token(){
  return window.ATLAS_SUPABASE.auth.getSession().then(function(s){ return s.data && s.data.session ? s.data.session.access_token : null; });
 }
 function api(method, body){
  return token().then(function(t){
   if (!t) return { status: 401, data: null };
   return fetch(API, { method: method, headers: Object.assign({ "Authorization": "Bearer " + t }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined })
    .then(function(r){ return r.json().catch(function(){ return null; }).then(function(d){ return { status: r.status, data: d }; }); });
  }).catch(function(){ return { status: 0, data: null }; });
 }
 function errText(r){
  var code = r.data && r.data.error && r.data.error.code;
  if (r.status === 401) return "Oturumunuzun süresi dolmuş. Çıkış yapıp tekrar giriş yapın.";
  return ERR[code] || "İşlem tamamlanamadı. Tekrar deneyin.";
 }

 /* Görseli tarayıcıda küçült: fotoğraf JPEG 1600 px, logo PNG 512 px (saydamlık korunur). */
 function shrink(file, kind){
  return new Promise(function(resolve, reject){
   if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error("image_format"));
   var img = new Image(), url = URL.createObjectURL(file);
   img.onload = function(){
    var max = kind === "logo" ? 512 : 1600, s = Math.min(1, max / Math.max(img.width, img.height));
    var c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(kind === "logo" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85));
   };
   img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("image_format")); };
   img.src = url;
  });
 }

 function field(label, input, hint){
  var l = ui.el("label", { class: "co-field" });
  l.appendChild(ui.el("span", { text: label })); l.appendChild(input);
  if (hint) l.appendChild(ui.el("small", { class: "muted", text: hint }));
  return l;
 }
 function input(attrs, value){ var i = ui.el("input", attrs); if (value != null) i.value = value; return i; }
 function area(attrs, value){ var t = ui.el("textarea", attrs); t.value = value || ""; return t; }
 function stepCard(n, title, sub){
  var c = ui.el("section", { class: "card ws-step" });
  var h = ui.el("div", { class: "ws-head" });
  h.appendChild(ui.el("span", { class: "onb-num", text: String(n) }));
  var t = ui.el("div"); t.appendChild(ui.el("h2", { text: title })); if (sub) t.appendChild(ui.el("p", { class: "muted", text: sub }));
  h.appendChild(t); c.appendChild(h);
  return c;
 }
 function status(el, text, ok){ el.textContent = text; el.className = ok ? "ws-ok" : "auth-error-text"; }

 /* ---------- 1. Bilgiler ---------- */
 function infoStep(wrap){
  var s = state.site || {}, i = s.info || {}, can = state.canManage;
  var c = stepCard(1, "Bilgiler", "Sitede gösterilecek iletişim bilgileri ve tasarım. Fiyatlar Hizmetler ekranından otomatik gelir.");
  var f = ui.el("form", { class: "ws-form" });
  var sub = input({ type: "text", maxlength: "40", autocomplete: "off", spellcheck: "false" }, s.subdomain || state.suggested || "");
  var subWrap = ui.el("div", { class: "ws-sub" }); subWrap.appendChild(sub); subWrap.appendChild(ui.el("span", { text: ".atlasasistan.com" }));
  f.appendChild(field("Site adresi", subWrap, "Küçük harf, rakam ve tire. Örn: " + (state.suggested || "isil-guzellik")));
  var grid = ui.el("div", { class: "co-grid" });
  var addr = input({ type: "text", maxlength: "200" }, i.address); grid.appendChild(field("Açık adres", addr));
  var dist = input({ type: "text", maxlength: "60" }, i.district); grid.appendChild(field("İlçe", dist));
  var city = input({ type: "text", maxlength: "60" }, i.city); grid.appendChild(field("Şehir", city));
  var phone = input({ type: "tel", maxlength: "25", placeholder: "0532 123 45 67" }, i.phone); grid.appendChild(field("Telefon", phone));
  var ig = input({ type: "text", maxlength: "31", placeholder: "kullaniciadi" }, i.instagram); grid.appendChild(field("Instagram (isteğe bağlı)", ig, state.channels && state.channels.instagram ? "Bağlı hesap otomatik kullanılır: " + state.channels.instagram : ""));
  f.appendChild(grid);
  var wa = ui.el("input", { type: "checkbox" }); wa.checked = i.whatsapp !== false;
  var waL = ui.el("label", { class: "co-consent" }); waL.appendChild(wa); waL.appendChild(ui.el("span", { text: "Bu telefon WhatsApp'ta da kullanılıyor (sitede \"WhatsApp'tan yazın\" düğmesi)" }));
  f.appendChild(waL);
  var hours = area({ rows: "3", maxlength: "300", placeholder: "Hafta içi 09:00–20:00\nCumartesi 10:00–18:00" }, i.hours);
  f.appendChild(field("Çalışma saatleri", hours));
  var about = area({ rows: "5", maxlength: "1500", placeholder: "Kliniğinizi kendi cümlelerinizle anlatın: ne zamandır hizmet veriyorsunuz, nasıl bir ortam, neye önem veriyorsunuz…" }, i.aboutNotes);
  f.appendChild(field("Hakkımızda notları", about, "Yapay zekâ \"Hakkımızda\" metnini YALNIZ bu notlardan yazar; buraya yazmadığınız bilgiyi (ödül, yıl, doktor adı) eklemez."));

  f.appendChild(ui.el("h3", { class: "ws-sub-title", text: "Şablon" }));
  var themes = ui.el("div", { class: "ws-themes" }); var chosen = s.template || "nebula";
  state.themes.forEach(function(t){
   var b = ui.el("button", { type: "button", class: "ws-theme" + (t.id === chosen ? " on" : "") });
   b.appendChild(ui.el("span", { class: "ws-swatch ws-" + t.id })); b.appendChild(ui.el("b", { text: t.label }));
   b.addEventListener("click", function(){ chosen = t.id; themes.querySelectorAll(".ws-theme").forEach(function(x){ x.classList.toggle("on", x === b); }); color.value = t.accent; });
   themes.appendChild(b);
  });
  f.appendChild(themes);
  var color = input({ type: "color" }, s.accent || "#fbbf24");
  var row = ui.el("div", { class: "ws-colors" }); row.appendChild(color);
  PRESETS.forEach(function(p){ var d = ui.el("button", { type: "button", class: "ws-dot", "aria-label": "Renk " + p }); d.style.background = p; d.addEventListener("click", function(){ color.value = p; }); row.appendChild(d); });
  f.appendChild(field("Vurgu rengi", row));

  var msg = ui.el("p", { role: "status" });
  var save = ui.el("button", { class: "btn", type: "submit", text: "Bilgileri kaydet" });
  f.appendChild(msg); if (can) f.appendChild(save);
  f.addEventListener("submit", function(e){
   e.preventDefault(); save.disabled = true;
   api("POST", { action: "save", subdomain: sub.value.trim().toLowerCase(), template: chosen, accent: color.value,
    info: { address: addr.value, district: dist.value, city: city.value, phone: phone.value, whatsapp: wa.checked, instagram: ig.value, hours: hours.value, aboutNotes: about.value } })
    .then(function(r){ save.disabled = false; if (r.status === 200){ state.site = r.data.site; status(msg, "Kaydedildi.", true); renderStatus(); } else status(msg, errText(r)); });
  });
  if (!can) f.querySelectorAll("input,textarea,button").forEach(function(x){ x.disabled = true; });
  c.appendChild(f); wrap.appendChild(c);
 }

 /* ---------- 2. Görseller ---------- */
 function imagesStep(wrap){
  var c = stepCard(2, "Görseller", "Logo ve mekân/ekip fotoğrafları (JPEG, PNG, WebP; en çok 12 fotoğraf).");
  c.appendChild(ui.el("p", { class: "notice", text: "Öncesi/sonrası fotoğraf YÜKLEMEYİN: sağlık hizmetlerinin tanıtımında bu tür görseller mevzuatla sınırlıdır. Mekânınızı, ekibinizi ve ortamı gösteren fotoğraflar kullanın." }));
  var body = ui.el("div", { class: "ws-images" }); c.appendChild(body);
  var msg = ui.el("p", { role: "status" }); c.appendChild(msg);
  function upload(kind, file){
   status(msg, "Yükleniyor…", true);
   shrink(file, kind).then(function(data){ return api("POST", { action: "upload", kind: kind, data: data, alt: (state.clinicName || "") + " — fotoğraf" }); })
    .then(function(r){ if (r.status === 200){ state.site = r.data.site; status(msg, "Yüklendi.", true); paint(); } else status(msg, errText(r)); })
    .catch(function(e){ status(msg, ERR[e.message] || "Görsel okunamadı."); });
  }
  function picker(label, kind){
   var l = ui.el("label", { class: "btn ghost ws-pick" }); l.appendChild(document.createTextNode(label));
   var f = ui.el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: "hidden" });
   f.addEventListener("change", function(){ if (f.files[0]) upload(kind, f.files[0]); f.value = ""; });
   l.appendChild(f); return l;
  }
  function paint(){
   ui.clear(body);
   var s = state.site || {};
   var logo = ui.el("div", { class: "ws-logo glass-lite" });
   if (s.logo) logo.appendChild(ui.el("img", { src: s.logo.url, alt: "Logo" })); else logo.appendChild(ui.el("span", { class: "muted", text: "Logo yok — sitede klinik adının baş harfi kullanılır." }));
   if (state.canManage) logo.appendChild(picker(s.logo ? "Logoyu değiştir" : "Logo yükle", "logo"));
   body.appendChild(logo);
   var g = ui.el("div", { class: "ws-gallery" });
   (s.photos || []).forEach(function(p){
    var cell = ui.el("figure"); cell.appendChild(ui.el("img", { src: p.url, alt: p.alt || "" }));
    if (state.canManage){
     var x = ui.el("button", { type: "button", class: "ws-x", "aria-label": "Fotoğrafı kaldır", text: "×" });
     x.addEventListener("click", function(){ api("POST", { action: "removePhoto", path: p.path }).then(function(r){ if (r.status === 200){ state.site = r.data.site; paint(); } else status(msg, errText(r)); }); });
     cell.appendChild(x);
    }
    g.appendChild(cell);
   });
   if (state.canManage && (s.photos || []).length < state.limits.photos) g.appendChild(picker("+ Fotoğraf ekle", "photo"));
   body.appendChild(g);
  }
  paint(); wrap.appendChild(c);
 }

 /* ---------- 3. Metin ---------- */
 function textStep(wrap){
  var c = stepCard(3, "Metin", "Yapay zekâ hizmetleriniz ve notlarınızdan tanıtım metni yazar; dilediğiniz gibi düzenleyin.");
  var top = ui.el("div", { class: "ch-actions" });
  var gen = ui.el("button", { class: "btn", type: "button", text: "Yapay zekâ ile metin yaz" });
  top.appendChild(gen); top.appendChild(ui.el("span", { class: "muted", text: "Günde en çok " + state.limits.generationsPerDay + " kez." }));
  c.appendChild(top);
  var msg = ui.el("p", { role: "status" }); c.appendChild(msg);
  var editor = ui.el("div"); c.appendChild(editor);
  gen.addEventListener("click", function(){
   gen.disabled = true; status(msg, "Metin yazılıyor… (15–30 sn)", true);
   api("POST", { action: "generate" }).then(function(r){
    gen.disabled = false;
    if (r.status === 200){ state.site = r.data.site; status(msg, r.data.source === "fallback" ? "Yapay zekâ şu an yanıt vermedi; sade bir taslak hazırlandı, düzenleyebilirsiniz." : "Metin hazır. Okuyup düzenleyin.", true); paintEditor(); }
    else status(msg, errText(r));
   });
  });
  if (!state.canManage) gen.disabled = true;
  function paintEditor(){
   ui.clear(editor);
   var s = state.site || {}, ct = s.content;
   if (!ct){ editor.appendChild(ui.el("p", { class: "muted", text: "Henüz metin yok." })); return; }
   var issues = s.issues || [];
   if (issues.length){
    var box = ui.el("div", { class: "notice" });
    box.appendChild(ui.el("b", { text: "Yayına engel ifadeler (" + issues.length + "):" }));
    var ul = ui.el("ul"); issues.forEach(function(i){ ul.appendChild(ui.el("li", { text: "\"" + i.match + "\" — " + i.why })); }); box.appendChild(ul);
    editor.appendChild(box);
   }
   var f = ui.el("form", { class: "ws-form" });
   function flagged(name){ return issues.some(function(i){ return i.field === name; }); }
   function txt(label, name, val, max, multi){
    var el = multi ? area({ rows: "4", maxlength: String(max) }, val) : input({ type: "text", maxlength: String(max) }, val);
    el.dataset.name = name; var l = field(label, el); if (flagged(name)) l.classList.add("invalid"); f.appendChild(l); return el;
   }
   txt("Başlık", "heroTitle", ct.heroTitle, 70); txt("Alt başlık", "heroSubtitle", ct.heroSubtitle, 170, true);
   txt("Düğme metni", "ctaLabel", ct.ctaLabel, 26); txt("Hakkımızda", "about", ct.about, 700, true);
   f.appendChild(ui.el("h3", { class: "ws-sub-title", text: "Hizmet açıklamaları (fiyatlar Hizmetler ekranından gelir)" }));
   (ct.services || []).forEach(function(sv, i){ txt(sv.name, "services[" + i + "].description", sv.description, 140, true).dataset.svc = sv.name; });
   f.appendChild(ui.el("h3", { class: "ws-sub-title", text: "Sık sorulan sorular" }));
   (ct.faq || []).forEach(function(q, i){ txt("Soru " + (i + 1), "faq[" + i + "].q", q.q, 90); txt("Cevap " + (i + 1), "faq[" + i + "].a", q.a, 260, true); });
   txt("Arama motoru açıklaması", "metaDescription", ct.metaDescription, 155, true);
   var m = ui.el("p", { role: "status" }); var save = ui.el("button", { class: "btn", type: "submit", text: "Metni kaydet" });
   f.appendChild(m); if (state.canManage) f.appendChild(save);
   f.addEventListener("submit", function(e){
    e.preventDefault();
    var v = function(n){ var el = f.querySelector('[data-name="' + n + '"]'); return el ? el.value : ""; };
    var out = { heroTitle: v("heroTitle"), heroSubtitle: v("heroSubtitle"), ctaLabel: v("ctaLabel"), about: v("about"), metaDescription: v("metaDescription"),
     services: (ct.services || []).map(function(sv, i){ return { name: sv.name, description: v("services[" + i + "].description") }; }),
     faq: (ct.faq || []).map(function(q, i){ return { q: v("faq[" + i + "].q"), a: v("faq[" + i + "].a") }; }) };
    save.disabled = true;
    api("POST", { action: "saveContent", content: out }).then(function(r){ save.disabled = false; if (r.status === 200){ state.site = r.data.site; paintEditor(); renderStatus(); } else status(m, errText(r)); });
   });
   if (!state.canManage) f.querySelectorAll("input,textarea").forEach(function(x){ x.disabled = true; });
   editor.appendChild(f);
  }
  paintEditor(); wrap.appendChild(c);
 }

 /* ---------- 4. Önizle ve yayınla ---------- */
 var statusBox = null;
 function publishStep(wrap){
  var c = stepCard(4, "Önizle ve yayınla", "Sitenizi yayınlamadan önce görün. Yayınlanan, onayladığınız halidir.");
  var frameWrap = ui.el("div", { class: "ws-frame" }); var msg = ui.el("p", { role: "status" });
  var prev = ui.el("button", { class: "btn ghost", type: "button", text: "Önizle" });
  prev.addEventListener("click", function(){
   prev.disabled = true; status(msg, "Önizleme hazırlanıyor…", true);
   api("POST", { action: "preview" }).then(function(r){
    prev.disabled = false;
    if (r.status !== 200){ status(msg, errText(r)); return; }
    msg.textContent = ""; ui.clear(frameWrap);
    var fr = ui.el("iframe", { title: "Site önizlemesi", sandbox: "", loading: "lazy" }); fr.srcdoc = r.data.html; frameWrap.appendChild(fr);
   });
  });
  var acts = ui.el("div", { class: "ch-actions" }); acts.appendChild(prev); c.appendChild(acts); c.appendChild(msg); c.appendChild(frameWrap);
  statusBox = ui.el("div", { class: "ws-publish" }); c.appendChild(statusBox);
  wrap.appendChild(c); renderStatus();
 }

 function renderStatus(){
  if (!statusBox) return;
  ui.clear(statusBox);
  var s = state.site || {}, issues = s.issues || [];
  var msg = ui.el("p", { role: "status" });
  if (s.status === "published"){
   statusBox.appendChild(ui.el("p", { class: "notice info", text: "Siteniz yayında." }));
   if (s.urls){
    var links = ui.el("p");
    links.appendChild(ui.el("a", { href: s.urls.subdomain, target: "_blank", rel: "noopener", text: s.urls.subdomain }));
    links.appendChild(document.createTextNode("  ·  yedek adres: "));
    links.appendChild(ui.el("a", { href: s.urls.path, target: "_blank", rel: "noopener", text: s.urls.path }));
    statusBox.appendChild(links);
   }
   statusBox.appendChild(ui.el("p", { class: "muted", text: "Metinde ya da bilgilerde değişiklik yaptıysanız, güncel hali için yeniden onaylayıp yayınlayın." }));
  }
  if (!state.canManage){ statusBox.appendChild(ui.el("p", { class: "muted", text: "Yayınlamayı klinik sahibi ya da yöneticisi yapabilir." })); return; }
  var ok = ui.el("input", { type: "checkbox", id: "ws-approve" });
  var l = ui.el("label", { class: "co-consent" }); l.appendChild(ok);
  l.appendChild(ui.el("span", { text: "Sitedeki metinleri okudum. Sonuç garantisi, tedavi/iyileştirme vaadi, \"en iyi\" gibi üstünlük iddiası ve öncesi/sonrası görsel içermediğini onaylıyorum. Bilgiler doğrudur." }));
  statusBox.appendChild(l);
  var pub = ui.el("button", { class: "btn", type: "button", text: s.status === "published" ? "Güncel hali yeniden yayınla" : "Yayınla" });
  pub.disabled = !!issues.length || !s.content;
  if (issues.length) statusBox.appendChild(ui.el("p", { class: "auth-error-text", text: ERR.compliance }));
  pub.addEventListener("click", function(){
   if (!ok.checked){ status(msg, ERR.approval_required); return; }
   pub.disabled = true;
   api("POST", { action: "publish", approve: true }).then(function(r){
    pub.disabled = false;
    if (r.status === 200){ state.site = r.data.site; ui.toast("Siteniz yayında."); renderStatus(); } else status(msg, errText(r));
   });
  });
  var acts = ui.el("div", { class: "ch-actions" }); acts.appendChild(pub);
  if (s.status === "published"){
   var un = ui.el("button", { class: "btn ghost", type: "button", text: "Yayından kaldır" });
   un.addEventListener("click", function(){ api("POST", { action: "unpublish" }).then(function(r){ if (r.status === 200){ state.site = r.data.site; renderStatus(); } else status(msg, errText(r)); }); });
   acts.appendChild(un);
  }
  statusBox.appendChild(acts); statusBox.appendChild(msg);
 }

 function mount(f){
  var wrap = ui.el("div", { class: "ws-wrap" }); f.appendChild(wrap);
  if (!window.ATLAS_SUPABASE){ wrap.appendChild(ui.el("div", { class: "card", text: "Oturum hazır değil." })); return; }
  wrap.appendChild(ui.el("p", { class: "muted", text: "Yükleniyor…" }));
  api("GET").then(function(r){
   ui.clear(wrap);
   if (r.status !== 200 || !r.data){ wrap.appendChild(ui.el("div", { class: "card", text: r.status === 401 ? errText(r) : "Web sitesi bilgileri yüklenemedi. Sayfayı yenileyin." })); return; }
   state = r.data; statusBox = null;
   if (!state.services) wrap.appendChild(ui.el("p", { class: "notice", text: "Sitede hizmet ve fiyat göstermek için önce Hizmetler / Fiyatlar ekranından hizmet ekleyin." }));
   infoStep(wrap); imagesStep(wrap); textStep(wrap); publishStep(wrap);
  });
 }

 window.ATLAS_SITE = { mount: mount };
})();
