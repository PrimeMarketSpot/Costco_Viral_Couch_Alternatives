/* ---------------------------------------------------------------------------
   Storage.

   Two collections, with deliberately different physics:

     executions  — APPEND-ONLY. There is no update and no delete. An NDA
                   execution record is evidence; a system that can quietly revise
                   it is a system whose evidence is worthless. Records are also
                   hash-chained: each carries the hash of its predecessor, so
                   removing or reordering history is detectable.

     submissions — encrypted at rest, and DELETABLE, because the user has an
                   absolute right to erasure under the NDA (§10.3). Deletion
                   destroys the tenant's wrapped data key, which is what makes
                   the erasure real rather than a flag flip.

     auth         — sessions and single-use login tokens. Short-lived and freely
                   revocable; nothing here is evidence, so unlike executions it
                   can be deleted at will.

   This file-backed implementation is for local development and for the initial
   deploy. The exported interface is the seam: swapping in Postgres, DynamoDB, or
   Netlify Blobs means reimplementing these functions and nothing else.
   --------------------------------------------------------------------------- */

import { mkdir, readFile, writeFile, appendFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { hashText, canonicalize } from './crypto.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const EXECUTIONS_LOG = path.join(DATA_DIR, 'executions.jsonl');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
const SUBMISSIONS_DIR = path.join(DATA_DIR, 'submissions');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const COUNTERS_DIR = path.join(DATA_DIR, 'counters');
const LOGIN_TOKENS_DIR = path.join(DATA_DIR, 'login-tokens');

const GENESIS = '0'.repeat(64);

async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(TENANTS_DIR, { recursive: true });
  await mkdir(SUBMISSIONS_DIR, { recursive: true });
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(COUNTERS_DIR, { recursive: true });
  await mkdir(LOGIN_TOKENS_DIR, { recursive: true });
}

async function readLog() {
  if (!existsSync(EXECUTIONS_LOG)) return [];
  const raw = await readFile(EXECUTIONS_LOG, 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/* -------------------------------------------------------------------------- */
/* Executions — append-only, hash-chained                                      */
/* -------------------------------------------------------------------------- */

/**
 * Append an execution record. Returns the stored record including the chain
 * link. Callers must not mutate what comes back.
 */
export async function appendExecution(record) {
  await ensureDirs();
  const log = await readLog();
  const prevChainHash = log.length ? log[log.length - 1].chainHash : GENESIS;

  const linked = { ...record, prevChainHash };
  const chainHash = hashText(canonicalize(linked));
  const stored = { ...linked, chainHash };

  await appendFile(EXECUTIONS_LOG, `${JSON.stringify(stored)}\n`, 'utf8');
  return stored;
}

export async function getExecution(id) {
  const log = await readLog();
  return log.find((entry) => entry.id === id) ?? null;
}

/** Most recent execution for a tenant, or null if they have never signed. */
export async function latestExecutionForTenant(tenantId) {
  const log = await readLog();
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].tenantId === tenantId) return log[i];
  }
  return null;
}

/**
 * Walk the chain and confirm nothing was removed, reordered, or edited.
 * Returns { ok, length, brokenAt }.
 */
export async function auditChain() {
  const log = await readLog();
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const { chainHash, ...body } = log[i];
    if (body.prevChainHash !== prev) return { ok: false, length: log.length, brokenAt: i };
    if (hashText(canonicalize(body)) !== chainHash) return { ok: false, length: log.length, brokenAt: i };
    prev = chainHash;
  }
  return { ok: true, length: log.length, brokenAt: null };
}

/* -------------------------------------------------------------------------- */
/* Tenant keys                                                                 */
/* -------------------------------------------------------------------------- */

const tenantKeyPath = (tenantId) => path.join(TENANTS_DIR, `${encodeURIComponent(tenantId)}.json`);

