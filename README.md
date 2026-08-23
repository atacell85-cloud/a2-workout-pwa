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

## Commercial foundation

Programlar sekmesi yerel Program Builder v1'i içerir. Programlar cihazda saklanır;
gün, bölüm, canonical veya özel hareket, serbest metin set/tekrar ve ayrıntılı set
bilgileri desteklenir. Product decisions and canonical exercise data are governed by the repository-level `/product` Source of Truth; for exercise work use `/product/data/exercises.v1.json`. The currently bundled `data/exercises-master-v1.1.json` remains a compatibility copy pending an explicit migration.
altında 250 hareket içerir ve offline app shell'e dahildir.

AI dosya ayrıştırma/API'si henüz bağlı değildir. `import-service.js`, PDF/DOCX/XLSX
adaptörlerinin üreteceği import schema v1.1 preview'lerini doğrulamak ve kullanıcı
onayından sonra atomik/idempotent kalıcı programa dönüştürmek için hazırdır.
YouTube form videosu servis sınırı `youtube-service.js` içindedir; yalnızca sınırlı
bir `A2_YOUTUBE_API_KEY` sağlanırsa canlı arama yapar, aksi halde antrenmanı
etkilemeden unavailable durumunu gösterir.

## Dosyadan program oluşturma

Programlar ekranındaki **Dosyadan Oluştur** akışı PDF, DOCX ve XLSX dosyalarını
tarayıcı içinde işler. `document-extractor.js` dosyayı normalize block'lara çevirir,
`local-import-parser.js` sadece açıkça görülen program verisini import schema v1.1
preview'ına dönüştürür. Dosya veya içerik cihaz dışına gönderilmez. ZIP/XML tabanlı
DOCX/XLSX extraction için harici dependency eklenmedi; modern browser
`DecompressionStream` desteği gerekir. Metin katmanı olmayan taranmış PDF'ler için
OCR bu sürümün dışında tutulmuştur.

`tests/fixtures` altında gerçek text-layer PDF, Office Open XML DOCX/XLSX ve
negative fixture dosyaları bulunur. `node scripts/import-fixture-test.mjs`
komutu extraction -> local parser -> finalizer zincirini üç formatta doğrular.

## OpenAI import provider and Cloudflare pilot

`ImportParser` iki adapter sağlar: varsayılan cihaz-içi `local` ve `openai`.
OpenAI modu yalnız normalized extraction çıktısını `/api/import/parse` endpoint'ine
gönderir; binary dosya ve API key tarayıcıya gönderilmez. Production'da bu endpoint
ve PWA tek Cloudflare Worker Static Assets deployment'ında, aynı origin altında
çalışır. `OPENAI_API_KEY` Cloudflare secret binding'dir; model ve timeout/retry/input
limitleri Worker vars'larıdır. `.env.example` yerel geliştirme içindir ve gerçek
`.env` commit edilmemelidir. Structured Output sonrası
uygulama canonical hareket eşlemesini ve import doğrulamasını tekrar yapar.
Yerel Node proxy testi `node scripts/import-proxy-server.mjs` ile korunur. PWA aynı
origin altında proxy edilmiyorsa, uygulama yüklenmeden önce
`window.A2_IMPORT_PROXY_URL = 'http://localhost:8787/api/import/parse'` ve
`window.A2_IMPORT_PARSER_PROVIDER = 'openai'` ayarlanır.
Proxy varsayılan olarak 45 saniye timeout ve yalnız 429/5xx/network hatalarında
en fazla bir retry uygular. Token/latency/request ID metadata'sı response'ta
bulunur; API key veya belge içeriği loglanmaz. `node scripts/openai-live-contract-test.mjs`
yalnız API key mevcut olduğunda opt-in canlı contract testi için ayrılmıştır.

Cloudflare local runtime için `npm run cf:dev`, deploy için `npm run cf:deploy`
kullanılır. Worker `/api/health` endpoint'i sağlar ve AI import endpoint'i IP başına
dakikada dört istekle sınırlandırılır. Service worker `/api/*` cevaplarını cache'lemez;
kaydedilmiş programlar, workout ve history IndexedDB ile offline çalışmaya devam eder.
Tam operasyon adımları `CLOUDFLARE_DEPLOYMENT.md` içindedir.
