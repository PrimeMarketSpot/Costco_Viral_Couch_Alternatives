/* ---------------------------------------------------------------------------
   Storage — backend selection.

   Two implementations behind one interface:

     store-fs.js     files under .data/ — local development and the test suite
     store-blobs.js  Netlify Blobs — production

   The filesystem backend is NOT a fallback for production. Netlify Functions
   have ephemeral filesystems, so an execution record written during signing
   would be gone by the time the next request asked whether the account had
   signed: the vault would refuse submissions from people who had just signed,
   and the evidence that they signed would be lost. That is a silent, total
   failure of the product's central claim, so the check below is a hard error
   rather than a warning.

   Selection is by environment, not configuration, so it cannot be got wrong by
   forgetting a variable:

     NETLIFY=true         → Blobs (Netlify sets this in builds and functions)
     STORE_BACKEND=blobs  → Blobs (explicit override, for testing the backend)
     otherwise            → filesystem

   Adding a third backend means implementing this same set of functions and
   adding one branch here. Nothing else in the codebase touches storage.
   --------------------------------------------------------------------------- */

const explicit = process.env.STORE_BACKEND;
const onNetlify = Boolean(process.env.NETLIFY);

const backendName = explicit || (onNetlify ? 'blobs' : 'fs');

if (backendName === 'fs' && process.env.NODE_ENV === 'production') {
  throw new Error(
    'The filesystem store cannot be used in production: serverless filesystems ' +
    'are ephemeral, so NDA execution records would not survive between requests. ' +
    'Set STORE_BACKEND=blobs (automatic on Netlify) or implement another backend.',
  );
}

const backend = backendName === 'blobs'
  ? await import('./store-blobs.js')
  : await import('./store-fs.js');

export const STORE_BACKEND = backendName;

export const {
  appendExecution,
  getExecution,
  latestExecutionForTenant,
  auditChain,
  getTenantKeyRecord,
  putTenantKeyRecord,
  putSubmission,
  getSubmission,
  listSubmissionsForTenant,
  appendRevision,
  destroyTenantData,
  putSession,
  getSession,
  deleteSession,
  revokeSessionsForTenant,
  putLoginToken,
  consumeLoginToken,
} = backend;
