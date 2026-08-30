/* ---------------------------------------------------------------------------
   Netlify Blobs backend.

   Same interface as store-fs.js. Selected automatically when running on
   Netlify, where the filesystem is ephemeral and the file backend would lose
   every execution record between invocations.

   Two properties of Blobs shape this file, and both are documented rather than
   glossed over, because the whole product rests on this data being trustworthy:

   1. NO CONCURRENCY CONTROL — last write wins. Every record here is therefore
      written to its OWN immutable key. No two writers ever target the same blob
      for record data, so a record can never be clobbered by a concurrent write.
      The one shared mutable key is the chain tail (see appendExecution).

   2. EVENTUALLY CONSISTENT by default (~60s). That is unacceptable for anything
      the next request depends on — an execution record written at signing must
      be visible to the submission that follows seconds later — so every store
      here is opened with `consistency: 'strong'`.

   Key layout, designed so no lookup on a hot path has to scan:

     exec/<iso>-<id>          one execution record, immutable
     exec-tail                {chainHash, count} — the only mutable shared key
     tenant-exec/<t>          → latest execution id for a tenant (hot path)
     tenant-key/<t>           wrapped per-tenant data key
     sub/<t>/<id>             submission, prefix-scoped so listing is per tenant
     sub-id/<id>              → key, so a single read never scans all tenants
     exec-id/<id>             → key, so public /verify never scans the log
     session/<hash>           session record
     login/<hash>             single-use login token

   <t> is a hash of the email rather than the address itself: blob keys show up
   in listings and logs, and a store whose key names enumerate its users' email
   addresses is not one this product should ship.
   --------------------------------------------------------------------------- */

import { getStore } from '@netlify/blobs';
import { hashText, canonicalize } from './crypto.js';

const GENESIS = '0'.repeat(64);

/** Short, stable, non-reversible tenant key segment. */
const tkey = (tenantId) => hashText(String(tenantId).trim().toLowerCase()).slice(0, 32);

/**
 * Production data lives in the global store; anything else gets a per-context
 * store, so a deploy preview can never read or write real submissions.
 */
function store(name) {
  const context = globalThis.Netlify?.context?.deploy?.context;
  const scoped = context && context !== 'production' ? `${name}-${context}` : name;
  return getStore({ name: scoped, consistency: 'strong' });
}

/* -------------------------------------------------------------------------- */
/* Executions — append-only, hash-chained                                      */
/* -------------------------------------------------------------------------- */

export async function appendExecution(record) {
  const execs = store('executions');

  // The chain tail is the ONE shared mutable key, and Blobs has no
  // compare-and-set. Two executions landing in the same instant can therefore
  // read the same tail and produce a fork. That is a real limitation, not a
  // hidden one: auditChain() below detects it, the per-record Ed25519
  // countersignature is unaffected, and at signup volumes where two people
  // execute within the same few milliseconds this is worth revisiting with a
  // database that supports transactional appends.
  const tail = (await execs.get('exec-tail', { type: 'json' })) ?? { chainHash: GENESIS, count: 0 };

  const linked = { ...record, prevChainHash: tail.chainHash };
  const chainHash = hashText(canonicalize(linked));
  const stored = { ...linked, chainHash };

  // Record first, under a key nothing else will ever write to. If the tail
  // update below fails, the evidence still exists and the audit reports a gap —
  // strictly better than a tail that points at a record that was never written.
  await execs.setJSON(`exec/${stored.executedAt}-${stored.id}`, stored);
  await execs.setJSON('exec-tail', { chainHash, count: tail.count + 1 });

  // Hot-path pointer: every protected request asks "has this account signed?",
  // and that must not become a scan.
  await execs.setJSON(`tenant-exec/${tkey(stored.tenantId)}`, { id: stored.id, key: `exec/${stored.executedAt}-${stored.id}` });

  // Direct id lookup, so /verify does not scan. That endpoint is public and
  // unauthenticated by design, which makes a scan there an amplification
  // vector: one cheap request costs work proportional to every execution ever
  // recorded, and the log can never be pruned.
  await execs.setJSON(`exec-id/${stored.id}`, { key: `exec/${stored.executedAt}-${stored.id}` });

  return stored;
}

