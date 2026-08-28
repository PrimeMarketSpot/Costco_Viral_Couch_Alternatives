/**
 * Backend parity.
 *
 * Two storage backends now sit behind one interface, and only one of them
 * (filesystem) is exercised by the rest of the suite — the Blobs backend needs
 * Netlify to run against. That asymmetry is exactly how a production-only
 * failure gets shipped: add a function to the filesystem store, forget the
 * Blobs one, and the first call in production throws
 * "x is not a function" on a code path nobody could test locally.
 *
 * So these tests check the contract itself rather than the behaviour.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const fs = await import('../lib/store-fs.js');
const blobs = await import('../lib/store-blobs.js');
const facade = await import('../lib/store.js');

const isFn = (mod, name) => typeof mod[name] === 'function';

describe('storage backend parity', () => {
  const fsFns = Object.keys(fs).filter((k) => isFn(fs, k)).sort();
  const blobFns = Object.keys(blobs).filter((k) => isFn(blobs, k)).sort();

  test('both backends export the same set of functions', () => {
    const onlyInFs = fsFns.filter((k) => !blobFns.includes(k));
    const onlyInBlobs = blobFns.filter((k) => !fsFns.includes(k));

    assert.deepEqual(onlyInFs, [],
      `missing from the Blobs backend — these would throw in production: ${onlyInFs.join(', ')}`);
    assert.deepEqual(onlyInBlobs, [],
      `missing from the filesystem backend — these would throw in tests: ${onlyInBlobs.join(', ')}`);
  });

  test('every backend function takes the same number of arguments', () => {
    for (const name of fsFns) {
      assert.equal(blobs[name].length, fs[name].length,
        `${name}() has a different arity between backends`);
    }
  });

  test('the facade re-exports every backend function', () => {
    for (const name of fsFns) {
      assert.ok(isFn(facade, name), `lib/store.js does not re-export ${name}()`);
    }
  });

  test('the facade selects the filesystem backend outside Netlify', () => {
    assert.equal(facade.STORE_BACKEND, 'fs');
  });
});

describe('production guardrail', () => {
  test('the filesystem backend refuses to load in production', async () => {
    // A serverless filesystem is ephemeral, so this configuration would lose
    // execution records between requests — silently, and in the one place the
    // product cannot afford to be wrong. It must fail loudly instead.
    const original = { NODE_ENV: process.env.NODE_ENV, STORE_BACKEND: process.env.STORE_BACKEND };
    process.env.NODE_ENV = 'production';
    process.env.STORE_BACKEND = 'fs';

    await assert.rejects(
      () => import(`../lib/store.js?guardrail=${Date.now()}`),
      /filesystem store cannot be used in production/,
    );

    process.env.NODE_ENV = original.NODE_ENV;
    if (original.STORE_BACKEND === undefined) delete process.env.STORE_BACKEND;
    else process.env.STORE_BACKEND = original.STORE_BACKEND;
  });
});
