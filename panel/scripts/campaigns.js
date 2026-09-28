"use strict";
/* FAZ 14 — Kampanyalar: Taslak + Canlı Hedefleme Önizleme - satışa hazır */
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE;
  var hero=ui.el("div",{class:"card"}); hero.appendChild(ui.el("h2",{text:"Kampanyalar — Taslak + Canlı Hedefleme"})); hero.appendChild(ui.el("p",{text:"Kampanyalar prototipte gönderilmez — hedefleme önizlemesi canlı müşteri sayısından hesaplanır. Satışta WOW etkisi.",class:"muted"})); wrap.appendChild(hero);
  var grid=ui.el("div",{class:"grid kpi-grid"});
  function kpi(l,v){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:v})); return c; }
  var kTotal=kpi("Müşteri havuzu","…"); var kHot=kpi("Sıcak lead","…"); var kDraft=kpi("Taslak kampanya","2"); grid.appendChild(kTotal); grid.appendChild(kHot); grid.appendChild(kDraft); wrap.appendChild(grid);
  var card=ui.el("div",{class:"card"}); card.appendChild(ui.el("h2",{text:"Kampanya taslakları"}));
  var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr"); ["Kampanya","Hedefleme","Durum","Önizleme"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); }); thead.appendChild(htr); t.appendChild(thead); var tbody=ui.el("tbody"); t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
  var mockRows=[{name:"Bahar Kampanyası (taslak)",audience:"Sıcak leadler",state:"taslak"}, {name:"Doğum Günü İndirimi (taslak)",audience:"Tüm müşteriler",state:"taslak"}];
  function draw(custCount, hotCount){
   ui.clear(tbody);
   mockRows.forEach(function(c){ var tr=ui.el("tr"); tr.appendChild(ui.el("td",{text:c.name})); tr.appendChild(ui.el("td",{text:c.audience})); tr.appendChild(ui.el("td",{text:c.state})); var preview = c.audience==="Sıcak leadler"? hotCount+" kişiye ulaşacak" : custCount+" kişiye ulaşacak"; tr.appendChild(ui.el("td",{text:preview})); tbody.appendChild(tr); });
   kTotal.querySelector(".kpi-value").textContent=custCount; kHot.querySelector(".kpi-value").textContent=hotCount;
  }
  var form=ui.el("div",{class:"form-row"}); var input=ui.el("input",{type:"text",placeholder:"Yeni kampanya adı"}); var btn=ui.el("button",{class:"btn",text:"Taslak kaydet"}); btn.addEventListener("click",function(){ if(!input.value.trim()) return; mockRows.push({name:input.value.trim()+" (taslak)",audience:"Tüm müşteriler",state:"taslak"}); input.value=""; ui.toast("Taslak kaydedildi — gönderilmez, önizleme canlı"); draw(parseInt(kTotal.querySelector(".kpi-value").textContent||"0"), parseInt(kHot.querySelector(".kpi-value").textContent||"0")); }); form.appendChild(input); form.appendChild(btn); wrap.appendChild(form);
  if(!sb){ draw(34,12); return; }
  // canlı sayılar
  sb.from("customers").select("id,last_message_at",{count:"exact"}).limit(1).then(function(r){ var total=r.count||0; return sb.from("customers").select("id").gte("last_message_at", new Date(Date.now()-86400000).toISOString()).then(function(r2){ var hot=(r2.data||[]).length; draw(total, hot); }); }).catch(function(){ draw(34,12); });
  wrap.appendChild(ui.el("div",{class:"notice",text:"Not: Kampanya gönderimi yayın öncesi onay, opt-in ve şablon gerektirir. Bu ekran sadece taslak ve hedefleme önizlemesidir."}));
 }
 window.ATLAS_CAMPAIGNS={mount:mount};
})();
