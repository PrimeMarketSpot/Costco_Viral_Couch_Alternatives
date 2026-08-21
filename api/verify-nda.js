/* ---------------------------------------------------------------------------
   GET  /api/verify-nda?id=<execution-id>   → status of one execution record
   GET  /api/verify-nda?publicKey=1         → our Ed25519 public key (PEM)
   GET  /api/verify-nda?audit=1             → integrity of the whole append-only log
   POST /api/verify-nda  { id, text }       → check a COPY of the agreement against
                                              the hash recorded at execution

   This endpoint is public and unauthenticated on purpose. A confidentiality
   guarantee that only the guarantor can audit is not a guarantee. Anyone holding
   a countersigned PDF — the user, their lawyer, a court, a journalist — can
   confirm here that the document was not altered after signing, and can verify
   our countersignature offline using the published public key.

   It returns no submission content and no personal data beyond what is needed to
   identify the execution: the signatory's name (which IS the signature) and a
   redacted email.
   --------------------------------------------------------------------------- */

import { textForVersion, AGREEMENT_VERSION } from '../lib/nda-text.js';
import { hashText, verifyCountersignature, countersignPublicKeyPem, safeEqualHex } from '../lib/crypto.js';
import { getExecution, auditChain } from '../lib/store.js';
import { json, fail, readJson, isNonEmptyString } from '../lib/http.js';

/** Never echo a full address back to an unauthenticated caller. */
function redactEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '•••';
  const head = user.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(user.length - 1, 1))}@${domain}`;
}

/** Rebuild the exact object that was signed, stripping storage-added fields. */
function signedPortion(record) {
  const { chainHash, prevChainHash, countersignature, countersignedBy, ...signed } = record;
  return signed;
}

function describe(record) {
  const canonicalText = textForVersion(record.agreementVersion);
  const recomputed = canonicalText === null ? null : hashText(canonicalText);

  return {
    found: true,
    id: record.id,
    agreementVersion: record.agreementVersion,
    agreementHash: record.agreementHash,
    executedAt: record.executedAt,
    signatory: {
      fullName: record.signatory.fullName,
      email: redactEmail(record.signatory.email),
      capacity: record.signatory.capacity,
    },
    checks: {
      // Does the server still hold the exact text this person signed?
      agreementTextResolvable: canonicalText !== null,
      agreementHashMatchesStoredText:
        recomputed !== null && safeEqualHex(recomputed, record.agreementHash),
      // Is our countersignature authentic?
      countersignatureValid: verifyCountersignature(signedPortion(record), record.countersignature),
      // Is this the current version, or a superseded one?
      isCurrentVersion: record.agreementVersion === AGREEMENT_VERSION,
    },
    countersignature: record.countersignature,
    chainHash: record.chainHash,
  };
}

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (url.searchParams.get('publicKey')) {
      return new Response(countersignPublicKeyPem(), {
        status: 200,
        headers: {
          'content-type': 'application/x-pem-file; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      });
    }

    if (url.searchParams.get('audit')) {
      return json(await auditChain());
    }

    const id = url.searchParams.get('id');
    if (!id) return fail(400, 'id_required', 'Provide ?id=<execution-id>.');

    const record = await getExecution(id);
    if (!record) return json({ found: false, id }, 404);

    return json(describe(record));
  }

  if (req.method === 'POST') {
    const [body, bodyError] = await readJson(req);
    if (bodyError) return bodyError;

    const { id, text } = body;
    if (!isNonEmptyString(id, 100)) return fail(400, 'id_required', 'An execution id is required.');
    if (typeof text !== 'string' || !text.length) {
      return fail(400, 'text_required', 'Provide the agreement text to check.');
    }

    const record = await getExecution(id);
    if (!record) return json({ found: false, id }, 404);

    const submittedHash = hashText(text);
    const matches = safeEqualHex(submittedHash, record.agreementHash);

    return json({
      ...describe(record),
      submittedCopy: {
        hash: submittedHash,
        matchesExecutedAgreement: matches,
        verdict: matches
          ? 'This copy is byte-for-byte the agreement that was executed.'
          : 'This copy does NOT match the executed agreement. It has been altered, ' +
            'or it is a different version. Compare against the version named above.',
      },
    });
  }

  return fail(405, 'method_not_allowed', 'Use GET or POST.');
}

export const config = { path: '/api/verify-nda' };
