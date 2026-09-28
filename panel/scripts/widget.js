"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  wrap.appendChild(ui.el("h2",{text:"Widget / Tasarim - Canli"}));
  var card=ui.el("div",{class:"card"});
  card.appendChild(ui.el("p",{text:"Domain, tema ve konum ayari - canli onizleme",class:"muted"}));
  var row=ui.el("div",{class:"form-row"});
  var selTheme=ui.el("select"); [["light","Acik"],["dark","Koyu"]].forEach(function(o){ var op=ui.el("option",{value:o[0],text:o[1]}); selTheme.appendChild(op); });
  var selPos=ui.el("select"); [["right","Sag alt"],["left","Sol alt"]].forEach(function(o){ var op=ui.el("option",{value:o[0],text:o[1]}); selPos.appendChild(op); });
  row.appendChild(selTheme); row.appendChild(selPos); card.appendChild(row);
  var preview=ui.el("div",{class:"card"}); preview.textContent="Widget onizleme: tema="+selTheme.value+" konum="+selPos.value;
  function upd(){ preview.textContent="Widget onizleme: tema="+selTheme.value+" konum="+selPos.value; }
  selTheme.addEventListener("change",upd); selPos.addEventListener("change",upd);
  wrap.appendChild(card); wrap.appendChild(preview);
  wrap.appendChild(ui.el("div",{class:"notice",text:"Not: Widget kodu yayin oncesi domain dogrulama gerektirir."}));
 }
 window.ATLAS_WIDGET={mount:mount};
})();
