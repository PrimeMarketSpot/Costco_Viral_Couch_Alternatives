#!/usr/bin/env node
/**
 * Deployment preflight.
 *
 * Wired as the Netlify build command, so a misconfigured deploy fails HERE —
 * visibly, in the build log, before anything is served — rather than at runtime
 * when someone is halfway through signing an agreement.
 *
 * That ordering is the whole point. Every failure below is one that would
 * otherwise be silent or nearly so:
 *
 *   - Missing MASTER_KEK: the functions throw on first use, but only on the
 *     endpoints that encrypt. The marketing pages serve fine, so the site looks
 *     healthy while the product does not work.
 *
 *   - Missing COUNTERSIGN_PRIVATE_KEY: WORSE than throwing. In a non-production
 *     NODE_ENV the code falls back to an ephemeral key, so signing appears to
 *     succeed and countersignatures silently stop verifying after any cold
 *     start. The failure surfaces days later, in the one feature the product
 *     exists to provide.
 *
 *   - Filesystem backend on serverless: execution records vanish between
 *     requests. Users sign, then are told they never signed.
 *
 * A build that fails is a bad afternoon. Any of the above shipping quietly is a
 * product whose central promise is false.
 */

const problems = [];
const notes = [];

const onNetlify = Boolean(process.env.NETLIFY);
const backend = process.env.STORE_BACKEND || (onNetlify ? 'blobs' : 'fs');

/* --- Storage --------------------------------------------------------------- */

if (backend === 'fs') {
  problems.push([
    'Storage backend resolves to the filesystem.',
    'Serverless filesystems are ephemeral: an NDA execution record written',
    'during signing would be gone by the next request, so the vault would',
    'refuse submissions from people who had just signed.',
    'Fix: this should be automatic on Netlify (NETLIFY=true selects Blobs).',
    'If you see this in a Netlify build, set STORE_BACKEND=blobs explicitly.',
  ].join('\n    '));
} else {
  notes.push(`storage backend: ${backend}`);
}

/* --- Keys ------------------------------------------------------------------ */

const kek = process.env.MASTER_KEK;
if (!kek) {
  problems.push([
    'MASTER_KEK is not set.',
    'This wraps the per-account key that encrypts every submission.',
    'Fix: npm run keygen, then add it as a SECRET env var scoped to Functions.',
    'Back it up before the first real submission — it has no recovery path.',
  ].join('\n    '));
} else {
  const bytes = Buffer.from(kek, 'base64');
  if (bytes.length !== 32) {
    problems.push(`MASTER_KEK must decode to 32 bytes; got ${bytes.length}.`);
  } else {
    notes.push('MASTER_KEK: present, 32 bytes');
  }
}

const signingKey = process.env.COUNTERSIGN_PRIVATE_KEY;
if (!signingKey) {
  problems.push([
    'COUNTERSIGN_PRIVATE_KEY is not set.',
    'Without it the server generates an EPHEMERAL signing key per process, so',
    'countersignatures verify until the next cold start and then silently stop.',
    'Every countersigned PDF issued in the meantime becomes unverifiable.',
    'Fix: npm run keygen, then add it as a SECRET env var scoped to Functions.',
  ].join('\n    '));
} else if (!signingKey.includes('BEGIN PRIVATE KEY')) {
  problems.push([
    'COUNTERSIGN_PRIVATE_KEY does not look like a PKCS8 PEM.',
    'Expected a block beginning "-----BEGIN PRIVATE KEY-----".',
    'Newlines must survive however you pasted it.',
  ].join('\n    '));
} else {
  notes.push('COUNTERSIGN_PRIVATE_KEY: present, PEM-shaped');
}

/* --- Mail ------------------------------------------------------------------ */

if (!process.env.MAIL_PROVIDER) {
  // Not fatal: the site is usable and honest without it, and the mailer throws
  // rather than dropping mail silently. But sign-in links reach nobody, so the
  // build log should say so plainly.
  notes.push('MAIL_PROVIDER: NOT SET — sign-in links and countersigned copies ' +
    'will not be delivered. See lib/mailer.js.');
}

/* --- Report ---------------------------------------------------------------- */

const line = '─'.repeat(70);
console.log(`\n${line}\n  Deployment preflight\n${line}`);
for (const note of notes) console.log(`  · ${note}`);

if (problems.length) {
  console.error(`\n  ${problems.length} blocking problem${problems.length === 1 ? '' : 's'}:\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  console.error(`${line}\n  Build stopped. Fix the above and redeploy.\n${line}\n`);
  process.exit(1);
}

console.log(`${line}\n  All checks passed.\n${line}\n`);
