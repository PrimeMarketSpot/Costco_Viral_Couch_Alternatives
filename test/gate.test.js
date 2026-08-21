/**
 * These tests exist to check the claims the site makes, not to hit coverage.
 * Each one corresponds to a sentence a user is asked to believe.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Point the store at a scratch directory and pin the dev keys before any module
// that reads these variables is imported.
const DATA_DIR = path.join(tmpdir(), `nda-test-${Date.now()}`);
process.env.DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';

const { default: executeNda } = await import('../api/execute-nda.js');
const { default: submitIdea } = await import('../api/submit-idea.js');
const { default: verifyNda } = await import('../api/verify-nda.js');
const { default: agreement } = await import('../api/agreement.js');
const { default: submissions } = await import('../api/submissions.js');
const { default: exportAll } = await import('../api/export-all.js');
const { default: countersignedPdf } = await import('../api/countersigned-pdf.js');
const { default: me } = await import('../api/me.js');
const { default: requestLink } = await import('../api/auth-request-link.js');
const { default: authVerify } = await import('../api/auth-verify.js');
const { default: authLogout } = await import('../api/auth-logout.js');
const { AGREEMENT_TEXT, AGREEMENT_VERSION } = await import('../lib/nda-text.js');
const { hashText } = await import('../lib/crypto.js');
const { auditChain, destroyTenantData, listSubmissionsForTenant } = await import('../lib/store.js');

const ORIGIN = 'https://example.test';
const SECRET = 'A vending machine that only dispenses when you have walked 10,000 steps.';

/* -------------------------------------------------------------------------- */
/* Request helpers                                                             */
/* -------------------------------------------------------------------------- */

const headers = (cookie) => ({
  'content-type': 'application/json',
  'user-agent': 'test-runner',
  ...(cookie ? { cookie } : {}),
});

const post = (url, body, cookie) => new Request(`${ORIGIN}${url}`, {
  method: 'POST', headers: headers(cookie), body: JSON.stringify(body),
});

const get = (url, cookie) => new Request(`${ORIGIN}${url}`, { headers: headers(cookie) });

