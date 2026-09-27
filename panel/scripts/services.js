"use strict";
/* Hizmetler / Fiyatlar: Supabase services tablosundan canlı veri (mock değil).
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 * RLS organization_id bazlıdır; org filtresi ek savunma olarak tekrar uygulanır. */
(function(){
 var ui = window.ATLAS_UI;
 var ORG_ID = "fff29ed3-f2e3-4837-bdfc-f4e974f366e7";

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
   b.addEventListener("click", function(){ mount(container); });
   c.appendChild(b);
  }
  container.appendChild(c);
 }

 function renderTable(container, rows){
  var card = ui.el("div", { class: "card" });
  card.appendChild(ui.el("h2", { text: "Hizmetler (canlı)" }));
  var t = ui.el("table");
  var thead = ui.el("thead");
  var htr = ui.el("tr");
  ["Hizmet", "Fiyat"].forEach(function(h){ htr.appendChild(ui.el("th", { text: h })); });
  thead.appendChild(htr);
  t.appendChild(thead);
  var tbody = ui.el("tbody");
  rows.forEach(function(s){
   var tr = ui.el("tr");
   [s.name, fmtPrice(s.price)].forEach(function(c){
    tr.appendChild(ui.el("td", { text: c === null || c === undefined ? "—" : String(c) }));
   });
   tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  card.appendChild(t);
  container.appendChild(card);
 }

 function mount(f){
  var wrap = ui.el("div");
  f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){
   state(wrap, "wait", "Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)");
   return;
  }
  state(wrap, "loading", "Hizmetler yükleniyor…");
  sb.from("services")
   .select("*")
   .eq("organization_id", ORG_ID)
   .eq("is_active", true)
   .order("created_at")
   .then(function(res){
    ui.clear(wrap);
    if (res.error){
     state(wrap, "error", "Hizmetler yüklenemedi: " + res.error.message);
     return;
    }
    var rows = res.data || [];
    if (!rows.length){
     state(wrap, "error", "Henüz kayıtlı hizmet yok.");
     return;
    }
    renderTable(wrap, rows);
   })
   .catch(function(err){
    ui.clear(wrap);
    state(wrap, "error", "Hizmetler yüklenemedi: " + (err && err.message ? err.message : String(err)));
   });
 }

 window.ATLAS_SERVICES = { mount: mount };
})();
