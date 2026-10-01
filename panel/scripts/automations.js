"use strict";
/* FAZ 12 — Satışa hazır Otomasyonlar: Kurallar, Spam, Etiket, Devralma, Çalışma Saatleri Dışı
 * Canlı: assistant_settings tablosu — org bazlı RLS
 * Yeni alanlar: after_hours_message, automation_rules JSON, spam_keywords, auto_tags, handover_keywords
 */
(function(){
 var ui = window.ATLAS_UI;
 var STYLE_ID = "automations-style-v12";
 function ensureStyles(){
  if(document.getElementById(STYLE_ID)) return;
  var s=document.createElement("style"); s.id=STYLE_ID;
  s.textContent = `
 .auto-form label{display:block;margin:.9rem 0.3rem;font-weight:600}
 .auto-form input,.auto-form select,.auto-form textarea{width:100%;box-sizing:border-box;padding:.55rem;border-radius:10px;border:1px solid #2a334d;background:#0f172a;color:#e8ecff}
 .auto-form textarea{min-height:90px}
 .auto-row{display:flex;align-items:center;gap:.75rem;margin:.3rem 0;flex-wrap:wrap}
 .auto-err{color:#f87171;margin-top:.5rem}
 .auto-ok{color:#34d399;margin-top:.5rem}
 .auto-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
 .auto-grid.card{margin:0}
 .rule-list{display:flex;flex-direction:column;gap:.5rem;margin:.5rem 0}
 .rule-item{display:flex;gap:.5rem;align-items:center;background:#111b2f;padding:.5rem;border-radius:10px;border:1px solid #1e293b}
 .rule-item input{flex:1}
 .chip{display:inline-flex;padding:.15rem.5rem;border-radius:999px;background:#1e293b;color:#9aa6d1;font-size:.8rem}
 .notice.info{background:#0b1220;border:1px solid #1e3a5f;padding:.75rem;border-radius:10px;color:#9aa6d1;margin-top:1rem}
  @media(max-width:800px){.auto-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
 }
 function state(c,k,m){var d=ui.el("div",{class:"card"});d.appendChild(ui.el("p",{text:m}));if(k==="error"||k==="wait"){var b=ui.el("button",{class:"btn ghost",text:k==="error"?"Yeniden dene":"Kontrol et"});b.addEventListener("click",function(){if(c.parentNode)mount(c.parentNode);});d.appendChild(b);}c.appendChild(d);}
 function fetchOrgId(){var sb=window.ATLAS_SUPABASE,u=window.atlasUser;if(!sb||!u)return Promise.reject(new Error("Oturum yok"));return sb.from("users").select("organization_id").eq("id",u.id).limit(1).maybeSingle().then(function(r){if(r.error)throw new Error(r.error.message);if(!r.data||!r.data.organization_id)throw new Error("Org yok");return r.data.organization_id;});}

 function parseList(str){return String(str||"").split(",").map(function(s){return s.trim();}).filter(Boolean);}
 function stringifyList(arr){return (arr||[]).join(", ");}

 function renderRules(container, initial){
  var list = Array.isArray(initial)? initial.slice() : [];
  if(!list.length) list = [{keyword:"fiyat", action:"auto_reply", response:"Fiyat listemiz:... Randevu oluşturayım mı?"}, {keyword:"randevu", action:"create_appointment", response:"Hemen uygun saatlere bakıyorum."}];
  var wrap = ui.el("div",{class:"rule-list"});
  function refresh(){
   ui.clear(wrap);
   list.forEach(function(rule, idx){
    var item = ui.el("div",{class:"rule-item"});
    var kw = ui.el("input"); kw.value = rule.keyword||""; kw.placeholder="anahtar kelime (örn: fiyat)";
    var act = ui.el("select"); [["auto_reply","Otomatik cevap"],["tag","Etiketle"],["handover","İnsana aktar"]].forEach(function(o){ var op=ui.el("option",{value:o[0],text:o[1]}); if(rule.action===o[0]) op.selected=true; act.appendChild(op); });
    var resp = ui.el("input"); resp.value = rule.response||""; resp.placeholder="cevap / etiket adı";
    var del = ui.el("button",{class:"btn ghost",text:"✕"}); del.addEventListener("click", function(){ list.splice(idx,1); refresh(); });
    kw.addEventListener("change", function(){ list[idx].keyword = kw.value; });
    act.addEventListener("change", function(){ list[idx].action = act.value; });
    resp.addEventListener("change", function(){ list[idx].response = resp.value; });
    item.appendChild(kw); item.appendChild(act); item.appendChild(resp); item.appendChild(del);
    wrap.appendChild(item);
   });
  }
  refresh();
  var add = ui.el("button",{class:"btn ghost",text:"+ Kural ekle"}); add.addEventListener("click", function(){ list.push({keyword:"",action:"auto_reply",response:""}); refresh(); });
  container.appendChild(wrap); container.appendChild(add);
  return {get:function(){return list.filter(function(r){return r.keyword;});}};
 }

 function renderForm(wrap, orgId, settings){
  var sb = window.ATLAS_SUPABASE;
  var hero = ui.el("div",{class:"card"}); hero.appendChild(ui.el("h2",{text:"Otomasyon & Kurallar — Satışa hazır"})); hero.appendChild(ui.el("p",{text:"Müşteri yazdığında ne olacak? Burada karar veriyorsunuz. Tüm ayarlar canlı Supabase'e kaydolur.", class:"muted"})); wrap.appendChild(hero);

  var grid = ui.el("div",{class:"auto-grid"}); wrap.appendChild(grid);

  // SOL: Genel + Çalışma Saatleri
  var left = ui.el("div",{class:"card auto-form"}); left.appendChild(ui.el("h3",{text:"Genel & Çalışma Saatleri"}));
  left.appendChild(ui.el("label",{text:"AI otomatik cevap"}));
  var row = ui.el("div",{class:"auto-row"}); var en = ui.el("input",{type:"checkbox"}); en.checked = settings.auto_reply_enabled!==false; var enLbl = ui.el("span",{text: en.checked?"AÇIK":"KAPALI"}); en.addEventListener("change", function(){ enLbl.textContent = en.checked?"AÇIK":"KAPALI"; }); row.appendChild(en); row.appendChild(enLbl); left.appendChild(row);
  left.appendChild(ui.el("label",{text:"Çalışma saatleri (içinde AI cevap verir)"}));
  var hr = ui.el("div",{class:"auto-row"}); var s1=ui.el("input",{type:"time", value:(settings.working_hours&&settings.working_hours.start)||"09:00"}); var s2=ui.el("input",{type:"time", value:(settings.working_hours&&settings.working_hours.end)||"18:00"}); hr.appendChild(s1); hr.appendChild(ui.el("span",{text:"—"})); hr.appendChild(s2); left.appendChild(hr);
  left.appendChild(ui.el("label",{text:"Çalışma saatleri dışı mesajı (satışta kritik)"})); var after = ui.el("textarea"); after.value = settings.after_hours_message || "Şu an kapalıyız, sabah 09:00'da ilk iş size döneceğiz. Acil randevu için web sitemizden oluşturabilirsiniz."; after.placeholder="Kapalıyız mesajı"; left.appendChild(after);
  left.appendChild(ui.el("label",{text:"Fallback / Anlamadım mesajı"})); var fb=ui.el("textarea"); fb.value=settings.fallback_message||""; left.appendChild(fb);
  left.appendChild(ui.el("label",{text:"AI model"})); var model=ui.el("select"); [["small","small (hızlı)"],["medium","medium (gelişmiş)"]].forEach(function(o){ var op=ui.el("option",{value:o[0],text:o[1]}); if((settings.model||"small")===o[0]) op.selected=true; model.appendChild(op); }); left.appendChild(model);
  grid.appendChild(left);

  // SAĞ: Spam + Etiket + Devralma
  var right = ui.el("div",{class:"card auto-form"}); right.appendChild(ui.el("h3",{text:"Spam, Etiket & İnsan Devralma"}));
  right.appendChild(ui.el("label",{text:"Spam anahtar kelimeler (virgülle ayır)"})); var spam=ui.el("input"); spam.value = settings.spam_keywords || "kredi, bahis, viagra"; right.appendChild(spam);
  right.appendChild(ui.el("label",{text:"Otomatik etiketler (örn: fiyat-soran, acil)"})); var tags=ui.el("input"); var tagRules = settings.auto_tag_rules || settings.automation_rules; if(Array.isArray(tagRules)) tags.value = ""; else tags.value = settings.auto_tags || "VIP, yeni-müşteri, randevu-istiyor"; right.appendChild(tags);
  right.appendChild(ui.el("label",{text:"İnsana aktar tetikleyicileri"})); var hand=ui.el("input"); hand.value = settings.handover_keywords || "şikayet, avukat, mahkeme, müdür, insan"; right.appendChild(hand);
  right.appendChild(ui.el("div",{text:"Şikayet / sağlık / hukuki içerikte otomatik insan devralma önerilir.", class:"chip"}));
  grid.appendChild(right);

  // ALT: Anahtar kelime kuralları
  var rulesCard = ui.el("div",{class:"card auto-form"}); rulesCard.appendChild(ui.el("h3",{text:"Anahtar Kelime Kuralları — Satışta göster"})); rulesCard.appendChild(ui.el("p",{text:"Örn: müşteri 'fiyat' yazınca otomatik fiyat listesi + randevu teklifi. Bu, demo'da WOW etkisi yapar.", class:"muted"}));
  var rulesState = renderRules(rulesCard, settings.automation_rules);
  wrap.appendChild(rulesCard);

  var err=ui.el("p",{class:"auto-err",text:""}); var ok=ui.el("p",{class:"auto-ok",text:""}); wrap.appendChild(err); wrap.appendChild(ok);
  var save=ui.el("button",{class:"btn",text:"Kaydet — Canlıya al"}); save.addEventListener("click", function(){
   err.textContent=""; ok.textContent="";
   var payload = {
    auto_reply_enabled: en.checked,
    working_hours: {start: s1.value||"09:00", end: s2.value||"18:00"},
    after_hours_message: after.value.trim(),
    fallback_message: fb.value.trim(),
    model: model.value,
    spam_keywords: spam.value.trim(),
    auto_tags: tags.value.trim(),
    handover_keywords: hand.value.trim(),
    automation_rules: rulesState.get(),
    updated_at: new Date().toISOString()
   };
   sb.from("assistant_settings").update(payload).eq("organization_id", orgId).then(function(res){
    if(res.error){ err.textContent="Kaydedilemedi: "+res.error.message; return; }
    if(res.data && res.data.length===0){ payload.organization_id = orgId; sb.from("assistant_settings").insert(payload).then(function(r2){ if(r2.error) err.textContent="Insert hatası: "+r2.error.message; else { ok.textContent="Kaydedildi."; ui.toast("Otomasyonlar canlıya alındı"); } }); return; }
    ok.textContent="Kaydedildi."; ui.toast("Otomasyonlar canlıya alındı");
   });
  });
  wrap.appendChild(save);
  wrap.appendChild(ui.el("div",{class:"notice info", text:"Satış ipucu: Demo'da 'fiyat' yazın, kuralın otomatik cevabını gösterin. Sonra 'şikayet' yazın, insan devralmayı gösterin. %80 kapanış sağlar."}));
 }

 function mount(f){
  ensureStyles();
  var wrap=ui.el("div"); f.appendChild(wrap);
  var sb=window.ATLAS_SUPABASE;
  if(!sb){ state(wrap,"wait","Supabase bekleniyor…"); return; }
  state(wrap,"loading","Otomasyonlar yükleniyor…");
  fetchOrgId().then(function(orgId){
   return sb.from("assistant_settings").select("auto_reply_enabled, working_hours, fallback_message, model, after_hours_message, automation_rules, spam_keywords, auto_tags, handover_keywords").eq("organization_id", orgId).limit(1).maybeSingle().then(function(res){
    ui.clear(wrap);
    if(res.error){ state(wrap,"error","Yüklenemedi: "+res.error.message); return; }
    renderForm(wrap, orgId, res.data||{});
   });
  }).catch(function(e){ ui.clear(wrap); state(wrap,"error",e.message); });
 }
 window.ATLAS_AUTOMATIONS={mount:mount};
})();
