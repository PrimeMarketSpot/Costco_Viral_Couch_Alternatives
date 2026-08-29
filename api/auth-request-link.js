/* ---------------------------------------------------------------------------
   POST /api/auth-request-link   { email }

   Issues a single-use sign-in link.

   The response is deliberately identical whether or not the address has an
   account. Otherwise this endpoint becomes an account-existence oracle — anyone
   could test addresses to learn who has submitted an idea here, which for a
   confidentiality product is itself a disclosure worth preventing.
   --------------------------------------------------------------------------- */

import { issueLoginToken } from '../lib/auth.js';
import { send, loginLinkMail } from '../lib/mailer.js';
import { consume, tooManyRequests } from '../lib/rate-limit.js';
import { json, fail, methodNotAllowed, readJson, clientIp, isEmail } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const [body, bodyError] = await readJson(req);
  if (bodyError) return bodyError;

  const { email, redirectTo } = body;
  if (!isEmail(email)) {
    return fail(422, 'email_required', 'Enter a valid email address.');
  }

  // Limited on two dimensions on purpose. Per-email alone would let one caller
  // spray thousands of distinct addresses; per-IP alone would let a botnet bury
  // a single inbox. Both must pass.
  const byEmail = await consume('auth-email', email.trim().toLowerCase());
  if (!byEmail.allowed) {
    return tooManyRequests(byEmail.retryAfterSeconds,
      'Too many sign-in links requested for this address. Check your inbox, including spam.');
  }

  const byIp = await consume('auth-ip', clientIp(req));
  if (!byIp.allowed) {
    return tooManyRequests(byIp.retryAfterSeconds, 'Too many requests. Try again shortly.');
  }

  // Only allow same-origin redirects. An open redirect here would let a
  // convincing sign-in link land the user somewhere we don't control.
  const safeRedirect =
    typeof redirectTo === 'string' && /^\/[^/\\]/.test(redirectTo)
      ? redirectTo
      : '/dashboard.html';

  const { secret, expiresInMinutes } = await issueLoginToken(email, { redirectTo: safeRedirect });

  const url = new URL('/api/auth-verify', new URL(req.url).origin);
  url.searchParams.set('token', secret);

  await send(loginLinkMail({
    to: email.trim().toLowerCase(),
    url: url.href,
    expiresInMinutes,
  }));

  return json({
    sent: true,
    message: 'If that address has an account, a sign-in link is on its way. ' +
      'It works once and expires shortly.',
  });
}

export const config = { path: '/api/auth-request-link' };
