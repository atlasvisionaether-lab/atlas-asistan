"use strict";
/* Kanallar ekranı (#kanallar): Telegram, WhatsApp (Cloud API), Instagram — klinik kendi bağlar.
 * Bağımlılıklar: window.ATLAS_UI (ui.js), window.ATLAS_SUPABASE (auth.js).
 *
 * Uç: https://atlasasistan.com/api/atlas-channels (CORS, Bearer Supabase jetonu).
 * Kimlik bilgileri yalnız sunucuya gider, şifreli saklanır; liste cevabında
 * jeton DÖNMEZ. Meta kanallarında son adım: kliniğin Meta uygulamasına webhook
 * adresi + doğrulama jetonu girilir (yalnız sahip/yönetici görür).
 * Bağlama/kesme yalnız sahip/yönetici; diğer roller durumu görür.
 *
 * WhatsApp "tek tıkla bağla" (Embedded Signup v4): sunucu Atlas Meta uygulaması
 * yapılandırılmışsa (GET → embedded.whatsapp) Facebook SDK'sı düğmeye basılınca
 * yüklenir; Facebook penceresi WABA + numara kimliğini postMessage ile, 30 sn
 * ömürlü kodu FB.login cevabıyla verir; ikisi sunucuya gider (kod orada jetona
 * çevrilir). "Mevcut WhatsApp Business numaram" = coexistence: telefondaki
 * uygulama çalışmaya devam eder. Eski el ile bağlama "Gelişmiş" altında kalır. */
