# Reptrio Apple login setup

Apple login backend kodu hazırdır. Canlıda aktif olması için Apple Developer tarafında Sign in with Apple yapılandırması ve Cloudflare Worker secret'ları gerekir.

## Apple Developer tarafı

1. App ID `com.reptrio.mobile` için **Sign in with Apple** capability açık olmalı.
2. Bir Services ID oluşturulmalı. Önerilen identifier:

   `com.reptrio.web.signin`

3. Services ID içinde Sign in with Apple etkinleştirilmeli ve primary App ID olarak `com.reptrio.mobile` seçilmeli.
4. Return URL olarak şu adres eklenmeli:

   `https://api.reptrio.com/api/auth/oauth/apple/callback`

5. Sign in with Apple için private key oluşturulmalı ve `.p8` dosyası yalnız güvenli yerde saklanmalı.

## Cloudflare Worker secret'ları

Secret değerleri terminale veya repoya yazılmamalı. `wrangler secret put` ile girilmeli:

```powershell
npx wrangler secret put APPLE_OAUTH_CLIENT_ID
npx wrangler secret put APPLE_OAUTH_TEAM_ID
npx wrangler secret put APPLE_OAUTH_KEY_ID
npx wrangler secret put APPLE_OAUTH_PRIVATE_KEY
```

Beklenen değerler:

- `APPLE_OAUTH_CLIENT_ID`: Services ID, örn. `com.reptrio.web.signin`
- `APPLE_OAUTH_TEAM_ID`: Apple Developer Team ID, Reptrio için `C4P47F32C8`
- `APPLE_OAUTH_KEY_ID`: Apple Sign in with Apple key id
- `APPLE_OAUTH_PRIVATE_KEY`: `.p8` dosyasının tamamı, BEGIN/END satırları dahil

## Doğrulama

Canlı Worker deploy edildikten ve secret'lar girildikten sonra:

```powershell
npx wrangler secret list
```

Listede Apple secret isimleri görünmelidir. Değerler görünmez.

Mobil uygulama `/api/auth/providers` endpoint'ini okuyarak Apple'ın hazır olup olmadığını anlar. Apple secret'ları eksikken buton kullanıcıyı kör OAuth hatasına sokmaz; secret'lar tamamlandığında Apple giriş yolu aktifleşir.
