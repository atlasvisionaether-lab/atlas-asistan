"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  wrap.appendChild(ui.el("h2",{text:"Ekip / Yetkiler - Canli"}));
  var sb=window.ATLAS_SUPABASE;
  var card=ui.el("div",{class:"card"}); card.textContent="Yukleniyor..."; wrap.appendChild(card);
  if(!sb){ card.textContent="Supabase bekleniyor"; return; }
  sb.from("users").select("id,email,role").limit(50).then(function(r){
   ui.clear(card);
   var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr");
   ["Email","Rol"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); });
   thead.appendChild(htr); t.appendChild(thead);
   var tb=ui.el("tbody");
   (r.data||[]).forEach(function(u){
    var tr=ui.el("tr");
    tr.appendChild(ui.el("td",{text:u.email||"-"}));
    tr.appendChild(ui.el("td",{text:u.role||"user"}));
    tb.appendChild(tr);
   });
   t.appendChild(tb); card.appendChild(t);
  }).catch(function(e){ card.textContent="Hata: "+e.message; });
 }
 window.ATLAS_TEAM={mount:mount};
})();
