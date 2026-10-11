// CyberLion AI — FCM jetonunu sunucuya kaydeden servis.
//
// Sunucu sözleşmesi (bu depodaki api/device-token.js):
//
//   POST   /api/device-token   { "token": "<fcm>", "platform": "android|ios|web" }
//   DELETE /api/device-token   { "token": "<fcm>" }
//   Authorization: Bearer <supabase access_token>
//   Content-Type: application/json
//
//   200 { ok: true, platform }      kaydedildi
//   200 { ok: true, removed }       silindi
//   400 { error: bad_token }        jeton 20 karakterden kısa / 4096'dan uzun
//   401 { error: unauthorized }     oturum yok ya da belirteç geçersiz
//   429 { error: rate_limited }     saatte 20 istek sınırı
//   503 { error: ... }              sunucu tarafı geçici
//
// ÜÇ KURAL — bunlar bilinçli ve bozulmamalı:
//
//   1. JETON LOGLANMIYOR. Bir FCM kayıt jetonu o cihaza bildirim gönderme
//      YETKİSİDİR. Log satırına düşen bir jeton, log toplayan her yere
//      kopyalanır. Bu dosyadaki hiçbir print/debugPrint jetonu basmıyor;
//      sunucu tarafında da aynı kural geçerli (api/device-token.js).
//   2. SAHİBİ SUNUCU BELİRLİYOR. Gövdede kullanıcı kimliği YOK; sunucu
//      sahibi Authorization başlığındaki oturumdan okuyor. Gövdeye bir
//      userId eklemek, başkasının hesabına cihaz bağlama yolu açardı.
//   3. ERİŞİM BELİRTECİ BU SERVİSTE SAKLANMIYOR. `accessToken` bir geri
//      çağrı: her istekte uygulamanın oturum katmanından (Supabase SDK)
//      tazesi isteniyor. Servis onu bir alanda tutmuyor.
//
// Bağımlılıklar: firebase_core, firebase_messaging, http (pubspec örneği
// ../../pubspec.example.yaml).

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show debugPrint, kIsWeb;
import 'package:http/http.dart' as http;

/// Sunucu adresi. Üretim varsayılan; başka ortam için derlerken
/// `--dart-define=CL_API_BASE=https://...` verilir.
const String kApiBase = String.fromEnvironment(
  'CL_API_BASE',
  defaultValue: 'https://www.cyberlionai.com',
);

/// Web'de FCM anahtarı gerekiyor: `--dart-define=CL_VAPID_KEY=...`.
/// Boşsa web'de jeton istenmez (sessiz başarısızlık yerine açık atlama).
const String kVapidKey = String.fromEnvironment('CL_VAPID_KEY', defaultValue: '');

/// Sunucunun kabul ettiği alt sınır (api/_lib/fcm.js: MIN_TOKEN_LENGTH).
const int kMinTokenLength = 20;

enum PushRegistrationResult { kaydedildi, izinYok, oturumYok, jetonYok, hata }

class PushTokenService {
  PushTokenService({
    required this.accessToken,
    FirebaseMessaging? messaging,
    http.Client? client,
    this.apiBase = kApiBase,
  })  : _messaging = messaging ?? FirebaseMessaging.instance,
        _client = client ?? http.Client();

  /// Geçerli Supabase erişim belirtecini döndürür; oturum yoksa null.
  /// Örnek: `() async => Supabase.instance.client.auth.currentSession?.accessToken`
  final Future<String?> Function() accessToken;

  final String apiBase;
  final FirebaseMessaging _messaging;
  final http.Client _client;

  StreamSubscription<String>? _refreshAbonesi;
  String? _sonGonderilen; // yalnızca gereksiz tekrarları atlamak için

  /// Uygulama açılışında bir kez çağrılır: izin ister, jetonu alır, kaydeder
  /// ve jeton yenilendiğinde yeniden kaydetmek üzere dinlemeye başlar.
  Future<PushRegistrationResult> baslat() async {
    _refreshAbonesi ??= _messaging.onTokenRefresh.listen(
      (yeni) {
        // Yenilenen jeton hemen kaydedilir; eski jeton FCM tarafında ölür ve
        // sunucu ilk başarısız gönderimde onu kendisi düşürür.
        _kaydet(yeni);
      },
      onError: (_) => debugPrint('push: jeton yenileme akışı hata verdi'),
    );

    final izin = await _izinIste();
    if (!izin) return PushRegistrationResult.izinYok;

    final jeton = await _jetonAl();
    if (jeton == null) return PushRegistrationResult.jetonYok;

    return _kaydet(jeton);
  }

  /// Çıkışta çağrılır: cihazı hesaptan ayırır. Oturum HENÜZ KAPATILMAMIŞKEN
  /// çağrılmalı — sunucu isteği oturumla yetkilendiriyor, belirteç gidince
  /// 401 döner ve cihaz hesapta kalır.
  Future<bool> cikistaSil() async {
    final jeton = await _jetonAl();
    if (jeton == null) return false;
    final belirtec = await accessToken();
    if (belirtec == null || belirtec.isEmpty) {
      debugPrint('push: çıkışta oturum yok, cihaz kaydı silinemedi');
      return false;
    }
    final yanit = await _istek('DELETE', jeton, belirtec);
    _sonGonderilen = null;
    if (yanit == null) return false;
    if (yanit.statusCode == 200) {
      debugPrint('push: cihaz kaydı silindi');
      return true;
    }
    debugPrint('push: silme başarısız (HTTP ${yanit.statusCode} ${_kod(yanit)})');
    return false;
  }

