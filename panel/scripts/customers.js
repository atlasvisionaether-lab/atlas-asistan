"use strict";
/* FAZ 14 - Musteriler canli lead skorlama - satis hazir */
(function(){
 var ui=window.ATLAS_UI;
 function fetchOrgId(){ var sb=window.ATLAS_SUPABASE, u=window.atlasUser; if(!sb||!u) return Promise.reject(new Error("Oturum yok")); return sb.from("users").select("organization_id").eq("id",u.id).limit(1).maybeSingle().then(function(r){ if(r.error) throw new Error(r.error.message); return r.data.organization_id; }); }
 function leadScore(c){ var last=c.last_message_at? new Date(c.last_message_at): null; if(!last) return "yeni"; var diff=(Date.now()-last.getTime())/86400000; if(diff<1) return "sicak"; if(diff<7) return "ilimli"; return "soguk"; }
 function leadTag(s){ var cls=s==="sicak"?"tag danger":(s==="ilimli"?"tag warn":"tag ok"); return ui.el("span",{class:cls,text:s}); }
 function fmtDate(iso){ if(!iso) return "-"; try{ return new Date(iso).toLocaleString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){return "-";} }
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE; if(!sb){ wrap.appendChild(ui.el("div",{class:"card",text:"Supabase bekleniyor"})); return; }
  wrap.appendChild(ui.el("div",{class:"card",text:"Yukleniyor..."}));
  fetchOrgId().then(function(orgId){
   return sb.from("customers").select("id,name,phone,source,last_message_at,is_handled_by_human,organization_id").eq("organization_id",orgId).order("last_message_at",{ascending:false}).limit(200).then(function(res){
    if(res.error) throw new Error(res.error.message);
    var rows=res.data||[];
    ui.clear(wrap);
    var hero=ui.el("div",{class:"card"}); hero.appendChild(ui.el("h2",{text:"Musteriler / Leadler - Canli + Skorlama"})); hero.appendChild(ui.el("p",{text:rows.length+" musteri - son mesaja gore sicak/ilimli/soguk",class:"muted"})); wrap.appendChild(hero);
    var stats={total:rows.length, hot:0, warm:0, cold:0, human:0};
    rows.forEach(function(c){ var s=leadScore(c); if(s==="sicak") stats.hot++; else if(s==="ilimli") stats.warm++; else stats.cold++; if(c.is_handled_by_human) stats.human++; });
    var grid=ui.el("div",{class:"grid kpi-grid"});
    function kpi(l,v,sub){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:String(v)})); if(sub) c.appendChild(ui.el("div",{class:"kpi-sub",text:sub})); return c; }
    grid.appendChild(kpi("Toplam",stats.total,"kayitli")); grid.appendChild(kpi("Sicak",stats.hot,"<24s")); grid.appendChild(kpi("Ilimli",stats.warm,"<7g")); grid.appendChild(kpi("Insanda",stats.human,"devralinan")); wrap.appendChild(grid);
    var bar=ui.el("div",{class:"form-row"});
    var search=ui.el("input",{type:"text",placeholder:"Ara: ad, telefon"}); var filter=ui.el("select"); [["","Tum"],["sicak","Sicak"],["ilimli","Ilimli"],["yeni","Yeni"],["soguk","Soguk"]].forEach(function(o){ var opt=ui.el("option",{value:o[0],text:o[1]}); filter.appendChild(opt); });
    bar.appendChild(search); bar.appendChild(filter); wrap.appendChild(bar);
    var card=ui.el("div",{class:"card"}); var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr"); ["Musteri","Telefon","Kaynak","Skor","Son mesaj","Durum","Islem"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); }); thead.appendChild(htr); t.appendChild(thead); var tbody=ui.el("tbody"); t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
    function draw(list){ ui.clear(tbody); if(!list.length){ var tr=ui.el("tr"); var td=ui.el("td",{text:"Yok"}); td.colSpan=7; tr.appendChild(td); tbody.appendChild(tr); return; } list.forEach(function(c){ var tr=ui.el("tr"); tr.appendChild(ui.el("td",{text:c.name||"-"})); tr.appendChild(ui.el("td",{text:c.phone||"-"})); tr.appendChild(ui.el("td",{text:c.source||"-"})); var tdL=ui.el("td"); tdL.appendChild(leadTag(leadScore(c))); tr.appendChild(tdL); tr.appendChild(ui.el("td",{text:fmtDate(c.last_message_at)})); var tdD=ui.el("td"); tdD.appendChild(ui.el("span",{class:c.is_handled_by_human?"tag warn":"tag ok",text:c.is_handled_by_human?"insanda":"AI"})); tr.appendChild(tdD); var tdA=ui.el("td"); var btn=ui.el("button",{class:"btn ghost",text:"Inbox"}); btn.addEventListener("click",function(){ location.hash="#inbox"; }); tdA.appendChild(btn); tr.appendChild(tdA); tbody.appendChild(tr); }); }
    function apply(){ var q=search.value.toLowerCase().trim(); var f=filter.value; var list=rows.filter(function(c){ var ok=true; if(q) ok=ok && ((c.name||"").toLowerCase().includes(q) || (c.phone||"").toLowerCase().includes(q)); if(f) ok=ok && leadScore(c)===f; return ok; }); draw(list); }
    search.addEventListener("input",apply); filter.addEventListener("change",apply); draw(rows);
   });
  }).catch(function(e){ ui.clear(wrap); wrap.appendChild(ui.el("div",{class:"card",text:"Hata: "+e.message})); });
 }
 window.ATLAS_CUSTOMERS={mount:mount};
})();
