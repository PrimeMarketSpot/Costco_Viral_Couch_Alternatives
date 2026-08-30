/* ---------------------------------------------------------------------------
   Rate limiting.

   Fixed-window counters. Deliberately simple: a sliding window or token bucket
   would be more precise, but this has to work identically across two storage
   backends with different consistency guarantees, and a limiter nobody can
   reason about is worse than a blunt one.

   Why this exists at all — the endpoints being protected are not equally risky:

     auth-request-link   UNAUTHENTICATED and SENDS EMAIL. Without a limit this
                         is a spam cannon pointed at arbitrary inboxes, and the
                         fastest way to get a transactional email domain
                         blacklisted. Limited by BOTH email and IP: per-email
                         alone lets one attacker hit thousands of addresses;
                         per-IP alone lets a botnet hammer one inbox.

     execute-nda         UNAUTHENTICATED and writes to the append-only log,
                         which by design can never be pruned. Unbounded writes
                         to an unprunable structure is a slow-motion outage.

     submit-idea         Authenticated and NDA-gated, so abuse costs an
                         attacker a signature first. Limited anyway, to bound
                         storage per account.

     verify-nda          PUBLIC and unauthenticated by design — a confidentiality
                         guarantee only the guarantor can audit is worthless. But
                         its POST form hashes caller-supplied text, so a cheap
                         request buys expensive work. Limited generously (this is
                         a legitimate flow someone may repeat) but not infinitely.

   HONEST LIMITATION: Netlify Blobs has no atomic increment and no
   compare-and-set, so two requests landing in the same instant can both read
   the same count and write the same +1 — undercounting by one. This limiter
   therefore raises the cost of abuse rather than making it impossible, and a
   determined attacker with enough parallelism can exceed the nominal limit by
   a small factor. That is an acceptable trade for a spam/abuse control at this
   scale; it would NOT be acceptable for anything security-critical like a
   login attempt counter guarding a password, which is one more reason this
   product has no passwords. Revisit with a backend that supports atomic
   counters before the numbers get large.
   --------------------------------------------------------------------------- */

import { hashText } from './crypto.js';
import { bumpCounter } from './store.js';

export const LIMITS = {
  'auth-email':   { max: 5,  windowMs: 60 * 60 * 1000 },
  'auth-ip':      { max: 20, windowMs: 60 * 60 * 1000 },
  'execute-ip':   { max: 10, windowMs: 60 * 60 * 1000 },
  'submit-tenant':{ max: 60, windowMs: 60 * 60 * 1000 },
  'verify-ip':    { max: 120, windowMs: 60 * 60 * 1000 },
};

/**
 * Consume one unit against a named limit.
 *
 * The identifier is hashed: counter keys land in storage listings and logs, and
 * a limiter whose key names enumerate the email addresses that tried to sign in
 * would leak exactly what the rest of this codebase works to protect.
 *
 * Returns { allowed, remaining, retryAfterSeconds }.
 */
export async function consume(limitName, identifier) {
  const limit = LIMITS[limitName];
  if (!limit) throw new Error(`Unknown rate limit: ${limitName}`);

  // A missing identifier (no IP behind some proxies) must not collapse every
  // caller into one shared bucket — that would let one abuser lock out
  // everyone. Fail open instead, and let the other dimension do the work.
  if (!identifier) return { allowed: true, remaining: limit.max, retryAfterSeconds: 0 };

  const key = `${limitName}:${hashText(String(identifier).toLowerCase()).slice(0, 32)}`;
  const { count, resetAt } = await bumpCounter(key, limit.windowMs);

  const allowed = count <= limit.max;
  return {
    allowed,
    remaining: Math.max(0, limit.max - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

/** Standard 429 response. */
export function tooManyRequests(retryAfterSeconds, message) {
  return new Response(
    JSON.stringify({
      error: {
        code: 'rate_limited',
        message: message ?? 'Too many requests. Try again shortly.',
        retryAfterSeconds,
      },
    }, null, 2),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(retryAfterSeconds),
        'cache-control': 'no-store',
      },
    },
  );
}
