# A2 Antrenman Takip PWA

iPhone Safari'de ana ekrana eklenebilen, offline çalışan, local-first A2 antrenman takip uygulaması.

## Lokal çalıştırma

Bu klasörde statik sunucu aç:

```bash
python -m http.server 8080
```

Tarayıcıda aç:

```text
http://localhost:8080
```

## iPhone Safari'den açma

PWA ve service worker için yayın adresi HTTPS olmalıdır. GitHub Pages, Cloudflare Pages veya Netlify uygundur.

1. HTTPS yayın adresini iPhone Safari'de aç.
2. Sayfa bir kez tamamen yüklensin.
3. Paylaş butonuna bas.
4. Ana Ekrana Ekle seçeneğini seç.
5. A2 Antrenman ikonundan aç.

Ana ekrandan açıldığında `standalone` modda çalışır. İlk başarılı yüklemeden sonra uygulama kabuğu cache'lenir ve temel antrenman/log ekranları offline açılır.

## GitHub Pages deployment

Repository GitHub'a yüklendikten sonra:

1. GitHub'da repository sayfasını aç.
2. Settings -> Pages bölümüne git.
3. Source olarak GitHub Actions seç.
4. Bu projedeki `.github/workflows/pages.yml` workflow dosyasını push et.
5. Actions tamamlanınca Pages URL'sini aç.

Yeni sürüm deploy etmek için dosyaları commit edip default branch'e push etmek yeterlidir. Service worker cache adı `sw.js` içinde değiştiği için yeni sürüm kullanıcı cihazında aktivasyonda eski cache'i temizler.

## Veri ve yedek

Ana veri IndexedDB içinde cihazda saklanır. UI doğrudan IndexedDB çağırmaz; storage erişimi `storage.js` içindeki repository katmanından yapılır.

JSON export tam yedektir ve şunları içerir:

- `schemaVersion`
- `exportedAt`
- uygulama/program bilgileri
- ayarlar
- session kayıtları
- set kayıtları

CSV export set bazlı log verir. Düzenli JSON yedek almak önerilir.

## Future Commercial Architecture

Mevcut yapı local-first ve backend'sizdir. İleride ticari ürüne dönüşürse aynı veri modeli korunarak storage repository katmanı REST API, Supabase veya başka bir cloud database adaptörüyle değiştirilebilir. `Program -> Workout Day -> Exercise -> Set Prescription` modeli çoklu program ve program builder için genişletilebilir. `WorkoutSession` ve `WorkoutSet` şeması authentication, multi-device sync, coach features, analytics ve subscription gibi alanlara backend tarafında bağlanabilir. Bu özellikler v1 kapsamına dahil değildir.

## Kapsam dışı

Kullanıcı hesabı, cloud sync, ödeme, abonelik, Apple Health, AI koç, sosyal özellikler ve backend bu v1 içinde yoktur.
