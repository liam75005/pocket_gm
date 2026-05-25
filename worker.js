/**
 * Pocket GM — Cloudflare Workers proxy for Anthropic API
 *
 * Deploys a public endpoint that forwards requests to api.anthropic.com,
 * injecting the API key server-side so it never leaves your infrastructure.
 *
 * SETUP:
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler secret put ANTHROPIC_API_KEY  (paste your sk-ant-... key)
 *   4. wrangler deploy
 *
 * SECURITY:
 *   - Set ALLOWED_ORIGIN env var to your GitHub Pages URL to lock down CORS.
 *   - Rate-limiting is enforced via IP using Cloudflare KV (optional, see below).
 *   - The client never sees the real API key.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin, origin),
      });
    }

    // Only POST /v1/messages is proxied
    if (request.method !== "POST" || url.pathname !== "/v1/messages") {
      return jsonResponse({ error: "Not found" }, 404, allowedOrigin, origin);
    }

    // Optional: rate limit by IP (requires KV namespace bound as RATE_LIMIT_KV)
    if (env.RATE_LIMIT_KV) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const key = `rl:${ip}`;
      const count = parseInt((await env.RATE_LIMIT_KV.get(key)) || "0", 10);
      const LIMIT = parseInt(env.RATE_LIMIT_PER_HOUR || "60", 10);
      if (count >= LIMIT) {
        return jsonResponse(
          { error: { type: "rate_limit_error", message: "Hourly rate limit reached." } },
          429,
          allowedOrigin,
          origin
        );
      }
      await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 3600 });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: { type: "config_error", message: "ANTHROPIC_API_KEY not configured on the server." } },
        500,
        allowedOrigin,
        origin
      );
    }

    // Forward to Anthropic API
    let body;
    try {
      body = await request.text();
    } catch (e) {
      return jsonResponse({ error: "Invalid body" }, 400, allowedOrigin, origin);
    }

    // Basic payload validation: must be JSON with model + messages + system
    try {
      const parsed = JSON.parse(body);
      if (!parsed.model || !parsed.messages) {
        return jsonResponse({ error: "Missing 'model' or 'messages'" }, 400, allowedOrigin, origin);
      }
      // Restrict allowed models to prevent misuse
      const ALLOWED = ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-7"];
      if (!ALLOWED.includes(parsed.model)) {
        return jsonResponse(
          { error: { type: "model_not_allowed", message: `Model ${parsed.model} not allowed.` } },
          400,
          allowedOrigin,
          origin
        );
      }
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON body" }, 400, allowedOrigin, origin);
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body,
    });

    const respBody = await upstream.text();
    return new Response(respBody, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        ...corsHeaders(allowedOrigin, origin),
      },
    });
  },
};

function corsHeaders(allowed, origin) {
  // If ALLOWED_ORIGIN is "*", echo the request origin (or "*" if absent).
  // If set to a specific URL, only that origin is allowed.
  const allowOrigin = allowed === "*" ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(obj, status, allowed, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(allowed, origin),
    },
  });
}