  /// Dinleyiciyi bırakır. Jeton kaydını SİLMEZ — silmek için cikistaSil().
  void kapat() {
    _refreshAbonesi?.cancel();
    _refreshAbonesi = null;
  }

  // ---------------------------------------------------------------- iç kısım

  Future<bool> _izinIste() async {
    try {
      final ayar = await _messaging.requestPermission();
      final durum = ayar.authorizationStatus;
      final verildi = durum == AuthorizationStatus.authorized ||
          durum == AuthorizationStatus.provisional;
      if (!verildi) debugPrint('push: bildirim izni verilmedi ($durum)');
      return verildi;
    } catch (e) {
      debugPrint('push: izin istenirken hata');
      return false;
    }
  }

  Future<String?> _jetonAl() async {
    if (kIsWeb && kVapidKey.isEmpty) {
      debugPrint('push: web için CL_VAPID_KEY tanımlı değil, jeton istenmedi');
      return null;
    }
    try {
      final jeton = kIsWeb
          ? await _messaging.getToken(vapidKey: kVapidKey)
          : await _messaging.getToken();
      if (jeton == null || jeton.length < kMinTokenLength) {
        // Uzunluk burada da bakılıyor: sunucu 400 döndüğünde sebebi
        // anlamak için bir tur ağ beklemek gereksiz.
        debugPrint('push: FCM jetonu alınamadı ya da beklenenden kısa');
        return null;
      }
      return jeton;
    } catch (e) {
      debugPrint('push: FCM jetonu alınırken hata');
      return null;
    }
  }

  String get _platform {
    if (kIsWeb) return 'web';
    if (Platform.isIOS || Platform.isMacOS) return 'ios';
    return 'android';
  }

  Future<PushRegistrationResult> _kaydet(String jeton) async {
    if (jeton == _sonGonderilen) return PushRegistrationResult.kaydedildi;

    final belirtec = await accessToken();
    if (belirtec == null || belirtec.isEmpty) {
      // Oturum açılmadan jeton kaydetmenin anlamı yok: bildirim hesaba
      // bağlı. Kullanıcı giriş yaptığında baslat() yeniden çağrılır.
      debugPrint('push: oturum yok, jeton kaydı atlandı');
      return PushRegistrationResult.oturumYok;
    }

    final yanit = await _istek('POST', jeton, belirtec);
    if (yanit == null) return PushRegistrationResult.hata;

    if (yanit.statusCode == 200) {
      _sonGonderilen = jeton;
      debugPrint('push: jeton kaydedildi (platform: $_platform)');
      return PushRegistrationResult.kaydedildi;
    }
    if (yanit.statusCode == 401) {
      // Belirteç dolmuş olabilir. Sunucu mobilde yenileme yapmıyor; oturumu
      // uygulama tazeleyip baslat()'ı yeniden çağırır.
      debugPrint('push: yetki reddedildi, oturum tazelenmeli');
      return PushRegistrationResult.oturumYok;
    }
    debugPrint('push: kayıt başarısız (HTTP ${yanit.statusCode} ${_kod(yanit)})');
    return PushRegistrationResult.hata;
  }

  /// Tek bir istek, bir kez yeniden deneme ile. Yeniden deneme YALNIZCA ağ
  /// hatası ve 5xx için: 400/401/429'u tekrar denemek ne sonucu değiştirir ne
  /// de hız sınırına yardım eder.
  Future<http.Response?> _istek(String yontem, String jeton, String belirtec) async {
    final adres = Uri.parse('$apiBase/api/device-token');
    final basliklar = {
      'Authorization': 'Bearer $belirtec',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    final govde = yontem == 'DELETE'
        ? jsonEncode({'token': jeton})
        : jsonEncode({'token': jeton, 'platform': _platform});

    for (var deneme = 0; deneme < 2; deneme++) {
      if (deneme > 0) await Future<void>.delayed(const Duration(seconds: 2));
      try {
        final istek = http.Request(yontem, adres)
          ..headers.addAll(basliklar)
          ..body = govde;
        final akis = await _client.send(istek).timeout(const Duration(seconds: 15));
        final yanit = await http.Response.fromStream(akis);
        if (yanit.statusCode >= 500 && deneme == 0) continue;
        return yanit;
      } on TimeoutException {
        debugPrint('push: istek zaman aşımına uğradı (deneme ${deneme + 1})');
      } catch (e) {
        // Hata metni ADRESİ taşıyabilir ama jetonu taşımaz (jeton gövdede).
        debugPrint('push: ağ hatası (deneme ${deneme + 1})');
      }
    }
    return null;
  }

  /// Sunucunun hata kodunu okur. Gövde JSON değilse boş döner — ham gövdeyi
  /// loga basmıyoruz, içinde ne olduğunu garanti edemeyiz.
  String _kod(http.Response yanit) {
    try {
      final j = jsonDecode(yanit.body);
      if (j is Map && j['error'] is Map && j['error']['code'] is String) {
        return j['error']['code'] as String;
      }
    } catch (_) {/* yut */}
    return '';
  }
}
