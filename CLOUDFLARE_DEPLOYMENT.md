# Cloudflare Pilot Deployment

## First deploy

1. Install dependencies with `npm install`.
2. Authenticate interactively: `npx wrangler login`.
3. Add the production secret without placing it in source control: `npx wrangler secret put OPENAI_API_KEY`.
4. Review non-secret defaults in `wrangler.jsonc`, then deploy with `npm run cf:deploy`.
5. The same Worker serves the PWA and API. Production URLs are `https://app.reptrio.com` and `https://api.reptrio.com`; the workers.dev URL remains a legacy fallback.

## Configuration

`OPENAI_IMPORT_MODEL`, `OPENAI_IMPORT_TIMEOUT_MS`, `OPENAI_IMPORT_MAX_RETRIES`, `OPENAI_IMPORT_RETRY_BASE_MS`, and `OPENAI_IMPORT_MAX_INPUT_BYTES` are non-secret Worker vars in `wrangler.jsonc`. `OPENAI_API_KEY` is a Cloudflare secret only. For local Worker development, Wrangler reads the ignored `.env` file; use `npm run cf:dev`.

`AI_IMPORT_LIMITER` is a Cloudflare Rate Limiting binding configured for four import requests per IP per minute. Change its `simple` block in `wrangler.jsonc` deliberately if the pilot needs a different limit.

## Google and Apple login

OAuth login is enabled by code, but each provider must be configured in its own developer console and then stored as Cloudflare secrets. Use these redirect URLs:

- Google: `https://api.reptrio.com/api/auth/oauth/google/callback`
- Apple: `https://api.reptrio.com/api/auth/oauth/apple/callback`

Required Cloudflare secrets:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `APPLE_OAUTH_CLIENT_ID` (Apple Services ID)
- `APPLE_OAUTH_TEAM_ID`
- `APPLE_OAUTH_KEY_ID`
- `APPLE_OAUTH_PRIVATE_KEY` (Sign in with Apple private key in PKCS#8 `.p8` format)

Store secrets with `npx wrangler secret put <NAME>`. Do not place these values in source control or chat.

## Operations

- Health check: `https://api.reptrio.com/api/health`
- Tail safe metadata logs: `npx wrangler tail a2-workout`
- Roll back: `npx wrangler rollback`
- Custom hostnames are configured as Worker custom domains in `wrangler.jsonc`: `app.reptrio.com` and `api.reptrio.com`.

Do not upload `.env`, `.dev.vars`, API keys, or imported document contents. Worker logs contain request metadata only, never keys or document bodies.
