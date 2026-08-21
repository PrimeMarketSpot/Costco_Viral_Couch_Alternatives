/* ---------------------------------------------------------------------------
   GET /api/agreement            → current agreement text + version + hash
   GET /api/agreement?version=x  → a specific (possibly superseded) version

   The signing page renders THIS text. It never composes its own copy from
   markup. That is the only way "you signed exactly what we stored" can be true:
   one source of bytes, served here, rendered verbatim, hashed on both ends, and
   compared at execution time.
   --------------------------------------------------------------------------- */

import { AGREEMENT_TEXT, AGREEMENT_VERSION, textForVersion } from '../lib/nda-text.js';
import { hashText } from '../lib/crypto.js';
import { json, fail } from '../lib/http.js';

export default async function handler(req) {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.');

  const requested = new URL(req.url).searchParams.get('version');
  const version = requested || AGREEMENT_VERSION;
  const text = requested ? textForVersion(requested) : AGREEMENT_TEXT;

  if (text === null) {
    return fail(404, 'unknown_agreement_version', `No such agreement version: "${requested}".`);
  }

  return json({
    version,
    isCurrent: version === AGREEMENT_VERSION,
    hash: hashText(text),
    hashAlgorithm: 'sha-256',
    text,
  });
}

export const config = { path: '/api/agreement' };