/** Pull the session cookie out of a Set-Cookie header, ready to send back. */
function cookieFrom(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

/** Execute the NDA for an address and return its session cookie. */
async function signUp(email, fullName = 'Test Signatory') {
  const res = await executeNda(post('/api/execute-nda', {
    fullName, email, assent: true, consentToElectronicRecords: true,
  }));
  assert.ok(res.status === 201 || res.status === 200, `expected execution, got ${res.status}`);
  return { cookie: cookieFrom(res), body: await res.json() };
}

after(async () => { await rm(DATA_DIR, { recursive: true, force: true }); });

/* ========================================================================== */

describe('the gate: no NDA, no disclosure', () => {
  test('submit-idea refuses an anonymous caller', async () => {
    const res = await submitIdea(post('/api/submit-idea', { title: 'x', content: SECRET }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'not_signed_in');
  });

  test('submit-idea refuses a signed-in caller who has not executed the NDA', async () => {
    // Being authenticated is not the same as being a party to the agreement.
    // Sign in properly, but never execute, and the vault must stay shut.
    const email = 'unsigned@example.test';
    const { issueLoginToken } = await import('../lib/auth.js');
    const { secret } = await issueLoginToken(email);

    const verified = await authVerify(get(`/api/auth-verify?token=${encodeURIComponent(secret)}`));
    const cookie = cookieFrom(verified);
    assert.ok(cookie, 'the caller really is signed in');

    const res = await submitIdea(post('/api/submit-idea', {
      title: 'Signed in but unsigned', content: SECRET,
    }, cookie));

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'nda_not_executed');
    assert.equal(body.error.executeAt, '/nda.html');

    assert.equal((await listSubmissionsForTenant(email)).length, 0);
  });

  test('nothing is written to disk for a rejected submission', async () => {
    const stored = await listSubmissionsForTenant('nobody@example.test');
    assert.equal(stored.length, 0, 'a rejected submission must leave no trace');
  });

  test('the refusal is server-side, not merely a disabled form field', async () => {
    // Bypass the UI entirely, exactly as an attacker or a curl user would.
    const res = await submitIdea(post('/api/submit-idea', {
      title: 'Bypassing the browser', content: SECRET,
    }));
    assert.equal(res.status, 401);
  });

  test('identity cannot be forged through the request body', async () => {
    const { cookie } = await signUp('owner@example.test');
    // Claim to be someone else while holding owner's session.
    const res = await submitIdea(post('/api/submit-idea', {
      email: 'victim@example.test', title: 'Misattributed', content: SECRET,
    }, cookie));
    assert.equal(res.status, 201);

    // The submission must land on the session's account, not the claimed one.
    assert.equal((await listSubmissionsForTenant('victim@example.test')).length, 0);
    assert.equal((await listSubmissionsForTenant('owner@example.test')).length, 1);
  });
});

/* ========================================================================== */

describe('execution', () => {
  let executed;

  test('refuses without affirmative assent', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace', email: 'ada@example.test',
      assent: false, consentToElectronicRecords: true,
    }));
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'assent_required');
  });

  test('refuses without ESIGN consent', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace', email: 'ada@example.test',
      assent: true, consentToElectronicRecords: false,
    }));
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'esign_consent_required');
  });

  test('refuses when the text the user saw differs from the server copy', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace', email: 'ada@example.test',
      assent: true, consentToElectronicRecords: true,
      agreementHash: hashText('a document that is not the agreement'),
    }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, 'agreement_hash_mismatch');
  });

  test('executes and countersigns when everything is in order', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace', email: 'Ada@Example.Test',
      assent: true, consentToElectronicRecords: true,
      agreementHash: hashText(AGREEMENT_TEXT),
    }));

    assert.equal(res.status, 201);
    executed = await res.json();

    assert.equal(executed.agreementVersion, AGREEMENT_VERSION);
    assert.equal(executed.agreementHash, hashText(AGREEMENT_TEXT));
    assert.ok(executed.countersignature, 'must be countersigned');
    assert.ok(executed.chainHash, 'must be linked into the log chain');
  });

  test('signing also signs you in', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Signed In', email: 'signedin@example.test',
      assent: true, consentToElectronicRecords: true,
    }));
    const cookie = cookieFrom(res);
    assert.ok(cookie, 'execution must set a session cookie');

    const who = await me(get('/api/me', cookie));
    const body = await who.json();
    assert.equal(body.signedIn, true);
    assert.equal(body.email, 'signedin@example.test');
    assert.equal(body.nda.executed, true);
  });

  test('re-executing the same version is idempotent, not a duplicate', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace', email: 'ada@example.test',
      assent: true, consentToElectronicRecords: true,
    }));
    const body = await res.json();
    assert.equal(body.alreadyExecuted, true);
    assert.equal(body.id, executed.id);
  });

  test('the email is normalised so identity is stable across casing', async () => {
    const res = await verifyNda(get(`/api/verify-nda?id=${executed.id}`));
    const body = await res.json();
    assert.match(body.signatory.email, /@example\.test$/);
  });
});

/* ========================================================================== */

