"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  wrap.appendChild(ui.el("h2",{text:"Musteriler / Leadler - Canli"}));
  var sb=window.ATLAS_SUPABASE;
  if(!sb){ wrap.appendChild(ui.el("div",{class:"card",text:"Supabase yok"})); return; }
  var card=ui.el("div",{class:"card"}); card.textContent="Yukleniyor..."; wrap.appendChild(card);
  sb.from("customers").select("id,name,phone,last_message_at").limit(50).then(function(r){
   if(r.error) throw new Error(r.error.message);
   ui.clear(card);
   var t=ui.el("table"); var th=ui.el("thead"); var tr=ui.el("tr");
   ["Ad","Telefon","Son mesaj"].forEach(function(h){ tr.appendChild(ui.el("th",{text:h})); });
   th.appendChild(tr); t.appendChild(th);
   var tb=ui.el("tbody");
   (r.data||[]).forEach(function(c){
    var row=ui.el("tr");
    row.appendChild(ui.el("td",{text:c.name||"-"}));
    row.appendChild(ui.el("td",{text:c.phone||"-"}));
    row.appendChild(ui.el("td",{text:c.last_message_at?new Date(c.last_message_at).toLocaleString("tr-TR"):"-"}));
    tb.appendChild(row);
   });
   t.appendChild(tb); card.appendChild(t);
  }).catch(function(e){ card.textContent="Hata: "+e.message; });
 }
 window.ATLAS_CUSTOMERS={mount:mount};
})();