export async function getTenantKeyRecord(tenantId) {
  const file = tenantKeyPath(tenantId);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function putTenantKeyRecord(tenantId, wrappedDek) {
  await ensureDirs();
  const record = { tenantId, wrappedDek, createdAt: new Date().toISOString() };
  await writeFile(tenantKeyPath(tenantId), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/* -------------------------------------------------------------------------- */
/* Submissions — encrypted at rest                                             */
/* -------------------------------------------------------------------------- */

export async function putSubmission(submission) {
  await ensureDirs();
  const file = path.join(SUBMISSIONS_DIR, `${submission.id}.json`);
  await writeFile(file, JSON.stringify(submission, null, 2), 'utf8');
  return submission;
}

export async function getSubmission(id) {
  const file = path.join(SUBMISSIONS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function listSubmissionsForTenant(tenantId) {
  await ensureDirs();
  const files = await readdir(SUBMISSIONS_DIR);
  const out = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(path.join(SUBMISSIONS_DIR, file), 'utf8'));
    if (record.tenantId === tenantId) out.push(record);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Append a new revision to an existing submission.
 *
 * Revisions accumulate rather than overwrite. An idea's history is often the
 * evidence of when you conceived what — which is exactly what matters in a
 * priority dispute — so a save must never silently discard the prior text.
 * Every revision carries its own ciphertext and its own plaintext digest.
 */
export async function appendRevision(id, revision) {
  const submission = await getSubmission(id);
  if (!submission) return null;

  const revisions = submission.revisions ?? [];
  const updated = {
    ...submission,
    revisions: [...revisions, revision],
    updatedAt: revision.createdAt,
  };

  await writeFile(
    path.join(SUBMISSIONS_DIR, `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf8',
  );
  return updated;
}

/**
 * Cryptographic erasure: destroy the tenant's wrapped data key so that every
 * ciphertext encrypted under it becomes permanently unrecoverable, then remove
 * the ciphertext too. The execution log is deliberately NOT touched — the record
 * that an NDA was signed is evidence both parties may need, and it contains no
 * submission content.
 */
export async function destroyTenantData(tenantId) {
  const keyFile = tenantKeyPath(tenantId);
  const keyDestroyed = existsSync(keyFile);
  if (keyDestroyed) await unlink(keyFile);

  const submissions = await listSubmissionsForTenant(tenantId);
  for (const record of submissions) {
    await unlink(path.join(SUBMISSIONS_DIR, `${record.id}.json`));
  }

  // Sign the account out everywhere. Leaving live sessions pointing at a tenant
  // whose key no longer exists would only produce confusing decryption failures.
  const sessionsRevoked = await revokeSessionsForTenant(tenantId);

  return {
    tenantId,
    keyDestroyed,
    ciphertextsRemoved: submissions.length,
    sessionsRevoked,
    destroyedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Sessions and login tokens are stored under the SHA-256 of their secret, never
 * the secret itself. A read-only leak of this directory therefore does not let
 * anyone authenticate — the same reason password hashes exist. The lookup still
 * works because the caller always presents the secret and we hash it to find
 * the row.
 */

const sessionPath = (tokenHash) => path.join(SESSIONS_DIR, `${tokenHash}.json`);

export async function putSession(tokenHash, session) {
  await ensureDirs();
  const record = { ...session, tokenHash };
  await writeFile(sessionPath(tokenHash), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export async function getSession(tokenHash) {
  const file = sessionPath(tokenHash);
  if (!existsSync(file)) return null;

  const record = JSON.parse(await readFile(file, 'utf8'));
  if (new Date(record.expiresAt) <= new Date()) {
    await unlink(file).catch(() => {});
    return null;
  }
  return record;
}

export async function deleteSession(tokenHash) {
  const file = sessionPath(tokenHash);
  if (!existsSync(file)) return false;
  await unlink(file);
  return true;
}

export async function revokeSessionsForTenant(tenantId) {
  await ensureDirs();
  const files = await readdir(SESSIONS_DIR);
  let revoked = 0;
  for (const file of files) {
    const full = path.join(SESSIONS_DIR, file);
    const record = JSON.parse(await readFile(full, 'utf8'));
    if (record.tenantId === tenantId) {
      await unlink(full);
      revoked++;
    }
  }
  return revoked;
}

/* -------------------------------------------------------------------------- */
/* Login tokens — single use                                                   */
/* -------------------------------------------------------------------------- */

const loginTokenPath = (tokenHash) => path.join(LOGIN_TOKENS_DIR, `${tokenHash}.json`);

export async function putLoginToken(tokenHash, record) {
  await ensureDirs();
  await writeFile(loginTokenPath(tokenHash), JSON.stringify({ ...record, tokenHash }, null, 2), 'utf8');
}

/**
 * Read and immediately destroy a login token. Deleting before returning is what
 * makes it single-use: a link that leaks from an inbox, a proxy log, or a
 * browser history cannot be replayed once it has been followed.
 * Returns null if the token is unknown or expired.
 */
export async function consumeLoginToken(tokenHash) {
  const file = loginTokenPath(tokenHash);
  if (!existsSync(file)) return null;

  const record = JSON.parse(await readFile(file, 'utf8'));
  await unlink(file);

  if (new Date(record.expiresAt) <= new Date()) return null;
  return record;
}

/* -------------------------------------------------------------------------- */
/* Rate-limit counters                                                         */
/* -------------------------------------------------------------------------- */

const counterPath = (key) => path.join(COUNTERS_DIR, `${encodeURIComponent(key)}.json`);

/**
 * Increment a fixed-window counter and return its state.
 * An expired window resets rather than accumulating forever.
 */
export async function bumpCounter(key, windowMs) {
  await ensureDirs();
  const file = counterPath(key);
  const now = Date.now();

  let record = null;
  if (existsSync(file)) {
    try { record = JSON.parse(await readFile(file, 'utf8')); } catch { record = null; }
  }

  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + windowMs };
  }

  record.count += 1;
  await writeFile(file, JSON.stringify(record), 'utf8');
  return record;
}