describe('sign-in', () => {
  test('requesting a link never reveals whether an account exists', async () => {
    const known = await requestLink(post('/api/auth-request-link', { email: 'ada@example.test' }));
    const unknown = await requestLink(post('/api/auth-request-link', { email: 'ghost@example.test' }));

    assert.equal(known.status, unknown.status);
    assert.deepEqual(await known.json(), await unknown.json());
  });

  test('a sign-in link works once, then never again', async () => {
    const { issueLoginToken } = await import('../lib/auth.js');
    const { secret } = await issueLoginToken('replay@example.test');

    const first = await authVerify(get(`/api/auth-verify?token=${encodeURIComponent(secret)}`));
    assert.equal(first.status, 302);
    assert.ok(cookieFrom(first), 'first use must issue a session');

    const second = await authVerify(get(`/api/auth-verify?token=${encodeURIComponent(secret)}`));
    assert.equal(second.status, 302);
    assert.match(second.headers.get('location'), /error=invalid_token/,
      'a consumed link must not be replayable');
  });

  test('a garbage token is refused', async () => {
    const res = await authVerify(get('/api/auth-verify?token=not-a-real-token'));
    assert.match(res.headers.get('location'), /error=invalid_token/);
  });

  test('signing out destroys the session server-side', async () => {
    const { cookie } = await signUp('logout@example.test');
    assert.equal((await (await me(get('/api/me', cookie))).json()).signedIn, true);

    await authLogout(post('/api/auth-logout', {}, cookie));

    // Replaying the same cookie must now fail — clearing it client-side is not enough.
    const after = await me(get('/api/me', cookie));
    assert.equal((await after.json()).signedIn, false);
  });

  test('anonymous callers get a plain answer, not an error', async () => {
    const res = await me(get('/api/me'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).signedIn, false);
  });
});

/* ========================================================================== */

describe('verification', () => {
  let id;

  before(async () => {
    const { body } = await signUp('grace@example.test', 'Grace Hopper');
    id = body.id;
  });

  test('a genuine record verifies on every check', async () => {
    const res = await verifyNda(get(`/api/verify-nda?id=${id}`));
    const body = await res.json();

    assert.equal(body.found, true);
    assert.equal(body.checks.agreementTextResolvable, true);
    assert.equal(body.checks.agreementHashMatchesStoredText, true);
    assert.equal(body.checks.countersignatureValid, true);
    assert.equal(body.checks.isCurrentVersion, true);
  });

  test('an unaltered copy of the agreement is confirmed authentic', async () => {
    const res = await verifyNda(post('/api/verify-nda', { id, text: AGREEMENT_TEXT }));
    assert.equal((await res.json()).submittedCopy.matchesExecutedAgreement, true);
  });

  test('a copy altered by ONE character is detected', async () => {
    const tampered = AGREEMENT_TEXT.replace('strict confidence', 'strict Confidence');
    assert.notEqual(tampered, AGREEMENT_TEXT, 'the tamper must actually change the text');

    const res = await verifyNda(post('/api/verify-nda', { id, text: tampered }));
    assert.equal((await res.json()).submittedCopy.matchesExecutedAgreement, false);
  });

  test('verification stays public — no session required', async () => {
    const res = await verifyNda(get(`/api/verify-nda?id=${id}`));
    assert.equal(res.status, 200, 'a user must be able to verify without our cooperation');
  });

  test('the signatory email is redacted for anonymous callers', async () => {
    const body = await (await verifyNda(get(`/api/verify-nda?id=${id}`))).json();
    assert.ok(!body.signatory.email.includes('grace'), 'must not expose the full address');
    assert.ok(body.signatory.email.includes('@example.test'));
  });

  test('an unknown id is reported as not found, without leaking', async () => {
    const res = await verifyNda(get('/api/verify-nda?id=does-not-exist'));
    assert.equal(res.status, 404);
    assert.equal((await res.json()).found, false);
  });

  test('the public key is published for offline verification', async () => {
    const res = await verifyNda(get('/api/verify-nda?publicKey=1'));
    assert.match(await res.text(), /BEGIN PUBLIC KEY/);
  });

  test('the append-only log chain is intact', async () => {
    const body = await (await verifyNda(get('/api/verify-nda?audit=1'))).json();
    assert.equal(body.ok, true);
    assert.equal(body.brokenAt, null);
  });
});

/* ========================================================================== */

