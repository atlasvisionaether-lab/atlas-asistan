"use strict";
/* Kurulum (onboarding) ve Abonelik ekranları.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 * Adım durumları veritabanından türetilir (atlas_onboarding_status RPC'si,
 * bkz. supabase/migrations/0017_self_signup.sql); panel burada bir şey
 * işaretlemez, adımı tamamlayan iş (hizmet ekleme, ödeme, ilk mesaj)
 * durumu kendiliğinden değiştirir.
 * Sipariş geçmişi atlas_my_orders RPC'sinden: fatura bilgisi dönmez. */
(function(){
 var ui = window.ATLAS_UI;
 var SITE = "https://atlasasistan.com";

 var PLAN_NAMES = { standart: "Standart Asistan", pro: "Pro Asistan", starter: "Dijital Başlangıç Paketi", vip: "VIP Klinik Dönüşümü" };
 var STATUS = {
  paid: ["Ödendi", "ok"], pending: ["Bekliyor", "warn"], failed: ["Başarısız", "danger"], cancelled: ["İptal", "danger"]
 };

 function steps(s, waNumber){
  return [
   { done: s.info, title: "Hizmet ve fiyatlarınızı ekleyin",
     body: "Asistan, müşterilerinize yalnızca buraya yazdığınız hizmet ve fiyatları söyler.",
     cta: "Hizmetlere git", href: "#services" },
   { done: s.payment, title: "Paketinizi seçin ve ödeyin",
     body: "Ödemeyi bu panelde kullandığınız e-postayla yapın; ödeme hesabınıza otomatik bağlanır.",
     cta: "Paketleri gör", href: SITE + "/checkout?plan=standart", external: true },
   { done: s.whatsapp, title: "WhatsApp numaranızı bağlayın",
     body: s.whatsapp ? "Bağlı numara: " + (waNumber || "tanımlı")
      : "Numaranız henüz bağlı değil. Ödemeden sonra numaranızı kliniğinize biz bağlıyoruz; bağlanınca bu adım kendiliğinden tamamlanır.",
     cta: null },
   { done: s.test, title: "İlk test mesajını gönderin",
     body: "Kendi telefonunuzdan klinik numaranıza \"Merhaba\" yazın; mesaj Gelen Kutusu'nda görünür ve asistan cevaplar.",
     cta: "Gelen Kutusu", href: "#inbox" }
  ];
 }

 function progress(list){
  var n = list.filter(function(x){ return x.done; }).length;
  var wrap = ui.el("div", { class: "card" });
  wrap.appendChild(ui.el("p", { class: "kpi-label", text: "Kurulum ilerlemesi: " + n + " / " + list.length + " adım" }));
  var bar = ui.el("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(list.length), "aria-valuenow": String(n) });
  var fill = ui.el("div", { class: "progress-fill" });
  fill.style.width = Math.round(n / list.length * 100) + "%";
  bar.appendChild(fill);
  wrap.appendChild(bar);
  if (n === list.length) wrap.appendChild(ui.el("p", { class: "notice info", text: "Kurulum tamam. Asistanınız müşterilerinize 7/24 cevap veriyor." }));
  return wrap;
 }

 function stepCard(step, i, isNext){
  var c = ui.el("div", { class: "card onb-step" + (step.done ? " done" : "") + (isNext ? " next" : "") });
  var head = ui.el("div", { class: "onb-head" });
  head.appendChild(ui.el("span", { class: "onb-num", text: step.done ? "✓" : String(i + 1) }));
  head.appendChild(ui.el("h2", { text: step.title }));
  head.appendChild(ui.el("span", { class: "tag " + (step.done ? "ok" : "warn"), text: step.done ? "tamam" : "bekliyor" }));
  c.appendChild(head);
  c.appendChild(ui.el("p", { class: "muted", text: step.body }));
  if (step.cta && !step.done){
   var a = ui.el("a", { class: "btn" + (isNext ? "" : " ghost"), href: step.href, text: step.cta });
   if (step.external){ a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
   c.appendChild(a);
  }
  return c;
 }

 function failCard(container, msg){
  var c = ui.el("div", { class: "card" });
  c.appendChild(ui.el("p", { text: msg }));
  container.appendChild(c);
 }

 function mountOnboarding(f){
  var wrap = ui.el("div"); f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){ failCard(wrap, "Oturum hazır değil."); return; }
  wrap.appendChild(ui.el("p", { class: "muted", text: "Yükleniyor…" }));
  sb.rpc("atlas_link_my_orders").then(function(){ return Promise.all([
   sb.rpc("atlas_onboarding_status"),
   sb.from("organizations").select("whatsapp_number").eq("id", window.atlasOrgId).maybeSingle()
  ]); }).then(function(r){
   ui.clear(wrap);
   if (r[0].error || !r[0].data || !r[0].data[0]){ failCard(wrap, "Kurulum durumu okunamadı" + (r[0].error ? ": " + r[0].error.message : ".")); return; }
   var org = r[1].data || {};
   var list = steps(r[0].data[0], org.whatsapp_number);
   var next = list.findIndex(function(x){ return !x.done; });
   wrap.appendChild(progress(list));
   list.forEach(function(step, i){ wrap.appendChild(stepCard(step, i, i === next)); });
  });
 }

 function fmtDate(iso){
  try { return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch (e) { return iso; }
 }

 function mountBilling(f){
  var wrap = ui.el("div"); f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){ failCard(wrap, "Oturum hazır değil."); return; }
  sb.rpc("atlas_link_my_orders").then(function(){ return sb.rpc("atlas_my_orders"); }).then(function(r){
   if (r.error){ failCard(wrap, "Fatura geçmişi okunamadı: " + r.error.message); return; }
   var rows = r.data || [];
   var active = rows.find(function(o){ return o.status === "paid" && o.kind === "subscription"; });
   var sum = ui.el("div", { class: "card" });
   sum.appendChild(ui.el("h2", { text: "Abonelik durumu" }));
   if (active){
    sum.appendChild(ui.el("p", { text: (PLAN_NAMES[active.plan] || active.plan) + " — " + active.amount_try.toLocaleString("tr-TR") + " TL / ay (KDV dahil)" }));
    sum.appendChild(ui.el("span", { class: "tag ok", text: active.sub_status ? "iyzico: " + active.sub_status : "aktif" }));
   } else {
    sum.appendChild(ui.el("p", { text: "Aktif aboneliğiniz yok." }));
    sum.appendChild(ui.el("a", { class: "btn", href: SITE + "/checkout?plan=standart", target: "_blank", rel: "noopener", text: "Paket seç" }));
   }
   wrap.appendChild(sum);

   var card = ui.el("div", { class: "card" });
   card.appendChild(ui.el("h2", { text: "Ödeme geçmişi" }));
   if (!rows.length){
    card.appendChild(ui.el("p", { class: "muted", text: "Henüz ödeme yok. Paneldeki e-postanızla yaptığınız ödemeler burada görünür." }));
   } else {
    card.appendChild(ui.table(["Tarih", "Paket", "Tür", "Tutar", "Durum"], rows.map(function(o){
     var st = STATUS[o.status] || [o.status, ""];
     var td = ui.el("td"); td.appendChild(ui.el("span", { class: "tag " + st[1], text: st[0] }));
     return [fmtDate(o.paid_at || o.created_at), PLAN_NAMES[o.plan] || o.plan, o.kind === "subscription" ? "Aylık abonelik" : "Kurulum",
      o.amount_try.toLocaleString("tr-TR") + " TL", td];
    })));
   }
   wrap.appendChild(card);
  });
 }

 window.ATLAS_ONBOARDING = { mount: mountOnboarding, mountBilling: mountBilling };
})();
