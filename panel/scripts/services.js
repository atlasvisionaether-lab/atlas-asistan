"use strict";
/* Hizmetler / Fiyatlar: Supabase services tablosu — canlı CRUD.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js), window.atlasUser.
 * RLS: yalnızca kendi organizasyonunun satırları görünür/değiştirilebilir;
 * ORG_ID ek savunma olarak panel sorgularında tekrar uygulanır.
 * Edge Function bu tabloyu her çağrıda okur — buradaki değişiklikler
 * otomatik yansır, Edge Function deploy'ı GEREKMEZ. */
(function(){
 var ui = window.ATLAS_UI;
 var ORG_ID = "fff29ed3-f2e3-4837-bdfc-f4e974f366e7";
 var realtimeChannel = null;
 var currentWrap = null;

 function fmtPrice(p){
  if (p === null || p === undefined || p === "") return "—";
  if (typeof p === "number") return p.toLocaleString("tr-TR") + " TRY";
  var n = Number(p);
  if (!isNaN(n) && String(p).trim() !== "") return n.toLocaleString("tr-TR") + " TRY";
  return String(p);
 }

 function state(container, kind, msg){
  var c = ui.el("div", { class: "card" });
  c.appendChild(ui.el("p", { text: msg }));
  if (kind === "error" || kind === "wait"){
   var b = ui.el("button", { class: "btn ghost", text: kind === "error" ? "Yeniden dene" : "Yeniden kontrol et" });
   b.addEventListener("click", function(){ if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode); });
   c.appendChild(b);
  }
  container.appendChild(c);
 }

 function toggleSwitch(svc, sb){
  var box = ui.el("label", { class: "switch" });
  var input = ui.el("input", { type: "checkbox" });
  input.checked = !!svc.is_active;
  var slider = ui.el("span", { class: "slider" });
  box.appendChild(input);
  box.appendChild(slider);
  input.addEventListener("change", function(){
   sb.from("services")
    .update({ is_active: input.checked })
    .eq("id", svc.id)
    .then(function(res){
     if (res.error){ ui.toast("Durum güncellenemedi: " + res.error.message); input.checked = !input.checked; }
     else ui.toast(svc.name + (input.checked ? " aktifleştirildi" : " pasifleştirildi"));
    });
  });
  return box;
 }

 function rowActions(svc, sb){
  var wrap = ui.el("div", { class: "svc-actions" });

  var editBtn = ui.el("button", { class: "btn ghost", text: "Düzenle" });
  editBtn.addEventListener("click", function(){ openModal(svc, sb, false); });
  wrap.appendChild(editBtn);

  var delBtn = ui.el("button", { class: "btn danger", text: "Sil" });
  delBtn.addEventListener("click", function(){
   if (!window.confirm('"' + svc.name + '" hizmeti kalıcı olarak silinsin mi?')) return;
   sb.from("services").delete().eq("id", svc.id).then(function(res){
    if (res.error) ui.toast("Silinemedi: " + res.error.message);
    else ui.toast(svc.name + " silindi");
   });
  });
  wrap.appendChild(delBtn);

  return wrap;
 }

 function renderTable(container, rows, sb){
  var card = ui.el("div", { class: "card" });
  card.appendChild(ui.el("h2", { text: "Hizmetler — Canlı + AI önizleme (satışa hazır)" }));
  var t = ui.el("table");
  var thead = ui.el("thead");
  var htr = ui.el("tr");
  ["Hizmet", "Fiyat", "Süre (dk)", "Aktif", "İşlem"].forEach(function(h){ htr.appendChild(ui.el("th", { text: h })); });
  thead.appendChild(htr);
  t.appendChild(thead);
  var tbody = ui.el("tbody");
  rows.forEach(function(s){
   var tr = ui.el("tr");
   var tdName = ui.el("td", { text: String(s.name || "—") });
   var tdPrice = ui.el("td", { text: fmtPrice(s.price) + " — AI'da anında" });
   var tdDur = ui.el("td", { text: s.duration_min ? String(s.duration_min) : "—" });
   var tdActive = ui.el("td");
   tdActive.appendChild(toggleSwitch(s, sb));
   var tdActions = ui.el("td");
   tdActions.appendChild(rowActions(s, sb));
   [tdName, tdPrice, tdDur, tdActive, tdActions].forEach(function(td){ tr.appendChild(td); });
   tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  card.appendChild(t);
  container.appendChild(card);

  var addBtn = ui.el("button", { class: "btn", text: "+ Yeni hizmet ekle" });
  addBtn.addEventListener("click", function(){ openModal(null, sb, true); });
  container.appendChild(addBtn);
 }

 function renderEmpty(container, sb){
  var card = ui.el("div", { class: "card empty-state" });
  card.appendChild(ui.el("h2", { text: "Henüz kayıtlı hizmet yok" }));
  card.appendChild(ui.el("p", { text: "İlk hizmetinizi ekleyin — fiyatlar Atlas AI'ın cevaplarında anında kullanılır." }));
  var addBtn = ui.el("button", { class: "btn", text: "Hizmet ekle" });
  addBtn.addEventListener("click", function(){ openModal(null, sb, true); });
  card.appendChild(addBtn);
  container.appendChild(card);
 }

 var MODAL_STYLE_ID = "svc-modal-style";
 function ensureStyles(){
  if (document.getElementById(MODAL_STYLE_ID)) return;
  var s = document.createElement("style"); s.id = MODAL_STYLE_ID;
  s.textContent =
   ".svc-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem}" +
   ".svc-modal{background:var(--panel,#fff);color:inherit;border-radius:12px;max-width:440px;width:100%;padding:1.25rem;box-shadow:0 12px 40px rgba(0,0,0,.25)}" +
   ".svc-modal h2{margin:0 0 .75rem}" +
   ".svc-modal label{display:block;margin:.6rem 0 .2rem;font-weight:600}" +
   ".svc-modal input,.svc-modal textarea{width:100%;box-sizing:border-box}" +
   ".svc-actions{display:flex;gap:.35rem}" +
   ".switch{position:relative;display:inline-block;width:44px;height:24px}" +
   ".switch input{opacity:0;width:0;height:0}" +
   ".slider{position:absolute;cursor:pointer;inset:0;background:var(--line,#555);border-radius:999px;transition:.2s}" +
   ".slider:before{content:'';position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}" +
   ".switch input:checked + .slider{background:var(--accent,#4f46e5)}" +
   ".switch input:checked + .slider:before{transform:translateX(20px)}" +
   ".empty-state{text-align:center;padding:2.5rem 1rem}" +
   ".empty-state p{color:var(--muted,#999)}";
  document.head.appendChild(s);
 }

 function closeModal(){ var m = document.getElementById("svc-modal"); if (m) m.remove(); }

 function openModal(svc, sb, isNew){
  ensureStyles();
  closeModal();
  var bd = ui.el("div", { class: "svc-modal-backdrop" });
  bd.id = "svc-modal";
  var box = ui.el("div", { class: "svc-modal" });
  box.appendChild(ui.el("h2", { text: isNew ? "Yeni hizmet" : "Hizmeti düzenle" }));

  box.appendChild(ui.el("label", { text: "Hizmet adı" }));
  var nameInput = ui.el("input", { type: "text", value: svc ? String(svc.name || "") : "" });
  box.appendChild(nameInput);

  box.appendChild(ui.el("label", { text: "Fiyat (TRY)" }));
  var priceInput = ui.el("input", { type: "number", min: "0", step: "0.01", value: svc && svc.price != null ? String(svc.price) : "" });
  box.appendChild(priceInput);

  box.appendChild(ui.el("label", { text: "Süre (dakika)" }));
  var durInput = ui.el("input", { type: "number", min: "0", step: "5", value: svc && svc.duration_min ? String(svc.duration_min) : "" });
  box.appendChild(durInput);

  box.appendChild(ui.el("label", { text: "Aktif" }));
  var activeBox = ui.el("label", { class: "switch" });
  var activeInput = ui.el("input", { type: "checkbox" });
  activeInput.checked = svc ? !!svc.is_active : true;
  activeBox.appendChild(activeInput);
  activeBox.appendChild(ui.el("span", { class: "slider" }));
  box.appendChild(activeBox);

  var err = ui.el("p", { class: "ai-err", text: "" });
  box.appendChild(err);

  var save = ui.el("button", { class: "btn", text: "Kaydet" });
  save.addEventListener("click", function(){
   var name = nameInput.value.trim();
   if (!name){ err.textContent = "Hizmet adı boş olamaz."; return; }
   var payload = {
    organization_id: ORG_ID,
    name: name,
    price: priceInput.value === "" ? null : Number(priceInput.value),
    duration_min: durInput.value === "" ? null : Number(durInput.value),
    is_active: activeInput.checked
   };
   var req = isNew
    ? sb.from("services").insert(payload)
    : sb.from("services").update(payload).eq("id", svc.id);
   req.then(function(res){
    if (res.error){ err.textContent = "Kaydedilemedi: " + res.error.message; return; }
    closeModal();
    ui.toast(isNew ? "Hizmet eklendi" : "Hizmet güncellendi");
   });
  });
  box.appendChild(save);

  var cancel = ui.el("button", { class: "btn ghost", text: "Vazgeç" });
  cancel.addEventListener("click", closeModal);
  box.appendChild(cancel);

  bd.appendChild(box);
  bd.addEventListener("click", function(ev){ if (ev.target === bd) closeModal(); });
  document.body.appendChild(bd);
 }

 function mount(f){
  ensureStyles();
  if (currentWrap && currentWrap.parentNode) currentWrap.parentNode.removeChild(currentWrap);
  var wrap = ui.el("div");
  currentWrap = wrap;
  f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){
   state(wrap, "wait", "Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)");
   return;
  }
  if (!realtimeChannel && sb.channel){
   realtimeChannel = sb.channel("services-live")
    .on("postgres_changes",
     { event: "*", schema: "public", table: "services" },
     function(){ if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode); })
    .subscribe();
  }
  state(wrap, "loading", "Hizmetler yükleniyor…");
  sb.from("services")
   .select("*")
   .eq("organization_id", ORG_ID)
   .order("created_at")
   .then(function(res){
    ui.clear(wrap);
    if (res.error){ state(wrap, "error", "Hizmetler yüklenemedi: " + res.error.message); return; }
    var rows = res.data || [];
    if (!rows.length) renderEmpty(wrap, sb);
    else renderTable(wrap, rows, sb);
   })
   .catch(function(err){
    ui.clear(wrap);
    state(wrap, "error", "Hizmetler yüklenemedi: " + (err && err.message ? err.message : String(err)));
   });
 }

 window.ATLAS_SERVICES = { mount: mount };
})();
