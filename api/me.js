/* ---------------------------------------------------------------------------
   GET /api/me

   Who the caller is and what agreement governs them. Drives the dashboard's
   initial render, and tells an anonymous caller plainly that they are anonymous
   rather than erroring.
   --------------------------------------------------------------------------- */

import { currentSession } from '../lib/auth.js';
import { latestExecutionForTenant, listSubmissionsForTenant } from '../lib/store.js';
import { json, fail } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.');

  const session = await currentSession(req);
  if (!session) return json({ signedIn: false });

  const execution = await latestExecutionForTenant(session.tenantId);
  const submissions = await listSubmissionsForTenant(session.tenantId);

  return json({
    signedIn: true,
    email: session.tenantId,
    sessionExpiresAt: session.expiresAt,
    nda: execution
      ? {
          executed: true,
          executionId: execution.id,
          agreementVersion: execution.agreementVersion,
          agreementHash: execution.agreementHash,
          executedAt: execution.executedAt,
          signatoryName: execution.signatory.fullName,
          verifyUrl: `/verify.html?id=${encodeURIComponent(execution.id)}`,
          downloadUrl: `/api/countersigned-pdf?id=${encodeURIComponent(execution.id)}`,
        }
      : { executed: false },
    vault: {
      submissionCount: submissions.length,
      // Revisions accumulate, so this is a truer measure of activity than count.
      revisionCount: submissions.reduce((n, s) => n + (s.revisions?.length ?? 1), 0),
    },
  });
}

export const config = { path: '/api/me' };
