"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function score(c){ var d=c.last_message_at?new Date(c.last_message_at):null; if(!d) return "yeni"; var diff=(Date.now()-d.getTime())/86400000; if(diff<1) return "sicak"; if(diff<7) return "ilimli"; return "soguk"; }
 function mount(f){
  var w=ui.el("div"); f.appendChild(w);
  w.appendChild(ui.el("h2",{text:"Musteriler / Leadler - Canli Skorlama"}));
  var sb=window.ATLAS_SUPABASE; var card=ui.el("div",{class:"card"}); card.textContent="Yukleniyor..."; w.appendChild(card);
  if(!sb) return;
  sb.from("customers").select("id,name,phone,source,last_message_at,is_handled_by_human").order("last_message_at",{ascending:false}).limit(100).then(function(r){
   ui.clear(card);
   var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr");
   ["Ad","Tel","Kaynak","Skor","Son","Durum"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); });
   thead.appendChild(htr); t.appendChild(thead);
   var tb=ui.el("tbody");
   (r.data||[]).forEach(function(c){
    var tr=ui.el("tr");
    tr.appendChild(ui.el("td",{text:c.name||"-"}));
    tr.appendChild(ui.el("td",{text:c.phone||"-"}));
    tr.appendChild(ui.el("td",{text:c.source||"-"}));
    var sc=score(c); var td=ui.el("td"); td.appendChild(ui.el("span",{class:sc==="sicak"?"tag danger":sc==="ilimli"?"tag warn":"tag ok",text:sc})); tr.appendChild(td);
    tr.appendChild(ui.el("td",{text:c.last_message_at?new Date(c.last_message_at).toLocaleString("tr-TR"):"-"}));
    tr.appendChild(ui.el("td",{text:c.is_handled_by_human?"insanda":"AI"}));
    tb.appendChild(tr);
   });
   t.appendChild(tb); card.appendChild(t);
  });
 }
 window.ATLAS_CUSTOMERS={mount:mount};
})();
