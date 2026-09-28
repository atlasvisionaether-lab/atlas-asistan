"use strict";
/* FAZ 14 - Kampanyalar taslak + canli hedefleme */
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE;
  var hero=ui.el("div",{class:"card"}); hero.appendChild(ui.el("h2",{text:"Kampanyalar - Taslak + Canli Hedefleme"})); hero.appendChild(ui.el("p",{text:"Gonderilmez - hedefleme canli musteri sayisindan hesaplanir",class:"muted"})); wrap.appendChild(hero);
  var grid=ui.el("div",{class:"grid kpi-grid"});
  function kpi(l,v){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:v})); return c; }
  var kTotal=kpi("Havuz","..."); var kHot=kpi("Sicak","..."); var kDraft=kpi("Taslak","2"); grid.appendChild(kTotal); grid.appendChild(kHot); grid.appendChild(kDraft); wrap.appendChild(grid);
  var card=ui.el("div",{class:"card"}); card.appendChild(ui.el("h2",{text:"Taslaklar"}));
  var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr"); ["Kampanya","Hedef","Durum","Onizleme"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); }); thead.appendChild(htr); t.appendChild(thead); var tbody=ui.el("tbody"); t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
  var mockRows=[{name:"Bahar Kampanyasi (taslak)",audience:"Sicak leadler",state:"taslak"}, {name:"Dogum Gunu (taslak)",audience:"Tum",state:"taslak"}];
  function draw(custCount, hotCount){
   ui.clear(tbody);
   mockRows.forEach(function(c){ var tr=ui.el("tr"); tr.appendChild(ui.el("td",{text:c.name})); tr.appendChild(ui.el("td",{text:c.audience})); tr.appendChild(ui.el("td",{text:c.state})); var preview=c.audience==="Sicak leadler"? hotCount+" kisi" : custCount+" kisi"; tr.appendChild(ui.el("td",{text:preview})); tbody.appendChild(tr); });
   kTotal.querySelector(".kpi-value").textContent=custCount; kHot.querySelector(".kpi-value").textContent=hotCount;
  }
  var form=ui.el("div",{class:"form-row"}); var input=ui.el("input",{type:"text",placeholder:"Yeni kampanya"}); var btn=ui.el("button",{class:"btn",text:"Taslak kaydet"}); btn.addEventListener("click",function(){ if(!input.value.trim()) return; mockRows.push({name:input.value.trim()+" (taslak)",audience:"Tum",state:"taslak"}); input.value=""; draw(parseInt(kTotal.querySelector(".kpi-value").textContent||"0"), parseInt(kHot.querySelector(".kpi-value").textContent||"0")); }); form.appendChild(input); form.appendChild(btn); wrap.appendChild(form);
  if(!sb){ draw(34,12); return; }
  sb.from("customers").select("id,last_message_at",{count:"exact"}).limit(1).then(function(r){ var total=r.count||0; return sb.from("customers").select("id").gte("last_message_at", new Date(Date.now()-86400000).toISOString()).then(function(r2){ var hot=(r2.data||[]).length; draw(total, hot); }); }).catch(function(){ draw(34,12); });
 }
 window.ATLAS_CAMPAIGNS={mount:mount};
})();
