/* ---------------------------------------------------------------------------
   POST /api/submit-idea   { title, content }

   This is where the product's central claim is either true or it isn't.

   The claim: "the NDA is executed before your idea is received." A disabled
   textarea does not make that true — anyone can re-enable a DOM node or curl the
   endpoint directly. The claim is true only if the SERVER refuses to accept
   submission content from a caller with no execution record, which is what
   requireSignedNda() does, before this handler reads the content field at all.

   Identity comes from the session cookie, never from the request body. An
   earlier version took an `email` field, which meant anyone could file a
   submission under someone else's account — attributing an idea to a person who
   never sent it, inside a system whose entire purpose is establishing who
   disclosed what and when.

   Two further properties follow from the design rather than from a policy page:

     - Content is encrypted under a key unique to this account before it touches
       disk, so "we do not train on your idea" is backed by our not holding it in
       readable form.
     - Nothing is echoed back. The response confirms receipt with a size and a
       digest; a leaked response is not a leaked idea.
   --------------------------------------------------------------------------- */

import { getTenantKeyRecord, putTenantKeyRecord, putSubmission } from '../lib/store.js';
import { createTenantKey, unwrapTenantKey, encryptForTenant, hashText, newId }
  from '../lib/crypto.js';
import { requireSignedNda } from '../lib/auth.js';
import { consume, tooManyRequests } from '../lib/rate-limit.js';
import { json, fail, methodNotAllowed, readJson, isNonEmptyString } from '../lib/http.js';

const MAX_CONTENT_CHARS = 100_000;

export default async function handler(req) {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  /* ======================================================================= */
  /*  THE GATE. Nothing below this runs without a countersigned NDA.         */
  /* ======================================================================= */

  const auth = await requireSignedNda(req);
  if (!auth.ok) {
    return fail(auth.status, auth.code, auth.message,
      auth.code === 'nda_not_executed' ? { executeAt: '/nda.html' } : {});
  }
  const { tenantId, execution } = auth;

  /* ======================================================================= */

  // Already authenticated and NDA-gated, so abuse costs a signature first.
  // Limited anyway to bound how much a single account can store.
  const byTenant = await consume('submit-tenant', tenantId);
  if (!byTenant.allowed) {
    return tooManyRequests(byTenant.retryAfterSeconds,
      'Too many submissions in a short period. Try again shortly.');
  }

  const [body, bodyError] = await readJson(req);
  if (bodyError) return bodyError;

  const { title, content } = body;

  if (!isNonEmptyString(title, 300)) {
    return fail(422, 'title_required', 'A short title is required.');
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail(422, 'content_required', 'Submission content is required.');
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return fail(413, 'content_too_large',
      `Submissions are limited to ${MAX_CONTENT_CHARS.toLocaleString()} characters.`);
  }

  /* --- Envelope encryption ------------------------------------------------ */

  let keyRecord = await getTenantKeyRecord(tenantId);
  let dek;
  if (keyRecord) {
    dek = unwrapTenantKey(tenantId, keyRecord.wrappedDek);
  } else {
    const minted = createTenantKey(tenantId);
    keyRecord = await putTenantKeyRecord(tenantId, minted.wrappedDek);
    dek = minted.dek;
  }

  const now = new Date().toISOString();
  const ciphertext = encryptForTenant(dek, tenantId, content);

  // Integrity digest of the plaintext, so the user can later prove what they
  // submitted without us retaining a readable copy to compare against.
  const contentDigest = hashText(content);

  const submission = await putSubmission({
    id: newId(),
    tenantId,
    // The title is stored in the clear so the vault is listable without
    // decryption. Flagged to the user at the point of entry: nothing
    // confidential belongs in a title.
    title: title.trim(),
    createdAt: now,
    updatedAt: now,
    // Revisions accumulate; the first submission is revision 1.
    revisions: [{
      revision: 1,
      ciphertext,
      contentDigest,
      contentChars: content.length,
      createdAt: now,
      // Bind each revision to the agreement in force when it was made, so there
      // is never ambiguity about which terms govern which disclosure.
      ndaExecutionId: execution.id,
      ndaAgreementVersion: execution.agreementVersion,
      ndaAgreementHash: execution.agreementHash,
    }],
  });

  return json({
    id: submission.id,
    revision: 1,
    createdAt: submission.createdAt,
    contentChars: content.length,
    contentDigest,
    storedAs: 'aes-256-gcm ciphertext under a key unique to this account',
    governedBy: {
      ndaExecutionId: execution.id,
      agreementVersion: execution.agreementVersion,
      verifyUrl: `/verify.html?id=${encodeURIComponent(execution.id)}`,
    },
  }, 201);
}

export const config = { path: '/api/submit-idea' };
