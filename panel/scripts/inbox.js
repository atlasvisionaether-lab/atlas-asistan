"use strict";
/* Gelen Kutusu: Supabase messages tablosundan canlı veri + Realtime.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 * Filtreler: Tümü | Okunmadı | AI Cevaplı | İnsana Aktarıldı.
 * Badge: sender_type='ai' mor "AI", sender_type='human' yeşil "İnsan".
 * Risk: içerikte şikâyet/ağrı/yanık benzeri kelimeler varsa sarı "dikkat".
 * Devralma: handover_requested=true (messages) + is_handled_by_human=true (customers) —
 * mock DEĞİL, kalıcı DB yazımı (0013 kolonları). */
(function(){
 var ui = window.ATLAS_UI;

 var STYLE_ID = "inbox-modal-style";
 function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent =
   ".inbox-row{cursor:pointer}" +
   ".inbox-filters{display:flex;gap:.4rem;flex-wrap:wrap;margin:0 0 14px}" +
   ".inbox-filters button{border:1px solid var(--line,#555);background:transparent;color:var(--muted,#999);border-radius:999px;padding:5px 14px;font-size:.85rem;cursor:pointer}" +
   ".inbox-filters button.active{background:var(--accent,#4f46e5);color:#fff;border-color:var(--accent,#4f46e5)}" +
   ".inbox-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem}" +
   ".inbox-modal{background:var(--bg,#fff);color:inherit;border-radius:12px;max-width:520px;width:100%;padding:1.25rem;box-shadow:0 12px 40px rgba(0,0,0,.25)}" +
   ".inbox-modal h2{margin:0 0 .5rem}" +
   ".inbox-modal dl{margin:0 0 1rem}" +
   ".inbox-modal dt{font-weight:600;margin-top:.5rem}" +
   ".inbox-modal dd{margin:0}";
  document.head.appendChild(s);
 }

 function fmtDate(iso){
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("tr-TR"); } catch(e){ return String(iso); }
 }

 var RISK_WORDS = ["şikayet","şikâyet","ağrı","agrı","yanık","yanik","memnun değilim","kızarıklık","kizariklik","şişlik","sislik","acı","aci","rahatsız"];
 function hasRiskWord(text){
  var t = String(text || "").toLocaleLowerCase("tr-TR");
  for (var i = 0; i < RISK_WORDS.length; i++){
   if (t.indexOf(RISK_WORDS[i]) !== -1) return true;
  }
  return false;
 }

 function riskTag(risk, content){
  var r = String(risk || "normal");
  var flagged = hasRiskWord(content);
  if (r === "yüksek") return ui.el("span", { class: "tag danger", text: "yüksek" });
  if (flagged) return ui.el("span", { class: "tag warn", text: "dikkat" });
  return ui.el("span", { class: "tag ok", text: r });
 }

 function aiTag(){
  return ui.el("span", { class: "tag ai", text: "AI" });
 }

 function humanTag(){
  return ui.el("span", { class: "tag human", text: "İnsan" });
 }

 var currentFilter = "all";
 function setFilter(f){ currentFilter = f; }

 function applyFilter(rows){
  var f = currentFilter;
  if (f === "unread") return rows.filter(function(m){ return m.unread; });
  if (f === "ai") return rows.filter(function(m){ return m.senderType === "ai"; });
  if (f === "handover") return rows.filter(function(m){ return m.handoverRequested; });
  return rows;
 }

 function renderFilters(container){
  var bar = ui.el("div", { class: "inbox-filters" });
  [["all","Tümü"],["unread","Okunmadı"],["ai","AI Cevaplı"],["handover","İnsana Aktarıldı"]].forEach(function(x){
   var b = ui.el("button", { text: x[1] });
   if (currentFilter === x[0]) b.className = "active";
   b.addEventListener("click", function(){
    setFilter(x[0]);
    if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode);
   });
   bar.appendChild(b);
  });
  container.appendChild(bar);
 }

 function renderList(container, rows, sb){
  if (!rows.length){
   var e = ui.el("div", { class: "card" });
   e.appendChild(ui.el("h2", { text: "Mesajlar" }));
   e.appendChild(ui.el("p", { text: "Bu filtrede mesaj yok." }));
   container.appendChild(e);
   return;
  }
  var tableRows = rows.map(function(m){
   var sender = ui.el("span", null, [ui.el("b", { text: m.customerName })]);
   if (m.senderType === "ai") sender.appendChild(aiTag());
   if (m.senderType === "human") sender.appendChild(humanTag());
   if (m.handoverRequested) sender.appendChild(ui.el("span", { class: "tag warn", text: " aktarıldı" }));
   if (m.unread) sender.appendChild(ui.el("span", { class: "tag warn", text: " okunmadı" }));
   var tr = ui.el("tr", { class: "inbox-row" });
   [m.channel, sender, m.content, riskTag(m.riskFlag, m.content)].forEach(function(c){
    var td = ui.el("td");
    td.appendChild(c && c.nodeType ? c : document.createTextNode(String(c)));
    tr.appendChild(td);
   });
   tr.addEventListener("click", function(){ openModal(m, sb); });
   return tr;
  });
  var card = ui.el("div", { class: "card" });
  card.appendChild(ui.el("h2", { text: "Mesajlar (son 50, okunmayan önce)" }));
  var t = document.createElement("table");
  var thead = document.createElement("thead");
  var htr = document.createElement("tr");
  ["Kanal","Gönderen","Mesaj","Risk"].forEach(function(h){ htr.appendChild(ui.el("th", { text: h })); });
  thead.appendChild(htr); t.appendChild(thead);
  var tbody = document.createElement("tbody");
  tableRows.forEach(function(r){ tbody.appendChild(r); });
  t.appendChild(tbody); card.appendChild(t);
  container.appendChild(card);
 }

 function openModal(m, sb){
  ensureStyles();
  closeModal();
  var bd = ui.el("div", { class: "inbox-modal-backdrop" });
  bd.id = "inbox-modal";
  var box = ui.el("div", { class: "inbox-modal" });
  box.appendChild(ui.el("h2", { text: m.customerName }));
  var dl = ui.el("dl");
  var senderLabel = m.senderType === "ai" ? "Atlas AI (Otomatik)" : (m.senderType === "human" ? "İnsan temsilci" : "Müşteri");
  [["Kanal", m.channel],["Gönderen", senderLabel],["Yön", m.direction],["Tarih", fmtDate(m.createdAt)],["Risk", m.riskFlag],["Okunmadı", m.unread ? "evet" : "hayır"],["Devralma talebi", m.handoverRequested ? "evet" : "hayır"]].forEach(function(x){
   dl.appendChild(ui.el("dt", { text: x[0] }));
   dl.appendChild(ui.el("dd", { text: String(x[1] == null ? "-" : x[1]) }));
  });
  box.appendChild(dl);
  box.appendChild(ui.el("p", { text: m.content }));

  var actions = ui.el("div", { class: "form-row" });
  if (m.handoverRequested){
   actions.appendChild(ui.el("span", { class: "tag ok", text: "İnsan temsilciye aktarıldı" }));
  } else {
   var handoverBtn = ui.el("button", { class: "btn", text: "İnsan temsilciye aktar" });
   handoverBtn.addEventListener("click", function(){
    handoverBtn.disabled = true;
    var req = sb.from("messages").update({ handover_requested: true }).eq("id", m.id);
    req.then(function(res){
     if (res.error){
      ui.toast("Aktarılamadı: " + res.error.message);
      handoverBtn.disabled = false;
      return;
     }
     sb.from("customers").update({ is_handled_by_human: true }).eq("id", m.customerId || "")
      .then(function(cRes){
       if (cRes && cRes.error) ui.toast("Müşteri flag güncellenemedi: " + cRes.error.message);
       else ui.toast("İnsan temsilciye aktarıldı — AI bu konuşmada susacak");
      });
     closeModal();
     if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode);
    });
   });
   actions.appendChild(handoverBtn);
  }
  box.appendChild(actions);

  var close = ui.el("button", { class: "btn ghost", text: "Kapat" });
  close.addEventListener("click", closeModal);
  box.appendChild(close);
  bd.appendChild(box);
  bd.addEventListener("click", function(ev){ if (ev.target === bd) closeModal(); });
  document.body.appendChild(bd);
 }
 function closeModal(){
  var m = document.getElementById("inbox-modal");
  if (m) m.remove();
 }
 document.addEventListener("keydown", function(ev){ if (ev.key === "Escape") closeModal(); });

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

 var realtimeChannel = null;
 var currentWrap = null;

 function mount(f){
  if (currentWrap && currentWrap.parentNode) currentWrap.parentNode.removeChild(currentWrap);
  var wrap = ui.el("div");
  currentWrap = wrap;
  f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){
   state(wrap, "wait", "Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)");
   return;
  }
  ensureStyles();
  renderFilters(wrap);
  if (!realtimeChannel && sb.channel){
   realtimeChannel = sb.channel("messages-inbox")
    .on("postgres_changes",
     { event: "INSERT", schema: "public", table: "messages" },
     function(){ if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode); })
    .subscribe();
  }
  var listWrap = ui.el("div");
  wrap.appendChild(listWrap);
  state(listWrap, "loading", "Mesajlar yükleniyor…");
  sb.from("messages")
   .select("id, channel, direction, content, risk_flag, created_at, unread, sender_type, handover_requested, customer_id, customers(full_name)")
   .order("unread", { ascending: false })
   .order("created_at", { ascending: false })
   .range(0, 49)
   .then(function(res){
    ui.clear(listWrap);
    if (res.error){
     state(listWrap, "error", "Mesajlar yüklenemedi: " + res.error.message);
     return;
    }
    var rows = (res.data || []).map(function(m){
     return {
      id: m.id,
      customerId: m.customer_id,
      channel: m.channel || "-",
      direction: m.direction || "-",
      content: m.content || "",
      riskFlag: m.risk_flag || "normal",
      createdAt: m.created_at,
      unread: !!m.unread,
      senderType: m.sender_type || null,
      handoverRequested: !!m.handover_requested,
      customerName: (m.customers && m.customers.full_name) ? m.customers.full_name : "Bilinmiyor"
     };
    });
    renderList(listWrap, applyFilter(rows), sb);
   })
   .catch(function(err){
    ui.clear(listWrap);
    state(listWrap, "error", "Mesajlar yüklenemedi: " + (err && err.message ? err.message : String(err)));
   });
 }

 window.ATLAS_INBOX = { mount: mount };
})();
