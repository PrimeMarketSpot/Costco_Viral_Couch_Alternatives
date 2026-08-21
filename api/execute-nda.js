/* ---------------------------------------------------------------------------
   POST /api/execute-nda

   Executes the mutual NDA and countersigns it. This runs BEFORE the user is
   permitted to disclose anything — /api/submit-idea refuses every request from a
   tenant that has no execution record here.

   The endpoint is deliberately strict. Every rejection below corresponds to a
   way an execution record could later be argued to be worthless:

     - no affirmative assent            → no meeting of the minds
     - no ESIGN consent                 → electronic execution not validly consented to
     - client hash ≠ server hash        → the user was shown different text than we stored
     - unknown agreement version        → we cannot reproduce what they read
   --------------------------------------------------------------------------- */

import { AGREEMENT_VERSION, textForVersion } from '../lib/nda-text.js';
import { hashText, newId, countersign, usingEphemeralKey, safeEqualHex } from '../lib/crypto.js';
import { appendExecution, latestExecutionForTenant } from '../lib/store.js';
import { createSession, sessionCookieHeader } from '../lib/auth.js';
import { send, countersignedCopyMail } from '../lib/mailer.js';
import { json, fail, methodNotAllowed, readJson, clientIp, isEmail, isNonEmptyString } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const [body, bodyError] = await readJson(req);
  if (bodyError) return bodyError;

  const {
    fullName,
    email,
    agreementVersion = AGREEMENT_VERSION,
    agreementHash: clientHash,
    assent,
    consentToElectronicRecords,
    signatoryCapacity = 'individual',
  } = body;

  /* --- Validate the assent itself --------------------------------------- */

  if (assent !== true) {
    return fail(422, 'assent_required',
      'The agreement is executed only on explicit affirmative assent.');
  }
  if (consentToElectronicRecords !== true) {
    return fail(422, 'esign_consent_required',
      'Electronic execution requires consent to the use of electronic records. ' +
      'You may request a paper copy instead.');
  }
  if (!isNonEmptyString(fullName, 200)) {
    return fail(422, 'name_required', 'A full legal name is required as the signature.');
  }
  if (!isEmail(email)) {
    return fail(422, 'email_required', 'A valid email address is required to deliver your countersigned copy.');
  }

  /* --- Resolve the exact text the user assented to ----------------------- */

  const agreementText = textForVersion(agreementVersion);
  if (agreementText === null) {
    return fail(422, 'unknown_agreement_version',
      `Agreement version "${agreementVersion}" is not known to this server.`);
  }

  const agreementHash = hashText(agreementText);

  // The client hashes the text it actually rendered and sends it up. If the two
  // disagree, the user read something other than what we would store — the one
  // scenario this whole design exists to prevent. Refuse rather than reconcile.
  if (clientHash !== undefined && !safeEqualHex(String(clientHash), agreementHash)) {
    return fail(409, 'agreement_hash_mismatch',
      'The agreement text displayed to you does not match the text on the server. ' +
      'Nothing was executed. Reload and try again.',
      { serverHash: agreementHash, clientHash });
  }

  /* --- Tenant identity ---------------------------------------------------- */

  // Until accounts land in Phase 2, the normalized email is the tenant key.
  const tenantId = email.trim().toLowerCase();

  const existing = await latestExecutionForTenant(tenantId);
  if (existing && existing.agreementVersion === agreementVersion) {
    // Idempotent: re-signing the same version is a no-op, not a duplicate record.
    // Still issue a session — signing is also how you get back into your vault.
    const { secret } = await createSession(tenantId, {
      userAgent: req.headers.get('user-agent'),
      ip: clientIp(req),
    });

    return json({
      alreadyExecuted: true,
      id: existing.id,
      agreementVersion: existing.agreementVersion,
      agreementHash: existing.agreementHash,
      executedAt: existing.executedAt,
      countersignature: existing.countersignature,
      verifyUrl: `/verify.html?id=${encodeURIComponent(existing.id)}`,
    }, 200, { 'set-cookie': sessionCookieHeader(secret) });
  }

  /* --- Build, countersign, append ---------------------------------------- */

  const record = {
    id: newId(),
    tenantId,
    agreementVersion,
    agreementHash,
    signatory: {
      fullName: fullName.trim(),
      email: tenantId,
      capacity: signatoryCapacity === 'entity' ? 'entity' : 'individual',
    },
    assent: {
      affirmed: true,
      consentToElectronicRecords: true,
      statement: 'I have read this Agreement in full and intend my typed name as my signature.',
    },
    executedAt: new Date().toISOString(),
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
  };

  // We countersign the record as-is; the chain link is added by the store and is
  // therefore outside the signature. The signature proves we agreed to these
  // terms with this person; the chain proves the log was not rewritten.
  const countersignature = countersign(record);

  const stored = await appendExecution({
    ...record,
    countersignature,
    countersignedBy: 'company',
  });

  // Signing establishes identity: the signatory proved control of nothing yet,
  // but they are now a party to an agreement, and they need a way back into the
  // vault they are about to fill. The magic-link flow re-verifies the address on
  // any later sign-in.
  const { secret } = await createSession(tenantId, {
    userAgent: req.headers.get('user-agent'),
    ip: clientIp(req),
  });

  const origin = new URL(req.url).origin;
  const verifyUrl = `${origin}/verify.html?id=${encodeURIComponent(stored.id)}`;
  const downloadUrl = `${origin}/api/countersigned-pdf?id=${encodeURIComponent(stored.id)}`;

  // ESIGN requires the signer be able to retain a copy. Mail it rather than
  // relying on them to download it in the moment.
  await send(countersignedCopyMail({
    to: tenantId, executionId: stored.id, verifyUrl, downloadUrl,
  }));

  return json({
    id: stored.id,
    agreementVersion: stored.agreementVersion,
    agreementHash: stored.agreementHash,
    executedAt: stored.executedAt,
    countersignature: stored.countersignature,
    chainHash: stored.chainHash,
    verifyUrl: `/verify.html?id=${encodeURIComponent(stored.id)}`,
    // Surfaced so a misconfigured deploy is loud rather than silently worthless.
    warning: usingEphemeralKey()
      ? 'Server is using an ephemeral countersigning key. This signature will not ' +
        'verify after a restart. Set COUNTERSIGN_PRIVATE_KEY before production use.'
      : undefined,
  }, 201, { 'set-cookie': sessionCookieHeader(secret) });
}

export const config = { path: '/api/execute-nda' };
