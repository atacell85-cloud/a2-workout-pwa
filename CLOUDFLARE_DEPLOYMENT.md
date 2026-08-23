# Cloudflare Pilot Deployment

## First deploy

1. Install dependencies with `npm install`.
2. Authenticate interactively: `npx wrangler login`.
3. Add the production secret without placing it in source control: `npx wrangler secret put OPENAI_API_KEY`.
4. Review non-secret defaults in `wrangler.jsonc`, then deploy with `npm run cf:deploy`.
5. Wrangler prints the `https://a2-workout.<account>.workers.dev` pilot URL. The same Worker serves the PWA and `/api/import/parse`.

## Configuration

`OPENAI_IMPORT_MODEL`, `OPENAI_IMPORT_TIMEOUT_MS`, `OPENAI_IMPORT_MAX_RETRIES`, `OPENAI_IMPORT_RETRY_BASE_MS`, and `OPENAI_IMPORT_MAX_INPUT_BYTES` are non-secret Worker vars in `wrangler.jsonc`. `OPENAI_API_KEY` is a Cloudflare secret only. For local Worker development, Wrangler reads the ignored `.env` file; use `npm run cf:dev`.

`AI_IMPORT_LIMITER` is a Cloudflare Rate Limiting binding configured for four import requests per IP per minute. Change its `simple` block in `wrangler.jsonc` deliberately if the pilot needs a different limit.

## Google and Apple login

OAuth login is enabled by code, but each provider must be configured in its own developer console and then stored as Cloudflare secrets. Use these redirect URLs:

- Google: `https://a2-workout.antrenmankocu.workers.dev/api/auth/oauth/google/callback`
- Apple: `https://a2-workout.antrenmankocu.workers.dev/api/auth/oauth/apple/callback`

Required Cloudflare secrets:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `APPLE_OAUTH_CLIENT_ID` (Apple Services ID)
- `APPLE_OAUTH_TEAM_ID`
- `APPLE_OAUTH_KEY_ID`
- `APPLE_OAUTH_PRIVATE_KEY` (Sign in with Apple private key in PKCS#8 `.p8` format)

Store secrets with `npx wrangler secret put <NAME>`. Do not place these values in source control or chat.

## Operations

- Health check: `https://<worker>.workers.dev/api/health`
- Tail safe metadata logs: `npx wrangler tail a2-workout`
- Roll back: `npx wrangler rollback`
- Add a custom hostname in Workers & Pages > `a2-workout` > Settings > Domains and Routes. No application code changes are required.

Do not upload `.env`, `.dev.vars`, API keys, or imported document contents. Worker logs contain request metadata only, never keys or document bodies.
