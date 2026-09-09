'use strict';

/**
 * Sınır değerleri tek yerde.
 *
 * Kota hem tarama ucunda hem de anonim geçmişi hesaba devreden akışta
 * kullanılıyor. İki yerde ayrı sabit tutmak, biri değiştiğinde diğerinin
 * sessizce eski değerde kalması demekti.
 */
module.exports = {
  /** Hesap veya anonim oturum başına ücretsiz tarama. */
  FREE_SCAN_LIMIT: 5,

  /** Kota sayacının yaşam süresi. */
  QUOTA_TTL_SECONDS: 60 * 60 * 24 * 365,

  /** IP hız sınırı: pencere ve pencere başına istek. */
  RATE_WINDOW_SECONDS: 10 * 60,
  RATE_MAX: 12
};