describe('the countersigned PDF', () => {
  let id, cookie;

  before(async () => {
    const signed = await signUp('pdf@example.test', 'Pdf Holder');
    id = signed.body.id;
    cookie = signed.cookie;
  });

  test('is retrievable by the signatory', async () => {
    const res = await countersignedPdf(get(`/api/countersigned-pdf?id=${id}`, cookie));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');

    const pdf = Buffer.from(await res.arrayBuffer());
    assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
    assert.ok(pdf.includes('%%EOF'), 'must be a complete document');
  });

  test('is refused to anonymous callers', async () => {
    const res = await countersignedPdf(get(`/api/countersigned-pdf?id=${id}`));
    assert.equal(res.status, 401);
  });

  test('is refused to a different signed-in account', async () => {
    const other = await signUp('intruder@example.test');
    const res = await countersignedPdf(get(`/api/countersigned-pdf?id=${id}`, other.cookie));
    assert.equal(res.status, 404, 'another account must not read this agreement');
  });
});

/* ========================================================================== */

describe('the vault', () => {
  const email = 'katherine@example.test';
  let cookie, submissionId;

  before(async () => {
    cookie = (await signUp(email, 'Katherine Johnson')).cookie;
  });

  test('accepts a submission once the NDA is in force', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      title: 'Orbital reentry calculator', content: SECRET,
    }, cookie));

    assert.equal(res.status, 201);
    const body = await res.json();
    submissionId = body.id;

    assert.equal(body.contentDigest, hashText(SECRET));
    assert.equal(body.revision, 1);
    assert.ok(body.governedBy.ndaExecutionId, 'must be bound to the agreement in force');
  });

  test('never echoes the submitted content back', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      title: 'Second idea', content: SECRET,
    }, cookie));
    const raw = await res.text();
    assert.ok(!raw.includes(SECRET), 'a leaked response must not be a leaked idea');
  });

  test('stores content as ciphertext — plaintext is nowhere on disk', async () => {
    const files = await readdir(path.join(DATA_DIR, 'submissions'));
    assert.ok(files.length > 0);

    for (const file of files) {
      const raw = await readFile(path.join(DATA_DIR, 'submissions', file), 'utf8');
      assert.ok(!raw.includes(SECRET),
        `plaintext found in ${file} — the encryption-at-rest claim is false`);
      assert.ok(!raw.includes('vending machine'), `partial plaintext found in ${file}`);
      assert.match(raw, /"ciphertext"/);
    }
  });

  test('lists submissions without decrypting them', async () => {
    const res = await submissions(get('/api/submissions', cookie));
    const body = await res.json();

    assert.equal(body.count, 2);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(SECRET), 'the index must not carry plaintext');
    assert.ok(body.submissions[0].title, 'titles are listable');
  });

  test('returns plaintext only when a submission is opened', async () => {
    const res = await submissions(get(`/api/submissions?id=${submissionId}`, cookie));
    const body = await res.json();
    assert.equal(body.content, SECRET);
    assert.equal(body.contentDigest, hashText(SECRET));
  });

  test('revisions accumulate rather than overwrite', async () => {
    const revised = 'A vending machine that also accepts squats.';
    const res = await submissions(
      post(`/api/submissions?id=${submissionId}`, { content: revised }, cookie));
    assert.equal(res.status, 201);
    assert.equal((await res.json()).revisionCount, 2);

    // The original text must still be retrievable — it is the record of what was
    // disclosed and when.
    const first = await submissions(
      get(`/api/submissions?id=${submissionId}&revision=1`, cookie));
    assert.equal((await first.json()).content, SECRET);

    const latest = await submissions(get(`/api/submissions?id=${submissionId}`, cookie));
    assert.equal((await latest.json()).content, revised);
  });

  test('refuses oversized submissions', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      title: 'Too big', content: 'x'.repeat(100_001),
    }, cookie));
    assert.equal(res.status, 413);
  });

  test('one account cannot read another account\'s submission', async () => {
    const other = await signUp('nosy@example.test');
    const res = await submissions(get(`/api/submissions?id=${submissionId}`, other.cookie));
    assert.equal(res.status, 404, 'must be indistinguishable from a nonexistent id');
  });

  test('one account cannot revise another account\'s submission', async () => {
    const other = await signUp('nosy2@example.test');
    const res = await submissions(
      post(`/api/submissions?id=${submissionId}`, { content: 'overwritten' }, other.cookie));
    assert.equal(res.status, 404);

    // And the original is untouched.
    const check = await submissions(get(`/api/submissions?id=${submissionId}`, cookie));
    assert.notEqual((await check.json()).content, 'overwritten');
  });
});