export async function getExecution(id) {
  const execs = store('executions');

  const pointer = await execs.get(`exec-id/${id}`, { type: 'json' });
  if (pointer) return execs.get(pointer.key, { type: 'json' });

  // Fallback for records written before the index existed. Kept so old
  // countersigned PDFs keep resolving at /verify — the one thing this system
  // must never break — but it is the slow path and should stay rare.
  const { blobs } = await execs.list({ prefix: 'exec/' });
  const match = blobs.find((b) => b.key.endsWith(`-${id}`));
  if (!match) return null;
  return execs.get(match.key, { type: 'json' });
}

export async function latestExecutionForTenant(tenantId) {
  const execs = store('executions');
  const pointer = await execs.get(`tenant-exec/${tkey(tenantId)}`, { type: 'json' });
  if (!pointer) return null;
  return execs.get(pointer.key, { type: 'json' });
}

export async function auditChain() {
  const execs = store('executions');
  const { blobs } = await execs.list({ prefix: 'exec/' });

  // Keys are `exec/<iso>-<uuid>`, so lexical order is chronological order.
  const keys = blobs.map((b) => b.key).sort();

  let prev = GENESIS;
  for (let i = 0; i < keys.length; i++) {
    const entry = await execs.get(keys[i], { type: 'json' });
    const { chainHash, ...body } = entry;
    if (body.prevChainHash !== prev) return { ok: false, length: keys.length, brokenAt: i };
    if (hashText(canonicalize(body)) !== chainHash) return { ok: false, length: keys.length, brokenAt: i };
    prev = chainHash;
  }
  return { ok: true, length: keys.length, brokenAt: null };
}

/* -------------------------------------------------------------------------- */
/* Tenant keys                                                                 */
/* -------------------------------------------------------------------------- */

export async function getTenantKeyRecord(tenantId) {
  return store('tenants').get(`tenant-key/${tkey(tenantId)}`, { type: 'json' });
}

export async function putTenantKeyRecord(tenantId, wrappedDek) {
  const record = { tenantId, wrappedDek, createdAt: new Date().toISOString() };
  await store('tenants').setJSON(`tenant-key/${tkey(tenantId)}`, record);
  return record;
}

/* -------------------------------------------------------------------------- */
/* Submissions                                                                 */
/* -------------------------------------------------------------------------- */

const subKey = (tenantId, id) => `sub/${tkey(tenantId)}/${id}`;

export async function putSubmission(submission) {
  const subs = store('submissions');
  await subs.setJSON(subKey(submission.tenantId, submission.id), submission);
  // Index so a single-submission read does not scan every tenant's keys.
  await subs.setJSON(`sub-id/${submission.id}`,
    { key: subKey(submission.tenantId, submission.id) });
  return submission;
}

export async function getSubmission(id) {
  const subs = store('submissions');

  const pointer = await subs.get(`sub-id/${id}`, { type: 'json' });
  if (pointer) return subs.get(pointer.key, { type: 'json' });

  // Fallback for pre-index records. Callers still enforce ownership on the
  // returned record, so this never widens access — it is only slow.
  const { blobs } = await subs.list({ prefix: 'sub/' });
  const match = blobs.find((b) => b.key.endsWith(`/${id}`));
  if (!match) return null;
  return subs.get(match.key, { type: 'json' });
}

