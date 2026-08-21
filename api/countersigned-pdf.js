/* ---------------------------------------------------------------------------
   GET /api/countersigned-pdf?id=<execution-id>

   Returns the executed agreement as a PDF carrying both signatures, the document
   hash, the countersignature, and a verification URL.

   Access control is the session cookie, and the session's account must match the
   record's signatory. An earlier version accepted the signatory's email as a
   query parameter instead — which meant anyone who learned an execution id and
   guessed an email could pull someone else's executed agreement, and put that
   email into server logs, browser history, and any referrer header along the way.
   Guessing an email is not authentication.

   The document remains publicly *verifiable* without signing in — /verify.html
   confirms integrity from the id alone. Verifiable and readable are different
   things, and only the second needs protecting.
   --------------------------------------------------------------------------- */

import { textForVersion } from '../lib/nda-text.js';
import { getExecution } from '../lib/store.js';
import { textToPdf } from '../lib/pdf.js';
import { requireSession } from '../lib/auth.js';
import { fail } from '../lib/http.js';

const RULE = '='.repeat(84);

function coverSheet(record, siteOrigin) {
  const verifyUrl = `${siteOrigin}/verify.html?id=${record.id}`;
  return `${RULE}
EXECUTED COPY - MUTUAL CONFIDENTIALITY AND IDEA PROTECTION AGREEMENT
${RULE}

Agreement version : ${record.agreementVersion}
Document hash     : SHA-256
                    ${record.agreementHash}

EXECUTED BY
  Signature       : /s/ ${record.signatory.fullName}
  Name            : ${record.signatory.fullName}
  Email           : ${record.signatory.email}
  Capacity        : ${record.signatory.capacity}
  Executed at     : ${record.executedAt}
  Network address : ${record.ip ?? 'not recorded'}

  Affirmation     : "${record.assent.statement}"
  ESIGN consent   : ${record.assent.consentToElectronicRecords ? 'given' : 'NOT GIVEN'}

COUNTERSIGNED BY COMPANY
  Method          : Ed25519 over the canonical execution record
  Signature       : ${record.countersignature}

INTEGRITY
  Execution id    : ${record.id}
  Log chain hash  : ${record.chainHash}

HOW TO VERIFY THIS DOCUMENT INDEPENDENTLY

  1. Take the agreement text that follows this cover sheet.
  2. Compute its SHA-256 digest.
  3. Confirm it equals the document hash printed above.
  4. Confirm the countersignature above using the company's published public key,
     available at ${siteOrigin}/api/verify-nda?publicKey=1

  Or use the verification page directly:
     ${verifyUrl}

  Verification requires no cooperation from the company. That is the point.

${RULE}
AGREEMENT TEXT AS EXECUTED
${RULE}

`;
}

export default async function handler(req) {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.');

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return fail(400, 'id_required', 'Provide ?id=<execution-id>.');

  const auth = await requireSession(req);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message);

  const record = await getExecution(id);
  if (!record) return fail(404, 'not_found', 'No such execution record.');

  if (record.signatory.email !== auth.tenantId) {
    // Same response as a missing record, so this cannot be used as an oracle
    // for which execution ids exist.
    return fail(404, 'not_found', 'No such execution record.');
  }

  const agreementText = textForVersion(record.agreementVersion);
  if (agreementText === null) {
    return fail(500, 'agreement_text_missing',
      `Agreement version ${record.agreementVersion} is no longer resolvable on this server. ` +
      'This is a server defect: superseded versions must be retained in PRIOR_VERSIONS.');
  }

  const pdf = textToPdf(coverSheet(record, url.origin) + agreementText);
  const filename = `nda-${record.id}.pdf`;

  return new Response(pdf, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

export const config = { path: '/api/countersigned-pdf' };
