"use strict";
/* Web Sitem ekranı (#site): klinik web sitesi — bilgiler → görseller → metin → önizle ve yayınla
 * → (VIP) hizmet/bölge sayfaları ve blog.
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
  role: "Bu işlemi yalnız klinik sahibi ya da yöneticisi yapabilir.",
  vip_required: "Ek sayfalar ve blog VIP pakette.",
  region_name: "Bölge adı en az 2 karakter olmalı.",
  region_service: "Her bölge için aktif bir hizmet seçin.",
  region_note: "Her bölge için o bölgeye özgü en az 40 karakterlik bir not yazın.",
  region_duplicate: "Aynı bölge + hizmet iki kez eklenmiş.",
  region_limit: "En çok 6 bölge sayfası açılabilir.",
  service_unknown: "Bu hizmet artık aktif değil.",
  region_unknown: "Önce bölgeleri kaydedin.",
  slug_conflict: "Bu adres başka bir sayfada kullanılıyor.",
  title: "Yazı başlığı en az 8 karakter olmalı.",
  post_exists: "Bu başlıkta bir yazı zaten var.",
  llm: "Yapay zekâ şu an yanıt vermedi; biraz sonra tekrar deneyin.",
  site_not_published: "Blog yazısı yayınlamak için önce siteyi yayınlayın.",
  compliance_pages: "Bazı ek sayfalarda yayına engel ifadeler var; Ek sayfalar adımında düzeltin.",
  not_found: "Sayfa bulunamadı; ekranı yenileyin."
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
  l.appendChild(ui.el("span", { text: (state.vip ? "Ana sayfayı ve metni hazır tüm hizmet ve bölge sayfalarını okudum (blog yazıları ayrıca onaylanır). " : "Sitedeki metinleri okudum. ") + "Sonuç garantisi, tedavi/iyileştirme vaadi, \"en iyi\" gibi üstünlük iddiası ve öncesi/sonrası görsel içermediğini onaylıyorum. Bilgiler doğrudur." }));
  statusBox.appendChild(l);
  var pub = ui.el("button", { class: "btn", type: "button", text: s.status === "published" ? "Güncel hali yeniden yayınla" : "Yayınla" });
  pub.disabled = !!issues.length || !s.content;
  if (issues.length) statusBox.appendChild(ui.el("p", { class: "auth-error-text", text: ERR.compliance }));
  pub.addEventListener("click", function(){
   if (!ok.checked){ status(msg, ERR.approval_required); return; }
   pub.disabled = true;
   api("POST", { action: "publish", approve: true }).then(function(r){
    pub.disabled = false;
    if (r.status === 200){ state.site = r.data.site; if (r.data.pages) state.pages = r.data.pages; ui.toast("Siteniz yayında."); renderStatus(); if (vipRepaint) vipRepaint(); }
    else status(msg, errText(r) + (r.data && r.data.pages ? " (" + r.data.pages.join(", ") + ")" : ""));
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


 /* ---------- 5. VIP: hizmet/bölge sayfaları ve blog ----------
  * Hizmet ve bölge sayfaları ana sayfayla birlikte (4. adımdaki onayla) yayınlanır;
  * blog yazıları tek tek, her biri kendi onayıyla. Üretim tek istekte tek sayfa (60 sn sınırı). */
 var vipRepaint = null;
 var STATUS_TXT = { draft: "Taslak", published: "Yayında" };
 function pageOf(kind, key){
  return (state.pages || []).filter(function(p){ return p.kind === kind && (kind === "service" ? p.ref === key : p.slug === key); })[0] || null;
 }
 function putPage(pg){
  state.pages = (state.pages || []).filter(function(p){ return p.slug !== pg.slug; });
  if (pg.status !== "archived") state.pages.push(pg);
 }
 function chip(pg){
  if (!pg || !pg.content) return ui.el("span", { class: "ws-chip", text: "Yazılmadı" });
  if ((pg.issues || []).length) return ui.el("span", { class: "ws-chip warn", text: pg.issues.length + " uyarı" });
  return ui.el("span", { class: "ws-chip" + (pg.status === "published" ? " ok" : ""), text: STATUS_TXT[pg.status] || pg.status });
 }

 /* Ortak sayfa düzenleyici: blog → başlık+özet; hizmet/bölge → giriş+SSS. */
 function pageEditor(pg, onSaved){
  var ct = pg.content || {}, blog = pg.kind === "blog";
  var f = ui.el("form", { class: "ws-form ws-page-edit" });
  var issues = pg.issues || [];
  if (issues.length){
   var box = ui.el("div", { class: "notice" }); box.appendChild(ui.el("b", { text: "Yayına engel ifadeler:" }));
   var ul = ui.el("ul"); issues.forEach(function(i){ ul.appendChild(ui.el("li", { text: "\"" + i.match + "\" — " + i.why })); }); box.appendChild(ul); f.appendChild(box);
  }
  function txt(label, val, max, multi){
   var el = multi ? area({ rows: multi, maxlength: String(max) }, val) : input({ type: "text", maxlength: String(max) }, val);
   f.appendChild(field(label, el)); return el;
  }
  var title = blog ? txt("Başlık", ct.title, 80) : null;
  var lead = blog ? txt("Özet", ct.excerpt, 220, "3") : txt("Giriş", ct.intro, 420, "4");
  var secs = (ct.sections || []).map(function(sc, i){ return { h: txt("Ara başlık " + (i + 1), sc.h, 70), p: txt("Paragraf " + (i + 1), sc.p, 1800, "6") }; });
  var faqs = blog ? [] : (ct.faq || []).map(function(q, i){ return { q: txt("Soru " + (i + 1), q.q, 90), a: txt("Cevap " + (i + 1), q.a, 260, "3") }; });
  var meta = txt("Arama motoru açıklaması", ct.metaDescription, 155, "2");
  var m = ui.el("p", { role: "status" }); var save = ui.el("button", { class: "btn", type: "submit", text: "Kaydet" });
  f.appendChild(m); f.appendChild(save);
  f.addEventListener("submit", function(e){
   e.preventDefault();
   var out = { metaDescription: meta.value, sections: secs.map(function(x){ return { h: x.h.value, p: x.p.value }; }) };
   if (blog){ out.title = title.value; out.excerpt = lead.value; } else { out.intro = lead.value; out.faq = faqs.map(function(x){ return { q: x.q.value, a: x.a.value }; }); }
   save.disabled = true;
   api("POST", { action: "savePage", slug: pg.slug, content: out }).then(function(r){
    save.disabled = false;
    if (r.status === 200){ putPage(r.data.page); onSaved(); ui.toast((r.data.page.issues || []).length ? "Kaydedildi; uyarılar var." : "Kaydedildi."); }
    else status(m, errText(r));
   });
  });
  return f;
 }

 function pageRow(list, label, kind, key, onChange){
  var pg = pageOf(kind, key);
  var row = ui.el("div", { class: "ws-page-row" });
  var head = ui.el("div", { class: "ws-page-head" });
  head.appendChild(ui.el("b", { text: label })); head.appendChild(chip(pg));
  var acts = ui.el("div", { class: "ch-actions" });
  var gen = ui.el("button", { class: "btn ghost sm", type: "button", text: pg && pg.content ? "Yeniden yaz" : "Yaz" });
  var msg = ui.el("span", { class: "muted", role: "status" });
  var slot = ui.el("div");
  gen.addEventListener("click", function(){ run(); });
  function run(){
   gen.disabled = true; msg.textContent = "Yazılıyor… (15–30 sn)";
   return api("POST", { action: "generatePage", kind: kind, key: key }).then(function(r){
    gen.disabled = false;
    if (r.status === 200){ putPage(r.data.page); onChange(); return true; }
    msg.textContent = errText(r); msg.className = "auth-error-text"; return false;
   });
  }
  acts.appendChild(gen);
  if (pg && pg.content){
   var ed = ui.el("button", { class: "btn ghost sm", type: "button", text: "Düzenle" });
   ed.addEventListener("click", function(){ if (slot.firstChild) ui.clear(slot); else slot.appendChild(pageEditor(pg, onChange)); });
   acts.appendChild(ed);
  }
  head.appendChild(acts); row.appendChild(head); row.appendChild(msg); row.appendChild(slot); list.appendChild(row);
  return { run: run, needs: !pg || !pg.content };
 }

 function vipStep(wrap){
  var c = stepCard(5, "Ek sayfalar ve blog (VIP)", "Her hizmete ayrı sayfa, seçtiğiniz bölgeler için yerel sayfalar ve onayınızla yayınlanan blog yazıları.");
  wrap.appendChild(c);
  if (!state.vip){
   c.appendChild(ui.el("p", { class: "notice info", text: "Bu adım VIP pakette açılır: hizmet sayfaları, en çok " + ((state.vipLimits || {}).regions || 6) + " bölge sayfası ve blog. Paketinizi yükseltmek için Paketler ekranına bakın." }));
   return;
  }
  if (!state.site || !state.site.subdomain){ c.appendChild(ui.el("p", { class: "notice", text: ERR.save_first })); return; }
  var body = ui.el("div"); c.appendChild(body);
  vipRepaint = paint;
  function paint(){
   ui.clear(body);
   if (!state.canManage) body.appendChild(ui.el("p", { class: "muted", text: "Sayfaları klinik sahibi ya da yöneticisi düzenleyebilir." }));
   body.appendChild(ui.el("p", { class: "muted", text: "Günde en çok " + state.vipLimits.generationsPerDay + " yazma hakkı (ana metin dahil). Hizmet ve bölge sayfaları 4. adımdaki onayla birlikte yayınlanır." }));
   servicesBlock(); regionsBlock(); blogBlock();
   if (!state.canManage) body.querySelectorAll("button,input,textarea,select").forEach(function(x){ x.disabled = true; });
  }

  function servicesBlock(){
   body.appendChild(ui.el("h3", { class: "ws-sub-title", text: "Hizmet sayfaları" }));
   var list = ui.el("div", { class: "ws-pages" });
   var rows = (state.serviceNames || []).map(function(n){ return pageRow(list, n, "service", n, paint); });
   if (!rows.length){ body.appendChild(ui.el("p", { class: "muted", text: ERR.no_services })); return; }
   var all = ui.el("button", { class: "btn sm", type: "button", text: "Eksik sayfaların hepsini yaz" });
   var prog = ui.el("span", { class: "muted", role: "status" });
   var todo = rows.filter(function(r){ return r.needs; });
   all.disabled = !todo.length;
   all.addEventListener("click", function(){
    all.disabled = true; var i = 0;
    (function next(){
     if (i >= todo.length){ paint(); return; }
     prog.textContent = (i + 1) + " / " + todo.length + " yazılıyor…";
     todo[i].run().then(function(ok){ if (!ok){ prog.textContent = "Durdu; ayrıntı satırda."; all.disabled = false; return; } i++; next(); });
    })();
   });
   var top = ui.el("div", { class: "ch-actions" }); top.appendChild(all); top.appendChild(prog);
   body.appendChild(top); body.appendChild(list);
  }

  function regionsBlock(){
   var lim = state.vipLimits || { regions: 6, regionNoteMin: 40 };
   body.appendChild(ui.el("h3", { class: "ws-sub-title", text: "Bölge sayfaları (en çok " + lim.regions + ")" }));
   body.appendChild(ui.el("p", { class: "muted", text: "Örn. \"Kadıköy\" + \"Lazer Epilasyon\". Her bölge için o bölgeye özgü gerçek bilgi yazın (ulaşım, otopark, hangi semtlerden gelindiği…). Sayfa yalnız bu nottan yazılır; aynı metni bölge adıyla çoğaltan sayfalar arama motorlarınca cezalandırılır." }));
   var regions = (state.site.regions || []).map(function(r){ return { name: r.name, service: r.service, note: r.note }; });
   var form = ui.el("form", { class: "ws-form" });
   var rowsBox = ui.el("div"); form.appendChild(rowsBox);
   function drawRows(){
    ui.clear(rowsBox);
    regions.forEach(function(r, i){
     var box = ui.el("div", { class: "ws-region" });
     var name = input({ type: "text", maxlength: "40", placeholder: "Bölge (ör. Kadıköy)" }, r.name);
     var sel = ui.el("select");
     (state.serviceNames || []).forEach(function(n){ var o = ui.el("option", { value: n, text: n }); if (n === r.service) o.selected = true; sel.appendChild(o); });
     var note = area({ rows: "3", maxlength: "600", placeholder: "Bu bölgeye özgü bilgi (en az " + lim.regionNoteMin + " karakter)" }, r.note);
     var del = ui.el("button", { class: "btn ghost sm", type: "button", text: "Kaldır" });
     name.addEventListener("input", function(){ r.name = name.value; });
     sel.addEventListener("change", function(){ r.service = sel.value; });
     note.addEventListener("input", function(){ r.note = note.value; });
     del.addEventListener("click", function(){ regions.splice(i, 1); drawRows(); });
     if (!r.service) r.service = sel.value;
     box.appendChild(field("Bölge", name)); box.appendChild(field("Hizmet", sel)); box.appendChild(field("Bölgeye özgü not", note)); box.appendChild(del);
     rowsBox.appendChild(box);
    });
    add.disabled = regions.length >= lim.regions;
   }
   var add = ui.el("button", { class: "btn ghost sm", type: "button", text: "+ Bölge ekle" });
   add.addEventListener("click", function(){ regions.push({ name: "", service: "", note: "" }); drawRows(); });
   var save = ui.el("button", { class: "btn sm", type: "submit", text: "Bölgeleri kaydet" });
   var m = ui.el("p", { role: "status" });
   var acts = ui.el("div", { class: "ch-actions" }); acts.appendChild(add); acts.appendChild(save);
   form.appendChild(acts); form.appendChild(m);
   form.addEventListener("submit", function(e){
    e.preventDefault(); save.disabled = true;
    api("POST", { action: "saveRegions", regions: regions }).then(function(r){
     save.disabled = false;
     if (r.status === 200){ state.site = r.data.site; state.pages = r.data.pages; paint(); ui.toast("Bölgeler kaydedildi."); } else status(m, errText(r));
    });
   });
   drawRows(); body.appendChild(form);
   var list = ui.el("div", { class: "ws-pages" });
   (state.site.regions || []).forEach(function(r){ pageRow(list, r.name + " " + r.service, "region", r.slug, paint); });
   body.appendChild(list);
  }

  function blogBlock(){
   body.appendChild(ui.el("h3", { class: "ws-sub-title", text: "Blog" }));
   body.appendChild(ui.el("p", { class: "muted", text: "Her yazı ayrı onayla yayınlanır. Yazılar genel bilgilendirmedir; sonuna \"tıbbi tavsiye yerine geçmez\" notu otomatik eklenir." }));
   var f = ui.el("form", { class: "ws-form" });
   var title = input({ type: "text", maxlength: "80", placeholder: "Yazı başlığı" });
   f.appendChild(field("Yeni yazı", title));
   var chips = ui.el("div", { class: "ws-chips" });
   var sug = ui.el("button", { class: "btn ghost sm", type: "button", text: "Konu öner" });
   var draft = ui.el("button", { class: "btn sm", type: "submit", text: "Taslak yaz" });
   var m = ui.el("p", { role: "status" });
   sug.addEventListener("click", function(){
    sug.disabled = true;
    api("POST", { action: "suggestTopics" }).then(function(r){
     sug.disabled = false; ui.clear(chips);
     if (r.status !== 200){ status(m, errText(r)); return; }
     (r.data.topics || []).forEach(function(t){
      var b = ui.el("button", { class: "ws-chip pick", type: "button", text: t });
      b.addEventListener("click", function(){ title.value = t; title.focus(); }); chips.appendChild(b);
     });
    });
   });
   f.addEventListener("submit", function(e){
    e.preventDefault(); draft.disabled = true; status(m, "Yazı hazırlanıyor… (20–40 sn)", true);
    api("POST", { action: "draftPost", title: title.value }).then(function(r){
     draft.disabled = false;
     if (r.status === 200){ putPage(r.data.page); paint(); ui.toast("Taslak hazır; okuyup onaylayın."); } else status(m, errText(r));
    });
   });
   var acts = ui.el("div", { class: "ch-actions" }); acts.appendChild(sug); acts.appendChild(draft);
   f.appendChild(chips); f.appendChild(acts); f.appendChild(m); body.appendChild(f);

   var posts = (state.pages || []).filter(function(p){ return p.kind === "blog"; });
   var list = ui.el("div", { class: "ws-pages" });
   posts.forEach(function(pg){
    var row = ui.el("div", { class: "ws-page-row" });
    var head = ui.el("div", { class: "ws-page-head" });
    head.appendChild(ui.el("b", { text: (pg.content && pg.content.title) || pg.ref })); head.appendChild(chip(pg));
    var a = ui.el("div", { class: "ch-actions" });
    var slot = ui.el("div"); var msg = ui.el("p", { role: "status" });
    var ed = ui.el("button", { class: "btn ghost sm", type: "button", text: "Düzenle" });
    ed.addEventListener("click", function(){ if (slot.firstChild) ui.clear(slot); else slot.appendChild(pageEditor(pg, paint)); });
    a.appendChild(ed);
    function act(action, extra, done){
     return function(){
      api("POST", Object.assign({ action: action, slug: pg.slug }, extra || {})).then(function(r){
       if (r.status === 200){ putPage(r.data.page); paint(); if (done) ui.toast(done); } else status(msg, errText(r));
      });
     };
    }
    if (pg.status === "published"){
     var un = ui.el("button", { class: "btn ghost sm", type: "button", text: "Yayından kaldır" }); un.addEventListener("click", act("unpublishPost")); a.appendChild(un);
    }
    var ar = ui.el("button", { class: "btn ghost sm", type: "button", text: "Arşivle" }); ar.addEventListener("click", act("archivePost", null, "Yazı arşivlendi.")); a.appendChild(ar);
    head.appendChild(a); row.appendChild(head);
    if (pg.status !== "published"){
     var ok = ui.el("input", { type: "checkbox" });
     var l = ui.el("label", { class: "co-consent" }); l.appendChild(ok);
     l.appendChild(ui.el("span", { text: "Bu yazıyı okudum; sonuç garantisi, tedavi vaadi, üstünlük iddiası ve öncesi/sonrası görsel içermediğini onaylıyorum." }));
     var pub = ui.el("button", { class: "btn sm", type: "button", text: "Onayla ve yayınla" });
     pub.disabled = !!(pg.issues || []).length;
     pub.addEventListener("click", function(){ if (!ok.checked){ status(msg, ERR.approval_required); return; } act("publishPost", { approve: true }, "Yazı yayında.")(); });
     row.appendChild(l); var pa = ui.el("div", { class: "ch-actions" }); pa.appendChild(pub); row.appendChild(pa);
    }
    row.appendChild(msg); row.appendChild(slot); list.appendChild(row);
   });
   if (!posts.length) list.appendChild(ui.el("p", { class: "muted", text: "Henüz yazı yok." }));
   body.appendChild(list);
  }
  paint();
 }

 function mount(f){
  var wrap = ui.el("div", { class: "ws-wrap" }); f.appendChild(wrap);
  if (!window.ATLAS_SUPABASE){ wrap.appendChild(ui.el("div", { class: "card", text: "Oturum hazır değil." })); return; }
  wrap.appendChild(ui.el("p", { class: "muted", text: "Yükleniyor…" }));
  api("GET").then(function(r){
   ui.clear(wrap);
   if (r.status !== 200 || !r.data){ wrap.appendChild(ui.el("div", { class: "card", text: r.status === 401 ? errText(r) : "Web sitesi bilgileri yüklenemedi. Sayfayı yenileyin." })); return; }
   state = r.data; statusBox = null; vipRepaint = null;
   if (!state.services) wrap.appendChild(ui.el("p", { class: "notice", text: "Sitede hizmet ve fiyat göstermek için önce Hizmetler / Fiyatlar ekranından hizmet ekleyin." }));
   infoStep(wrap); imagesStep(wrap); textStep(wrap); publishStep(wrap); vipStep(wrap);
  });
 }

 window.ATLAS_SITE = { mount: mount };
})();
