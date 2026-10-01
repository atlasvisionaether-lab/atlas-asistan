"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  wrap.appendChild(ui.el("h2",{text:"Ayarlar - Canli"}));
  var card=ui.el("div",{class:"card"});
  card.appendChild(ui.el("p",{text:"Dil, saat dilimi, veri saklama - KVKK uyumlu",class:"muted"}));
  var row=ui.el("div",{class:"form-row"});
  var lang=ui.el("select"); [["tr","Turkce"],["en","English"]].forEach(function(o){ var op=ui.el("option",{value:o[0],text:o[1]}); lang.appendChild(op); });
  var tz=ui.el("input",{type:"text",value:"Europe/Istanbul"});
  row.appendChild(lang); row.appendChild(tz); card.appendChild(row);
  wrap.appendChild(card);
 }
 window.ATLAS_SETTINGS={mount:mount};
})();
