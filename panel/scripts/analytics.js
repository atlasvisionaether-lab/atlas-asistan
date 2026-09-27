"use strict";
/* Analitik: messages tablosundan son 7 gün — canlı metrikler (mock değil).
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js), window.atlasUser.
 * Metrikler: toplam mesaj, AI cevap sayısı, ortalama cevap süresi (müşteri→AI diff),
 * günlük mesaj bar chart, en sık sorulan sorular tablosu.
 * NOT: Harici CDN (Chart.js vb.) proje kuralı gereği kullanılmaz;
 * bar chart saf SVG ile çizilir. */
(function(){
 var ui = window.ATLAS_UI;

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

 function kpiCard(label, value, tagText, tagClass){
  var c = ui.el("div", { class: "card" });
  c.appendChild(ui.el("div", { class: "kpi-label", text: label }));
  c.appendChild(ui.el("div", { class: "kpi-value", text: value }));
  if (tagText) c.appendChild(ui.el("span", { class: tagClass || "tag ok", text: tagText }));
  return c;
 }

 function fmtNum(n){
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (n < 60) return Math.round(n * 10) / 10 + " sn";
  return Math.round(n / 6) / 10 + " dk";
 }

 /* Ortalama cevap süresi: her AI cevabı için, aynı müşterinin ondan önceki
  * son müşteri mesajı ile created_at farkının ortalaması. */
 function avgResponseSeconds(rows){
  var diffs = [];
  rows.forEach(function(m){
   if (m.sender_type !== "ai") return;
   for (var i = 0; i < rows.length; i++){
    var prev = rows[i];
    if (prev === m) continue;
    if (prev.customer_id === m.customer_id && prev.sender_type !== "ai" &&
        new Date(prev.created_at).getTime() < new Date(m.created_at).getTime()){
     diffs.push((new Date(m.created_at) - new Date(prev.created_at)) / 1000);
     break;
    }
   }
  });
  if (!diffs.length) return null;
  return diffs.reduce(function(a, b){ return a + b; }, 0) / diffs.length;
 }

 function normalizeQuestion(content){
  var t = String(content || "").toLocaleLowerCase("tr-TR").trim();
  t = t.replace(/[?!.,;:]+$/g, "");
  return t;
 }

 function topQuestions(rows, limit){
  var counts = {};
  rows.forEach(function(m){
   if (m.sender_type === "ai") return;
   var q = normalizeQuestion(m.content);
   if (!q || q.length < 3) return;
   counts[q] = (counts[q] || 0) + 1;
  });
  return Object.keys(counts)
   .map(function(k){ return { q: k, n: counts[k] }; })
   .sort(function(a, b){ return b.n - a.n; })
   .slice(0, limit || 5);
 }

 function dayKey(iso){
  var d = new Date(iso);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
 }

 function dailyCounts(rows, days){
  var byDay = {};
  rows.forEach(function(m){
   var k = dayKey(m.created_at);
   byDay[k] = (byDay[k] || 0) + 1;
  });
  var out = [];
  var now = new Date();
  for (var i = days - 1; i >= 0; i--){
   var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
   var k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
   out.push({
    label: String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0"),
    count: byDay[k] || 0
   });
  }
  return out;
 }

 /* Bar chart: saf SVG, harici kütüphane yok. */
 function barChart(days){
  var W = 560, H = 180, PAD = 24;
  var max = Math.max.apply(null, days.map(function(d){ return d.count; }).concat([1]));
  var bw = (W - PAD * 2) / days.length;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + (H + 28) + '" width="100%" role="img" aria-label="Günlük mesaj sayısı">';
  days.forEach(function(d, i){
   var h = Math.round((d.count / max) * (H - PAD));
   var x = PAD + i * bw + 4;
   var y = H - h;
   svg += '<rect x="' + x + '" y="' + y + '" width="' + Math.max(2, bw - 8) + '" height="' + Math.max(h, 2) + '" rx="4" fill="#6366f1"/>';
   svg += '<text x="' + (x + (bw - 8) / 2) + '" y="' + (H + 14) + '" font-size="11" fill="#9aa6d1" text-anchor="middle">' + d.label + '</text>';
   if (d.count > 0){
    svg += '<text x="' + (x + (bw - 8) / 2) + '" y="' + (y - 6) + '" font-size="11" fill="#e8ecff" text-anchor="middle">' + d.count + '</text>';
   }
  });
  svg += '</svg>';
  var wrap = document.createElement("div");
  wrap.innerHTML = svg;
  return wrap.firstChild;
 }

 function render(wrap, rows){
  var total = rows.length;
  var aiCount = rows.filter(function(m){ return m.sender_type === "ai"; }).length;
  var avg = avgResponseSeconds(rows);
  var questions = topQuestions(rows, 5);
  var days = dailyCounts(rows, 7);

  var g = ui.el("div", { class: "grid" });
  g.appendChild(kpiCard("Toplam mesaj (7 gün)", String(total), "canlı"));
  g.appendChild(kpiCard("AI cevap sayısı", String(aiCount), "canlı"));
  g.appendChild(kpiCard("Ortalama cevap süresi", fmtNum(avg), "canlı"));
  wrap.appendChild(g);

  var chartCard = ui.el("div", { class: "card" });
  chartCard.appendChild(ui.el("h2", { text: "Günlük mesaj sayısı (son 7 gün)" }));
  chartCard.appendChild(barChart(days));
  wrap.appendChild(chartCard);

  var qCard = ui.el("div", { class: "card" });
  qCard.appendChild(ui.el("h2", { text: "En çok sorulan sorular" }));
  if (!questions.length){
   qCard.appendChild(ui.el("p", { text: "Henüz yeterli mesaj yok." }));
  } else {
   var t = ui.el("table");
   var thead = ui.el("thead"), htr = ui.el("tr");
   ["Soru", "Adet"].forEach(function(h){ htr.appendChild(ui.el("th", { text: h })); });
   thead.appendChild(htr); t.appendChild(thead);
   var tbody = ui.el("tbody");
   questions.forEach(function(q){
    var tr = ui.el("tr");
    tr.appendChild(ui.el("td", { text: q.q }));
    tr.appendChild(ui.el("td", { text: String(q.n) }));
    tbody.appendChild(tr);
   });
   t.appendChild(tbody);
   qCard.appendChild(t);
  }
  wrap.appendChild(qCard);
 }

 function mount(f){
  var wrap = ui.el("div");
  f.appendChild(wrap);
  var sb = window.ATLAS_SUPABASE;
  if (!sb){
   state(wrap, "wait", "Supabase bağlantısı kuruluyor… (giriş yapmış olmanız gerekir)");
   return;
  }
  state(wrap, "loading", "Analitik yükleniyor…");
  var since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  fetchOrgId()
   .then(function(orgId){
    return sb.from("messages")
     .select("id, customer_id, sender_type, content, created_at")
     .eq("organization_id", orgId)
     .gte("created_at", since)
     .order("created_at", { ascending: true })
     .range(0, 999)
     .then(function(res){
      ui.clear(wrap);
      if (res.error){ state(wrap, "error", "Analitik yüklenemedi: " + res.error.message); return; }
      render(wrap, res.data || []);
     });
   })
   .catch(function(e){
    ui.clear(wrap);
    state(wrap, "error", "Analitik yüklenemedi: " + (e && e.message ? e.message : String(e)));
   });
 }

 window.ATLAS_ANALYTICS = { mount: mount };
})();
