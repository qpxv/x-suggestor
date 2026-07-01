import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";

export async function GET() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: process.env.X_CALLBACK_URL!,
    scope: "dm.read dm.write tweet.read users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(
    `https://twitter.com/i/oauth2/authorize?${params}`
  );
  response.cookies.set("x_code_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
  });
  response.cookies.set("x_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
  });
  return response;
}