/* ========================================================================== */

describe('export — a contractual obligation, not a feature', () => {
  const email = 'exporter@example.test';
  let cookie;

  before(async () => {
    cookie = (await signUp(email, 'Ex Porter')).cookie;
    await submitIdea(post('/api/submit-idea', { title: 'Exportable', content: SECRET }, cookie));
  });

  test('returns everything, decrypted, in a non-proprietary format', async () => {
    const res = await exportAll(get('/api/export-all', cookie));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);

    const bundle = JSON.parse(await res.text());
    assert.equal(bundle.account.email, email);
    assert.equal(bundle.submissions.length, 1);
    assert.equal(bundle.submissions[0].revisions[0].content, SECRET);
  });

  test('includes the agreement, so the bundle is self-describing', async () => {
    const bundle = JSON.parse(await (await exportAll(get('/api/export-all', cookie))).text());
    assert.ok(bundle.agreement.executionId);
    assert.ok(bundle.agreement.documentHash);
    assert.match(bundle.agreement.verifyUrl, /verify\.html/);
  });

  test('is refused to anonymous callers', async () => {
    assert.equal((await exportAll(get('/api/export-all'))).status, 401);
  });

  test('consults no billing state — there is no paywall to add', async () => {
    // NDA §10.2 promises export survives non-payment. The strongest form of that
    // promise is that no payment check exists in the code path at all.
    const source = await readFile(new URL('../api/export-all.js', import.meta.url), 'utf8');
    for (const term of ['subscription', 'billing', 'plan', 'paid', 'stripe']) {
      assert.ok(!new RegExp(`\\b${term}\\b`, 'i').test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
        `export-all.js references "${term}" outside comments — export must not be gated`);
    }
  });
});

/* ========================================================================== */

describe('deletion is cryptographic, not cosmetic', () => {
  const email = 'radia@example.test';
  let cookie;

  before(async () => {
    cookie = (await signUp(email, 'Radia Perlman')).cookie;
    await submitIdea(post('/api/submit-idea', { title: 'Spanning tree', content: SECRET }, cookie));
  });

  test('destroys the account key and removes every ciphertext', async () => {
    assert.ok((await listSubmissionsForTenant(email)).length > 0);

    const result = await destroyTenantData(email);
    assert.equal(result.keyDestroyed, true);
    assert.ok(result.ciphertextsRemoved > 0);
    assert.equal((await listSubmissionsForTenant(email)).length, 0);
  });

  test('signs the account out everywhere', async () => {
    const res = await me(get('/api/me', cookie));
    assert.equal((await res.json()).signedIn, false,
      'live sessions must not survive erasure of the key they depend on');
  });

  test('the execution record survives — it is evidence, not content', async () => {
    const audit = await auditChain();
    assert.equal(audit.ok, true, 'destroying content must not break the execution log');
  });
});

/* ========================================================================== */

describe('the agreement endpoint', () => {
  test('serves the canonical text with a matching hash', async () => {
    const body = await (await agreement(get('/api/agreement'))).json();

    assert.equal(body.text, AGREEMENT_TEXT, 'must serve the canonical bytes verbatim');
    assert.equal(body.hash, hashText(body.text), 'the advertised hash must match the text served');
    assert.equal(body.isCurrent, true);
  });

  test('rejects an unknown version rather than guessing', async () => {
    assert.equal((await agreement(get('/api/agreement?version=9.9.9'))).status, 404);
  });
});
