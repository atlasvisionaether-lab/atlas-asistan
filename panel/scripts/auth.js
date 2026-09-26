// panel/scripts/auth.js
// Supabase auth gate: oturum aç/kapat, oturumu geri yükle, panele erişimi denetle.
// ui.js global'ine BAĞIMLI DEĞİL (adını bilmiyoruz) — DOM'u doğrudan yönetir.
// store.js'e BU commit'te YAZMIYORUZ: set() render tetiklediği için login'de panel
// flash'ı olurdu; oturum bilgisini window.atlasUser global'inde tutuyoruz.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.ATLAS_SUPABASE_CONFIG || {};
const main = document.getElementById("main");

let supabase = null;

function clearMain() { while (main.firstChild) main.removeChild(main.firstChild); }

function renderConfigError() {
  clearMain();
  const box = document.createElement("section");
  box.className = "auth-gate auth-error";
  box.innerHTML =
    '<h2>Yapılandırma eksik</h2>' +
    '<p>Supabase bağlantısı tanımlı değil. <code>panel/scripts/supabase-config.js</code> ' +
    'içindeki <code>url</code> ve <code>anonKey</code> alanlarını doldurun.</p>';
  main.appendChild(box);
}

function renderLogin() {
  clearMain();
  const box = document.createElement("section");
  box.className = "auth-gate";
  box.innerHTML =
    '<h2>Atlas Asistan</h2>' +
    '<p>Kliniğinize giriş yapın.</p>' +
    '<form id="login-form" autocomplete="on">' +
      '<label>E-posta<input id="login-email" type="email" required autocomplete="email"></label>' +
      '<label>Şifre<input id="login-password" type="password" required autocomplete="current-password"></label>' +
      '<button type="submit">Giriş Yap</button>' +
      '<p id="login-error" class="auth-error-text" role="alert"></p>' +
    '</form>';
  main.appendChild(box);

  const form = box.querySelector("#login-form");
  const errEl = box.querySelector("#login-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const email = box.querySelector("#login-email").value.trim();
    const password = box.querySelector("#login-password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // Başarıda onAuthStateChange (SIGNED_IN) gate'i panele çevirir; burada ek çağrı yok.
    if (error) errEl.textContent = "Giriş başarısız: " + error.message;
  });
}

function boot() {
  if (!cfg.url || !cfg.anonKey) { renderConfigError(); return; }
  supabase = createClient(cfg.url, cfg.anonKey);
  // onAuthStateChange subscribe anında INITIAL_SESSION fırlatır → başlangıç kararı burada,
  // sonraki giriş/çıkış/refresh değişimleri de burada. Tek kaynak, getSession'e gerek yok.
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      window.atlasUser = session.user;          // store'a YAZMIYORUZ (render flash önleme)
      if (typeof window.atlasBoot === "function") window.atlasBoot();
    } else {
      window.atlasUser = null;
      renderLogin();
    }
  });
}

// Logout UI butonu 5.2.2'de sidebar'a eklenecek; şimdilik global hazır.
window.atlasSignOut = async () => { if (supabase) await supabase.auth.signOut(); };

boot();
