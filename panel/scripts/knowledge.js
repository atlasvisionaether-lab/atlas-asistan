"use strict";
/* Bilgi Bankası: salon belgeleri (PDF / Word) → MinerU → asistanın bilgisi.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js), window.atlasUser.
 *
 * Akış: yükle (kb-uploads kovası, kurum klasörü) → kb_documents 'pending'
 * → işçi (worker/kb-ingest) Markdown'a çevirip parçalar → 'review'
 * → burada parçalar okunur ve ONAYLANIR → yalnızca onaylı belgeler
 * otomatik cevapta kullanılır (assistant_settings.kb_enabled açıksa).
 *
 * Onay/ret yalnızca kb_set_status() ile (doğrudan UPDATE yetkisi yok).
 * Dosya ve satırlar RLS ile kuruma kapalı (0014). DOM yalnızca textContent. */
(function(){
 var ui = window.ATLAS_UI;
 var MAX_BYTES = 10 * 1024 * 1024;
 var ACCEPT = ".pdf,.docx,.doc";
 var MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword"
 };
 var STATUS = {
  pending: ["Sırada", "warn"], processing: ["İşleniyor", "warn"], review: ["Onay bekliyor", "ai"],
  approved: ["Onaylandı", "ok"], rejected: ["Reddedildi", "danger"], failed: ["Hata", "danger"]
 };
 var currentWrap = null, timer = null;

 function fetchOrgId(){
  var sb = window.ATLAS_SUPABASE, user = window.atlasUser;
  if (!sb || !user) return Promise.reject(new Error("Oturum bulunamadı."));
  return sb.from("users").select("organization_id").eq("id", user.id).limit(1).maybeSingle()
   .then(function(u){
    if (u.error) throw new Error(u.error.message);
    if (!u.data || !u.data.organization_id) throw new Error("Kullanıcı bir organizasyona bağlı değil.");
    return u.data.organization_id;
   });
 }

 function card(title){
  var c = ui.el("div", { class: "card" });
  c.style.marginBottom = "14px";
  if (title) c.appendChild(ui.el("h2", { text: title }));
  return c;
 }

 function safeName(name){
  return String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-80) || "belge";
 }

 function fmtDate(iso){
  try { return new Date(iso).toLocaleString("tr-TR"); } catch (e) { return iso || "—"; }
 }

 /* ---------------- yükleme ---------------- */
 function uploadCard(orgId){
  var sb = window.ATLAS_SUPABASE;
  var c = card("Belge yükle");
  c.appendChild(ui.el("p", { class: "sub", text: "Fiyat listesi, broşür, iptal politikası gibi belgeleri yükleyin (PDF veya Word, en çok 10 MB). Belge metne çevrilir; siz onaylayınca asistan bu bilgilerle cevap verir." }));
  var row = ui.el("div", { class: "form-row" });
  var input = ui.el("input", { type: "file", accept: ACCEPT });
  var btn = ui.el("button", { class: "btn", text: "Yükle" });
  row.appendChild(input); row.appendChild(btn);
  c.appendChild(row);
  btn.addEventListener("click", function(){
   var f = input.files && input.files[0];
   if (!f) { ui.toast("Önce bir dosya seçin."); return; }
   var ext = (f.name.split(".").pop() || "").toLowerCase();
   if (!MIME[ext]) { ui.toast("Yalnızca PDF veya Word (.docx, .doc) yüklenebilir."); return; }
   if (f.size > MAX_BYTES) { ui.toast("Dosya 10 MB'tan büyük."); return; }
   btn.disabled = true;
   var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
   var path = orgId + "/" + id + "-" + safeName(f.name);
   sb.storage.from("kb-uploads").upload(path, f, { contentType: MIME[ext], upsert: false })
    .then(function(up){
     if (up.error) throw new Error(up.error.message);
     return sb.from("kb_documents").insert({
      organization_id: orgId, file_name: f.name.slice(0, 255), storage_path: path,
      mime_type: MIME[ext], size_bytes: f.size, created_by: window.atlasUser.id
     });
    })
    .then(function(ins){
     if (ins.error) throw new Error(ins.error.message);
     ui.toast("Yüklendi. Belge sıraya alındı; birkaç dakika içinde onayınıza sunulur.");
     input.value = "";
     refresh();
    })
    .catch(function(err){ ui.toast("Yüklenemedi: " + (err && err.message ? err.message : err)); })
    .then(function(){ btn.disabled = false; });
  });
  return c;
 }

 /* ---------------- açma anahtarı ---------------- */
 function toggleCard(orgId){
  var sb = window.ATLAS_SUPABASE;
  var c = card("Asistan bu bilgileri kullansın");
  var box = ui.el("label", { class: "switch" });
  var input = ui.el("input", { type: "checkbox" });
  box.appendChild(input); box.appendChild(ui.el("span", { class: "slider" }));
  var note = ui.el("p", { class: "sub", text: "Açıkken otomatik cevaplar yalnızca ONAYLADIĞINIZ belgelerden ilgili bölümleri kullanır. Sağlık ve şikâyet mesajlarında kullanılmaz; o mesajlar ekibinize devredilir." });
  c.appendChild(box); c.appendChild(note);
  sb.from("assistant_settings").select("kb_enabled").eq("organization_id", orgId).limit(1).maybeSingle()
   .then(function(r){ input.checked = !!(r.data && r.data.kb_enabled); });
  input.addEventListener("change", function(){
   sb.from("assistant_settings").update({ kb_enabled: input.checked }).eq("organization_id", orgId)
    .then(function(r){
     if (r.error) { ui.toast("Kaydedilemedi: " + r.error.message); input.checked = !input.checked; }
     else ui.toast(input.checked ? "Asistan onaylı belgeleri kullanacak." : "Bilgi bankası kapatıldı.");
    });
  });
  return c;
 }

 /* ---------------- inceleme ---------------- */
 function review(doc, host){
  var sb = window.ATLAS_SUPABASE;
  ui.clear(host);
  host.appendChild(ui.el("p", { class: "sub", text: "Yükleniyor…" }));
  sb.from("knowledge_base").select("chunk_index, heading, content").eq("document_id", doc.id).order("chunk_index")
   .then(function(r){
    ui.clear(host);
    if (r.error) { host.appendChild(ui.el("p", { text: "Okunamadı: " + r.error.message })); return; }
    host.appendChild(ui.el("div", { class: "notice info", text: "Aşağıdaki metin belgeden otomatik çıkarıldı. Fiyatları ve kuralları kontrol edin: onaylarsanız asistan müşterilere bunları söyler." }));
    (r.data || []).forEach(function(ch){
     var c = ui.el("div", { class: "card" });
     c.style.margin = "8px 0";
     if (ch.heading) c.appendChild(ui.el("strong", { text: ch.heading }));
     var pre = ui.el("pre", { text: ch.content });
     pre.style.whiteSpace = "pre-wrap"; pre.style.margin = "6px 0 0"; pre.style.fontFamily = "inherit";
     c.appendChild(pre);
     host.appendChild(c);
    });
    var actions = ui.el("div", { class: "form-row" });
    [["approved", "Onayla", "btn"], ["rejected", "Reddet", "btn danger"]].forEach(function(a){
     var b = ui.el("button", { class: a[2], text: a[1] });
     b.addEventListener("click", function(){
      sb.rpc("kb_set_status", { p_document: doc.id, p_status: a[0] }).then(function(res){
       if (res.error) ui.toast("İşlem yapılamadı: " + res.error.message);
       else { ui.toast(a[0] === "approved" ? "Onaylandı: asistan bu belgeyi kullanacak." : "Reddedildi."); refresh(); }
      });
     });
     actions.appendChild(b);
    });
    host.appendChild(actions);
   });
 }

 /* ---------------- liste ---------------- */
 function listCard(orgId){
  var sb = window.ATLAS_SUPABASE;
  var c = card("Belgeler");
  var body = ui.el("div");
  var detail = ui.el("div");
  c.appendChild(body); c.appendChild(detail);
  sb.from("kb_documents").select("*").eq("organization_id", orgId).order("created_at", { ascending: false })
   .then(function(r){
    if (r.error) { body.appendChild(ui.el("p", { text: "Belgeler yüklenemedi: " + r.error.message })); return; }
    var docs = r.data || [];
    if (!docs.length) { body.appendChild(ui.el("p", { class: "sub", text: "Henüz belge yok." })); return; }
    var rows = docs.map(function(d){
     var st = STATUS[d.status] || [d.status, ""];
     var tagTd = ui.el("td");
     tagTd.appendChild(ui.el("span", { class: "tag " + st[1], text: st[0] }));
     if (d.status === "failed" && d.error) tagTd.appendChild(ui.el("div", { class: "sub", text: d.error }));
     var act = ui.el("td");
     if (d.status === "review" || d.status === "approved" || d.status === "rejected") {
      var see = ui.el("button", { class: "btn ghost", text: d.status === "review" ? "İncele ve onayla" : "Görüntüle" });
      see.addEventListener("click", function(){ review(d, detail); });
      act.appendChild(see);
     }
     var del = ui.el("button", { class: "btn danger", text: "Sil" });
     del.style.marginLeft = "6px";
     del.addEventListener("click", function(){
      if (!window.confirm(d.file_name + " silinsin mi? Asistan bu belgeyi artık kullanmaz.")) return;
      sb.from("kb_documents").delete().eq("id", d.id).then(function(res){
       if (res.error) { ui.toast("Silinemedi: " + res.error.message); return; }
       sb.storage.from("kb-uploads").remove([d.storage_path]);
       ui.toast("Silindi."); refresh();
      });
     });
     act.appendChild(del);
     return [d.file_name, tagTd, String(d.chunk_count || 0), fmtDate(d.created_at), act];
    });
    body.appendChild(ui.table(["Belge", "Durum", "Bölüm", "Yüklendi", ""], rows));
    /* İşlenen belge varken liste kendini tazeler. */
    var busy = docs.some(function(d){ return d.status === "pending" || d.status === "processing"; });
    clearTimeout(timer);
    if (busy) timer = setTimeout(refresh, 10000);
   });
  return c;
 }

 function refresh(){ if (currentWrap && currentWrap.parentNode) mount(currentWrap.parentNode); }

 function mount(container){
  if (currentWrap && currentWrap.parentNode === container) container.removeChild(currentWrap);
  var wrap = ui.el("div");
  currentWrap = wrap;
  container.appendChild(wrap);
  wrap.appendChild(ui.el("p", { class: "sub", text: "Yükleniyor…" }));
  fetchOrgId().then(function(orgId){
   ui.clear(wrap);
   wrap.appendChild(toggleCard(orgId));
   wrap.appendChild(uploadCard(orgId));
   wrap.appendChild(listCard(orgId));
  }).catch(function(err){
   ui.clear(wrap);
   wrap.appendChild(ui.el("div", { class: "card", text: "Bilgi bankası açılamadı: " + (err && err.message ? err.message : err) }));
  });
 }

 window.ATLAS_KNOWLEDGE = { mount: mount };
})();
