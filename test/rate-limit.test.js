/**
 * Rate limiting.
 *
 * The endpoint that matters most here is auth-request-link: unauthenticated,
 * and it sends email to whatever address it is handed. Unlimited, that is a
 * spam cannon aimed at arbitrary inboxes and the fastest way to get a
 * transactional email domain blacklisted.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = path.join(tmpdir(), `nda-rl-${Date.now()}`);
process.env.DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';

const { default: requestLink } = await import('../api/auth-request-link.js');
const { default: executeNda } = await import('../api/execute-nda.js');
const { LIMITS, consume } = await import('../lib/rate-limit.js');
const { MAX_BODY_BYTES } = await import('../lib/http.js');
const { default: verifyNda } = await import('../api/verify-nda.js');

const ORIGIN = 'https://example.test';

const post = (url, body, ip) => new Request(`${ORIGIN}${url}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(ip ? { 'x-forwarded-for': ip } : {}),
  },
  body: JSON.stringify(body),
});

after(async () => { await rm(DATA_DIR, { recursive: true, force: true }); });

describe('the limiter itself', () => {
  test('allows up to the limit, then refuses', async () => {
    const id = `probe-${Date.now()}`;
    const max = LIMITS['auth-email'].max;

    for (let i = 1; i <= max; i++) {
      const r = await consume('auth-email', id);
      assert.equal(r.allowed, true, `request ${i} of ${max} should be allowed`);
    }

    const over = await consume('auth-email', id);
    assert.equal(over.allowed, false);
    assert.ok(over.retryAfterSeconds > 0, 'must tell the caller when to come back');
  });

  test('counts each identifier separately', async () => {
    const a = `sep-a-${Date.now()}`;
    const b = `sep-b-${Date.now()}`;

    for (let i = 0; i < LIMITS['auth-email'].max; i++) await consume('auth-email', a);
    assert.equal((await consume('auth-email', a)).allowed, false);

    // b must be untouched — one abuser cannot lock out everyone else.
    assert.equal((await consume('auth-email', b)).allowed, true);
  });

  test('fails open on a missing identifier rather than sharing one bucket', async () => {
    // Some proxies give no client IP. Collapsing those callers into a single
    // bucket would let one of them lock out all the others.
    for (let i = 0; i < LIMITS['auth-ip'].max + 5; i++) {
      assert.equal((await consume('auth-ip', null)).allowed, true);
    }
  });

  test('rejects an unknown limit name loudly', async () => {
    await assert.rejects(() => consume('no-such-limit', 'x'), /Unknown rate limit/);
  });
});

describe('auth-request-link is protected', () => {
  test('refuses after too many links for one address', async () => {
    const email = `flood-${Date.now()}@example.test`;
    let last;

    // Vary the IP so the per-email limit is what trips, not the per-IP one.
    for (let i = 0; i <= LIMITS['auth-email'].max; i++) {
      last = await requestLink(post('/api/auth-request-link', { email }, `10.0.0.${i + 1}`));
    }

    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.error.code, 'rate_limited');
    assert.ok(last.headers.get('retry-after'), 'must send a Retry-After header');
  });

  test('refuses after too many requests from one address, across many inboxes', async () => {
    const ip = '198.51.100.7';
    let last;

    // The attack the per-email limit alone would miss: one caller spraying
    // thousands of distinct addresses.
    for (let i = 0; i <= LIMITS['auth-ip'].max; i++) {
      last = await requestLink(
        post('/api/auth-request-link', { email: `spray-${Date.now()}-${i}@example.test` }, ip));
    }

    assert.equal(last.status, 429);
  });
});

describe('execute-nda is protected', () => {
  test('refuses after too many executions from one address', async () => {
    const ip = '203.0.113.9';
    let last;

    for (let i = 0; i <= LIMITS['execute-ip'].max; i++) {
      last = await executeNda(post('/api/execute-nda', {
        fullName: 'Flood Tester',
        email: `exec-flood-${Date.now()}-${i}@example.test`,
        assent: true,
        consentToElectronicRecords: true,
      }, ip));
    }

    assert.equal(last.status, 429,
      'the append-only log can never be pruned, so unbounded writes must be refused');
  });

  test('the limit is checked before the body is parsed', async () => {
    // Already over the limit from the test above; garbage body should still
    // produce 429 rather than a parse error — the cheap check comes first.
    const res = await executeNda(new Request(`${ORIGIN}/api/execute-nda`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: 'not json at all',
    }));
    assert.equal(res.status, 429);
  });
});

describe('request bodies are bounded', () => {

  test('a declared oversize body is refused without being read', async () => {
    const res = await requestLink(new Request(`${ORIGIN}/api/auth-request-link`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_BODY_BYTES + 1),
      },
      body: JSON.stringify({ email: 'x@example.test' }),
    }));
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error.code, 'body_too_large');
  });

  test('an actually-oversize body is refused even with no content-length', async () => {
    // Content-Length is advisory; the real defence is measuring what arrives.
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1024);
    const res = await requestLink(new Request(`${ORIGIN}/api/auth-request-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.test', pad: huge }),
    }));
    assert.equal(res.status, 413);
  });
});

describe('the public verify endpoint is bounded', () => {

  test('refuses an implausibly large agreement copy', async () => {
    const res = await verifyNda(new Request(`${ORIGIN}/api/verify-nda`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.50' },
      body: JSON.stringify({ id: 'whatever', text: 'x'.repeat(200_001) }),
    }));
    // Either cap may fire first depending on encoded size; both are correct.
    assert.equal(res.status, 413);
  });

  test('still serves legitimate verification', async () => {
    const res = await verifyNda(new Request(`${ORIGIN}/api/verify-nda?audit=1`, {
      headers: { 'x-forwarded-for': '192.0.2.51' },
    }));
    assert.equal(res.status, 200, 'public auditability must survive the hardening');
  });
});
