# Reptrio PWA/backend bilgisayarsız deploy akışı

Bu repo GitHub ve Cloudflare merkezli çalışır:

- Kod kaynağı: https://github.com/atacell85-cloud/a2-workout-pwa
- Canlı Worker/PWA: https://a2-workout.antrenmankocu.workers.dev
- Manuel deploy: GitHub Actions > Worker Deploy > Run workflow

## Telefondayken deploy başlatma

1. GitHub mobil uygulamasını veya tarayıcıyı aç.
2. `atacell85-cloud/a2-workout-pwa` reposuna gir.
3. `Actions` sekmesini aç.
4. `Worker Deploy` workflow'unu seç.
5. `Run workflow` de.
6. Workflow önce testleri çalıştırır, sonra Cloudflare Worker'ı deploy eder.

## Gerekli GitHub secret

Repo ayarlarına şu secret eklenmeli:

- `CLOUDFLARE_API_TOKEN`

Token Cloudflare dashboard'da oluşturulur. Minimum pratik yetkiler:

- Workers Scripts edit
- D1 edit
- Account resources erişimi

Mevcut secret'lar uygulama koduna yazılmaz; Cloudflare tarafında kalır.

## D1 migration notu

Yeni veritabanı migration'ı eklendiğinde GitHub Action şu an otomatik migration uygulamaz.
Migration gerektiren değişikliklerde önce migration uygulanmalı, sonra deploy yapılmalı.
