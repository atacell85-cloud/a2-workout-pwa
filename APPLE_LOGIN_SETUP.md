# Reptrio Apple login setup

Apple login backend kodu ve canlı yapılandırması hazırdır. Apple Developer tarafında Sign in with Apple yapılandırıldı ve Cloudflare Worker secret'ları yüklendi.

## Apple Developer tarafı

1. App ID `com.reptrio.mobile` için **Sign in with Apple** capability açık.
2. Services ID:

   `com.reptrio.web.signin`

3. Services ID içinde Sign in with Apple etkin ve primary App ID olarak `com.reptrio.mobile` seçili.
4. Domain ve Return URL:

   `api.reptrio.com`
   `https://api.reptrio.com/api/auth/oauth/apple/callback`

5. Sign in with Apple private key oluşturuldu. `.p8` dosyası yerelde `C:\Users\selcu\OneDrive\Desktop\Reptrio\Secrets\Apple` altında saklanır ve repoya yazılmaz.

## Cloudflare Worker secret'ları

Secret değerleri terminale veya repoya yazılmamalı. Değiştirmek gerekirse `wrangler secret put` ile girilmeli:

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

Canlı doğrulama:

```powershell
npx wrangler secret list
```

Listede Apple secret isimleri görünmelidir. Değerler görünmez. Ayrıca:

```powershell
Invoke-RestMethod https://api.reptrio.com/api/auth/providers
```

sonucu `google: true` ve `apple: true` dönmelidir.

Mobil uygulama `/api/auth/providers` endpoint'ini okuyarak Apple'ın hazır olup olmadığını anlar.
