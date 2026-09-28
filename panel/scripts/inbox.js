"use strict";
/* Gelen Kutusu (FAZ 10): iki panelli canlı inbox.
 * Sol: müşteri listesi (customers.last_message_at desc, Realtime ile güncellenir).
 * Sağ: seçili müşterinin mesaj akışı (chat) + "out" mesaj gönderimi.
 * Satır: risk_flag badge + is_handled_by_human "İnsanda / AI'da" toggle.
 * Üst bar: assistant_settings — auto_reply_enabled Switch + working_hours start/end.
 * Realtime: postgres_changes INSERT (messages) → liste ve chat otomatik güncellenir.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js), window.atlasUser.
 * RLS: authenticated kullanıcı kendi organizasyonuna yazar (0002). */
(function(){
 var ui = window.ATLAS_UI;
 var ORG_ID = "fff29ed3-f2e3-4837-bdfc-f4e974f366e7";
 var realtimeChannel = null;
 var currentWrap = null;
 var selectedCustomerId = null;
 var lastMessages = [];

 var STYLE_ID = "inbox-modal-style";
 function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent =
   ".inbox-layout{display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start}" +
   "@media(max-width:900px){.inbox-layout{grid-template-columns:1fr}}" +
   ".inbox-list{display:flex;flex-direction:column;gap:6px;max-height:70vh;overflow:auto;padding-right:2px}" +
   ".inbox-cust{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--line,#555);border-radius:12px;cursor:pointer;background:transparent}" +
   ".inbox-cust:hover{background:var(--card,#1a224a)}" +
   ".inbox-cust.selected{border-color:var(--accent,#4f46e5);background:rgba(79,70,229,.12)}" +
   ".inbox-cust-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
   ".inbox-cust-name{font-weight:600}" +
   ".inbox-cust-sub{color:var(--muted,#999);font-size:.8rem;display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
   ".inbox-cust-toggle{display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--muted,#999)}" +
   ".inbox-chat{display:flex;flex-direction:column;gap:10px;min-height:300px;max-height:60vh;overflow:auto;padding:4px}" +
   ".inbox-msg{max-width:78%;padding:9px 12px;border-radius:12px;border:1px solid var(--line,#555);font-size:.9rem;word-wrap:break-word}" +
   ".inbox-msg.in{align-self:flex-start;background:var(--card,#1a224a)}" +
   ".inbox-msg.out{align-self:flex-end;background:rgba(79,70,229,.18);border-color:var(--accent,#4f46e5)}" +
   ".inbox-msg-meta{display:flex;gap:6px;align-items:center;margin-bottom:3px;font-size:.72rem;color:var(--muted,#999)}" +
   ".inbox-send{display:flex;gap:8px;margin-top:10px}" +
   ".inbox-send input{flex:1}" +
   ".inbox-topbar{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--line,#555);border-radius:12px;margin-bottom:14px;background:var(--card,#1a224a)}" +
   ".inbox-topbar .switch{flex-shrink:0}" +
   ".inbox-topbar label{font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:8px}" +
   ".inbox-topbar input[type=time]{padding:4px 8px;border-radius:8px;border:1px solid var(--line,#555);background:var(--panel,#121a33);color:var(--text,#e8ecff)}" +
   ".inbox-empty{color:var(--muted,#999);padding:20px;text-align:center}" +
   ".switch{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}" +
   ".switch input{opacity:0;width:0;height:0}" +
   ".slider{position:absolute;cursor:pointer;inset:0;background:var(--line,#555);border-radius:999px;transition:.2s}" +
   ".slider:before{content:'';position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}" +
   ".switch input:checked + .slider{background:var(--accent,#4f46e5)}" +
   ".switch input:checked + .slider:before{transform:translateX(20px)}";
  document.head.appendChild(s);
 }

 function fmtTime(iso){
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }); } catch(e){ return ""; }
 }
 function fmtDateTime(iso){
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

 function riskBadge(cust){
  var r = String((cust.risk_flag || "normal"));
  var flagged = hasRiskWord(cust.last_content);
  if (r === "yüksek") return ui.el("span", { class: "tag danger", text: "yüksek risk" });
  if (flagged) return ui.el("span", { class: "tag warn", text: "dikkat" });
  return ui.el("span", { class: "tag ok", text: "normal" });
 }

 function aiTag(){ return ui.el("span", { class: "tag ai", text: "AI" }); }
 function humanTag(){ return ui.el("span", { class: "tag human", text: "İnsan" }); }

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

 /* ————— Üst bar: assistant_settings ————— */
 function renderTopbar(sb){
  var bar = ui.el("div", { class: "inbox-topbar" });

  var autoLabel = ui.el("label");
  var autoBox = ui.el("span", { class: "switch" });
  var autoInput = ui.el("input", { type: "checkbox" });
  autoBox.appendChild(autoInput);
  autoBox.appendChild(ui.el("span", { class: "slider" }));
  var autoText = ui.el("span", { text: "AI otomatik cevap" });
  autoLabel.appendChild(autoText);
  autoLabel.appendChild(autoBox);
  bar.appendChild(autoLabel);

  var hoursLabel = ui.el("label", { text: "Çalışma saatleri" });
  var startInput = ui.el("input", { type: "time", value: "09:00" });
  var endInput = ui.el("input", { type: "time", value: "18:00" });
  hoursLabel.appendChild(startInput);
  hoursLabel.appendChild(ui.el("span", { text: "–" }));
  hoursLabel.appendChild(endInput);
  bar.appendChild(hoursLabel);

  var save = ui.el("button", { class: "btn", text: "Kaydet" });
  bar.appendChild(save);

  sb.from("assistant_settings")
   .select("auto_reply_enabled, working_hours")
   .eq("organization_id", ORG_ID)
   .limit(1)
   .maybeSingle()
   .then(function(res){
    if (res && res.data){
     autoInput.checked = res.data.auto_reply_enabled !== false;
     if (res.data.working_hours && res.data.working_hours.start) startInput.value = res.data.working_hours.start;
     if (res.data.working_hours && res.data.working_hours.end) endInput.value = res.data.working_hours.end;
    } else {
     autoInput.checked = true;
    }
   });

  save.addEventListener("click", function(){
   save.disabled = true;
   sb.from("assistant_settings")
    .update({
     auto_reply_enabled: autoInput.checked,
     working_hours: { start: startInput.value || "09:00", end: endInput.value || "18:00" },
     updated_at: new Date().toISOString()
    })
    .eq("organization_id", ORG_ID)
    .then(function(res){
     save.disabled = false;
     if (res.error){ ui.toast("Ayarlar kaydedilemedi: " + res.error.message); return; }
     if (res.data && res.data.length === 0){
      var payload = {
       organization_id: ORG_ID,
       auto_reply_enabled: autoInput.checked,
       working_hours: { start: startInput.value || "09:00", end: endInput.value || "18:00" }
      };
      sb.from("assistant_settings").insert(payload).then(function(r2){
       if (r2.error) ui.toast("Kaydedilemedi: " + r2.error.message);
       else ui.toast("Asistan ayarları kaydedildi");
      });
      return;
     }
     ui.toast("Asistan ayarları kaydedildi");
    });
  });

  return bar;
 }

 /* ————— Sol liste: customers ————— */
 function custRow(cust, sb, listWrap, chatWrap){
  var row = ui.el("div", { class: "inbox-cust" + (cust.id === selectedCustomerId ? " selected" : "") });

  var top = ui.el("div", { class: "inbox-cust-top" });
  top.appendChild(ui.el("span", { class: "inbox-cust-name", text: cust.full_name || "Bilinmiyor" }));
  top.appendChild(riskBadge(cust));
  row.appendChild(top);

  var sub = ui.el("div", { class: "inbox-cust-sub" });
  sub.appendChild(ui.el("span", { text: fmtDateTime(cust.last_message_at) }));
  row.appendChild(sub);

  var toggleWrap = ui.el("div", { class: "inbox-cust-toggle" });
  var box = ui.el("label", { class: "switch" });
  var input = ui.el("input", { type: "checkbox" });
  input.checked = !!cust.is_handled_by_human;
  box.appendChild(input);
  box.appendChild(ui.el("span", { class: "slider" }));
  var tLabel = ui.el("span", { text: input.checked ? "İnsanda" : "AI'da" });
  input.addEventListener("change", function(){
   var newVal = input.checked;
   sb.from("customers")
    .update({ is_handled_by_human: newVal })
    .eq("id", cust.id)
    .then(function(res){
     if (res.error){
      ui.toast("Güncellenemedi: " + res.error.message);
      input.checked = !newVal;
      tLabel.textContent = input.checked ? "İnsanda" : "AI'da";
      return;
     }
     tLabel.textContent = newVal ? "İnsanda" : "AI'da";
     ui.toast((cust.full_name || "Müşteri") + (newVal ? " — insan temsilcide (AI susar)" : " — AI'da"));
    });
  });
  toggleWrap.appendChild(tLabel);
  toggleWrap.appendChild(box);
  row.appendChild(toggleWrap);

  row.addEventListener("click", function(ev){
   if (ev.target.tagName === "INPUT" || ev.target.closest(".switch")) return;
   selectedCustomerId = cust.id;
   renderChat(chatWrap, sb);
   ui.clear(listWrap);
   loadCustomers(listWrap, chatWrap, sb);
  });
  return row;
 }

 function loadCustomers(listWrap, chatWrap, sb){
  sb.from("customers")
   .select("id, full_name, is_handled_by_human, last_message_at")
   .eq("organization_id", ORG_ID)
   .order("last_message_at", { ascending: false, nullsFirst: false })
   .range(0, 49)
   .then(function(res){
    ui.clear(listWrap);
    if (res.error){
     state(listWrap, "error", "Müşteri listesi yüklenemedi: " + res.error.message);
     return;
    }
    var rows = res.data || [];
    if (!rows.length){
     listWrap.appendChild(ui.el("div", { class: "inbox-empty", text: "Henüz müşteri yok." }));
     return;
    }
    rows.forEach(function(c){ listWrap.appendChild(custRow(c, sb, listWrap, chatWrap)); });
   });
 }

 /* ————— Sağ: chat ————— */
 function renderChat(chatWrap, sb){
  ui.clear(chatWrap);
  if (!selectedCustomerId){
   chatWrap.appendChild(ui.el("div", { class: "inbox-empty", text: "Soldan bir müşteri seçin." }));
   return;
  }
  state(chatWrap, "loading", "Mesajlar yükleniyor…");

  sb.from("messages")
   .select("id, channel, direction, content, risk_flag, created_at, unread, sender_type, is_from_customer, customers(full_name)")
   .eq("customer_id", selectedCustomerId)
   .order("created_at", { ascending: true })
   .range(0, 99)
   .then(function(res){
    ui.clear(chatWrap);
    if (res.error){
     state(chatWrap, "error", "Mesajlar yüklenemedi: " + res.error.message);
     return;
    }
    var rows = res.data || [];
    if (!rows.length){
     chatWrap.appendChild(ui.el("div", { class: "inbox-empty", text: "Bu müşteriyle mesaj yok." }));
    }
    rows.forEach(function(m){ chatWrap.appendChild(msgBubble(m)); });
    chatWrap.scrollTop = chatWrap.scrollHeight;
   });
 }

 function msgBubble(m){
  var isOut = m.is_from_customer === false;
  var bubble = ui.el("div", { class: "inbox-msg " + (isOut ? "out" : "in") });
  var meta = ui.el("div", { class: "inbox-msg-meta" });
  if (m.sender_type === "ai") meta.appendChild(aiTag());
  else if (m.sender_type === "human") meta.appendChild(humanTag());
  meta.appendChild(ui.el("span", { text: fmtTime(m.created_at) }));
  if (m.unread && !isOut) meta.appendChild(ui.el("span", { class: "tag warn", text: "okunmadı" }));
  bubble.appendChild(meta);
  bubble.appendChild(ui.el("div", { text: String(m.content || "") }));
  return bubble;
 }

 /* ————— Mesaj gönder (out) ————— */
 function sendMessage(chatWrap, input, sb){
  var text = input.value.trim();
  if (!text || !selectedCustomerId) return;
  input.value = "";
  sb.from("messages")
   .insert({
    organization_id: ORG_ID,
    customer_id: selectedCustomerId,
    content: text,
    channel: "panel",
    direction: "out",
    is_from_customer: false,
    sender_type: "human",
    risk_flag: "normal",
    unread: false
   })
   .then(function(res){
    if (res.error){ ui.toast("Gönderilemedi: " + res.error.message); input.value = text; return; }
    ui.toast("Mesaj gönderildi");
    renderChat(chatWrap, sb);
   });
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

  wrap.appendChild(renderTopbar(sb));

  var layout = ui.el("div", { class: "inbox-layout" });
  var listCol = ui.el("div");
  var chatCol = ui.el("div");
  layout.appendChild(listCol);
  layout.appendChild(chatCol);
  wrap.appendChild(layout);

  var listCard = ui.el("div", { class: "card" });
  listCard.appendChild(ui.el("h2", { text: "Müşteriler (son mesaja göre)" }));
  var listWrap = ui.el("div", { class: "inbox-list" });
  listCard.appendChild(listWrap);
  listCol.appendChild(listCard);

  var chatCard = ui.el("div", { class: "card" });
  var chatTitle = ui.el("h2", { text: "Sohbet" });
  chatCard.appendChild(chatTitle);
  var chatWrap = ui.el("div", { class: "inbox-chat" });
  chatCard.appendChild(chatWrap);
  var sendRow = ui.el("div", { class: "inbox-send" });
  var sendInput = ui.el("input", { type: "text", placeholder: "Mesaj yazın — insan temsilci olarak gönderilir…" });
  var sendBtn = ui.el("button", { class: "btn", text: "Gönder" });
  sendBtn.addEventListener("click", function(){ sendMessage(chatWrap, sendInput, sb); });
  sendInput.addEventListener("keydown", function(ev){ if (ev.key === "Enter") sendMessage(chatWrap, sendInput, sb); });
  sendRow.appendChild(sendInput);
  sendRow.appendChild(sendBtn);
  chatCard.appendChild(sendRow);
  chatCol.appendChild(chatCard);

  loadCustomers(listWrap, chatWrap, sb);
  renderChat(chatWrap, sb);

  if (!realtimeChannel && sb.channel){
   realtimeChannel = sb.channel("messages-inbox")
    .on("postgres_changes",
     { event: "INSERT", schema: "public", table: "messages" },
     function(payload){
      var newMsg = payload && payload.new && payload.new.customer_id;
      loadCustomers(listWrap, chatWrap, sb);
      if (newMsg && newMsg === selectedCustomerId) renderChat(chatWrap, sb);
     })
    .subscribe(function(status){
     if (status === "SUBSCRIBED") ui.toast("Gelen Kutusu canlı bağlandı");
    });
  }
 }

 window.ATLAS_INBOX = { mount: mount };
})();
