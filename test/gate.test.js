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
const { AGREEMENT_TEXT, AGREEMENT_VERSION } = await import('../lib/nda-text.js');
const { hashText } = await import('../lib/crypto.js');
const { auditChain, destroyTenantData, listSubmissionsForTenant } = await import('../lib/store.js');

const ORIGIN = 'https://example.test';

const post = (url, body) => new Request(`${ORIGIN}${url}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'test-runner' },
  body: JSON.stringify(body),
});

const get = (url) => new Request(`${ORIGIN}${url}`);

const SECRET = 'A vending machine that only dispenses when you have walked 10,000 steps.';

after(async () => { await rm(DATA_DIR, { recursive: true, force: true }); });

/* ========================================================================== */

describe('the gate: no NDA, no disclosure', () => {
  test('submit-idea refuses content from an account with no execution record', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      email: 'nobody@example.test',
      title: 'Test',
      content: SECRET,
    }));

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'nda_not_executed');
  });

  test('nothing is written to disk for a rejected submission', async () => {
    const stored = await listSubmissionsForTenant('nobody@example.test');
    assert.equal(stored.length, 0, 'a rejected submission must leave no trace');
  });

  test('the refusal is server-side, not merely a disabled form field', async () => {
    // Bypass the UI entirely, exactly as an attacker or a curl user would.
    const res = await submitIdea(post('/api/submit-idea', {
      email: 'DIRECT@Example.Test',
      title: 'Bypassing the browser',
      content: SECRET,
    }));
    assert.equal(res.status, 403);
  });
});

/* ========================================================================== */

describe('execution', () => {
  let executed;

  test('refuses without affirmative assent', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      assent: false,
      consentToElectronicRecords: true,
    }));
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'assent_required');
  });

  test('refuses without ESIGN consent', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      assent: true,
      consentToElectronicRecords: false,
    }));
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'esign_consent_required');
  });

  test('refuses when the text the user saw differs from the server copy', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      assent: true,
      consentToElectronicRecords: true,
      agreementHash: hashText('a document that is not the agreement'),
    }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, 'agreement_hash_mismatch');
  });

  test('executes and countersigns when everything is in order', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace',
      email: 'Ada@Example.Test',
      assent: true,
      consentToElectronicRecords: true,
      agreementHash: hashText(AGREEMENT_TEXT),
    }));

    assert.equal(res.status, 201);
    executed = await res.json();

    assert.equal(executed.agreementVersion, AGREEMENT_VERSION);
    assert.equal(executed.agreementHash, hashText(AGREEMENT_TEXT));
    assert.ok(executed.countersignature, 'must be countersigned');
    assert.ok(executed.chainHash, 'must be linked into the log chain');
  });

  test('re-executing the same version is idempotent, not a duplicate', async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      assent: true,
      consentToElectronicRecords: true,
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

describe('verification', () => {
  let id;

  before(async () => {
    const res = await executeNda(post('/api/execute-nda', {
      fullName: 'Grace Hopper',
      email: 'grace@example.test',
      assent: true,
      consentToElectronicRecords: true,
    }));
    id = (await res.json()).id;
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
    const body = await res.json();
    assert.equal(body.submittedCopy.matchesExecutedAgreement, true);
  });

  test('a copy altered by ONE character is detected', async () => {
    // Change "strict confidence" to "strict Confidence". Nothing else.
    const tampered = AGREEMENT_TEXT.replace('strict confidence', 'strict Confidence');
    assert.notEqual(tampered, AGREEMENT_TEXT, 'the tamper must actually change the text');

    const res = await verifyNda(post('/api/verify-nda', { id, text: tampered }));
    const body = await res.json();
    assert.equal(body.submittedCopy.matchesExecutedAgreement, false);
  });

  test('the signatory email is redacted for anonymous callers', async () => {
    const res = await verifyNda(get(`/api/verify-nda?id=${id}`));
    const body = await res.json();
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
    const pem = await res.text();
    assert.match(pem, /BEGIN PUBLIC KEY/);
  });

  test('the append-only log chain is intact', async () => {
    const res = await verifyNda(get('/api/verify-nda?audit=1'));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.brokenAt, null);
  });
});

/* ========================================================================== */

describe('submission after execution', () => {
  const email = 'katherine@example.test';
  let submissionId;

  before(async () => {
    await executeNda(post('/api/execute-nda', {
      fullName: 'Katherine Johnson',
      email,
      assent: true,
      consentToElectronicRecords: true,
    }));
  });

  test('is accepted once the NDA is in force', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      email,
      title: 'Orbital reentry calculator',
      content: SECRET,
    }));

    assert.equal(res.status, 201);
    const body = await res.json();
    submissionId = body.id;

    assert.equal(body.contentDigest, hashText(SECRET));
    assert.ok(body.governedBy.ndaExecutionId, 'must be bound to the agreement in force');
  });

  test('the response never echoes the submitted content back', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      email,
      title: 'Second idea',
      content: SECRET,
    }));
    const raw = await res.text();
    assert.ok(!raw.includes(SECRET), 'a leaked response must not be a leaked idea');
  });

  test('content is ciphertext at rest — the plaintext is nowhere on disk', async () => {
    const files = await readdir(path.join(DATA_DIR, 'submissions'));
    assert.ok(files.length > 0);

    for (const file of files) {
      const raw = await readFile(path.join(DATA_DIR, 'submissions', file), 'utf8');
      assert.ok(!raw.includes(SECRET),
        `plaintext found in ${file} — the encryption-at-rest claim is false`);
      assert.ok(!raw.includes('vending machine'),
        `partial plaintext found in ${file}`);
      assert.match(raw, /"ciphertext"/);
    }
  });

  test('oversized submissions are refused', async () => {
    const res = await submitIdea(post('/api/submit-idea', {
      email,
      title: 'Too big',
      content: 'x'.repeat(100_001),
    }));
    assert.equal(res.status, 413);
  });
});

/* ========================================================================== */

describe('deletion is cryptographic, not cosmetic', () => {
  const email = 'radia@example.test';

  before(async () => {
    await executeNda(post('/api/execute-nda', {
      fullName: 'Radia Perlman',
      email,
      assent: true,
      consentToElectronicRecords: true,
    }));
    await submitIdea(post('/api/submit-idea', {
      email, title: 'Spanning tree', content: SECRET,
    }));
  });

  test('destroys the account key and removes every ciphertext', async () => {
    const before = await listSubmissionsForTenant(email);
    assert.ok(before.length > 0);

    const result = await destroyTenantData(email);
    assert.equal(result.keyDestroyed, true);
    assert.ok(result.ciphertextsRemoved > 0);

    const after = await listSubmissionsForTenant(email);
    assert.equal(after.length, 0);
  });

  test('the execution record survives deletion — it is evidence, not content', async () => {
    const audit = await auditChain();
    assert.equal(audit.ok, true, 'destroying content must not break the execution log');
  });
});

/* ========================================================================== */

describe('the agreement endpoint', () => {
  test('serves the canonical text with a matching hash', async () => {
    const res = await agreement(get('/api/agreement'));
    const body = await res.json();

    assert.equal(body.text, AGREEMENT_TEXT, 'must serve the canonical bytes verbatim');
    assert.equal(body.hash, hashText(body.text), 'the advertised hash must match the text served');
    assert.equal(body.isCurrent, true);
  });

  test('rejects an unknown version rather than guessing', async () => {
    const res = await agreement(get('/api/agreement?version=9.9.9'));
    assert.equal(res.status, 404);
  });
});
