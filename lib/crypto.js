/* ---------------------------------------------------------------------------
   Cryptographic primitives.

   Three jobs, each tied to a promise made on the site:

   1. hashText()        — "the document you signed is the document we stored"
   2. envelope crypto   — "we cannot read your idea, so we cannot train on it"
   3. Ed25519 signing   — "our countersignature is verifiable by anyone,
                           including without our cooperation"

   The signing key is ASYMMETRIC on purpose. An HMAC would let us prove a
   countersignature only to ourselves, which is worth nothing to a user in a
   dispute. With Ed25519 we publish the public key and any third party — a court,
   a journalist, an adversary — can verify our signature without our help.
   --------------------------------------------------------------------------- */

import {
  createHash,
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';

/* -------------------------------------------------------------------------- */
/* Hashing                                                                     */
/* -------------------------------------------------------------------------- */

/** SHA-256 of a UTF-8 string, lowercase hex. This is the document fingerprint. */
export function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Deterministic JSON: keys sorted recursively so the same logical record always
 * serializes to the same bytes. Signing a non-deterministic serialization is a
 * classic way to build a signature that mysteriously stops verifying.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export function newId() {
  return randomUUID();
}

/** Constant-time-ish equality for hex digests. */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* Envelope encryption                                                         */
/* -------------------------------------------------------------------------- */

const KEY_BYTES = 32;
const IV_BYTES = 12;

function masterKey() {
  const raw = process.env.MASTER_KEK;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MASTER_KEK is required in production. Refusing to store plaintext.');
    }
    // Deterministic dev-only key so local runs are reproducible. Never in prod.
    console.warn('[crypto] MASTER_KEK unset — using an INSECURE dev key. Do not deploy this way.');
    return createHash('sha256').update('insecure-development-kek').digest();
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`MASTER_KEK must decode to ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  return key;
}

function aesEncrypt(key, plaintext, aad) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function aesDecrypt(key, blob, aad) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Mint a fresh per-tenant data key, wrapped under the master key.
 *
 * The tenant id is bound in as AAD, so a wrapped key stolen from one tenant's
 * row cannot be replayed against another's.
 */
export function createTenantKey(tenantId) {
  const dek = randomBytes(KEY_BYTES);
  const wrapped = aesEncrypt(masterKey(), dek.toString('base64'), `tenant:${tenantId}`);
  return { wrappedDek: wrapped, dek };
}

export function unwrapTenantKey(tenantId, wrappedDek) {
  return Buffer.from(aesDecrypt(masterKey(), wrappedDek, `tenant:${tenantId}`), 'base64');
}

/** Encrypt submission content under the tenant's data key. */
export function encryptForTenant(dek, tenantId, plaintext) {
  return aesEncrypt(dek, plaintext, `submission:${tenantId}`);
}

export function decryptForTenant(dek, tenantId, blob) {
  return aesDecrypt(dek, blob, `submission:${tenantId}`);
}

/* -------------------------------------------------------------------------- */
/* Countersignature (Ed25519)                                                  */
/* -------------------------------------------------------------------------- */

let cachedKeyPair = null;

function countersignKeyPair() {
  if (cachedKeyPair) return cachedKeyPair;

  const pem = process.env.COUNTERSIGN_PRIVATE_KEY;
  if (pem) {
    const privateKey = createPrivateKey(pem);
    cachedKeyPair = { privateKey, publicKey: createPublicKey(privateKey), ephemeral: false };
    return cachedKeyPair;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('COUNTERSIGN_PRIVATE_KEY is required in production.');
  }
  console.warn('[crypto] COUNTERSIGN_PRIVATE_KEY unset — generating an EPHEMERAL dev key. ' +
    'Signatures will not verify across restarts. Do not deploy this way.');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  cachedKeyPair = { privateKey, publicKey, ephemeral: true };
  return cachedKeyPair;
}

/** Sign a record. Returns base64 Ed25519 signature over its canonical form. */
export function countersign(record) {
  const { privateKey } = countersignKeyPair();
  return edSign(null, Buffer.from(canonicalize(record), 'utf8'), privateKey).toString('base64');
}

export function verifyCountersignature(record, signatureB64) {
  try {
    const { publicKey } = countersignKeyPair();
    return edVerify(
      null,
      Buffer.from(canonicalize(record), 'utf8'),
      publicKey,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}

/** The public half, published so third parties can verify without us. */
export function countersignPublicKeyPem() {
  return countersignKeyPair().publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

export function usingEphemeralKey() {
  return countersignKeyPair().ephemeral;
}
