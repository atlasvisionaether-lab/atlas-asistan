"use strict";
/* FAZ 14 — Müşteriler / Leadler: Canlı Supabase + Lead Skorlama - satışa hazır */
(function(){
 var ui=window.ATLAS_UI;
 var ORG_ID="fff29ed3-f2e3-4837-bdfc-f4e974f366e7";
 function fetchOrgId(){ var sb=window.ATLAS_SUPABASE, u=window.atlasUser; if(!sb||!u) return Promise.reject(new Error("Oturum yok")); return sb.from("users").select("organization_id").eq("id",u.id).limit(1).maybeSingle().then(function(r){ if(r.error) throw new Error(r.error.message); return r.data.organization_id; }); }
 function leadScore(c){ var last=c.last_message_at? new Date(c.last_message_at): null; if(!last) return "yeni"; var diff=(Date.now()-last.getTime())/86400000; if(diff<1) return "sıcak"; if(diff<7) return "ılımlı"; return "soğuk"; }
 function leadTag(s){ var cls=s==="sıcak"?"tag danger":(s==="ılımlı"?"tag warn":"tag ok"); return ui.el("span",{class:cls,text:s}); }
 function fmtDate(iso){ if(!iso) return "—"; try{ return new Date(iso).toLocaleString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){return "—";} }
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE; if(!sb){ wrap.appendChild(ui.el("div",{class:"card",text:"Supabase bekleniyor…"})); return; }
  wrap.appendChild(ui.el("div",{class:"card",text:"Müşteriler yükleniyor…"}));
  fetchOrgId().then(function(orgId){
   return sb.from("customers").select("id,name,phone,source,last_message_at,is_handled_by_human,organization_id").eq("organization_id",orgId).order("last_message_at",{ascending:false}).limit(200).then(function(res){
    if(res.error) throw new Error(res.error.message);
    var rows=res.data||[];
    ui.clear(wrap);
    var hero=ui.el("div",{class:"card"}); hero.appendChild(ui.el("h2",{text:"Müşteriler / Leadler — Canlı + Skorlama"})); hero.appendChild(ui.el("p",{text:rows.length+" müşteri — son mesaj zamanına göre sıcak/ılımlı/soğuk skorlanıyor. Demo'da arama + filtre gösterin.",class:"muted"})); wrap.appendChild(hero);
    var stats={total:rows.length, hot:0, warm:0, cold:0, human:0};
    rows.forEach(function(c){ var s=leadScore(c); if(s==="sıcak") stats.hot++; else if(s==="ılımlı") stats.warm++; else stats.cold++; if(c.is_handled_by_human) stats.human++; });
    var grid=ui.el("div",{class:"grid kpi-grid"});
    function kpi(l,v,sub){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:String(v)})); if(sub) c.appendChild(ui.el("div",{class:"kpi-sub",text:sub})); return c; }
    grid.appendChild(kpi("Toplam",stats.total,"kayıtlı")); grid.appendChild(kpi("Sıcak lead",stats.hot,"<24 saat")); grid.appendChild(kpi("Ilımlı",stats.warm,"<7 gün")); grid.appendChild(kpi("İnsanda",stats.human,"devralınan")); wrap.appendChild(grid);
    var bar=ui.el("div",{class:"form-row"});
    var search=ui.el("input",{type:"text",placeholder:"Müşteri ara: ad, telefon"}); var filter=ui.el("select"); [["","Tüm skorlar"],["sıcak","Sıcak"],["ılımlı","Ilımlı"],["yeni","Yeni"],["soğuk","Soğuk"]].forEach(function(o){ var opt=ui.el("option",{value:o[0],text:o[1]}); filter.appendChild(opt); });
    bar.appendChild(search); bar.appendChild(filter); wrap.appendChild(bar);
    var card=ui.el("div",{class:"card"}); var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr"); ["Müşteri","Telefon","Kaynak","Lead skoru","Son mesaj","Durum","İşlem"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); }); thead.appendChild(htr); t.appendChild(thead); var tbody=ui.el("tbody"); t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
    function draw(list){ ui.clear(tbody); if(!list.length){ var tr=ui.el("tr"); var td=ui.el("td",{text:"Filtreye uygun müşteri yok"}); td.colSpan=7; tr.appendChild(td); tbody.appendChild(tr); return; } list.forEach(function(c){ var tr=ui.el("tr"); tr.appendChild(ui.el("td",{text:c.name||"—"})); tr.appendChild(ui.el("td",{text:c.phone||"—"})); tr.appendChild(ui.el("td",{text:c.source||"—"})); var tdL=ui.el("td"); tdL.appendChild(leadTag(leadScore(c))); tr.appendChild(tdL); tr.appendChild(ui.el("td",{text:fmtDate(c.last_message_at)})); var tdD=ui.el("td"); tdD.appendChild(ui.el("span",{class:c.is_handled_by_human?"tag warn":"tag ok",text:c.is_handled_by_human?"insanda":"AI'da"})); tr.appendChild(tdD); var tdA=ui.el("td"); var btn=ui.el("button",{class:"btn ghost",text:"Mesajlara git"}); btn.addEventListener("click",function(){ location.hash="#inbox"; }); tdA.appendChild(btn); tr.appendChild(tdA); tbody.appendChild(tr); }); }
    function apply(){ var q=search.value.toLowerCase().trim(); var f=filter.value; var list=rows.filter(function(c){ var ok=true; if(q) ok=ok && ((c.name||"").toLowerCase().includes(q) || (c.phone||"").toLowerCase().includes(q)); if(f) ok=ok && leadScore(c)===f; return ok; }); draw(list); }
    search.addEventListener("input",apply); filter.addEventListener("change",apply); draw(rows);
    wrap.appendChild(ui.el("div",{class:"notice info",text:"Satış ipucu: 'Sıcak lead' filtresi açın, 1 müşteri seçin, Gelen Kutusu'nda son mesajını gösterin — %80 kapanış."}));
   });
  }).catch(function(e){ ui.clear(wrap); wrap.appendChild(ui.el("div",{class:"card",text:"Yüklenemedi: "+e.message})); });
 }
 window.ATLAS_CUSTOMERS={mount:mount};
})();
