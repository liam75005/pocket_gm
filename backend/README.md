# Pocket GM Backend Proxy

A Cloudflare Workers proxy that lets you host Pocket GM publicly without exposing your Anthropic API key to clients.

## Why?

Without this proxy, each user of your site needs their own Anthropic API key. With this proxy, the key lives only on Cloudflare and all users share it — at your expense, so **deploy rate limiting**.

## Setup

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Add your API key as a secret

```bash
cd backend
wrangler secret put ANTHROPIC_API_KEY
# Paste your sk-ant-... key when prompted
```

### 3. (Recommended) Restrict CORS to your domain

Edit `wrangler.toml`, uncomment the `[vars]` section and set `ALLOWED_ORIGIN` to your GitHub Pages URL:

```toml
[vars]
ALLOWED_ORIGIN = "https://YOUR_USERNAME.github.io"
RATE_LIMIT_PER_HOUR = "60"
```

### 4. (Recommended) Enable rate limiting

```bash
wrangler kv:namespace create "RATE_LIMIT_KV"
```

Wrangler will print an `id`. Paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "the_id_printed_above"
```

### 5. Deploy

```bash
wrangler deploy
```

You'll get a URL like `https://pocket-gm-proxy.YOUR_SUBDOMAIN.workers.dev`.

### 6. Update the client

In `index.html`, find the line:

```js
fetch("https://api.anthropic.com/v1/messages", {
```

Replace it with your Workers URL:

```js
fetch("https://pocket-gm-proxy.YOUR_SUBDOMAIN.workers.dev/v1/messages", {
```

Also remove the `x-api-key` and `anthropic-dangerous-direct-browser-access` headers — they're now injected server-side.

## Cost

- Cloudflare Workers free tier: 100,000 requests/day. More than enough for personal/small public usage.
- KV free tier: 100,000 reads/day, 1,000 writes/day. Each call writes once (rate limiter).
- Anthropic API costs: still on your bill, but rate-limited so abusers can't drain your wallet.

## Security checklist before going public

- [ ] `ANTHROPIC_API_KEY` set as Wrangler secret (NOT in wrangler.toml)
- [ ] `ALLOWED_ORIGIN` set to your exact GitHub Pages URL
- [ ] `RATE_LIMIT_KV` enabled with a reasonable hourly limit
- [ ] Test the deployed URL responds with CORS headers from your origin only
- [ ] Consider Cloudflare Bot Fight Mode in the Cloudflare dashboard
