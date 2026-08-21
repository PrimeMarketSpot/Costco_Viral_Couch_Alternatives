#!/usr/bin/env node
/**
 * Generate the countersigning keypair and the master key-encryption key.
 *
 *   node scripts/keygen.js
 *
 * Prints the two environment variables the production deploy needs. Store the
 * private key in the host's secret manager — never in the repository.
 *
 * Rotating the countersigning key invalidates verification of every signature
 * made under the old one, so if you ever rotate, keep the old PUBLIC key
 * published alongside the new one and record which executions belong to which.
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const kek = randomBytes(32).toString('base64');

console.log(`
# ---------------------------------------------------------------------------
# Countersigning key (Ed25519). KEEP THE PRIVATE HALF SECRET.
# ---------------------------------------------------------------------------
COUNTERSIGN_PRIVATE_KEY="${privatePem.trimEnd().replace(/\n/g, '\\n')}"

# Public half — safe to publish. Served at /api/verify-nda?publicKey=1
# ${publicPem.trim().split('\n').join('\n# ')}

# ---------------------------------------------------------------------------
# Master key-encryption key. Wraps every per-account content key.
# LOSING THIS MAKES EVERY SUBMISSION PERMANENTLY UNREADABLE.
# ---------------------------------------------------------------------------
MASTER_KEK="${kek}"
`);
