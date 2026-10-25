// panel/scripts/auth.js
// Supabase auth gate: giriş, self-servis kayıt, şifremi unuttum, şifre yenileme.
// ui.js global'ine BAĞIMLI DEĞİL — DOM'u doğrudan yönetir.
// store.js'e YAZMIYORUZ: set() render tetiklediği için login'de panel
// flash'ı olurdu; oturum bilgisini window.atlasUser / window.atlasOrgId
// global'lerinde tutuyoruz.
//
// Kayıt: signUp (klinik adı user_metadata'da) → ilk oturumda
// atlas_claim_clinic RPC'si kurumu + 'owner' kullanıcıyı açar (bkz.
// supabase/migrations/0017_self_signup.sql). Kurulumu bitmemiş kullanıcı
// #onboarding'e gider.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.ATLAS_SUPABASE_CONFIG || {};
const main = document.getElementById("main");
const LEGAL = "https://atlasasistan.com/pages/";

let supabase = null;
let bootedFor = null;     // aynı kullanıcı için TOKEN_REFRESHED'de paneli yeniden kurma
let recovering = false;   // şifre yenileme bağlantısıyla gelindi

function setSignoutVisible(on) {
  const b = document.getElementById("signout");
  if (b) b.hidden = !on;
}

function clearMain() { while (main.firstChild) main.removeChild(main.firstChild); }

function gate(html) {
  clearMain();
  const box = document.createElement("section");
  box.className = "auth-gate";
  box.innerHTML = html;
  main.appendChild(box);
  return box;
}

/** Supabase hata mesajını kullanıcıya gösterilecek Türkçe metne çevirir. */
function trError(error) {
  const m = String((error && error.message) || "");
  if (/invalid login credentials/i.test(m)) return "E-posta veya şifre hatalı.";
  if (/email not confirmed/i.test(m)) return "E-postanızı henüz doğrulamadınız. Gelen kutunuzdaki bağlantıya tıklayın.";
  if (/already registered|already been registered/i.test(m)) return "Bu e-postayla bir hesap zaten var. Giriş yapın ya da şifrenizi sıfırlayın.";
  if (/password should be at least|weak password/i.test(m)) return "Şifre en az 8 karakter olmalı.";
  if (/rate limit|too many/i.test(m)) return "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.";
  if (/clinic_name_invalid/.test(m)) return "Klinik adı 2–80 karakter olmalı.";
  return "İşlem tamamlanamadı: " + m;
}

function bindForm(box, id, handler) {
  const form = box.querySelector(id);
  const errEl = form.querySelector(".auth-error-text");
  const btn = form.querySelector("button[type=submit]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    btn.disabled = true;
    try { await handler(form, errEl); }
    catch (err) { errEl.textContent = trError(err); }
    finally { btn.disabled = false; }
  });
}

function val(form, sel) { return form.querySelector(sel).value.trim(); }

function renderConfigError() {
  gate('<h2>Yapılandırma eksik</h2>' +
    '<p>Supabase bağlantısı tanımlı değil. <code>panel/scripts/supabase-config.js</code> ' +
    'içindeki <code>url</code> ve <code>anonKey</code> alanlarını doldurun.</p>').classList.add("auth-error");
}

function renderLogin(notice) {
  const box = gate(
    '<h2>Atlas Asistan</h2>' +
    '<p>Kliniğinize giriş yapın.</p>' +
    '<p class="notice info" hidden></p>' +
    '<form id="login-form" autocomplete="on">' +
      '<label>E-posta<input id="login-email" type="email" required autocomplete="email"></label>' +
      '<label>Şifre<input id="login-password" type="password" required autocomplete="current-password"></label>' +
      '<button class="btn" type="submit">Giriş Yap</button>' +
      '<p class="auth-error-text" role="alert"></p>' +
    '</form>' +
    '<p class="auth-links"><a href="#" data-go="forgot">Şifremi unuttum</a> · ' +
    '<a href="#" data-go="signup">Hesabınız yok mu? Kayıt olun</a></p>');
  showNotice(box, notice);
  bindLinks(box);
  bindForm(box, "#login-form", async (form) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: val(form, "#login-email"), password: form.querySelector("#login-password").value
    });
    // Başarıda onAuthStateChange (SIGNED_IN) gate'i panele çevirir.
    if (error) throw error;
  });
}

