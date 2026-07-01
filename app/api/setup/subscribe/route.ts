import { createHmac } from "crypto";

function percentEncode(str: string) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthHeader(method: string, url: string) {
  const consumerKey    = process.env.X_CONSUMER_KEY!;
  const consumerSecret = process.env.X_CONSUMER_SECRET!;
  const accessToken    = process.env.X_ACCESS_TOKEN!;
  const accessSecret   = process.env.X_ACCESS_TOKEN_SECRET!;

  const nonce     = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        timestamp,
    oauth_token:            accessToken,
    oauth_version:          "1.0",
  };

  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join("&");

  const baseString = [method, percentEncode(url), percentEncode(sortedParams)].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessSecret)}`;
  const signature  = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const header = "OAuth " + Object.entries(headerParams)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return header;
}

export async function GET() {
  const url    = "https://api.twitter.com/1.1/account_activity/all/production/subscriptions.json";
  const header = buildOAuthHeader("POST", url);

  const res = await fetch(url, {
    method:  "POST",
    headers: { Authorization: header, "Content-Length": "0" },
  });

  if (res.status === 204) {
    return new Response("subscribed successfully — you can delete /api/setup now", { status: 200 });
  }

  const body = await res.text();
  return new Response(`failed (${res.status}): ${body}`, { status: 500 });
}
