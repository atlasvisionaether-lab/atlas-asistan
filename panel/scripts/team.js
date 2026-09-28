"use strict";
(function(){
 var ui=window.ATLAS_UI;
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
  wrap.appendChild(ui.el("h2",{text:"Ekip / Yetkiler - Canli"}));
  var sb=window.ATLAS_SUPABASE;
  var card=ui.el("div",{class:"card"}); card.textContent="Yukleniyor..."; wrap.appendChild(card);
  if(!sb){ card.textContent="Supabase bekleniyor"; return; }
  fetchOrgId().then(function(orgId){
    return sb.from("users").select("id,role,organization_id,created_at").eq("organization_id",orgId).limit(100).then(function(r){
      if(r.error) throw new Error(r.error.message);
      ui.clear(card);
      var rows=r.data||[];
      var h=ui.el("h2",{text:"Ekip / Yetkiler - Canli ("+ rows.length +" kisi)"});
      card.appendChild(h);
      var t=ui.el("table"); var thead=ui.el("thead"); var htr=ui.el("tr");
      ["Kullanici ID","Rol","Katildi","Durum"].forEach(function(h){ htr.appendChild(ui.el("th",{text:h})); });
      thead.appendChild(htr); t.appendChild(thead);
      var tb=ui.el("tbody");
      rows.forEach(function(u){
        var tr=ui.el("tr");
        tr.appendChild(ui.el("td",{text:(u.id||"").substring(0,8)+"..."}));
        tr.appendChild(ui.el("td",{text:u.role||"user"}));
        var d=u.created_at? new Date(u.created_at).toLocaleDateString("tr-TR"):"-";
        tr.appendChild(ui.el("td",{text:d}));
        tr.appendChild(ui.el("td",{text: u.id=== (window.atlasUser&&window.atlasUser.id) ? "Sen (owner)" : "Ayni org"}));
        tb.appendChild(tr);
      });
      t.appendChild(tb); card.appendChild(t);
    });
  }).catch(function(e){
    ui.clear(card);
    card.textContent="Hata: "+e.message;
  });
 }
 window.ATLAS_TEAM={mount:mount};
})();