function renderSignup() {
  const box = gate(
    '<h2>Hesap oluşturun</h2>' +
    '<p>Asistanınızı birkaç adımda kendiniz kurun.</p>' +
    '<form id="signup-form" autocomplete="on">' +
      '<label>Klinik adı<input id="su-clinic" type="text" required minlength="2" maxlength="80" autocomplete="organization"></label>' +
      '<label>Adınız soyadınız<input id="su-name" type="text" maxlength="80" autocomplete="name"></label>' +
      '<label>E-posta<input id="su-email" type="email" required autocomplete="email"></label>' +
      '<label>Şifre (en az 8 karakter)<input id="su-password" type="password" required minlength="8" autocomplete="new-password"></label>' +
      '<label class="auth-check"><input id="su-terms" type="checkbox" required> ' +
        '<span><a href="' + LEGAL + 'kullanim-sartlari" target="_blank" rel="noopener">Kullanım şartlarını</a> kabul ediyorum; ' +
        '<a href="' + LEGAL + 'kvkk-aydinlatma-metni" target="_blank" rel="noopener">KVKK aydınlatma metnini</a> okudum.</span></label>' +
      '<button class="btn" type="submit">Kayıt Ol ve Devam Et</button>' +
      '<p class="auth-error-text" role="alert"></p>' +
    '</form>' +
    '<p class="auth-links"><a href="#" data-go="login">Zaten hesabınız var mı? Giriş yapın</a></p>');
  bindLinks(box);
  bindForm(box, "#signup-form", async (form) => {
    const clinic = val(form, "#su-clinic");
    if (clinic.length < 2) throw new Error("clinic_name_invalid");
    const { data, error } = await supabase.auth.signUp({
      email: val(form, "#su-email"),
      password: form.querySelector("#su-password").value,
      options: {
        data: { clinic_name: clinic, full_name: val(form, "#su-name") },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
    // E-posta doğrulaması açıksa oturum gelmez; doğrulamadan sonra ilk girişte kurum açılır.
    if (!data.session) renderLogin("Doğrulama bağlantısını e-postanıza gönderdik. Bağlantıya tıkladıktan sonra giriş yapın.");
  });
}

function renderForgot() {
  const box = gate(
    '<h2>Şifremi unuttum</h2>' +
    '<p>E-postanızı yazın; şifre yenileme bağlantısı gönderelim.</p>' +
    '<form id="forgot-form">' +
      '<label>E-posta<input id="fg-email" type="email" required autocomplete="email"></label>' +
      '<button class="btn" type="submit">Bağlantı Gönder</button>' +
      '<p class="auth-error-text" role="alert"></p>' +
    '</form>' +
    '<p class="auth-links"><a href="#" data-go="login">Girişe dön</a></p>');
  bindLinks(box);
  bindForm(box, "#forgot-form", async (form) => {
    const { error } = await supabase.auth.resetPasswordForEmail(val(form, "#fg-email"), {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
    // Hesap olsun olmasın aynı mesaj: e-postanın kayıtlı olup olmadığı sızmaz.
    renderLogin("Bu e-postayla bir hesap varsa yenileme bağlantısı gönderildi.");
  });
}

function renderNewPassword() {
  const box = gate(
    '<h2>Yeni şifre belirleyin</h2>' +
    '<form id="reset-form">' +
      '<label>Yeni şifre (en az 8 karakter)<input id="rs-password" type="password" required minlength="8" autocomplete="new-password"></label>' +
      '<button class="btn" type="submit">Şifreyi Kaydet</button>' +
      '<p class="auth-error-text" role="alert"></p>' +
    '</form>');
  bindForm(box, "#reset-form", async (form) => {
    const { error } = await supabase.auth.updateUser({ password: form.querySelector("#rs-password").value });
    if (error) throw error;
    recovering = false;
    const { data } = await supabase.auth.getSession();
    if (data.session) enterPanel(data.session); else renderLogin("Şifreniz güncellendi. Giriş yapabilirsiniz.");
  });
}

/** Eski hesapta kurum yoksa ve kayıtta klinik adı verilmemişse sorulur. */
function renderClaim(session) {
  const box = gate(
    '<h2>Kliniğinizi tanımlayın</h2>' +
    '<p>Hesabınız bir kliniğe bağlı değil. Klinik adını yazın, panelinizi açalım.</p>' +
    '<form id="claim-form">' +
      '<label>Klinik adı<input id="cl-clinic" type="text" required minlength="2" maxlength="80" autocomplete="organization"></label>' +
      '<button class="btn" type="submit">Devam Et</button>' +
      '<p class="auth-error-text" role="alert"></p>' +
    '</form>');
  bindForm(box, "#claim-form", async (form) => {
    await claimAndBoot(session, val(form, "#cl-clinic"));
  });
}

function showNotice(box, text) {
  const n = box.querySelector(".notice");
  if (n && text) { n.textContent = text; n.hidden = false; }
}

function bindLinks(box) {
  box.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const go = a.getAttribute("data-go");
    if (go === "signup") renderSignup(); else if (go === "forgot") renderForgot(); else renderLogin();
  }));
}

async function claimAndBoot(session, clinicName) {
  const { data, error } = await supabase.rpc("atlas_claim_clinic", { p_clinic_name: clinicName || "" });
  if (error) throw error;
  window.atlasOrgId = data;
  window.atlasUser = session.user;
  setSignoutVisible(true);
  bootedFor = session.user.id;
  const status = await supabase.rpc("atlas_onboarding_status");
  const s = status.data && status.data[0];
  const done = s && s.info && s.payment && s.whatsapp && s.test;
  // Doğrulama dönüşünde hash'te jeton parçası (access_token=…) kalabilir: ekran adı değil.
  // #signup: atlasasistan.com/checkout'taki "Kayıt Ol ve Devam Et" bağlantısı.
  const h = location.hash.slice(1);
  if (!done && (!h || h === "signup" || h.indexOf("=") !== -1)) {
    // Sitede paket seçilip gelindiyse ve ödeme yoksa doğrudan ödeme adımı.
    const plan = window.ATLAS_CHECKOUT && window.ATLAS_CHECKOUT.storedPlan();
    location.hash = s && !s.payment && plan ? "#odeme" : "#onboarding";
  }
  if (typeof window.atlasBoot === "function") window.atlasBoot();
}

async function enterPanel(session) {
  if (bootedFor === session.user.id) { window.atlasUser = session.user; return; }
  const meta = session.user.user_metadata || {};
  try {
    await claimAndBoot(session, meta.clinic_name);
  } catch (err) {
    if (/clinic_name_invalid/.test(String(err && err.message))) renderClaim(session);
    else gate('<h2>Panel açılamadı</h2><p class="auth-error-text"></p>').querySelector("p").textContent = trError(err);
  }
}

function resolveSupabaseUrl(url) {
  // supabase-js constructor URL'yi /^https?:\/\//i ile doğrular; göreli bir yol
  // ("/api/supabase") senkron olarak throw eder. Reverse-proxy niyetini korumak için
  // göreli URL'yi deployment origin'i ile mutlak hale getiriyoruz.
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, window.location.origin).href;
}

function boot() {
  if (!cfg.url || !cfg.anonKey) { renderConfigError(); return; }
  supabase = createClient(resolveSupabaseUrl(cfg.url), cfg.anonKey);
  window.ATLAS_SUPABASE = supabase;   // Gelen Kutusu gibi sayfaların erişimi için
  // onAuthStateChange subscribe anında INITIAL_SESSION fırlatır → başlangıç kararı burada.
  // Callback içinde başka supabase çağrısı await edilirse supabase-js kilitlenebilir;
  // bu yüzden işler setTimeout ile callback dışına alınıyor.
  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { recovering = true; renderNewPassword(); return; }
      if (recovering) return;
      if (session) enterPanel(session);
      else {
        window.atlasUser = null;
        window.atlasOrgId = null;
        bootedFor = null;
        setSignoutVisible(false);
        if (location.hash === "#signup") renderSignup(); else renderLogin();
      }
    }, 0);
  });
}

window.atlasSignOut = async () => { if (supabase) await supabase.auth.signOut(); };

boot();
