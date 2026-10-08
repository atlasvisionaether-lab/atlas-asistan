# Mobil bildirim istemcisi (Flutter)

`POST /api/device-token` ile cihazın FCM jetonunu hesaba bağlayan parça.
WORKFLOW 4'ün (bkz. `../../docs/notifications.md`) eksik olan son halkası:
sunucu bildirimi gönderebiliyor, gönderecek bir adres olması bu koda bağlı.

## Bu dizin bir uygulama değil

Depoda mobil uygulama YOK ve bu kapta Android/iOS SDK'sı da yok, yani bu kod
burada derlenip çalıştırılamadı. Buradaki iki dosya bir uygulamaya kopyalanmak
üzere duruyor:

| Dosya | Nereye |
| --- | --- |
| `lib/services/push_token_service.dart` | uygulamanın `lib/services/` dizini |
| `pubspec.example.yaml` | üç bağımlılık satırı uygulamanın `pubspec.yaml`'ına |

Sunucu sözleşmesinin doğruluğu derlemeye bağlı değil ve sınanıyor:
`node tools/devicetoken-mobile-test.js` bu Dart dosyasından adresi, başlıkları
ve gövde alanlarını okuyup GERÇEK `api/device-token.js` ucuna aynı isteği
geçiriyor. Yani "istemci ile sunucu aynı şeyi konuşuyor" iddiası sınanmış;
"uygulama derleniyor" iddiası sınanmamış.

## Bağlama

```dart
// main.dart
await Firebase.initializeApp();

final push = PushTokenService(
  // Belirteç her istekte buradan tazesi istenerek alınıyor; servis saklamıyor.
  accessToken: () async =>
      Supabase.instance.client.auth.currentSession?.accessToken,
);

// Oturum açıkken çağrılır: izin ister, jetonu alır, kaydeder ve
// onTokenRefresh'i dinlemeye başlar.
await push.baslat();
```

Giriş ekranından sonra da `baslat()` çağrılır: oturum yokken dönen sonuç
`PushRegistrationResult.oturumYok` ve o durumda hiçbir şey kaydedilmez.

Çıkışta, **oturumu kapatmadan önce**:

```dart
await push.cikistaSil();   // DELETE /api/device-token
await Supabase.instance.client.auth.signOut();
```

Sıra önemli: istek oturumla yetkileniyor, belirteç gittikten sonra 401 döner ve
cihaz hesapta kalır — yani kullanıcı çıktıktan sonra da bildirim alır.

## Derleme değişkenleri

```
flutter build apk \
  --dart-define=CL_API_BASE=https://www.cyberlionai.com \
  --dart-define=CL_VAPID_KEY=<yalnızca web hedefi için>
```

`CL_API_BASE` varsayılanı üretim. `CL_VAPID_KEY` yalnızca web hedefinde gerekli;
boşsa web'de jeton hiç istenmiyor (sessizce boş jeton göndermek yerine).

`NEXT_PUBLIC_*` değişkeni EKLENMEDİ: bu depoda Next.js yok, site düz HTML +
Vercel fonksiyonları. İstemci tarafı yapılandırma `--dart-define` ile geliyor,
bir `.env` dosyasıyla değil.

## Sunucu tarafında ne değişti

`/api/device-token` artık çerezin yanında `Authorization: Bearer <supabase
access_token>` da kabul ediyor. Mobilde tarayıcı çerezi kavramı yok.

Bu bir yetki atlatması değil: gelen belirteç yine GoTrue'nun
`/auth/v1/user` ucuna sorulup doğrulanıyor, yani çerez yolundaki ile aynı
kimlik denetimi işliyor. Bayrak uç uca opt-in (`{ bearerKabul: true }`) ve
YALNIZCA bu uçta açık; `_lib/auth.js`'i kullanan diğer uçların yetki yüzeyi
değişmedi. Bearer yolunda yenileme belirteci hiç okunmuyor: belirteç dolunca uç
401 döner ve oturumu uygulama kendi SDK'sı ile tazeler.

## Firebase tarafı (kullanıcıda)

1. Firebase konsolunda Android/iOS uygulamasını ekle, `google-services.json` ve
   `GoogleService-Info.plist` dosyalarını projeye koy.
2. iOS için APNs anahtarını Firebase'e yükle — yoksa iOS'ta jeton gelmez.
3. Sunucu tarafındaki `FIREBASE_SERVICE_ACCOUNT` aynı Firebase projesinin
   servis hesabı olmalı; başka bir projenin jetonuna gönderim 404/INVALID
   döner ve sunucu o jetonu ölü sayıp düşürür.
