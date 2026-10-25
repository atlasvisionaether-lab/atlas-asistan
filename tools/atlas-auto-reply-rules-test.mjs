/**
 * Otomatik cevabın karşılama / mesai dışı kuralları (supabase/functions/atlas-auto-reply/rules.ts).
 *
 *   node tools/atlas-auto-reply-rules-test.mjs
 *
 * Node 22.18+ TypeScript türlerini atarak .ts'yi doğrudan yükler.
 */
import { afterHoursText, greetingText, isPureGreeting, greetedNote } from '../supabase/functions/atlas-auto-reply/rules.ts';

let hata = 0;
function sina(ad, bulunan, beklenen) {
  const ok = JSON.stringify(bulunan) === JSON.stringify(beklenen);
  if (!ok) hata++;
  console.log((ok ? 'ok   ' : 'HATA ') + ad + (ok ? '' : ' — bulunan ' + JSON.stringify(bulunan) + ', beklenen ' + JSON.stringify(beklenen)));
}

sina('mesai dışı: önce after_hours_message', afterHoursText({ after_hours_message: ' Kapalıyız ', fallback_message: 'FB' }), 'Kapalıyız');
sina('mesai dışı: boşsa fallback', afterHoursText({ after_hours_message: '  ', fallback_message: 'FB' }), 'FB');
sina('mesai dışı: null ise fallback', afterHoursText({ after_hours_message: null, fallback_message: 'FB' }), 'FB');
sina('mesai dışı: ikisi de boş → gönderilmez', afterHoursText({ after_hours_message: '', fallback_message: '' }), '');
sina('mesai dışı: ayar yok → gönderilmez', afterHoursText(null), '');

sina('karşılama metni', greetingText({ greeting_message: ' Hoş geldiniz! ' }), 'Hoş geldiniz!');
sina('karşılama boş → gönderilmez', greetingText({ greeting_message: '   ' }), '');
sina('karşılama: ayar yok → gönderilmez', greetingText(null), '');

for (const m of ['Merhaba', 'merhaba!!', 'MERHABA', 'Slm', 'selam 👋', 'İyi akşamlar', 'iyi günler.', 'Günaydın', 'sa', 'Merhaba kolay gelsin', 'hello']) {
  sina('yalnız selam: ' + m, isPureGreeting(m), true);
}
for (const m of ['Merhaba, lazer ne kadar?', 'selam randevu almak istiyorum', 'Fiyat?', '', null, '👋', 'merhabalar botoks var mı']) {
  sina('soru/boş (selam değil): ' + JSON.stringify(m), isPureGreeting(m), false);
}

const not = greetedNote('Hoş geldiniz!');
sina('AI notu: karşılama metni geçiyor', not.includes('"Hoş geldiniz!"'), true);
sina('AI notu: tekrar selamlama yasağı', /Tekrar selamlama/.test(not), true);

console.log(hata ? '\n' + hata + ' sınama BAŞARISIZ' : '\nTümü geçti');
process.exit(hata ? 1 : 0);
