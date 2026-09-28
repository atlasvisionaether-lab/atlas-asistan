"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  wrap.appendChild(ui.el("h2",{text:"Kampanyalar - Canli hedefleme"}));
  var grid=ui.el("div",{class:"grid kpi-grid"});
  function kpi(l,v){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:v})); return c; }
  var k1=kpi("Havuz","..."), k2=kpi("Sicak","..."); grid.appendChild(k1); grid.appendChild(k2); wrap.appendChild(grid);
  var sb=window.ATLAS_SUPABASE;
  if(!sb) return;
  sb.from("customers").select("id",{count:"exact"}).limit(1).then(function(r){
   k1.querySelector(".kpi-value").textContent=r.count||0;
   return sb.from("customers").select("id").gte("last_message_at", new Date(Date.now()-86400000).toISOString());
  }).then(function(r2){ k2.querySelector(".kpi-value").textContent=(r2.data||[]).length; });
 }
 window.ATLAS_CAMPAIGNS={mount:mount};
})();