export async function listSubmissionsForTenant(tenantId) {
  const subs = store('submissions');
  const { blobs } = await subs.list({ prefix: `sub/${tkey(tenantId)}/` });

  const out = [];
  for (const blob of blobs) {
    const record = await subs.get(blob.key, { type: 'json' });
    if (record) out.push(record);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function appendRevision(id, revision) {
  const subs = store('submissions');
  const submission = await getSubmission(id);
  if (!submission) return null;

  const updated = {
    ...submission,
    revisions: [...(submission.revisions ?? []), revision],
    updatedAt: revision.createdAt,
  };
  await subs.setJSON(subKey(submission.tenantId, id), updated);
  return updated;
}

export async function destroyTenantData(tenantId) {
  const t = tkey(tenantId);

  // Destroy the key first. From this instant the ciphertext is unrecoverable
  // even if the deletes below fail partway — which is the point of encrypting
  // under a per-tenant key rather than trusting a delete to complete.
  const tenants = store('tenants');
  const keyExisted = (await tenants.get(`tenant-key/${t}`, { type: 'json' })) !== null;
  await tenants.delete(`tenant-key/${t}`);

  const subs = store('submissions');
  const { blobs } = await subs.list({ prefix: `sub/${t}/` });
  for (const blob of blobs) {
    // Clear the id index first: a pointer outliving its record would make a
    // deleted submission look merely unreadable rather than gone.
    const id = blob.key.split('/').pop();
    await subs.delete(`sub-id/${id}`);
    await subs.delete(blob.key);
  }

  const sessionsRevoked = await revokeSessionsForTenant(tenantId);

  return {
    tenantId,
    keyDestroyed: keyExisted,
    ciphertextsRemoved: blobs.length,
    sessionsRevoked,
    destroyedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export async function putSession(tokenHash, session) {
  const record = { ...session, tokenHash };
  await store('sessions').setJSON(`session/${tokenHash}`, record);
  return record;
}

export async function getSession(tokenHash) {
  const sessions = store('sessions');
  const record = await sessions.get(`session/${tokenHash}`, { type: 'json' });
  if (!record) return null;

  if (new Date(record.expiresAt) <= new Date()) {
    await sessions.delete(`session/${tokenHash}`);
    return null;
  }
  return record;
}

export async function deleteSession(tokenHash) {
  const sessions = store('sessions');
  const existed = (await sessions.get(`session/${tokenHash}`, { type: 'json' })) !== null;
  await sessions.delete(`session/${tokenHash}`);
  return existed;
}

export async function revokeSessionsForTenant(tenantId) {
  const sessions = store('sessions');
  const { blobs } = await sessions.list({ prefix: 'session/' });

  let revoked = 0;
  for (const blob of blobs) {
    const record = await sessions.get(blob.key, { type: 'json' });
    if (record && record.tenantId === tenantId) {
      await sessions.delete(blob.key);
      revoked++;
    }
  }
  return revoked;
}

/* -------------------------------------------------------------------------- */
/* Login tokens — single use                                                   */
/* -------------------------------------------------------------------------- */

export async function putLoginToken(tokenHash, record) {
  await store('sessions').setJSON(`login/${tokenHash}`, { ...record, tokenHash });
}

export async function consumeLoginToken(tokenHash) {
  const sessions = store('sessions');
  const record = await sessions.get(`login/${tokenHash}`, { type: 'json' });
  if (!record) return null;

  // Delete before returning — that is what makes the link single-use, so a link
  // leaked from an inbox or a proxy log cannot be replayed.
  await sessions.delete(`login/${tokenHash}`);

  if (new Date(record.expiresAt) <= new Date()) return null;
  return record;
}

/* -------------------------------------------------------------------------- */
/* Rate-limit counters                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Increment a fixed-window counter and return its state.
 *
 * Read-modify-write, because Blobs has no atomic increment. Concurrent requests
 * in the same instant can therefore both read the same value and undercount by
 * one — see the limitation documented at the top of lib/rate-limit.js. Strong
 * consistency (set on every store here) makes the window small, not zero.
 */
export async function bumpCounter(key, windowMs) {
  const counters = store('counters');
  const now = Date.now();

  let record = await counters.get(`counter/${key}`, { type: 'json' });
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + windowMs };
  }

  record.count += 1;
  await counters.setJSON(`counter/${key}`, record);
  return record;
}
