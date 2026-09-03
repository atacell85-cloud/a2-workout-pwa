# Reptrio PWA/Backend — Codex çalışma talimatı

Bu repo Reptrio web/PWA ve Cloudflare Worker backend uygulamasıdır.

Yerel ana yol: `C:\Users\selcu\OneDrive\Desktop\Reptrio\Backend`

## Ürün durumu

- Eski proje adı AKS/A2 idi; ürün markası Reptrio’dur.
- Canlı Web/PWA: `https://app.reptrio.com`
- Canlı API/backend: `https://api.reptrio.com`
- Eski Worker URL `https://a2-workout.antrenmankocu.workers.dev` yalnızca legacy fallback olarak tutulur.
- GitHub repo: `https://github.com/atacell85-cloud/a2-workout-pwa`
- Hedef repo adı: `reptrio-backend` (ayrı ve kontrollü bir GitHub rename adımı olarak ele alınmalı)
- Native mobile repo: `https://github.com/atacell85-cloud/reptrio-mobile`
- D1 database: `a2-workout-pilot`
- Import jobs queue: `a2-import-jobs`

## Kullanıcı çalışma modeli

Kullanıcı GitHub paneliyle uğraşmak istemiyor. Telefondayken de Codex ile konuşup geliştirme istemek istiyor.

Bu yüzden:

- GitHub repo ana kaynak kabul edilir.
- Kullanıcı panel/terminal adımı istemedikçe ona GitHub Actions yaptırma.
- Mümkünse değişiklikleri repo üzerinde yap, test et, commit/push et.
- Deploy gerekiyorsa Codex/CLI üzerinden tetikle.
- Kullanıcıdan secret isteme; gerekli olduğunda OAuth/browser login veya dashboard ekranında dur.

## Geliştirme kuralları

- Kullanıcı verisini silme/overwrite etme.
- D1 migration eklerken `IF NOT EXISTS` ve geriye uyumluluk tercih et.
- Migration gerektiren değişiklikleri deploy öncesi açıkça uygula.
- Session token URL query’sinde taşınmamalı.
- Native Google login için güvenli model:
  - OAuth callback kısa ömürlü tek kullanımlık mobil kod üretir.
  - Native uygulama bu kodu `/api/auth/oauth/mobile/exchange` endpoint’ine gönderir.
  - Session token sadece HTTPS JSON cevabında döner.
- YouTube aramaları İngilizce olmalı.
- AI import yalnızca program günleri, hareket sırası, set/tekrar ve açıkça anlaşılan ek alanları çıkarmalı; notları programa gereksiz doldurmamalı.
- Local parser ana kullanıcı akışı olarak geri getirilmemeli.
- Apple login backend akışı hazırdır; canlıda aktif olması için Cloudflare secret olarak `APPLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_TEAM_ID`, `APPLE_OAUTH_KEY_ID`, `APPLE_OAUTH_PRIVATE_KEY` gerekir.

## Kontrol komutları

```powershell
npm test
```

## Deploy komutları

```powershell
npm run cf:deploy
```

Migration gerekiyorsa:

```powershell
npx wrangler d1 execute a2-workout-pilot --remote --file .\migrations\<file>.sql
```

`wrangler d1 migrations apply` yetki/endpoint hatası verebilir; daha önce aynı güvenli SQL `d1 execute --file` ile uygulanmıştır.

## GitHub Actions

- `Worker CI`: test
- `Worker Deploy`: manuel test + Cloudflare deploy

`Worker Deploy` için GitHub secret gerekir:

- `CLOUDFLARE_API_TOKEN`

## Önemli dosyalar

- `worker/index.js`: Worker ana router, import jobs, YouTube proxy
- `worker/account-api.js`: auth, sync, OAuth, mobile token auth
- `APPLE_LOGIN_SETUP.md`: Apple Sign in yapılandırma ve Cloudflare secret rehberi
- `openai-import-parser.js`: AI import schema prompt
- `youtube-service.js`: PWA YouTube arama servisi
- `app.js`: PWA UI
- `sw.js`: cache version / service worker
- `data/exercises.v1.json`: canlı egzersiz veri dosyası
- `images/flat/`: egzersiz görselleri
- `migrations/`: D1 migration dosyaları

## Güncel eksikler / dikkat noktaları

- Reptrio production domainleri Cloudflare Worker custom domain olarak bağlıdır:
  - Web/PWA: `https://app.reptrio.com`
  - API/backend: `https://api.reptrio.com`
- GitHub Actions bilgisayarsız deploy için `CLOUDFLARE_API_TOKEN` secret bekler.
- Apple login, Apple Developer/App Store Connect yapılandırması sonrası ele alınmalı.
- OAuth sağlayıcı readiness endpoint'i: `/api/auth/providers`. Mobil uygulama Apple/Google buton davranışını bu endpoint'e göre ayarlamalı.
