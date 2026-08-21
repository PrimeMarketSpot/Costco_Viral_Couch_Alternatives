/* ---------------------------------------------------------------------------
   GET /api/auth-verify?token=…

   Redeems a sign-in link and sets the session cookie.

   The token is consumed on read, so following the same link twice fails the
   second time. That is the point: links sit in inboxes, proxy logs, and browser
   history for years, and a replayable one is a permanent credential.
   --------------------------------------------------------------------------- */

import { redeemLoginToken, createSession, sessionCookieHeader } from '../lib/auth.js';
import { fail, clientIp } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.');

  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return Response.redirect(new URL('/signin.html?error=missing_token', url.origin), 302);
  }

  const record = await redeemLoginToken(token);
  if (!record) {
    // Expired, already used, or never existed — all the same to the caller.
    return Response.redirect(new URL('/signin.html?error=invalid_token', url.origin), 302);
  }

  const { secret } = await createSession(record.tenantId, {
    userAgent: req.headers.get('user-agent'),
    ip: clientIp(req),
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(record.redirectTo || '/dashboard.html', url.origin).href,
      'set-cookie': sessionCookieHeader(secret),
      'cache-control': 'no-store',
    },
  });
}

export const config = { path: '/api/auth-verify' };
