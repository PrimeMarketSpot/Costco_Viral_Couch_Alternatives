/* ---------------------------------------------------------------------------
   Authentication.

   Passwordless, by choice rather than by fashion. A site whose pitch is that it
   collects and keeps as little as possible has no business storing password
   hashes it does not need: a password is a credential users reuse elsewhere, so
   holding one makes us a liability to people even after they leave. Email
   possession is already the recovery factor for any password system — we just
   stop pretending the password adds something on top.

   Two token types, both stored as SHA-256 digests rather than as secrets:

     login token  — single use, 15 minutes, delivered by email. Consumed on
                    first use, so a link leaked from an inbox or a proxy log
                    cannot be replayed.
     session      — 30 days, HttpOnly + Secure + SameSite=Lax cookie, revocable
                    server-side at any time.

   Storing digests means a read-only leak of the session directory does not let
   anyone log in — the same reasoning that makes password hashing standard.
   --------------------------------------------------------------------------- */

import { randomBytes } from 'node:crypto';
import { hashText, safeEqualHex } from './crypto.js';
import {
  putSession, getSession, deleteSession,
  putLoginToken, consumeLoginToken,
  latestExecutionForTenant,
} from './store.js';

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;         // 15 minutes

/** 32 bytes of entropy, url-safe. Long enough that guessing is not a strategy. */
function newSecret() {
  return randomBytes(32).toString('base64url');
}

/* -------------------------------------------------------------------------- */
/* Login tokens                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Issue a single-use login token for an email address.
 * Returns the raw secret — the ONLY moment it exists in readable form. It goes
 * straight into the email and is never persisted.
 */
export async function issueLoginToken(email, { redirectTo = '/dashboard.html' } = {}) {
  const secret = newSecret();
  const tenantId = email.trim().toLowerCase();

  await putLoginToken(hashText(secret), {
    tenantId,
    redirectTo,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString(),
  });

  return { secret, tenantId, expiresInMinutes: LOGIN_TOKEN_TTL_MS / 60000 };
}

/** Redeem a login token. Returns the record, or null if unknown/expired/used. */
export async function redeemLoginToken(secret) {
  if (typeof secret !== 'string' || !secret.length) return null;
  return consumeLoginToken(hashText(secret));
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export async function createSession(tenantId, { userAgent = null, ip = null } = {}) {
  const secret = newSecret();
  const session = await putSession(hashText(secret), {
    tenantId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    userAgent: userAgent?.slice(0, 400) ?? null,
    ip,
  });
  return { secret, session };
}

/** Read the session cookie from a request. Returns null when absent. */
export function sessionCookieFrom(req) {
  const header = req.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Resolve the caller's identity from their session cookie.
 * Returns null for anonymous, expired, or revoked callers — the endpoints
 * decide what to do about that, so that the decision is visible at each one
 * rather than buried in here.
 */
export async function currentSession(req) {
  const secret = sessionCookieFrom(req);
  if (!secret) return null;
  return getSession(hashText(secret));
}

export async function destroySession(req) {
  const secret = sessionCookieFrom(req);
  if (!secret) return false;
  return deleteSession(hashText(secret));
}

/* -------------------------------------------------------------------------- */
/* Cookie headers                                                              */
/* -------------------------------------------------------------------------- */

/*
 * SameSite=Lax rather than Strict: the magic link arrives from a mail client,
 * so a Strict cookie would not be sent on that top-level navigation and the
 * user would land logged out immediately after logging in. Lax still blocks
 * cross-site POSTs, which is the CSRF case that matters here.
 *
 * Secure is omitted only on localhost, where there is no https to attach it to.
 */
function cookieAttributes() {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `Path=/; HttpOnly;${secure} SameSite=Lax`;
}

export function sessionCookieHeader(secret) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(secret)}; ${cookieAttributes()}; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; ${cookieAttributes()}; Max-Age=0`;
}

/* -------------------------------------------------------------------------- */
/* Authorization helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The two questions every protected endpoint asks, in order:
 *
 *   1. Who are you?              → a valid session
 *   2. Have you signed the NDA?  → an execution record
 *
 * Both are answered server-side from the session cookie. Identity is never
 * taken from the request body: a client-supplied email would let anyone file
 * submissions under someone else's account, or pull another account's
 * countersigned agreement.
 *
 * Returns { ok: true, tenantId, session, execution } or
 *         { ok: false, status, code, message }.
 */
export async function requireSignedNda(req) {
  const session = await currentSession(req);
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'not_signed_in',
      message: 'Sign in to continue.',
    };
  }

  const execution = await latestExecutionForTenant(session.tenantId);
  if (!execution) {
    return {
      ok: false,
      status: 403,
      code: 'nda_not_executed',
      message: 'No countersigned confidentiality agreement exists for this account. ' +
        'Nothing was received, read, logged, or stored. Execute the mutual NDA first.',
    };
  }

  return { ok: true, tenantId: session.tenantId, session, execution };
}

/** Identity only, for endpoints that must work before the NDA is signed. */
export async function requireSession(req) {
  const session = await currentSession(req);
  if (!session) {
    return { ok: false, status: 401, code: 'not_signed_in', message: 'Sign in to continue.' };
  }
  return { ok: true, tenantId: session.tenantId, session };
}

export { safeEqualHex };
