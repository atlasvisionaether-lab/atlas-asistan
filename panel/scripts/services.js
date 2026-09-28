"use strict";
/* FAZ 13 — Hizmetler / Fiyatlar: Satışa hazır — arama, kategori, AI önizleme, istatistikler */
(function(){
 var ui = window.ATLAS_UI;
 var ORG_ID = "fff29ed3-f2e3-4837-bdfc-f4e974f366e7";
 var realtimeChannel = null;
 var currentWrap = null;
 var allServices = [];
 function fmtPrice(p){ if(p===null||p===undefined||p==="") return "—"; if(typeof p==="number") return p.toLocaleString("tr-TR")+" TRY"; var n=Number(p); if(!isNaN(n)&&String(p).trim()!=="") return n.toLocaleString("tr-TR")+" TRY"; return String(p); }
 function state(container, kind, msg){ var c=ui.el("div",{class:"card"}); c.appendChild(ui.el("p",{text:msg})); if(kind==="error"||kind==="wait"){ var b=ui.el("button",{class:"btn ghost",text:kind==="error"?"Yeniden dene":"Kontrol et"}); b.addEventListener("click",function(){ if(currentWrap&&currentWrap.parentNode) mount(currentWrap.parentNode); }); c.appendChild(b); } container.appendChild(c); }
 function toggleSwitch(svc, sb){ var box=ui.el("label",{class:"switch"}); var input=ui.el("input",{type:"checkbox"}); input.checked=!!svc.is_active; var slider=ui.el("span",{class:"slider"}); box.appendChild(input); box.appendChild(slider); input.addEventListener("change",function(){ sb.from("services").update({is_active:input.checked}).eq("id",svc.id).then(function(res){ if(res.error){ ui.toast("Güncellenemedi: "+res.error.message); input.checked=!input.checked; } else ui.toast(svc.name+(input.checked?" aktif":" pasif")); }); }); return box; }
 function rowActions(svc, sb){ var wrap=ui.el("div",{class:"svc-actions"}); var edit=ui.el("button",{class:"btn ghost",text:"Düzenle"}); edit.addEventListener("click",function(){ openModal(svc,sb,false); }); wrap.appendChild(edit); var del=ui.el("button",{class:"btn danger",text:"Sil"}); del.addEventListener("click",function(){ if(!confirm('"'+svc.name+'" silinsin mi?')) return; sb.from("services").delete().eq("id",svc.id).then(function(res){ if(res.error) ui.toast("Silinemedi: "+res.error.message); else ui.toast(svc.name+" silindi"); }); }); wrap.appendChild(del); return wrap; }
 function aiPreview(svc){ var txt=(svc.name||"").toLowerCase(); if(txt.includes("lazer")) return "Müşteri 'lazer fiyat' → AI: "+svc.name+" "+fmtPrice(svc.price)+" önerir"; if(txt.includes("cilt")||txt.includes("bakım")) return "Müşteri 'cilt bakımı' → AI bu hizmeti öne çıkarır"; return "AI: '"+(svc.name||"hizmet")+"' sorularında otomatik önerilir"; }
 function renderTable(container, rows, sb){
  allServices=rows.slice();
  var categories=Array.from(new Set(rows.map(function(s){ return s.category||"Genel"; })));
  var stats={total:rows.length, active:rows.filter(function(s){return s.is_active;}).length, avgPrice:0};
  var prices=rows.map(function(s){return Number(s.price)||0;}).filter(function(n){return n>0;});
  if(prices.length) stats.avgPrice=Math.round(prices.reduce(function(a,b){return a+b;},0)/prices.length);
  var statCard=ui.el("div",{class:"grid kpi-grid"});
  function kpi(l,v,s){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:v})); if(s) c.appendChild(ui.el("div",{class:"kpi-sub",text:s})); return c; }
  statCard.appendChild(kpi("Toplam hizmet", String(stats.total), "kayıtlı"));
  statCard.appendChild(kpi("Aktif", String(stats.active), (stats.total-stats.active)+" pasif"));
  statCard.appendChild(kpi("Ort. fiyat", stats.avgPrice? stats.avgPrice.toLocaleString("tr-TR")+" TRY" : "—", "AI fiyat sorularında kullanır"));
  statCard.appendChild(kpi("AI kapsama", "%"+(stats.total?100:0), "tüm hizmetler AI'da"));
  container.appendChild(statCard);
  var filterBar=ui.el("div",{class:"form-row"});
  var search=ui.el("input",{type:"text", placeholder:"Hizmet ara… (örn: lazer, cilt)"});
  var catSel=ui.el("select"); var optAll=ui.el("option",{value:"",text:"Tüm kategoriler"}); catSel.appendChild(optAll); categories.forEach(function(c){ var o=ui.el("option",{value:c,text:c}); catSel.appendChild(o); });
  var statusSel=ui.el("select"); [["","Tümü"],["active","Sadece aktif"],["passive","Sadece pasif"]].forEach(function(o){ var op=ui.el("option",{value:o[0],text:o[1]}); statusSel.appendChild(op); });
  filterBar.appendChild(search); filterBar.appendChild(catSel); filterBar.appendChild(statusSel);
  container.appendChild(filterBar);
  var card=ui.el("div",{class:"card"}); card.appendChild(ui.el("h2",{text:"Hizmetler — Canlı + AI önizleme (satışa hazır)"}));
  var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr"); ["Hizmet","Kategori","Fiyat","Süre","Aktif","AI'da nasıl görünür?","İşlem"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); }); thead.appendChild(htr); t.appendChild(thead);
  var tbody=ui.el("tbody"); t.appendChild(tbody); card.appendChild(t); container.appendChild(card);
  function draw(list){
   ui.clear(tbody);
   if(!list.length){ var tr=ui.el("tr"); var td=ui.el("td",{text:"Filtreye uygun hizmet yok."}); td.colSpan=7; tr.appendChild(td); tbody.appendChild(tr); return; }
   list.forEach(function(s){
    var tr=ui.el("tr");
    var tdN=ui.el("td",{text:String(s.name||"—")}); tdN.appendChild(ui.el("span",{class:"chip",text:s.is_active?"aktif":"pasif"}));
    var tdCat=ui.el("td",{text:s.category||"Genel"});
    var tdP=ui.el("td",{text:fmtPrice(s.price)});
    var tdD=ui.el("td",{text:s.duration_min?String(s.duration_min)+" dk":"—"});
    var tdA=ui.el("td"); tdA.appendChild(toggleSwitch(s,sb));
    var tdAI=ui.el("td",{text:aiPreview(s)}); tdAI.style.fontSize=".85rem"; tdAI.style.color="#9aa6d1";
    var tdAct=ui.el("td"); tdAct.appendChild(rowActions(s,sb));
    [tdN,tdCat,tdP,tdD,tdA,tdAI,tdAct].forEach(function(td){ tr.appendChild(td); });
    tbody.appendChild(tr);
   });
  }
  function apply(){ var q=search.value.toLowerCase().trim(); var cat=catSel.value; var st=statusSel.value; var filtered=allServices.filter(function(s){ var ok=true; if(q) ok=ok && (String(s.name||"").toLowerCase().includes(q) || String(s.description||"").toLowerCase().includes(q)); if(cat) ok=ok && (s.category||"Genel")===cat; if(st==="active") ok=ok && s.is_active; if(st==="passive") ok=ok &&!s.is_active; return ok; }); draw(filtered); }
  search.addEventListener("input", apply); catSel.addEventListener("change", apply); statusSel.addEventListener("change", apply);
  draw(rows);
  var addBtn=ui.el("button",{class:"btn",text:"+ Yeni hizmet — AI anında öğrenir"}); addBtn.addEventListener("click",function(){ openModal(null,sb,true); }); container.appendChild(addBtn);
  container.appendChild(ui.el("div",{class:"notice info",text:"Satış ipucu: Demo'da hizmet ekleyin, sonra Gelen Kutusu'nda 'fiyat' yazın — AI yeni fiyatı anında kullanır."}));
 }
 function renderEmpty(container, sb){ var card=ui.el("div",{class:"card empty-state"}); card.appendChild(ui.el("h2",{text:"Henüz hizmet yok"})); card.appendChild(ui.el("p",{text:"Hizmetler AI cevaplarında anında kullanılır."})); var add=ui.el("button",{class:"btn",text:"İlk hizmeti ekle"}); add.addEventListener("click",function(){ openModal(null,sb,true); }); card.appendChild(add); container.appendChild(card); }
 var MODAL_STYLE_ID="svc-modal-style";
 function ensureStyles(){ if(document.getElementById(MODAL_STYLE_ID)) return; var s=document.createElement("style"); s.id=MODAL_STYLE_ID; s.textContent=".svc-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem}.svc-modal{background:var(--panel,#fff);color:inherit;border-radius:12px;max-width:480px;width:100%;padding:1.25rem;box-shadow:0 12px 40px rgba(0,0,0,.25)}.svc-modal h2{margin:0 0.75rem}.svc-modal label{display:block;margin:.5rem 0.25rem;font-weight:600}.svc-modal input,.svc-modal select,.svc-modal textarea{width:100%;box-sizing:border-box;padding:.5rem;border-radius:10px;border:1px solid #2a334d;background:#0f172a;color:#e8ecff}.svc-modal textarea{min-height:70px}.svc-actions{display:flex;gap:.4rem}.chip{margin-left:.4rem;font-size:.7rem;padding:.1rem.4rem;border-radius:999px;background:#1e293b;color:#9aa6d1}"; document.head.appendChild(s); }
 function closeModal(){ var m=document.getElementById("svc-modal"); if(m) m.remove(); }
 document.addEventListener("keydown", function(ev){ if(ev.key==="Escape") closeModal(); });
 function openModal(svc, sb, isNew){
  ensureStyles(); closeModal();
  var bd=ui.el("div",{class:"svc-modal-backdrop", id:"svc-modal"}); bd.addEventListener("click", function(e){ if(e.target===bd) closeModal(); });
  var modal=ui.el("div",{class:"svc-modal"}); modal.appendChild(ui.el("h2",{text:isNew?"Yeni hizmet":"Hizmeti düzenle"}));
  var nameI=ui.el("input"); nameI.value=svc?svc.name:""; nameI.placeholder="Örn: Lazer Epilasyon";
  var catI=ui.el("input"); catI.value=svc?(svc.category||""):""; catI.placeholder="Kategori (Lazer, Cilt)";
  var priceI=ui.el("input",{type:"number"}); priceI.value=svc?(svc.price||""):"";
  var durI=ui.el("input",{type:"number"}); durI.value=svc?(svc.duration_min||""):"";
  var descI=ui.el("textarea"); descI.value=svc?(svc.description||""):""; descI.placeholder="AI bu metni kullanır";
  var activeI=ui.el("input",{type:"checkbox"}); if(!svc||svc.is_active) activeI.checked=true;
  var err=ui.el("p",{class:"auto-err",text:""});
  [["Hizmet adı",nameI],["Kategori",catI],["Fiyat",priceI],["Süre",durI],["Açıklama",descI]].forEach(function(p){ modal.appendChild(ui.el("label",{text:p[0]})); modal.appendChild(p[1]); });
  var row=ui.el("div",{class:"auto-row"}); row.appendChild(activeI); row.appendChild(ui.el("span",{text:"Aktif"})); modal.appendChild(row); modal.appendChild(err);
  var save=ui.el("button",{class:"btn",text:isNew?"Oluştur":"Kaydet"}); var cancel=ui.el("button",{class:"btn ghost",text:"İptal"}); cancel.addEventListener("click",closeModal);
  save.addEventListener("click", function(){ err.textContent=""; var payload={name:nameI.value.trim(), category:catI.value.trim()||"Genel", price:priceI.value?Number(priceI.value):null, duration_min:durI.value?Number(durI.value):null, description:descI.value.trim(), is_active:activeI.checked, organization_id:ORG_ID, updated_at:new Date().toISOString()}; if(!payload.name){ err.textContent="Ad gerekli"; return; } var q=isNew? sb.from("services").insert(payload) : sb.from("services").update(payload).eq("id",svc.id); q.then(function(res){ if(res.error){ err.textContent=res.error.message; } else { ui.toast(isNew?"Eklendi":"Güncellendi"); closeModal(); } }); });
  var btnRow=ui.el("div",{class:"auto-row"}); btnRow.appendChild(save); btnRow.appendChild(cancel); modal.appendChild(btnRow);
  bd.appendChild(modal); document.body.appendChild(bd);
 }
 function mount(f){
  currentWrap=f; ensureStyles(); var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE; if(!sb){ state(wrap,"wait","Supabase bekleniyor…"); return; }
  state(wrap,"loading","Yükleniyor…");
  sb.from("services").select("id,name,category,price,duration_min,description,is_active,organization_id").eq("organization_id",ORG_ID).order("name").then(function(res){
   ui.clear(wrap); if(res.error){ state(wrap,"error",res.error.message); return; }
   var rows=res.data||[]; if(!rows.length) renderEmpty(wrap,sb); else renderTable(wrap,rows,sb);
   if(realtimeChannel){ try{ sb.removeChannel(realtimeChannel);}catch(e){} }
   realtimeChannel = sb.channel("services-live-v13").on("postgres_changes",{event:"*",schema:"public",table:"services",filter:"organization_id=eq."+ORG_ID}, function(){ mount(f); }).subscribe();
  });
 }
 window.ATLAS_SERVICES={mount:mount};
})();
