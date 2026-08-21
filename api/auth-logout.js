/* ---------------------------------------------------------------------------
   POST /api/auth-logout

   Destroys the session server-side and clears the cookie. Both halves matter:
   clearing only the cookie would leave a live session record that anyone who
   captured the token could keep using.
   --------------------------------------------------------------------------- */

import { destroySession, clearSessionCookieHeader } from '../lib/auth.js';
import { methodNotAllowed } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  await destroySession(req);

  return new Response(JSON.stringify({ signedOut: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': clearSessionCookieHeader(),
      'cache-control': 'no-store',
    },
  });
}

export const config = { path: '/api/auth-logout' };
