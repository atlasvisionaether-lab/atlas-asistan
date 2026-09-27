"use strict";
/* Otomasyonlar: assistant_settings tablosundan auto_reply_enabled, working_hours,
 * fallback_message, model — canlı oku/yaz (mock değil).
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js), window.atlasUser.
 * RLS: 0009'daki assistant_settings politikaları organization_id bazlı.
 * Org ID, users tablosundan oturum kullanıcısı üzerinden çözülür (ai-settings.js pattern'i). */
(function(){
 var ui = window.ATLAS_UI;
 var STYLE_ID = "automations-style";

 function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent =
   ".auto-form label{display:block;margin:.75rem 0 .25rem;font-weight:600}" +
   ".auto-form input,.auto-form select,.auto-form textarea{width:100%;box-sizing:border-box;padding:.4rem;border-radius:8px;border:1px solid #ccc}" +
   ".auto-form textarea{min-height:90px}" +
   ".auto-row{display:flex;align-items:center;gap:.75rem;margin:.25rem 0}" +
   ".auto-err{color:#b00;margin-top:.5rem}" +
   ".auto-ok{color:var(--ok,#10b981);margin-top:.5rem}";
  document.head.appendChild(s);
 }

 function state(container, kind, msg){
  var c = ui.el("div", { class: "card" });
  c.appendChild(ui.el("p", { text: msg }));
  if (kind === "error" || kind === "wait"){
   var b = ui.el("button", { class: "btn ghost", text: kind === "error" ? "Yeniden dene" : "Yeniden kontrol et" });
   b.addEventListener("click", function(){ if (container.parentNode) mount(container.parentNode); });
   c.appendChild(b);
  }
  container.appendChild(c);
 }

 function fetchOrgId(){
  var sb = window.ATLAS_SUPABASE, user = window.atlasUser;
  if (!sb || !user) return Promise.reject(new Error("Oturum ya da Supabase bağlantısı yok."));
  return sb.from("users").select("organization_id").eq("id", user.id).limit(1).maybeSingle()
   .then(function(u){
    if (u.error) throw new Error("Organizasyon bilgisi alınamadı: " + u.error.message);
    if (!u.data || !u.data.organization_id) throw new Error("Kullanıcı bir organizasyona bağlı değil.");
    return u.data.organization_id;
   });
 }

 function renderForm(wrap, orgId, settings){
  var sb = window.ATLAS_SUPABASE;
  var card = ui.el("div", { class: "card auto-form" });
  card.appendChild(ui.el("h2", { text: "Otomasyon ayarları (canlı — assistant_settings)" }));

  /* 1) AI otomatik cevap anahtarı */
  card.appendChild(ui.el("label", { text: "AI otomatik cevabı" }));
  var row = ui.el("div", { class: "auto-row" });
  var enabledBox = ui.el("label", { class: "switch" });
  var enabledInput = ui.el("input", { type: "checkbox" });
  enabledInput.checked = settings.auto_reply_enabled !== false;
  enabledBox.appendChild(enabledInput);
  enabledBox.appendChild(ui.el("span", { class: "slider" }));
  row.appendChild(enabledBox);
  row.appendChild(ui.el("span", { text: enabledInput.checked ? "AÇIK" : "KAPALI" }));
  var stateLabel = row.lastChild;
  enabledInput.addEventListener("change", function(){ stateLabel.textContent = enabledInput.checked ? "AÇIK" : "KAPALI"; });
  card.appendChild(row);

  /* 2) Çalışma saatleri */
  card.appendChild(ui.el("label", { text: "Çalışma saatleri" }));
  var hoursRow = ui.el("div", { class: "auto-row" });
  var startInput = ui.el("input", { type: "time", value: (settings.working_hours && settings.working_hours.start) || "09:00" });
  var endInput = ui.el("input", { type: "time", value: (settings.working_hours && settings.working_hours.end) || "18:00" });
  hoursRow.appendChild(startInput);
  hoursRow.appendChild(ui.el("span", { text: "—" }));
  hoursRow.appendChild(endInput);
  card.appendChild(hoursRow);

  /* 3) Fallback mesajı */
  card.appendChild(ui.el("label", { text: "Fallback mesajı" }));
  var fallbackInput = ui.el("textarea");
  fallbackInput.value = settings.fallback_message || "";
  card.appendChild(fallbackInput);

  /* 4) AI modeli */
  card.appendChild(ui.el("label", { text: "AI modeli" }));
  var modelSelect = ui.el("select");
  [["small", "small (hızlı)"], ["medium", "medium (gelişmiş)"]].forEach(function(o){
   var opt = ui.el("option", { value: o[0], text: o[1] });
   if ((settings.model || "small") === o[0]) opt.selected = true;
   modelSelect.appendChild(opt);
  });
  card.appendChild(modelSelect);

  var err = ui.el("p", { class: "auto-err", text: "" });
  card.appendChild(err);
  var ok = ui.el("p", { class: "auto-ok", text: "" });
  card.appendChild(ok);

  var save = ui.el("button", { class: "btn", text: "Kaydet" });
  save.addEventListener("click", function(){
   err.textContent = ""; ok.textContent = "";
   var payload = {
    auto_reply_enabled: enabledInput.checked,
    working_hours: { start: startInput.value || "09:00", end: endInput.value || "18:00" },
    fallback_message: fallbackInput.value.trim(),
    model: modelSelect.value,
    updated_at: new Date().toISOString()
   };
   sb.from("assistant_settings")
    .update(payload)
    .eq("organization_id", orgId)
    .then(function(res){
     if (res.error){ err.textContent = "Kaydedilemedi: " + res.error.message; return; }
     if (res.data && res.data.length === 0){
      /* Satır yoksa insert et (upstream upsert yerine manuel) */
      payload.organization_id = orgId;
      sb.from("assistant_settings").insert(payload).then(function(r2){
       if (r2.error) err.textContent = "Kaydedilemedi (insert): " + r2.error.message;
       else { ok.textContent = "Kaydedildi."; ui.toast("Otomasyon ayarları kaydedildi"); }
      });
      return;
     }
     ok.textContent = "Kaydedildi.";
     ui.toast("Otomasyon ayarları kaydedildi");
    });
  });
  card.appendChild(save);
  wrap.appendChild(card);

  var notice = ui.el("div", { class: "notice info", text: "auto_reply_enabled kapatıldığında Edge Function cevap üretmez; çalışan saat dışında gelenler için fallback mesajı kullanılır." });
  wrap.appendChild(notice);
 }

 function mount(f){
  ensureStyles();
  var wrap = ui.el("div");
  f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){
   state(wrap, "wait", "Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)");
   return;
  }
  state(wrap, "loading", "Otomasyon ayarları yükleniyor…");
  fetchOrgId()
   .then(function(orgId){
    return sb.from("assistant_settings")
     .select("auto_reply_enabled, working_hours, fallback_message, model")
     .eq("organization_id", orgId)
     .limit(1)
     .maybeSingle()
     .then(function(res){
      ui.clear(wrap);
      if (res.error){ state(wrap, "error", "Ayarlar yüklenemedi: " + res.error.message); return; }
      renderForm(wrap, orgId, res.data || {});
     });
   })
   .catch(function(e){
    ui.clear(wrap);
    state(wrap, "error", "Ayarlar yüklenemedi: " + (e && e.message ? e.message : String(e)));
   });
 }

 window.ATLAS_AUTOMATIONS = { mount: mount };
})();
