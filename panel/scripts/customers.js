"use strict";
(function(){
 var ui=window.ATLAS_UI;
 function score(c){
   var d=c.created_at?new Date(c.created_at):null;
   if(!d) return "yeni";
   var diff=(Date.now()-d.getTime())/86400000;
   if(diff<1) return "sicak";
   if(diff<7) return "ilimli";
   return "soguk";
 }
 function fetchOrgId(){
   var sb=window.ATLAS_SUPABASE, u=window.atlasUser;
   if(!sb ||!u) return Promise.reject(new Error("Oturum yok"));
   return sb.from("users").select("organization_id").eq("id",u.id).limit(1).maybeSingle().then(function(r){
     if(r.error) throw new Error(r.error.message);
     return r.data.organization_id;
   });
 }
 function mount(f){
  var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE;
  if(!sb){ wrap.appendChild(ui.el("div",{class:"card",text:"Supabase bekleniyor"})); return; }
  wrap.appendChild(ui.el("div",{class:"card",text:"Yukleniyor..."}));
  fetchOrgId().then(function(orgId){
   return sb.from("customers").select("id,full_name,phone,email,lead_status,created_at,organization_id").eq("organization_id",orgId).order("created_at",{ascending:false}).limit(200).then(function(res){
    if(res.error) throw new Error(res.error.message);
    var rows=res.data||[];
    ui.clear(wrap);
    var hero=ui.el("div",{class:"card"});
    hero.appendChild(ui.el("h2",{text:"Musteriler / Leadler - Canli"}));
    hero.appendChild(ui.el("p",{text: rows.length+" musteri", class:"muted"}));
    wrap.appendChild(hero);
    var stats={total:rows.length, hot:0, warm:0, cold:0};
    rows.forEach(function(c){ var s=score(c); if(s==="sicak") stats.hot++; else if(s==="ilimli") stats.warm++; else stats.cold++; });
    var grid=ui.el("div",{class:"grid kpi-grid"});
    function kpi(l,v){ var c=ui.el("div",{class:"card kpi"}); c.appendChild(ui.el("div",{class:"kpi-label",text:l})); c.appendChild(ui.el("div",{class:"kpi-value",text:String(v)})); return c; }
    grid.appendChild(kpi("Toplam",stats.total)); grid.appendChild(kpi("Sicak",stats.hot)); grid.appendChild(kpi("Ilimli",stats.warm)); wrap.appendChild(grid);
    var bar=ui.el("div",{class:"form-row"});
    var search=ui.el("input",{type:"text",placeholder:"Ara: ad, telefon"});
    var filter=ui.el("select"); [["","Tum"],["sicak","Sicak"],["ilimli","Ilimli"],["yeni","Yeni"]].forEach(function(o){ var opt=ui.el("option",{value:o[0],text:o[1]}); filter.appendChild(opt); });
    bar.appendChild(search); bar.appendChild(filter); wrap.appendChild(bar);
    var card=ui.el("div",{class:"card"}); var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr");
    ["Musteri","Telefon","Lead","Skor","Son","Islem"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); });
    thead.appendChild(htr); t.appendChild(thead); var tbody=ui.el("tbody"); t.appendChild(tbody); card.appendChild(t); wrap.appendChild(card);
    function fmtDate(iso){ if(!iso) return "-"; try{ return new Date(iso).toLocaleString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ return "-"; } }
    function draw(list){
      ui.clear(tbody);
      if(!list.length){ var tr=ui.el("tr"); var td=ui.el("td",{text:"Yok"}); td.colSpan=6; tr.appendChild(td); tbody.appendChild(tr); return; }
      list.forEach(function(c){
        var tr=ui.el("tr");
        tr.appendChild(ui.el("td",{text:c.full_name||"-"}));
        tr.appendChild(ui.el("td",{text:c.phone||"-"}));
        tr.appendChild(ui.el("td",{text:c.lead_status||"-"}));
        var sc=score(c); var tdL=ui.el("td"); tdL.appendChild(ui.el("span",{class:sc==="sicak"?"tag danger":sc==="ilimli"?"tag warn":"tag ok",text:sc})); tr.appendChild(tdL);
        tr.appendChild(ui.el("td",{text:fmtDate(c.created_at)}));
        var tdA=ui.el("td"); var btn=ui.el("button",{class:"btn ghost",text:"Inbox"}); btn.addEventListener("click",function(){ location.hash="#inbox"; }); tdA.appendChild(btn); tr.appendChild(tdA);
        tbody.appendChild(tr);
      });
    }
    function apply(){ var q=search.value.toLowerCase().trim(); var f=filter.value; var list=rows.filter(function(c){ var ok=true; if(q) ok=ok && ((c.full_name||"").toLowerCase().includes(q) || (c.phone||"").toLowerCase().includes(q)); if(f) ok=ok && score(c)===f; return ok; }); draw(list); }
    search.addEventListener("input",apply); filter.addEventListener("change",apply); draw(rows);
   });
  }).catch(function(e){ ui.clear(wrap); wrap.appendChild(ui.el("div",{class:"card",text:"Hata: "+e.message})); });
 }
 window.ATLAS_CUSTOMERS={mount:mount};
})();
