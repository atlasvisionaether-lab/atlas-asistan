"use strict";
/* Gelen Kutusu: Supabase messages tablosundan canlı veri (mock değil).
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 * RLS sayesinde authenticated kullanıcı yalnızca kendi organizasyonunun satırlarını görür. */
(function(){
 var ui = window.ATLAS_UI;

 var STYLE_ID = "inbox-modal-style";
 function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent =
   ".inbox-row{cursor:pointer}" +
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

 function riskTag(risk){
  var r = String(risk || "normal");
  var cls = r === "yüksek" ? "tag danger" : "tag ok";
  return ui.el("span", { class: cls, text: r });
 }

 function aiTag(){
  return ui.el("span", { class: "tag ai", text: "AI" });
 }

 function renderList(container, rows){
  if (!rows.length){
   var e = ui.el("div", { class: "card" });
   e.appendChild(ui.el("h2", { text: "Mesajlar" }));
   e.appendChild(ui.el("p", { text: "Gelen kutusu boş. Henüz mesaj yok." }));
   container.appendChild(e);
   return;
  }
  var tableRows = rows.map(function(m){
   var sender = ui.el("span", null, [ui.el("b", { text: m.customerName })]);
   if (m.senderType === "ai") sender.appendChild(aiTag());
   if (m.unread) sender.appendChild(ui.el("span", { class: "tag warn", text: " okunmadı" }));
   var tr = ui.el("tr", { class: "inbox-row" });
   [m.channel, sender, m.content, riskTag(m.riskFlag)].forEach(function(c){
    var td = ui.el("td");
    td.appendChild(c && c.nodeType ? c : document.createTextNode(String(c)));
    tr.appendChild(td);
   });
   tr.addEventListener("click", function(){ openModal(m); });
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

 function openModal(m){
  ensureStyles();
  closeModal();
  var bd = ui.el("div", { class: "inbox-modal-backdrop" });
  bd.id = "inbox-modal";
  var box = ui.el("div", { class: "inbox-modal" });
  box.appendChild(ui.el("h2", { text: m.customerName }));
  var dl = ui.el("dl");
  [["Kanal", m.channel],["Yön", m.direction],["Gönderen", m.senderType === "ai" ? "Atlas AI" : "Müşteri"],["Tarih", fmtDate(m.createdAt)],["Risk", m.riskFlag],["Okunmadı", m.unread ? "evet" : "hayır"]].forEach(function(x){
   dl.appendChild(ui.el("dt", { text: x[0] }));
   dl.appendChild(ui.el("dd", { text: String(x[1] == null ? "-" : x[1]) }));
  });
  box.appendChild(dl);
  box.appendChild(ui.el("p", { text: m.content }));
  var close = ui.el("button", { class: "btn", text: "Kapat" });
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
   b.addEventListener("click", function(){ mount(container); });
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
  /* Realtime: messages tablosuna INSERT olunca liste anında yenilenir.
   * RLS, authenticated kullanıcıyı kendi org'una sınırlar; abonelik de
   * oturum ile yetkilendirilir. Tek kanal; tekrar mount'ta abonelik yenilenmez. */
  if (!realtimeChannel && sb.channel){
   realtimeChannel = sb.channel("messages-inbox")
    .on("postgres_changes",
     { event: "INSERT", schema: "public", table: "messages" },
     function(){ if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode); })
    .subscribe();
  }
  state(wrap, "loading", "Mesajlar yükleniyor…");
  sb.from("messages")
   .select("id, channel, direction, content, risk_flag, created_at, unread, sender_type, customers(full_name)")
   .order("unread", { ascending: false })
   .order("created_at", { ascending: false })
   .range(0, 49)
   .then(function(res){
    ui.clear(wrap);
    if (res.error){
     state(wrap, "error", "Mesajlar yüklenemedi: " + res.error.message);
     return;
    }
    var rows = (res.data || []).map(function(m){
     return {
      id: m.id,
      channel: m.channel || "-",
      direction: m.direction || "-",
      content: m.content || "",
      riskFlag: m.risk_flag || "normal",
      createdAt: m.created_at,
      unread: !!m.unread,
      customerName: (m.customers && m.customers.full_name) ? m.customers.full_name : "Bilinmiyor",
      senderType: m.sender_type || null
     };
    });
    renderList(wrap, rows);
   })
   .catch(function(err){
    ui.clear(wrap);
    state(wrap, "error", "Mesajlar yüklenemedi: " + (err && err.message ? err.message : String(err)));
   });
 }

 window.ATLAS_INBOX = { mount: mount };
})();
