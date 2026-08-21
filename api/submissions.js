/* ---------------------------------------------------------------------------
   GET  /api/submissions            → list the caller's vault (metadata only)
   GET  /api/submissions?id=…       → one submission, decrypted
   POST /api/submissions?id=…       → append a revision  { content }

   Listing returns titles and metadata but no content: the vault index does not
   need to decrypt anything, so it doesn't. Content is decrypted only when a
   specific submission is opened, which keeps plaintext out of the common path.

   Revisions accumulate and are never overwritten. An idea's history is often the
   evidence of when you conceived what — the thing that decides a priority
   dispute — so a save must not silently discard the previous text.
   --------------------------------------------------------------------------- */

import {
  listSubmissionsForTenant, getSubmission, appendRevision, getTenantKeyRecord,
} from '../lib/store.js';
import { unwrapTenantKey, encryptForTenant, decryptForTenant, hashText } from '../lib/crypto.js';
import { requireSignedNda } from '../lib/auth.js';
import { json, fail, readJson } from '../lib/http.js';

const MAX_CONTENT_CHARS = 100_000;

/** Metadata view — safe to list, never includes ciphertext or plaintext. */
function summarize(submission) {
  const revisions = submission.revisions ?? [];
  const latest = revisions[revisions.length - 1];
  return {
    id: submission.id,
    title: submission.title,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt ?? submission.createdAt,
    revisionCount: revisions.length,
    latestRevision: latest && {
      revision: latest.revision,
      contentChars: latest.contentChars,
      contentDigest: latest.contentDigest,
      createdAt: latest.createdAt,
      ndaAgreementVersion: latest.ndaAgreementVersion,
    },
  };
}

/** Resolve the caller's data key, or null if they have never submitted. */
async function tenantKey(tenantId) {
  const record = await getTenantKeyRecord(tenantId);
  if (!record) return null;
  return unwrapTenantKey(tenantId, record.wrappedDek);
}

export default async function handler(req) {
  const auth = await requireSignedNda(req);
  if (!auth.ok) {
    return fail(auth.status, auth.code, auth.message,
      auth.code === 'nda_not_executed' ? { executeAt: '/nda.html' } : {});
  }
  const { tenantId, execution } = auth;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  /* --- List ------------------------------------------------------------- */

  if (req.method === 'GET' && !id) {
    const all = await listSubmissionsForTenant(tenantId);
    return json({
      submissions: all.map(summarize),
      count: all.length,
    });
  }

  /* --- Read one --------------------------------------------------------- */

  if (req.method === 'GET') {
    const submission = await getSubmission(id);
    // Ownership check before existence disclosure: another account's id must
    // look identical to an id that was never issued.
    if (!submission || submission.tenantId !== tenantId) {
      return fail(404, 'not_found', 'No such submission.');
    }

    const dek = await tenantKey(tenantId);
    if (!dek) return fail(500, 'key_missing', 'No data key exists for this account.');

    const wanted = url.searchParams.get('revision');
    const revisions = submission.revisions ?? [];
    const chosen = wanted
      ? revisions.find((r) => String(r.revision) === String(wanted))
      : revisions[revisions.length - 1];

    if (!chosen) return fail(404, 'revision_not_found', 'No such revision.');

    return json({
      ...summarize(submission),
      revision: chosen.revision,
      content: decryptForTenant(dek, tenantId, chosen.ciphertext),
      contentDigest: chosen.contentDigest,
      governedBy: {
        ndaExecutionId: chosen.ndaExecutionId,
        agreementVersion: chosen.ndaAgreementVersion,
        verifyUrl: `/verify.html?id=${encodeURIComponent(chosen.ndaExecutionId)}`,
      },
      history: revisions.map((r) => ({
        revision: r.revision,
        createdAt: r.createdAt,
        contentChars: r.contentChars,
        contentDigest: r.contentDigest,
      })),
    });
  }

  /* --- Append a revision ------------------------------------------------ */

  if (req.method === 'POST') {
    if (!id) return fail(400, 'id_required', 'Provide ?id= to revise a submission.');

    const submission = await getSubmission(id);
    if (!submission || submission.tenantId !== tenantId) {
      return fail(404, 'not_found', 'No such submission.');
    }

    const [body, bodyError] = await readJson(req);
    if (bodyError) return bodyError;

    const { content } = body;
    if (typeof content !== 'string' || content.trim().length === 0) {
      return fail(422, 'content_required', 'Revision content is required.');
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return fail(413, 'content_too_large',
        `Submissions are limited to ${MAX_CONTENT_CHARS.toLocaleString()} characters.`);
    }

    const dek = await tenantKey(tenantId);
    if (!dek) return fail(500, 'key_missing', 'No data key exists for this account.');

    const revisions = submission.revisions ?? [];
    const now = new Date().toISOString();

    const updated = await appendRevision(id, {
      revision: revisions.length + 1,
      ciphertext: encryptForTenant(dek, tenantId, content),
      contentDigest: hashText(content),
      contentChars: content.length,
      createdAt: now,
      // The agreement in force *now*, which may be a later version than the one
      // governing revision 1.
      ndaExecutionId: execution.id,
      ndaAgreementVersion: execution.agreementVersion,
      ndaAgreementHash: execution.agreementHash,
    });

    return json({ ...summarize(updated), saved: true }, 201);
  }

  return fail(405, 'method_not_allowed', 'Use GET or POST.');
}

export const config = { path: '/api/submissions' };
