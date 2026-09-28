"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var w=ui.el("div"); f.appendChild(w);
  w.appendChild(ui.el("h2",{text:"Kampanyalar - Canli Hedefleme"}));
  var sb=window.ATLAS_SUPABASE;
  var grid=ui.el("div",{class:"grid kpi-grid"});
  function kpi(l,v){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:v})); return c; }
  var k1=kpi("Havuz","..."), k2=kpi("Sicak","..."), k3=kpi("Taslak","2"); grid.appendChild(k1); grid.appendChild(k2); grid.appendChild(k3); w.appendChild(grid);
  var card=ui.el("div",{class:"card"}); card.appendChild(ui.el("h2",{text:"Taslaklar"}));
  var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr"); ["Kampanya","Hedef","Onizleme"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); }); thead.appendChild(htr); t.appendChild(thead);
  var tb=ui.el("tbody"); t.appendChild(tb); card.appendChild(t); w.appendChild(card);
  function draw(tot,hot){
   ui.clear(tb);
   [["Bahar (taslak)","Sicak",hot+" kisi"],["Dogum Gunu (taslak)","Tum",tot+" kisi"]].forEach(function(r){
    var tr=ui.el("tr"); r.forEach(function(v){ tr.appendChild(ui.el("td",{text:v})); }); tb.appendChild(tr);
   });
   k1.querySelector(".kpi-value").textContent=tot; k2.querySelector(".kpi-value").textContent=hot;
  }
  if(!sb){ draw(34,12); return; }
  sb.from("customers").select("id",{count:"exact"}).limit(1).then(function(r){ var tot=r.count||0; return sb.from("customers").select("id").gte("last_message_at", new Date(Date.now()-86400000).toISOString()).then(function(r2){ draw(tot,(r2.data||[]).length); }); });
 }
 window.ATLAS_CAMPAIGNS={mount:mount};
})();
