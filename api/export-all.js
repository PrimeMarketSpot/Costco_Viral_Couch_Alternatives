/* ---------------------------------------------------------------------------
   GET /api/export-all

   Everything the caller has, decrypted, in one non-proprietary JSON file.

   This endpoint is a contractual obligation, not a feature (NDA §10):

     §10.1  export in full, in a non-proprietary machine-readable format,
            at any time and at no charge
     §10.2  suspension or termination — including for non-payment — stops our
            performance only, never export; available at least 90 days after
            termination and never behind a payment

   So it deliberately has no billing check and no subscription check. The only
   gate is identity, and there is no code path here that consults payment state.
   That absence is the point: a paywall could not be added to this endpoint
   without breaking a promise we published, so the promise is easier to keep than
   to break.

   The export includes the NDA execution record and its hash, so the bundle is
   self-describing: a reader can tell which agreement governed each revision and
   verify it independently at /verify.html.
   --------------------------------------------------------------------------- */

import {
  listSubmissionsForTenant, getTenantKeyRecord, latestExecutionForTenant,
} from '../lib/store.js';
import { unwrapTenantKey, decryptForTenant } from '../lib/crypto.js';
import { requireSession } from '../lib/auth.js';
import { fail } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.');

  // Identity only — deliberately NOT requireSignedNda. Someone who signed, then
  // asked us to delete everything, then came back should still be able to export
  // whatever remains rather than be told to sign a new agreement first.
  const auth = await requireSession(req);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message);
  const { tenantId } = auth;

  const submissions = await listSubmissionsForTenant(tenantId);
  const execution = await latestExecutionForTenant(tenantId);
  const keyRecord = await getTenantKeyRecord(tenantId);
  const dek = keyRecord ? unwrapTenantKey(tenantId, keyRecord.wrappedDek) : null;

  const origin = new URL(req.url).origin;

  const bundle = {
    format: 'nda-first-export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: { email: tenantId },

    agreement: execution
      ? {
          executionId: execution.id,
          version: execution.agreementVersion,
          documentHash: execution.agreementHash,
          executedAt: execution.executedAt,
          signatory: execution.signatory,
          countersignature: execution.countersignature,
          chainHash: execution.chainHash,
          verifyUrl: `${origin}/verify.html?id=${execution.id}`,
          agreementTextUrl: `${origin}/api/agreement?version=${execution.agreementVersion}`,
        }
      : null,

    submissions: submissions.map((submission) => ({
      id: submission.id,
      title: submission.title,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt ?? submission.createdAt,
      revisions: (submission.revisions ?? []).map((revision) => ({
        revision: revision.revision,
        createdAt: revision.createdAt,
        // Plaintext. This is the user's own data, going to the user.
        content: dek ? decryptForTenant(dek, tenantId, revision.ciphertext) : null,
        contentDigest: revision.contentDigest,
        contentChars: revision.contentChars,
        governedBy: {
          ndaExecutionId: revision.ndaExecutionId,
          agreementVersion: revision.ndaAgreementVersion,
          agreementHash: revision.ndaAgreementHash,
        },
      })),
    })),

    notes: [
      'Every content field is plaintext. Store this file accordingly.',
      'contentDigest is the SHA-256 of the corresponding content, so you can ' +
        'prove later exactly what you submitted and when.',
      'The agreement governing each revision is named per revision, because a ' +
        'later revision may fall under a later agreement version.',
      `Verify the agreement independently at ${origin}/verify.html — it needs ` +
        'nothing from us.',
    ],
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="export-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
}

export const config = { path: '/api/export-all' };
