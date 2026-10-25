"use strict";
/* Paket / Ödeme ekranı (#odeme): fatura bilgileri → iyzico barındırılan ödeme sayfası.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE ve window.atlasUser (auth.js).
 *
 * Ödeme ucu atlasasistan.com'da (başka origin, CORS): POST /api/atlas-checkout,
 * Authorization: Bearer <Supabase jetonu>. Sunucu siparişi jetonun kurumuna
 * bağlar, tutarı kendi paket tablosundan alır (buradaki fiyatlar yalnız
 * gösterim, bkz. api/_atlas/plans.js). Doğrulama kuralları sunucuda
 * (atlas-billing.js); hata metinleri cevapla gelir, burada tekrar yazılmaz.
 * iyzico dönüşü panelin Kurulum ekranına ?odeme=success|pending|failed ile gelir.
 * Ödeme kapalıysa form gönderilmez; WhatsApp'a yönlendirme YOK. */
(function(){
 var ui = window.ATLAS_UI;
 var API = "https://atlasasistan.com/api/atlas-checkout";
 var LEGAL = "https://atlasasistan.com/pages/";
 var PLAN_KEY = "atlasPlan";

 var PLANS = [
  { id: "standart", name: "Standart Asistan", price: "₺4.900", period: "/ay", note: "WhatsApp asistanı, randevu yönetimi, 7/24 yanıt" },
  { id: "pro", name: "Pro Asistan", price: "₺7.900", period: "/ay", note: "WhatsApp + Instagram, kampanya, müşteri takibi" },
  { id: "starter", name: "Dijital Başlangıç Paketi", price: "₺14.900", period: " tek sefer + ₺1.200/ay", note: "5 sayfalık site + temel asistan" },
  { id: "vip", name: "VIP Klinik Dönüşümü", price: "₺24.900", period: " tek sefer + ₺2.400/ay", note: "10+ sayfa, WhatsApp + Instagram, SEO" }
 ];

 /* atlasasistan.com/checkout'tan ?plan= ile gelinirse seçim kayıt/doğrulama boyunca korunur. */
 function storedPlan(){
  try { return localStorage.getItem(PLAN_KEY) || ""; } catch (e) { return ""; }
 }
 function storePlan(id){
  try { if (id) localStorage.setItem(PLAN_KEY, id); else localStorage.removeItem(PLAN_KEY); } catch (e) { /* tarayıcı depolaması kapalı */ }
 }
 (function capturePlanFromUrl(){
  var q = new URLSearchParams(location.search).get("plan");
  if (q === "standard") q = "standart";
  if (PLANS.some(function(p){ return p.id === q; })) storePlan(q);
 })();

 function field(label, input, name, hint){
  var box = ui.el("label", { class: "co-field", "data-field": name });
  box.appendChild(ui.el("span", { text: label }));
  box.appendChild(input);
  if (hint) box.appendChild(ui.el("small", { class: "muted", text: hint }));
  box.appendChild(ui.el("small", { class: "auth-error-text co-err" }));
  return box;
 }

 function input(attrs){ return ui.el("input", attrs); }

 function consent(id, name, html){
  var box = ui.el("label", { class: "co-consent", "data-field": name });
  var cb = ui.el("input", { type: "checkbox", id: id, required: "required" });
  var span = ui.el("span");
  span.innerHTML = html;   // yalnız sabit metin ve yasal sayfa bağlantıları
  box.appendChild(cb); box.appendChild(span);
  box.appendChild(ui.el("small", { class: "auth-error-text co-err" }));
  return box;
 }

 function planPicker(selected){
  var wrap = ui.el("fieldset", { class: "co-plans" });
  wrap.appendChild(ui.el("legend", { text: "Paket" }));
  PLANS.forEach(function(p){
   var lab = ui.el("label", { class: "co-plan" });
   var r = ui.el("input", { type: "radio", name: "plan", value: p.id });
   if (p.id === selected) r.checked = true;
   lab.appendChild(r);
   var t = ui.el("span");
   t.appendChild(ui.el("b", { text: p.name }));
   t.appendChild(ui.el("span", { class: "co-price", text: p.price + p.period + " (KDV dahil)" }));
   t.appendChild(ui.el("small", { class: "muted", text: p.note }));
   lab.appendChild(t);
   wrap.appendChild(lab);
  });
  return wrap;
 }

 function showErrors(form, messages){
  form.querySelectorAll("[data-field]").forEach(function(box){
   var err = box.querySelector(".co-err");
   var m = messages[box.getAttribute("data-field")];
   if (err) err.textContent = m || "";
   box.classList.toggle("invalid", !!m);
  });
  var first = form.querySelector(".invalid input");
  if (first) first.focus();
 }

 function collect(form){
  var v = function(id){ return form.querySelector("#" + id).value.trim(); };
  var corporate = form.querySelector("input[name=btype]:checked").value === "corporate";
  var plan = form.querySelector("input[name=plan]:checked");
  return {
   plan: plan ? plan.value : "",
   lang: "tr",
   name: v("co-name"),
   clinic: v("co-clinic"),
   email: v("co-email"),
   country: "TR",
   phone: v("co-phone"),
   address: v("co-address"),
   city: v("co-city"),
   billing: corporate
    ? { type: "corporate", taxNo: v("co-vkn"), taxOffice: v("co-taxoffice") }
    : { type: "individual", tcNo: v("co-tc") },
   consentPpf: form.querySelector("#co-ppf").checked,
   consentTransfer: form.querySelector("#co-transfer").checked
  };
 }

 /* Sunucuda TC/VKN isteğe bağlı (yurt dışı ve kimliksiz alıcı için); panelde
    Türkiye'deki klinikten fatura kimliği zorunlu istenir. */
 function localCheck(body){
  var m = {};
  if (!body.plan) m.plan = "Bir paket seçin.";
  if (body.billing.type === "individual" && !body.billing.tcNo) m.tcNo = "TC Kimlik No zorunludur.";
  if (body.billing.type === "corporate"){
   if (!body.billing.taxNo) m.taxNo = "Vergi No (VKN) zorunludur.";
   if (!body.billing.taxOffice) m.taxOffice = "Vergi dairesi zorunludur.";
  }
  return m;
 }

 function errorText(status, data){
  var code = data && data.error && data.error.code;
  if (status === 401) return "Oturumunuzun süresi dolmuş. Çıkış yapıp tekrar giriş yapın.";
  if (status === 403) return "Ödemeyi yalnızca klinik sahibi ya da yöneticisi başlatabilir.";
  if (code === "unavailable") return "Çevrimiçi ödeme şu an kapalı. Lütfen biraz sonra tekrar deneyin.";
  if (code === "plan") return "Paket bulunamadı. Sayfayı yenileyip tekrar seçin.";
  return "Ödeme sayfası açılamadı. Lütfen tekrar deneyin.";
 }

 function buildForm(wrap, mode, org){
  var user = window.atlasUser || {};
  var meta = user.user_metadata || {};
  var form = ui.el("form", { class: "card co-form", novalidate: "novalidate" });

  form.appendChild(planPicker(storedPlan() || "standart"));
  form.appendChild(ui.el("h2", { text: "Fatura bilgileri" }));

  var grid = ui.el("div", { class: "co-grid" });
  grid.appendChild(field("Ad soyad", input({ id: "co-name", type: "text", autocomplete: "name", maxlength: "100", value: meta.full_name || "" }), "name"));
  grid.appendChild(field("İşletme / şirket ünvanı", input({ id: "co-clinic", type: "text", autocomplete: "organization", maxlength: "120", value: org.name || "" }), "clinic",
   "Kurumsal faturada vergi levhasındaki tam ünvan."));
  grid.appendChild(field("E-posta", input({ id: "co-email", type: "email", autocomplete: "email", value: user.email || "" }), "email", "Fatura ve ödeme bildirimi bu adrese gider."));
  grid.appendChild(field("Cep telefonu", input({ id: "co-phone", type: "tel", autocomplete: "tel", inputmode: "tel", placeholder: "0532 123 45 67" }), "phone"));
  grid.appendChild(field("Açık adres", input({ id: "co-address", type: "text", autocomplete: "street-address", maxlength: "250" }), "address"));
  grid.appendChild(field("Şehir", input({ id: "co-city", type: "text", autocomplete: "address-level1", maxlength: "50" }), "city"));
  form.appendChild(grid);

  var types = ui.el("fieldset", { class: "co-types" });
  types.appendChild(ui.el("legend", { text: "Fatura tipi" }));
  [["individual", "Bireysel (şahıs)"], ["corporate", "Kurumsal (şirket)"]].forEach(function(t, i){
   var lab = ui.el("label");
   var r = ui.el("input", { type: "radio", name: "btype", value: t[0] });
   if (i === 0) r.checked = true;
   lab.appendChild(r); lab.appendChild(document.createTextNode(" " + t[1]));
   types.appendChild(lab);
  });
  form.appendChild(types);

  var ind = ui.el("div", { class: "co-grid" });
  ind.appendChild(field("TC Kimlik No", input({ id: "co-tc", type: "text", inputmode: "numeric", maxlength: "11", autocomplete: "off" }), "tcNo"));
  var corp = ui.el("div", { class: "co-grid" });
  corp.appendChild(field("Vergi No (VKN)", input({ id: "co-vkn", type: "text", inputmode: "numeric", maxlength: "10", autocomplete: "off" }), "taxNo"));
  corp.appendChild(field("Vergi dairesi", input({ id: "co-taxoffice", type: "text", maxlength: "60" }), "taxOffice"));
  corp.hidden = true;
  form.appendChild(ind); form.appendChild(corp);
  types.addEventListener("change", function(){
   var c = form.querySelector("input[name=btype]:checked").value === "corporate";
   corp.hidden = !c; ind.hidden = c;
  });
  ["co-tc", "co-vkn"].forEach(function(id){
   form.querySelector("#" + id).addEventListener("input", function(e){ e.target.value = e.target.value.replace(/\D/g, ""); });
  });

  form.appendChild(consent("co-ppf", "consentPpf",
   '<a href="' + LEGAL + 'on-bilgilendirme-formu" target="_blank" rel="noopener">Ön bilgilendirme formunu</a> ve ' +
   '<a href="' + LEGAL + 'mesafeli-satis-sozlesmesi" target="_blank" rel="noopener">mesafeli satış sözleşmesini</a> okudum, onaylıyorum.'));
  form.appendChild(consent("co-transfer", "consentTransfer",
   'Kişisel verilerimin ödeme ve faturalandırma amacıyla yurt dışındaki hizmet sağlayıcılara aktarılmasına ' +
   '<a href="' + LEGAL + 'kvkk-aydinlatma-metni" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a> kapsamında açık rıza veriyorum.'));

  var submitErr = ui.el("p", { class: "auth-error-text", role: "alert" });
  var btn = ui.el("button", { class: "btn", type: "submit", text: "Güvenli Ödemeye Geç" });
  form.appendChild(submitErr);
  form.appendChild(btn);
  form.appendChild(ui.el("p", { class: "muted co-secure",
   text: "Kart bilgileriniz bize değil, doğrudan iyzico'nun güvenli ödeme sayfasına girilir." + (mode.testMode ? " (Test modu: gerçek çekim yapılmaz.)" : "") }));

  form.querySelectorAll("input[name=plan]").forEach(function(r){ r.addEventListener("change", function(){ storePlan(r.value); }); });

  form.addEventListener("submit", function(e){
   e.preventDefault();
   submitErr.textContent = "";
   var body = collect(form);
   var local = localCheck(body);
   if (Object.keys(local).length){ showErrors(form, local); if (local.plan) submitErr.textContent = local.plan; return; }
   btn.disabled = true; btn.textContent = "Yönlendiriliyor…";
   var reset = function(){ btn.disabled = false; btn.textContent = "Güvenli Ödemeye Geç"; };
   window.ATLAS_SUPABASE.auth.getSession().then(function(s){
    var token = s.data && s.data.session && s.data.session.access_token;
    if (!token) throw { status: 401 };
    return fetch(API, {
     method: "POST",
     headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
     body: JSON.stringify(body)
    });
   }).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(data){ return { status: r.status, data: data }; });
   }).then(function(res){
    if (res.status === 200 && res.data && res.data.url){ location.href = res.data.url; return; }
    reset();
    if (res.status === 400 && res.data && res.data.messages){ showErrors(form, res.data.messages); submitErr.textContent = "Lütfen işaretli alanları düzeltin."; return; }
    showErrors(form, {});
    submitErr.textContent = errorText(res.status, res.data);
   }).catch(function(err){
    reset();
    submitErr.textContent = err && err.status === 401 ? errorText(401) : "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
   });
  });

  wrap.appendChild(form);
 }

 function mount(f){
  var wrap = ui.el("div"); f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){ wrap.appendChild(ui.el("div", { class: "card", text: "Oturum hazır değil." })); return; }
  wrap.appendChild(ui.el("p", { class: "muted", text: "Yükleniyor…" }));
  Promise.all([
   fetch(API + "?mode=1").then(function(r){ return r.ok ? r.json() : { enabled: false }; }).catch(function(){ return { enabled: false }; }),
   sb.from("organizations").select("name").eq("id", window.atlasOrgId).maybeSingle()
  ]).then(function(r){
   ui.clear(wrap);
   var mode = r[0] || {};
   if (!mode.enabled){
    var c = ui.el("div", { class: "card" });
    c.appendChild(ui.el("h2", { text: "Çevrimiçi ödeme şu an kapalı" }));
    c.appendChild(ui.el("p", { class: "muted", text: "Ödeme sistemi bakımda ya da henüz açılmadı. Lütfen biraz sonra bu sayfayı yenileyin." }));
    wrap.appendChild(c);
    return;
   }
   buildForm(wrap, mode, (r[1] && r[1].data) || {});
  });
 }

 /* iyzico dönüşü: ?odeme=… — Kurulum ekranının üstünde bir kez gösterilir, sonra adresten silinir. */
 var RESULT = {
  success: ["Ödemeniz alındı, teşekkürler! Sıradaki adım: WhatsApp numaranızın bağlanması.", "info"],
  pending: ["Ödemeniz bankanız ya da iyzico tarafından inceleniyor. Sonuçlanınca bu ekranda görünür.", ""],
  failed: ["Ödeme tamamlanamadı; kartınızdan tutar çekilmedi. Bilgileri kontrol edip tekrar deneyebilirsiniz.", ""]
 };
 var pendingResult = (function(){
  var q = new URLSearchParams(location.search);
  var st = q.get("odeme");
  if (!RESULT[st]) return null;
  q.delete("odeme");
  var rest = q.toString();
  history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  if (st === "success") storePlan("");
  return st;
 })();

 function resultNotice(){
  if (!pendingResult) return null;
  var r = RESULT[pendingResult];
  var box = ui.el("div", { class: "notice " + r[1], role: "status", text: r[0] });
  if (pendingResult === "failed"){
   var a = ui.el("a", { class: "btn", href: "#odeme", text: "Tekrar dene" });
   box.appendChild(document.createElement("br")); box.appendChild(a);
  }
  pendingResult = null;
  return box;
 }

 window.ATLAS_CHECKOUT = { mount: mount, resultNotice: resultNotice, storedPlan: storedPlan };
})();
