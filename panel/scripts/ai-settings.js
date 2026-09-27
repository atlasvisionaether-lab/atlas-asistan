"use strict";
/* AI Asistan Ayarları: system prompt, karşılama, fallback, model ve temperature —
 * Supabase assistant_settings tablosundan. Kayıt sonrası değişiklik geçmişi
 * assistant_settings_history tablosuna yazılır.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js —
 * resolveSupabaseUrl sayesinde /api/supabase reverse-proxy üzerinden çalışır), window.atlasUser.
 * RLS: 0009'daki politikalar organization_id = current_org_id() bazlıdır. */
(function(){
 var ui = window.ATLAS_UI;
 var DEFAULTS = {
  system_prompt: "Sen, Türkiye'deki bir güzellik merkezi için çalışan Atlas Asistan adlı asistansın. Kısa, kibar ve net yanıt ver. Randevu, hizmet, fiyat ve çalışma saatleri konularında yardımcı ol. Sağlık, teşhis veya tedavi taleplerinde yanıt verme; kullanıcıyı insan temsilciye yönlendir.",
  greeting_message: "Merhaba! Ben Atlas Asistan. Randevu ve hizmetler hakkında size yardımcı olabilirim. Nasıl yardımcı olabilirim?",
  fallback_message: "Bu soruya yanıt veremiyorum. Sizi ekibimize yönlendiriyorum; kısa süre içinde dönecekler.",
  model: "small",
  temperature: 0.3
 };
 var STYLE_ID = "ai-settings-style";
 function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent =
   ".ai-form label{display:block;margin:.75rem 0 .25rem;font-weight:600}" +
   ".ai-form textarea,.ai-form select{width:100%;box-sizing:border-box;padding:.4rem;border-radius:8px;border:1px solid #ccc}" +
   ".ai-form textarea{min-height:90px}" +
   ".ai-temp-row{display:flex;align-items:center;gap:.75rem;margin:.25rem 0}" +
   ".ai-temp-row input[type=range]{flex:1}" +
   ".ai-temp-val{min-width:2.5rem;text-align:right;font-variant-numeric:tabular-nums}" +
   ".ai-err{color:#b00;margin-top:.5rem}" +
   ".ai-changed{color:#666;font-size:.85rem;margin-top:.25rem}";
  document.head.appendChild(s);
 }
 function fetchOrgId(){
  var sb = window.ATLAS_SUPABASE, user = window.atlasUser;
  if (!sb || !user) return Promise.reject(new Error("Oturum ya da Supabase bağlantısı yok."));
  return sb.from("users").select("organization_id").eq("id", user.id).single()
   .then(function(u){
    if (u.error) throw new Error("Organizasyon bilgisi alınamadı: " + u.error.message);
    if (!u.data || !u.data.organization_id) throw new Error("Kullanıcı bir organizasyona bağlı değil.");
    return u.data.organization_id;
   });
 }
 function mount(f){
  ensureStyles();
  var wrap = ui.el("div");
  f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){
   var w = ui.el("div",{class:"card"});
   w.appendChild(ui.el("p",{text:"Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)"}));
   wrap.appendChild(w); return;
  }
  fetchOrgId().then(function(orgId){
   renderForm(wrap, orgId);
  }).catch(function(e){
   var c = ui.el("div",{class:"card"});
   c.appendChild(ui.el("p",{text:"Ayarlar yüklenemedi: " + (e && e.message ? e.message : String(e))}));
   wrap.appendChild(c);
  });
 }
 function renderForm(wrap, orgId){
  var sb = window.ATLAS_SUPABASE;
  ui.clear(wrap);
  wrap.appendChild(ui.el("div",{class:"card",text:"Ayarlar yükleniyor…"}));
  sb.from("assistant_settings").select("*").eq("organization_id", orgId).limit(1).maybeSingle()
   .then(function(res){
    if (res.error) throw new Error(res.error.message);
    var row = res.data;
    var settings = {
     system_prompt: (row && row.system_prompt) || DEFAULTS.system_prompt,
     greeting_message: (row && row.greeting_message) || DEFAULTS.greeting_message,
     fallback_message: (row && row.fallback_message) || DEFAULTS.fallback_message,
     model: (row && row.model) || DEFAULTS.model,
     temperature: (row && typeof row.temperature === "number") ? row.temperature : DEFAULTS.temperature
    };
    drawForm(wrap, orgId, row ? row.id : null, settings, !row);
    loadHistory(wrap, orgId);
   })
   .catch(function(e){
    ui.clear(wrap);
    var c = ui.el("div",{class:"card"});
    c.appendChild(ui.el("p",{text:"Ayarlar yüklenemedi: " + (e && e.message ? e.message : String(e))}));
    wrap.appendChild(c);
   });
 }
 function drawForm(wrap, orgId, rowId, s, isDefault){
  var sb = window.ATLAS_SUPABASE;
  ui.clear(wrap);
  var card = ui.el("div",{class:"card"});
  card.appendChild(ui.el("h2",{text:"Prompt ve Model Ayarları"}));
  if (isDefault){
   card.appendChild(ui.el("div",{class:"notice info",text:"Bu organizasyon için kayıtlı ayar yok; varsayılan değerler gösteriliyor. Kaydedince tabloya yazılır."}));
  }
  var form = ui.el("div",{class:"ai-form"});
  function ta(label, value, rows){
   form.appendChild(ui.el("label",{text:label}));
   var t = ui.el("textarea",{rows:String(rows)});
   t.value = value;
   form.appendChild(t);
   return t;
  }
  var sys = ta("System Prompt", s.system_prompt, 6);
  var greet = ta("Karşılama Mesajı", s.greeting_message, 3);
  var fallb = ta("Fallback", s.fallback_message, 3);
  form.appendChild(ui.el("label",{text:"Model"}));
  var modelSel = ui.el("select");
  ["small","medium"].forEach(function(m){
   var o = ui.el("option",{value:m,text:m === "small" ? "small (hızlı)" : "medium (daha yetenekli)"});
   if (m === s.model) o.selected = true;
   modelSel.appendChild(o);
  });
  form.appendChild(modelSel);
  form.appendChild(ui.el("label",{text:"Temperature (0 – 1)"}));
  var tempRow = ui.el("div",{class:"ai-temp-row"});
  var temp = ui.el("input",{type:"range",min:"0",max:"1",step:"0.1"});
  temp.value = String(s.temperature);
  var tempVal = ui.el("span",{class:"ai-temp-val",text:String(s.temperature)});
  temp.addEventListener("input", function(){ tempVal.textContent = temp.value; });
  tempRow.appendChild(temp); tempRow.appendChild(tempVal);
  form.appendChild(tempRow);
  var err = ui.el("p",{class:"ai-err",role:"alert"});
  form.appendChild(err);
  var save = ui.el("button",{class:"btn",text:"Kaydet"});
  var status = ui.el("p",{class:"ai-changed"});
  save.addEventListener("click", function(){
   err.textContent = "";
   var payload = {
    organization_id: orgId,
    system_prompt: sys.value.trim() || DEFAULTS.system_prompt,
    greeting_message: greet.value.trim() || DEFAULTS.greeting_message,
    fallback_message: fallb.value.trim() || DEFAULTS.fallback_message,
    model: modelSel.value,
    temperature: Number(temp.value),
    updated_at: new Date().toISOString()
   };
   if (payload.system_prompt.length > 8000){ err.textContent = "System prompt çok uzun (maks. 8000 karakter)."; return; }
   if (payload.temperature < 0 || payload.temperature > 1 || isNaN(payload.temperature)){ err.textContent = "Temperature 0 ile 1 arasında olmalı."; return; }
   var op = rowId ? sb.from("assistant_settings").update(payload).eq("id", rowId)
                  : sb.from("assistant_settings").insert(payload);
   op.then(function(res){
    if (res.error){ err.textContent = "Kaydedilemedi: " + res.error.message; return; }
    ui.toast("Ayarlar kaydedildi.");
    status.textContent = "Kaydedildi: " + new Date().toLocaleString("tr-TR");
    logHistory(payload);
   }).catch(function(e){ err.textContent = "Kaydedilemedi: " + (e && e.message ? e.message : String(e)); });
  });
  var row = ui.el("div",{class:"form-row"});
  row.appendChild(save);
  form.appendChild(row);
  form.appendChild(status);
  card.appendChild(form);
  wrap.appendChild(card);
 }
 function logHistory(payload){
  var sb = window.ATLAS_SUPABASE, user = window.atlasUser;
  sb.from("assistant_settings_history").insert({
   organization_id: payload.organization_id,
   system_prompt: payload.system_prompt,
   greeting_message: payload.greeting_message,
   fallback_message: payload.fallback_message,
   model: payload.model,
   temperature: payload.temperature,
   changed_by: user ? user.id : null
  }).then(function(res){
   if (res.error) ui.toast("Geçmiş kaydı yazılamadı: " + res.error.message);
  }).catch(function(){});
 }
 function loadHistory(wrap, orgId){
  var sb = window.ATLAS_SUPABASE;
  sb.from("assistant_settings_history").select("created_at,model,temperature")
   .eq("organization_id", orgId).order("created_at",{ascending:false}).limit(10)
   .then(function(res){
    if (res.error || !res.data || !res.data.length) return;
    var card = ui.el("div",{class:"card"});
    card.appendChild(ui.el("h2",{text:"Son Değişiklikler"}));
    var t = document.createElement("table");
    var thead = document.createElement("thead"); var htr = document.createElement("tr");
    ["Tarih","Model","Temperature"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); });
    thead.appendChild(htr); t.appendChild(thead);
    var tbody = document.createElement("tbody");
    res.data.forEach(function(h){
     var tr = document.createElement("tr");
     var d = document.createElement("td");
     try { d.textContent = new Date(h.created_at).toLocaleString("tr-TR"); } catch(e){ d.textContent = "-"; }
     tr.appendChild(d);
     var m = document.createElement("td"); m.textContent = h.model || "-"; tr.appendChild(m);
     var tp = document.createElement("td"); tp.textContent = (typeof h.temperature === "number") ? String(h.temperature) : "-"; tr.appendChild(tp);
     tbody.appendChild(tr);
    });
    t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
   }).catch(function(){});
 }
 window.ATLAS_AI = { mount: mount };
})();
