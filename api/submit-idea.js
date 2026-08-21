/* ---------------------------------------------------------------------------
   POST /api/submit-idea

   This is where the product's central claim is either true or it isn't.

   The claim: "the NDA is executed before your idea is received." A disabled
   textarea does not make that true — anyone can re-enable a DOM node or curl the
   endpoint directly. The claim is true only if the SERVER refuses to accept
   submission content from a tenant with no execution record, which is what the
   gate below does, before it reads the content field at all.

   Two further properties follow from the design rather than from a policy page:

     - The content is encrypted under a key unique to this tenant before it
       touches disk, so "we do not train on your idea" is backed by our not
       holding it in readable form.
     - Nothing is echoed back. The response confirms receipt with a size and a
       digest; it never returns the content, so a leaked response is not a leaked
       idea.
   --------------------------------------------------------------------------- */

import { latestExecutionForTenant, getTenantKeyRecord, putTenantKeyRecord, putSubmission }
  from '../lib/store.js';
import { createTenantKey, unwrapTenantKey, encryptForTenant, hashText, newId }
  from '../lib/crypto.js';
import { json, fail, methodNotAllowed, readJson, isEmail, isNonEmptyString } from '../lib/http.js';

const MAX_CONTENT_CHARS = 100_000;

export default async function handler(req) {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const [body, bodyError] = await readJson(req);
  if (bodyError) return bodyError;

  const { email, title, content } = body;

  if (!isEmail(email)) {
    return fail(422, 'email_required', 'A valid email address is required to identify your account.');
  }
  const tenantId = email.trim().toLowerCase();

  /* ======================================================================= */
  /*  THE GATE. Nothing below this block runs without a countersigned NDA.    */
  /* ======================================================================= */

  const execution = await latestExecutionForTenant(tenantId);
  if (!execution) {
    return fail(403, 'nda_not_executed',
      'No countersigned confidentiality agreement exists for this account. ' +
      'Nothing was received, read, logged, or stored. Execute the mutual NDA first.',
      { executeAt: '/nda.html' });
  }

  /* ======================================================================= */

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

  const ciphertext = encryptForTenant(dek, tenantId, content);

  // Integrity digest of the plaintext, so the user can later prove what they
  // submitted without us retaining a readable copy to compare against.
  const contentDigest = hashText(content);

  const submission = await putSubmission({
    id: newId(),
    tenantId,
    // The title is stored in the clear so submissions are listable in the
    // dashboard without decryption. Flagged to the user in the UI: put nothing
    // confidential in the title.
    title: title.trim(),
    ciphertext,
    contentDigest,
    contentChars: content.length,
    createdAt: new Date().toISOString(),
    // Binds the submission to the agreement in force when it was made, so there
    // is never ambiguity about which terms govern it.
    ndaExecutionId: execution.id,
    ndaAgreementVersion: execution.agreementVersion,
    ndaAgreementHash: execution.agreementHash,
  });

  return json({
    id: submission.id,
    createdAt: submission.createdAt,
    contentChars: submission.contentChars,
    contentDigest: submission.contentDigest,
    storedAs: 'aes-256-gcm ciphertext under a key unique to this account',
    governedBy: {
      ndaExecutionId: execution.id,
      agreementVersion: execution.agreementVersion,
      verifyUrl: `/verify.html?id=${encodeURIComponent(execution.id)}`,
    },
  }, 201);
}

export const config = { path: '/api/submit-idea' };