(function(){
 var ui = window.ATLAS_UI;
 var API = "https://atlasasistan.com/api/atlas-channels";

 var ICONS = {
  telegram: '<path d="M21.5 4.2 2.9 11.4c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8l3.2-15.2c.3-1.4-.5-2-1.9-1.5zM9.7 14.1l8.7-7.8c.4-.3-.1-.5-.6-.2l-10.7 6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.6 8.4c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.5l.7 1.7c.1.2 0 .4-.1.6l-.5.6c-.1.2-.2.3 0 .6.6 1 1.4 1.8 2.5 2.4.3.1.4.1.6-.1l.6-.7c.2-.2.4-.2.6-.1l1.7.8c.2.1.4.2.4.4 0 .6-.3 1.4-1 1.7-.7.4-1.6.4-3-.2-2.2-1-3.7-2.9-4.2-4-.5-1.2-.2-2.1 0-2.5z" fill="currentColor"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor"/>'
 };

 var CHANNELS = {
  telegram: {
   title: "Telegram", tagline: "En hızlı kanal: 2 dakikada hazır.",
   fields: [{ name: "botToken", label: "Bot token", hint: "BotFather'ın verdiği 123456789:ABC… biçimindeki değer" }],
   steps: [
    "Telegram'da @BotFather'ı açın ve /newbot yazın.",
    "Botunuza bir ad verin (ör. Işıl Güzellik), sonra sonu \"bot\" ile biten bir kullanıcı adı seçin (ör. isilguzellik_bot).",
    "BotFather size uzun bir token verir. Onu aşağıya yapıştırıp Bağla'ya basın.",
    "Deneme: Telegram'dan botunuza \"Merhaba\" yazın; asistan cevap verir ve mesaj Gelen Kutusu'nda görünür."
   ]
  },
  whatsapp: {
   title: "WhatsApp Business", tagline: "Meta'nın WhatsApp Cloud API'si ile, kendi Meta uygulamanız üzerinden.",
   fields: [
    { name: "phoneNumberId", label: "Phone number ID", hint: "Yalnız rakam" },
    { name: "wabaId", label: "WhatsApp Business Account ID", hint: "Yalnız rakam" },
    { name: "accessToken", label: "Kalıcı erişim jetonu", hint: "System User jetonu" },
    { name: "appSecret", label: "App Secret", hint: "32 karakter" }
   ],
   steps: [
    "Önemli: Cloud API'ye bağlanan numara artık telefondaki WhatsApp uygulamasında kullanılamaz. Kliniğin iş numarasını ya da yeni bir hat kullanın; sohbet geçmişini önceden yedekleyin.",
    "developers.facebook.com'da bir İşletme uygulaması oluşturun ve WhatsApp ürününü ekleyin.",
    "WhatsApp → API kurulumu ekranından Phone number ID ve WhatsApp Business Account ID'yi kopyalayın.",
    "Meta İşletme ayarlarında bir Sistem Kullanıcısı oluşturun; whatsapp_business_messaging ve whatsapp_business_management izinleriyle kalıcı bir jeton alın.",
    "Uygulama ayarları → Temel bölümünden App Secret'ı kopyalayın. Dört değeri aşağıya girip Bağla'ya basın.",
    "Son adım: Size verilen Webhook adresini ve doğrulama jetonunu WhatsApp → Yapılandırma → Webhook'a girin ve \"messages\" alanına abone olun. Meta adresi doğrulayınca kanal \"Bağlı\" olur."
   ]
  },
  instagram: {
   title: "Instagram", tagline: "Instagram Direkt mesajları — Facebook Sayfanız üzerinden.",
   fields: [
    { name: "pageAccessToken", label: "Facebook Sayfası erişim jetonu", hint: "Uzun ömürlü Sayfa jetonu" },
    { name: "appSecret", label: "App Secret", hint: "32 karakter" }
   ],
   steps: [
    "Instagram hesabınızı İşletme hesabına çevirin ve bir Facebook Sayfasına bağlayın.",
    "Instagram'da Ayarlar → Mesajlar bölümünde \"Mesajlara erişime izin ver\" seçeneğini açın.",
    "Meta uygulamanıza Messenger/Instagram ürününü ekleyin; Sayfanız için instagram_manage_messages ve pages_manage_metadata izinli uzun ömürlü bir Sayfa jetonu alın.",
    "Uygulama ayarları → Temel bölümünden App Secret'ı kopyalayın. İki değeri aşağıya girip Bağla'ya basın.",
    "Son adım: Size verilen Webhook adresini ve doğrulama jetonunu uygulamanızın Instagram webhook ayarına girin ve \"messages\" alanına abone olun."
   ]
  }
 };

 var embedded = null;   // GET → { whatsapp: { appId, configId, graphVersion } } | null
 var sdkPromise = null;

 function loadSdk(cfg){
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise(function(resolve, reject){
   window.fbAsyncInit = function(){
    window.FB.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: false, version: cfg.graphVersion });
    resolve(window.FB);
   };
   var sc = document.createElement("script");
   sc.src = "https://connect.facebook.net/en_US/sdk.js"; sc.async = true; sc.defer = true; sc.crossOrigin = "anonymous";
   sc.onerror = function(){ sdkPromise = null; reject(new Error("sdk")); };
   document.head.appendChild(sc);
  });
  return sdkPromise;
 }

 /* Facebook penceresi → { phone_number_id, waba_id } (postMessage) + FB.login → kod. */
 function embeddedSignup(coexistence, setStatus, reload){
  var cfg = embedded && embedded.whatsapp;
  if (!cfg) return;
  var session = null, done = false;
  function onMsg(ev){
   var host = ""; try { host = new URL(ev.origin).hostname; } catch (e) { return; }
   if (host !== "facebook.com" && !/\.facebook\.com$/.test(host)) return;
   var d; try { d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
   if (!d || d.type !== "WA_EMBEDDED_SIGNUP") return;
   if (/^FINISH/.test(String(d.event || "")) && d.data) session = { wabaId: String(d.data.waba_id || ""), phoneNumberId: String(d.data.phone_number_id || "") };
   else if (d.event === "CANCEL" || d.event === "ERROR"){ session = { cancelled: true, step: d.data && (d.data.current_step || d.data.error_message) }; }
  }
  window.addEventListener("message", onMsg);
  function finish(text, ok){ if (done) return; done = true; window.removeEventListener("message", onMsg); setStatus(text, ok); }
  setStatus("Facebook penceresi açılıyor…", true);
  loadSdk(cfg).then(function(FB){
   var extras = { setup: {}, sessionInfoVersion: "3" };
   if (coexistence) extras.featureType = "whatsapp_business_app_onboarding";
   FB.login(function(resp){
    var code = resp && resp.authResponse && resp.authResponse.code;
    if (!code){ finish(session && session.step ? "Bağlama tamamlanmadı (adım: " + session.step + "). Tekrar deneyebilirsiniz." : "Bağlama iptal edildi."); return; }
    setStatus("WhatsApp hesabınız bağlanıyor…", true);
    var tries = 0;
    (function wait(){
     /* Oturum bilgisi (postMessage) kodla aynı anda ya da hemen ardından gelir; kod 30 sn geçerli. */
     if ((!session || !session.phoneNumberId) && tries++ < 15){ setTimeout(wait, 200); return; }
     if (!session || !session.phoneNumberId){ finish("Facebook numara bilgisini iletmedi. Pencerede numara seçimini tamamlayıp tekrar deneyin."); return; }
     api("POST", { action: "embeddedSignup", channel: "whatsapp", code: code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId, coexistence: !!coexistence }).then(function(r){
      if (r.status === 200 && r.data && r.data.success){ finish("", true); ui.toast(r.data.message || "WhatsApp bağlandı."); reload(); return; }
      finish((r.data && r.data.message) || (r.status === 403 ? "Kanalları yalnız klinik sahibi ya da yöneticisi bağlayabilir." : "Bağlanamadı. Tekrar deneyin."));
     });
    })();
   }, { config_id: cfg.configId, response_type: "code", override_default_response_type: true, extras: extras });
  }).catch(function(){ finish("Facebook bağlantısı yüklenemedi. Reklam/izleme engelleyiciyi bu sayfa için kapatıp tekrar deneyin."); });
 }

 function embeddedBox(reload){
  var box = ui.el("div", { class: "ch-embedded" });
  box.appendChild(ui.el("h3", { class: "ch-sub", text: "Tek tıkla bağla (önerilen)" }));
  box.appendChild(ui.el("p", { class: "muted", text: "Facebook hesabınızla giriş yapıp işletmenizi ve numaranızı seçmeniz yeterli; uygulama, jeton ya da webhook ayarı gerekmez." }));
  var msg = ui.el("p", { role: "status" });
  function setStatus(text, ok){ msg.textContent = text || ""; msg.className = ok ? "muted" : "auth-error-text"; btns.forEach(function(b){ b.disabled = !!(ok && text); }); }
  var coex = ui.el("button", { class: "btn", type: "button", text: "Mevcut WhatsApp Business numaramı bağla" });
  var fresh = ui.el("button", { class: "btn ghost", type: "button", text: "Yeni bir numara bağla" });
  var btns = [coex, fresh];
  coex.addEventListener("click", function(){ embeddedSignup(true, setStatus, reload); });
  fresh.addEventListener("click", function(){ embeddedSignup(false, setStatus, reload); });
  var acts = ui.el("div", { class: "ch-actions" }); acts.appendChild(coex); acts.appendChild(fresh);
  box.appendChild(acts); box.appendChild(msg);
  var info = ui.el("details", { class: "ch-steps" });
  info.appendChild(ui.el("summary", { text: "Hangisini seçmeliyim?" }));
  var ul = ui.el("ul");
  [
   "Mevcut WhatsApp Business numaram: Telefonunuzdaki WhatsApp Business uygulaması (sürüm 2.24.17 ve üzeri) çalışmaya devam eder; müşterilerinize hem telefondan hem asistanla yanıt verilir. Telefondan yanıt verdiğiniz müşteriye asistan karışmaz. Bağlanınca yayın listeleri salt okunur olur ve WhatsApp Web gibi bağlı cihazlardan çıkış yapılır.",
   "Yeni bir numara: Henüz WhatsApp'ta kullanılmayan bir hat. Bu numara yalnız asistan ve panel üzerinden kullanılır.",
   "Her iki durumda da WhatsApp mesaj ücretlerini Meta doğrudan sizden alır: WhatsApp Manager'da ödeme yöntemi ekleyin. Numara başına ayda 1.000 yanıt mesajı ücretsizdir."
  ].forEach(function(t){ ul.appendChild(ui.el("li", { text: t })); });
  info.appendChild(ul); box.appendChild(info);
  return box;
 }

 var STATUS = {
  connected: ["Bağlı", "ok"], pending: ["Son adım bekleniyor", "warn"], error: ["Hata", "danger"], disconnected: ["Bağlı değil", ""]
 };

 var ERRORS = {
  already_connected_elsewhere: "Bu hesap başka bir klinik hesabına bağlı.",
  set_webhook_failed: "Telegram webhook kurulamadı. Tekrar deneyin.",
  not_connected: "Bağlantı kopmuş görünüyor; yeniden bağlayın."
 };

 function token(){
  return window.ATLAS_SUPABASE.auth.getSession().then(function(s){ return s.data && s.data.session ? s.data.session.access_token : null; });
 }

 function api(method, body){
  return token().then(function(t){
   if (!t) return { status: 401, data: null };
   return fetch(API, {
    method: method,
    headers: Object.assign({ "Authorization": "Bearer " + t }, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
   }).then(function(r){ return r.json().catch(function(){ return null; }).then(function(d){ return { status: r.status, data: d }; }); });
  }).catch(function(){ return { status: 0, data: null }; });
 }

 function icon(type){
  var s = ui.el("span", { class: "ch-icon ch-" + type, "aria-hidden": "true" });
  s.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26">' + ICONS[type] + "</svg>";
  return s;
 }

 function copyRow(label, value){
  var row = ui.el("div", { class: "ch-copy" });
  row.appendChild(ui.el("span", { class: "kpi-label", text: label }));
  var code = ui.el("code", { text: value });
  var btn = ui.el("button", { class: "btn ghost", type: "button", text: "Kopyala" });
  btn.addEventListener("click", function(){
   (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject()).then(function(){
    btn.textContent = "Kopyalandı ✓"; setTimeout(function(){ btn.textContent = "Kopyala"; }, 1800);
   }).catch(function(){ ui.toast("Kopyalanamadı; metni seçip elle kopyalayın."); });
  });
  row.appendChild(code); row.appendChild(btn);
  return row;
 }

 function stepsList(type){
  var d = ui.el("details", { class: "ch-steps" });
  d.appendChild(ui.el("summary", { text: "Bu değerleri nereden alırım? (adım adım)" }));
  var ol = ui.el("ol");
  CHANNELS[type].steps.forEach(function(s){ ol.appendChild(ui.el("li", { text: s })); });
  d.appendChild(ol);
  return d;
 }

 function connectForm(type, reload){
  var def = CHANNELS[type];
  var form = ui.el("form", { class: "ch-form", autocomplete: "off" });
  def.fields.forEach(function(f){
   var lab = ui.el("label", { class: "co-field" });
   lab.appendChild(ui.el("span", { text: f.label }));
   var inp = ui.el("input", { name: f.name, type: "password", autocomplete: "off", spellcheck: "false", required: "required" });
   lab.appendChild(inp);
   if (f.hint) lab.appendChild(ui.el("small", { class: "muted", text: f.hint }));
   form.appendChild(lab);
  });
  var err = ui.el("p", { class: "auth-error-text", role: "alert" });
  var btn = ui.el("button", { class: "btn", type: "submit", text: "Bağla" });
  form.appendChild(err); form.appendChild(btn);
  form.addEventListener("submit", function(e){
   e.preventDefault();
   err.textContent = "";
   var creds = {};
   def.fields.forEach(function(f){ creds[f.name] = form.querySelector("[name=" + f.name + "]").value.trim(); });
   if (Object.keys(creds).some(function(k){ return !creds[k]; })){ err.textContent = "Tüm alanları doldurun."; return; }
   btn.disabled = true; btn.textContent = "Bağlanıyor…";
   api("POST", { action: "connect", channel: type, credentials: creds }).then(function(r){
    btn.disabled = false; btn.textContent = "Bağla";
    if (r.status === 200 && r.data && r.data.success){ ui.toast(r.data.message || "Bağlandı."); reload(); return; }
    if (r.status === 401){ err.textContent = "Oturumunuzun süresi dolmuş. Çıkış yapıp tekrar giriş yapın."; return; }
    if (r.status === 403){ err.textContent = "Kanalları yalnız klinik sahibi ya da yöneticisi bağlayabilir."; return; }
    err.textContent = (r.data && r.data.message) || "Bağlanamadı. Değerleri kontrol edip tekrar deneyin.";
   });
  });
  return form;
 }

 function disconnectButton(type, reload){
  var wrap = ui.el("div", { class: "ch-actions" });
  var b = ui.el("button", { class: "btn ghost", type: "button", text: "Bağlantıyı kes" });
  b.addEventListener("click", function(){
   ui.clear(wrap);
   wrap.appendChild(ui.el("span", { class: "muted", text: "Asistan bu kanaldan cevap vermeyi bırakır. Emin misiniz?" }));
   var yes = ui.el("button", { class: "btn danger", type: "button", text: "Evet, kes" });
   var no = ui.el("button", { class: "btn ghost", type: "button", text: "Vazgeç" });
   yes.addEventListener("click", function(){
    yes.disabled = true;
    api("POST", { action: "disconnect", channel: type }).then(function(r){
     if (r.status === 200){ ui.toast(CHANNELS[type].title + " bağlantısı kesildi."); reload(); }
     else { ui.toast("Bağlantı kesilemedi."); reload(); }
    });
   });
   no.addEventListener("click", reload);
   wrap.appendChild(yes); wrap.appendChild(no);
  });
  wrap.appendChild(b);
  return wrap;
 }

 function card(view, canManage, reload){
  var type = view.channel, def = CHANNELS[type];
  var st = STATUS[view.status] || STATUS.disconnected;
  var c = ui.el("div", { class: "card ch-card ch-" + view.status });
  var head = ui.el("div", { class: "ch-head" });
  head.appendChild(icon(type));
  var t = ui.el("div", { class: "ch-title" });
  t.appendChild(ui.el("h2", { text: def.title }));
  var tagline = type === "whatsapp" && embedded && embedded.whatsapp ? "Facebook hesabınızla tek tıkla bağlanır; mevcut numaranız telefonda da çalışır." : def.tagline;
  t.appendChild(ui.el("span", { class: "muted", text: view.displayName || tagline }));
  head.appendChild(t);
  head.appendChild(ui.el("span", { class: "tag " + st[1], text: st[0] }));
  c.appendChild(head);

  if (view.status === "error" && view.lastError){
   c.appendChild(ui.el("p", { class: "notice", text: ERRORS[view.lastError] || ("Son deneme başarısız (" + view.lastError + "). Değerleri kontrol edip yeniden bağlayın.") }));
  }

  if (view.status === "connected"){
   c.appendChild(ui.el("p", { class: "muted", text: "Asistan bu kanaldan gelen mesajlara cevap veriyor. Mesajlar Gelen Kutusu'nda görünür." }));
   if (type === "whatsapp" && view.mode === "embedded"){
    var pay = ui.el("p", { class: "notice info" });
    pay.appendChild(document.createTextNode("Mesaj ücretlerini Meta doğrudan sizden alır; ödeme yöntemi eklemediyseniz ayda 1.000 yanıttan sonra mesajlar gitmez. "));
    pay.appendChild(ui.el("a", { href: "https://business.facebook.com/wa/manage/home/", target: "_blank", rel: "noopener", text: "WhatsApp Manager'ı aç →" }));
    c.appendChild(pay);
   }
   if (canManage) c.appendChild(disconnectButton(type, reload));
   return c;
  }

  if (view.status === "pending"){
   c.appendChild(ui.el("p", { text: "Son adım: aşağıdaki iki değeri Meta uygulamanızın Webhook ayarına girin ve \"messages\" alanına abone olun. Meta adresi doğrulayınca bu kart \"Bağlı\" olur." }));
   if (view.webhookUrl) c.appendChild(copyRow("Webhook adresi (Callback URL)", view.webhookUrl));
   if (view.verifyToken) c.appendChild(copyRow("Doğrulama jetonu (Verify token)", view.verifyToken));
   var refresh = ui.el("button", { class: "btn", type: "button", text: "Durumu yenile" });
   refresh.addEventListener("click", reload);
   var actions = ui.el("div", { class: "ch-actions" });
   actions.appendChild(refresh);
   c.appendChild(actions);
   if (canManage){
    var again = ui.el("details", { class: "ch-steps" });
    again.appendChild(ui.el("summary", { text: "Değerleri yeniden gir" }));
    again.appendChild(connectForm(type, reload));
    c.appendChild(again);
    c.appendChild(disconnectButton(type, reload));
   }
   return c;
  }

  if (!canManage){
   c.appendChild(ui.el("p", { class: "muted", text: "Bu kanalı klinik sahibi ya da yöneticisi bağlayabilir." }));
   return c;
  }
  if (type === "whatsapp" && embedded && embedded.whatsapp){
   c.appendChild(embeddedBox(reload));
   var adv = ui.el("details", { class: "ch-steps ch-advanced" });
   adv.appendChild(ui.el("summary", { text: "Gelişmiş: kendi Meta uygulamamla bağla" }));
   adv.appendChild(stepsList(type)); adv.appendChild(connectForm(type, reload));
   c.appendChild(adv);
   return c;
  }
  c.appendChild(stepsList(type));
  c.appendChild(connectForm(type, reload));
  return c;
 }

 function mount(f){
  var wrap = ui.el("div", { class: "ch-wrap" }); f.appendChild(wrap);
  if (!window.ATLAS_SUPABASE){ wrap.appendChild(ui.el("div", { class: "card", text: "Oturum hazır değil." })); return; }
  function load(){
   ui.clear(wrap);
   wrap.appendChild(ui.el("p", { class: "muted", text: "Kanallar yükleniyor…" }));
   api("GET").then(function(r){
    ui.clear(wrap);
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.channels)){
     wrap.appendChild(ui.el("div", { class: "card", text: r.status === 401 ? "Oturumunuzun süresi dolmuş. Çıkış yapıp tekrar giriş yapın." : "Kanallar yüklenemedi. Sayfayı yenileyin." }));
     return;
    }
    embedded = r.data.embedded || null;
    if (!r.data.ready){
     wrap.appendChild(ui.el("p", { class: "notice", text: "Kanal bağlama şu an kullanılamıyor (sunucu yapılandırması eksik). Atlas ekibine haber verin." }));
    }
    var connected = r.data.channels.filter(function(v){ return v.status === "connected"; }).length;
    wrap.appendChild(ui.el("p", { class: "notice info", text: connected
     ? connected + " kanal bağlı. Müşterileriniz bu kanallardan yazdığında asistan 7/24 cevaplar."
     : (embedded ? "Asistanınızın hangi kanallardan cevap vereceğini seçin. WhatsApp'ı tek tıkla bağlayabilirsiniz." : "Asistanınızın hangi kanallardan cevap vereceğini seçin. En hızlısı Telegram; WhatsApp ve Instagram için Meta uygulaması gerekir.") }));
    var grid = ui.el("div", { class: "ch-grid" });
    r.data.channels.forEach(function(v){ if (CHANNELS[v.channel]) grid.appendChild(card(v, r.data.canManage, load)); });
    wrap.appendChild(grid);
   });
  }
  load();
 }

 window.ATLAS_CHANNELS = { mount: mount };
})();
