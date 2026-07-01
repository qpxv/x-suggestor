import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`X auth error: ${error}`, { status: 400 });
  }

  const cookieStore = await cookies();
  const expectedOAuthState = cookieStore.get("x_state")?.value;
  const codeVerifier = cookieStore.get("x_code_verifier")?.value;

  if (!state || state !== expectedOAuthState) {
    return new Response("state mismatch — try again", { status: 400 });
  }
  if (!code || !codeVerifier) {
    return new Response("missing code or verifier", { status: 400 });
  }

  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.X_CALLBACK_URL!,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(`token exchange failed: ${err}`, { status: 500 });
  }

  const { access_token, refresh_token } = await tokenRes.json();

  return new Response(
    `<!DOCTYPE html><html><head><style>
      body{background:#0a0a0a;color:#e8e8e8;font-family:monospace;padding:40px;max-width:700px;margin:0 auto}
      h2{color:#e8a030;margin-bottom:24px}
      label{color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.05em;display:block;margin-top:20px;margin-bottom:6px}
      code{display:block;background:#111;border:1px solid #222;padding:12px;word-break:break-all;font-size:12px;border-radius:3px}
      p{color:#555;font-size:12px;margin-top:32px;line-height:1.6}
    </style></head><body>
      <h2>X OAuth done</h2>
      <label>X_ACCESS_TOKEN</label>
      <code>${access_token}</code>
      <label>X_REFRESH_TOKEN</label>
      <code>${refresh_token ?? "(none — offline.access scope may not have been granted)"}</code>
      <p>Copy these into your <strong>.env</strong> file, then restart the dev server.<br>
      You can delete <code>/api/auth</code> routes after this.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
