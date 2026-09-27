"use strict";
/* Randevular + Genel Bakış istatistikleri: Supabase appointments tablosundan canlı veri.
 * MANUAL CUSTOMER NAME FIX: müşteri seçimi serbest metin + datalist; bilinmeyen ad
 * girilirse customers tablosunda auto-create edilir.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js), window.atlasUser.
 * RLS: 0002'deki appointments/customers politikaları organization_id bazlı. */
(function(){
 var ui = window.ATLAS_UI;

 var STATUS_LABEL = { pending:"beklemede", scheduled:"onaylı", cancelled:"iptal", no_show:"yoklama", completed:"tamamlandı" };
 function statusLabel(s){ return STATUS_LABEL[s] || String(s || "-"); }
 function statusTag(s){
  var cls = s === "cancelled" ? "tag danger" : (s === "no_show" ? "tag warn" : "tag ok");
  return ui.el("span", { class: cls, text: statusLabel(s) });
 }

 function dayRange(d){
  var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  var end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
 }

 function fmtTime(iso){ try { return new Date(iso).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"}); } catch(e){ return ""; } }
 function fmtDate(d){ try { return d.toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"}); } catch(e){ return ""; } }

 /* Bugünün gerçek sayıları (cancelled hariç toplam, iptal, yoklama). */
 function stats(){
  var sb = window.ATLAS_SUPABASE;
  if (!sb) return Promise.reject(new Error("Supabase bağlantısı yok"));
  var r = dayRange(new Date());
  return Promise.all([
   sb.from("appointments").select("id",{count:"exact",head:true}).gte("starts_at",r.start).lt("starts_at",r.end).neq("status","cancelled"),
   sb.from("appointments").select("id",{count:"exact",head:true}).gte("starts_at",r.start).lt("starts_at",r.end).eq("status","cancelled"),
   sb.from("appointments").select("id",{count:"exact",head:true}).gte("starts_at",r.start).lt("starts_at",r.end).eq("status","no_show")
  ]).then(function(rs){
   return { today: (rs[0] && rs[0].count) || 0, cancelled: (rs[1] && rs[1].count) || 0, noShow: (rs[2] && rs[2].count) || 0 };
  });
 }

 function kpiCard(label, value, tagText, tagClass){
  var c = ui.el("div",{class:"card"});
  c.appendChild(ui.el("div",{class:"kpi-label",text:label}));
  c.appendChild(ui.el("div",{class:"kpi-value",text:String(value)}));
  if (tagText) c.appendChild(ui.el("span",{class:tagClass || "tag ok",text:tagText}));
  return c;
 }

 /* Genel Bakış: 4 kart — 3'ü gerçek, açık lead kartı demo etiketli. */
 function mountOverview(f){
  var g = ui.el("div",{class:"grid"});
  var cToday  = kpiCard("Bugünkü randevu","…");
  var cCancel = kpiCard("Bugünkü iptal","…");
  var cNoShow = kpiCard("Yoklama","…");
  var cLead   = kpiCard("Açık lead","—");
  cLead.appendChild(ui.el("span",{class:"tag warn",text:"demo"}));
  [cToday,cCancel,cNoShow,cLead].forEach(function(c){ g.appendChild(c); });
  f.appendChild(g);
  var notice = ui.el("div",{class:"notice",text:"İstatistikler yükleniyor…"});
  f.appendChild(notice);
  stats().then(function(s){
   cToday.querySelector(".kpi-value").textContent  = String(s.today);
   cCancel.querySelector(".kpi-value").textContent = String(s.cancelled);
   cNoShow.querySelector(".kpi-value").textContent = String(s.noShow);
   cToday.appendChild(ui.el("span",{class:"tag ok",text:"canlı"}));
   notice.textContent = "Bugünkü özet: " + s.today + " randevu, " + s.cancelled + " iptal, " + s.noShow + " yoklama (canlı veri).";
  }).catch(function(e){
   notice.textContent = "Randevu istatistikleri yüklenemedi: " + (e && e.message ? e.message : String(e));
  });
 }

 /* ---- Modal altyapısı ---- */
 var STYLE_ID = "appt-modal-style";
 function ensureStyles(){
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent =
   ".appt-row-actions{display:flex;gap:.35rem;flex-wrap:wrap}" +
   ".appt-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem}" +
   ".appt-modal{background:var(--bg,#fff);color:inherit;border-radius:12px;max-width:520px;width:100%;padding:1.25rem;box-shadow:0 12px 40px rgba(0,0,0,.25)}" +
   ".appt-modal h2{margin:0 0 .75rem}" +
   ".appt-modal label{display:block;margin:.5rem 0 .25rem;font-weight:600}" +
   ".appt-modal input,.appt-modal select,.appt-modal textarea{width:100%;box-sizing:border-box;padding:.4rem;border-radius:8px;border:1px solid #ccc}" +
   ".appt-modal textarea{min-height:70px}" +
   ".appt-modal .appt-err{color:#b00;margin-top:.5rem}" +
   ".appt-nav{display:flex;gap:.5rem;align-items:center;margin-bottom:.75rem}";
  document.head.appendChild(s);
 }
 function closeModal(){ var m = document.getElementById("appt-modal"); if (m) m.remove(); }
 document.addEventListener("keydown", function(ev){ if (ev.key === "Escape") closeModal(); });

 function actionBtn(label, cls, fn){
  var b = ui.el("button",{class:cls || "btn ghost",text:label});
  b.addEventListener("click", fn);
  return b;
 }

 function setStatus(id, status, onDone){
  var sb = window.ATLAS_SUPABASE;
  sb.from("appointments").update({ status: status }).eq("id", id)
   .then(function(res){
    if (res.error){ ui.toast("Güncellenemedi: " + res.error.message); return; }
    ui.toast("Randevu durumu güncellendi: " + statusLabel(status));
    if (onDone) onDone();
   })
   .catch(function(e){ ui.toast("Güncellenemedi: " + (e && e.message ? e.message : String(e))); });
 }

 /* Manuel müşteri adı: mevcut müşteriyi bul, yoksa auto-create. */
 function findOrCreateCustomer(orgId, name){
  var sb = window.ATLAS_SUPABASE;
  return sb.from("customers").select("id").eq("organization_id", orgId).ilike("full_name", name).maybeSingle()
   .then(function(res){
    if (res.error) return Promise.reject(new Error(res.error.message));
    if (res.data && res.data.id) return res.data.id;
    return sb.from("customers").insert({ organization_id: orgId, full_name: name }).select("id").single()
     .then(function(cr){
      if (cr.error) return Promise.reject(new Error("Müşteri oluşturulamadı: " + cr.error.message));
      return cr.data.id;
     });
   });
 }

 /* Yeni randevu modalı. organization_id users tablosundan auth.uid() ile alınır. */
 function openCreateModal(currentDate, onDone){
  ensureStyles(); closeModal();
  var sb = window.ATLAS_SUPABASE;
  var bd = ui.el("div",{class:"appt-modal-backdrop"}); bd.id = "appt-modal";
  var box = ui.el("div",{class:"appt-modal"});
  box.appendChild(ui.el("h2",{text:"Yeni Randevu"}));

  var svcInput = ui.el("input",{type:"text",placeholder:"Hizmet adı"});
  /* MANUAL CUSTOMER NAME FIX: serbest metin + datalist autocomplete. */
  var custName = ui.el("input",{type:"text",id:"appt-customer-name",list:"customer-list",placeholder:"Müşteri adı — örn: Ayşe Yılmaz"});
  var custList = ui.el("datalist",{id:"customer-list"});
  var dateInput = ui.el("input",{type:"date"});
  var pad = function(n){ return String(n).padStart(2,"0"); };
  dateInput.value = currentDate.getFullYear() + "-" + pad(currentDate.getMonth()+1) + "-" + pad(currentDate.getDate());
  var timeInput = ui.el("input",{type:"time"}); timeInput.value = "10:00";
  var notesInput = ui.el("textarea",{placeholder:"Notlar (opsiyonel)"});

  box.appendChild(ui.el("label",{text:"Hizmet"})); box.appendChild(svcInput);
  box.appendChild(ui.el("label",{text:"Müşteri"})); box.appendChild(custName); box.appendChild(custList);
  box.appendChild(ui.el("label",{text:"Tarih"})); box.appendChild(dateInput);
  box.appendChild(ui.el("label",{text:"Saat"})); box.appendChild(timeInput);
  box.appendChild(ui.el("label",{text:"Notlar"})); box.appendChild(notesInput);

  var err = ui.el("p",{class:"appt-err",role:"alert"});
  box.appendChild(err);

  var create = ui.el("button",{class:"btn",text:"Oluştur"});
  var cancel = ui.el("button",{class:"btn ghost",text:"Vazgeç"});
  cancel.addEventListener("click", closeModal);
  create.addEventListener("click", function(){
   err.textContent = "";
   var serviceName = svcInput.value.trim();
   var customerName = custName.value.trim();
   if (!serviceName){ err.textContent = "Hizmet adı gerekli."; return; }
   if (!customerName){ err.textContent = "Müşteri adı gerekli."; return; }
   if (!dateInput.value || !timeInput.value){ err.textContent = "Tarih ve saat gerekli."; return; }
   var startsAt = new Date(dateInput.value + "T" + timeInput.value);
   var endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
   var user = window.atlasUser;
   if (!user){ err.textContent = "Oturum bulunamadı."; return; }
   sb.from("users").select("organization_id").eq("id", user.id).limit(1).maybeSingle()
    .then(function(u){
     if (u.error) return Promise.reject(new Error("Organizasyon bilgisi alınamadı: " + u.error.message));
     var orgId = u.data && u.data.organization_id;
     if (!orgId) return Promise.reject(new Error("Kullanıcı bir organizasyona bağlı değil."));
     return findOrCreateCustomer(orgId, customerName).then(function(customerId){
      return sb.from("appointments").insert({
       organization_id: orgId,
       customer_id: customerId,
       service_name: serviceName,
       starts_at: startsAt.toISOString(),
       ends_at: endsAt.toISOString(),
       status: "pending",
       notes: notesInput.value.trim() || null
      }).then(function(res){
       if (res.error) return Promise.reject(new Error("Kayıt başarısız: " + res.error.message));
       ui.toast("Randevu oluşturuldu.");
       closeModal();
       if (onDone) onDone();
      });
     });
    })
    .catch(function(e){ err.textContent = (e && e.message) ? e.message : String(e); });
  });

  var row = ui.el("div",{class:"form-row"});
  row.appendChild(create); row.appendChild(cancel);
  box.appendChild(row);
  bd.appendChild(box);
  bd.addEventListener("click", function(ev){ if (ev.target === bd) closeModal(); });
  document.body.appendChild(bd);

  sb.from("customers").select("full_name").order("full_name",{ascending:true}).range(0,199)
   .then(function(res){
    if (res.error) return;
    (res.data || []).forEach(function(c){
     custList.appendChild(ui.el("option",{value:c.full_name}));
    });
   })
   .catch(function(){});
 }

 /* Günlük takvim: ileri/geri gün + durum aksiyonları + yeni randevu. */
 function mountRandevular(f){
  var currentDate = new Date();
  var wrap = ui.el("div");
  f.appendChild(wrap);

  function renderDay(){
   ui.clear(wrap);
   var nav = ui.el("div",{class:"appt-nav"});
   var prev = actionBtn("← Önceki gün","btn ghost",function(){ currentDate.setDate(currentDate.getDate()-1); renderDay(); });
   var today = ui.el("strong",{text:fmtDate(currentDate)});
   var next = actionBtn("Sonraki gün →","btn ghost",function(){ currentDate.setDate(currentDate.getDate()+1); renderDay(); });
   var newBtn = actionBtn("Yeni Randevu","btn",function(){ openCreateModal(currentDate, renderDay); });
   nav.appendChild(prev); nav.appendChild(today); nav.appendChild(next); nav.appendChild(newBtn);
   wrap.appendChild(nav);

   var sb = window.ATLAS_SUPABASE;
   if (!sb){
    var w = ui.el("div",{class:"card"}); w.appendChild(ui.el("p",{text:"Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)"})); wrap.appendChild(w); return;
   }
   var loading = ui.el("div",{class:"card",text:"Randevular yükleniyor…"});
   wrap.appendChild(loading);
   var r = dayRange(currentDate);
   sb.from("appointments")
    .select("id,service_name,starts_at,status,notes,customers(full_name)")
    .gte("starts_at", r.start).lt("starts_at", r.end)
    .order("starts_at",{ascending:true})
    .then(function(res){
     ui.clear(wrap);
     wrap.appendChild(nav);
     if (res.error){
      var e = ui.el("div",{class:"card"});
      e.appendChild(ui.el("p",{text:"Randevular yüklenemedi: " + res.error.message}));
      e.appendChild(actionBtn("Yeniden dene","btn ghost",renderDay));
      wrap.appendChild(e); return;
     }
     var rows = (res.data || []);
     if (!rows.length){
      var empty = ui.el("div",{class:"card"});
      empty.appendChild(ui.el("h2",{text:"Randevular"}));
      empty.appendChild(ui.el("p",{text:"Bu güne ait randevu yok."}));
      wrap.appendChild(empty); return;
     }
     var card = ui.el("div",{class:"card"});
     card.appendChild(ui.el("h2",{text:"Günlük takvim — " + rows.length + " randevu"}));
     var t = document.createElement("table");
     var thead = document.createElement("thead"); var htr = document.createElement("tr");
     ["Saat","Müşteri","Hizmet","Durum","İşlem"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); });
     thead.appendChild(htr); t.appendChild(thead);
     var tbody = document.createElement("tbody");
     rows.forEach(function(a){
      var tr = document.createElement("tr");
      var tdTime = document.createElement("td"); tdTime.textContent = fmtTime(a.starts_at); tr.appendChild(tdTime);
      var tdCust = document.createElement("td"); tdCust.textContent = (a.customers && a.customers.full_name) || "Bilinmiyor"; tr.appendChild(tdCust);
      var tdSvc = document.createElement("td"); tdSvc.textContent = a.service_name || "-"; tr.appendChild(tdSvc);
      var tdStatus = document.createElement("td"); tdStatus.appendChild(statusTag(a.status)); tr.appendChild(tdStatus);
      var tdActions = document.createElement("td");
      var actions = ui.el("div",{class:"appt-row-actions"});
      if (a.status !== "scheduled") actions.appendChild(actionBtn("Onayla","btn ghost",function(){ setStatus(a.id,"scheduled",renderDay); }));
      if (a.status !== "cancelled") actions.appendChild(actionBtn("İptal","btn danger",function(){ setStatus(a.id,"cancelled",renderDay); }));
      if (a.status !== "no_show") actions.appendChild(actionBtn("Yoklama","btn ghost",function(){ setStatus(a.id,"no_show",renderDay); }));
      tdActions.appendChild(actions); tr.appendChild(tdActions);
      tbody.appendChild(tr);
     });
     t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
    })
    .catch(function(e){
     ui.clear(wrap); wrap.appendChild(nav);
     var c = ui.el("div",{class:"card"});
     c.appendChild(ui.el("p",{text:"Randevular yüklenemedi: " + (e && e.message ? e.message : String(e))}));
     wrap.appendChild(c);
    });
  }
  renderDay();
 }

 window.ATLAS_APPTS = { mountRandevular: mountRandevular, mountOverview: mountOverview, stats: stats };
})();
