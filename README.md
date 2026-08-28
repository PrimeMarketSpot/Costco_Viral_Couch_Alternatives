# NDA-first company builder

An AI company builder where a **mutual NDA is countersigned before the idea is disclosed**, and
the user owns the IP, the code, the data, and the payment rail.

> **Note on this repository.** It is named `Costco_Viral_Couch_Alternatives` for historical
> reasons — it previously held an unrelated affiliate page, which is preserved in git history.
> To rename it: GitHub → Settings → Repository name. Renaming keeps stars, issues, and history,
> and GitHub redirects the old URL.

## The premise

Someone about to submit a business idea to a platform usually checks the privacy policy to see
whether it's safe. That's the wrong document. A privacy policy *discloses what the company may
do*; an NDA *restricts what the recipient may do*. Only the second creates a duty of confidence.

Worse, ideas have no default protection. Copyright covers expression, not ideas
(17 U.S.C. §102(b)). Patents require filing. Trade secret law is the only doctrine that reaches a
raw idea, and it protects you only while you take *"reasonable measures to keep it secret"* —
so disclosing to a party under no duty of confidence can **destroy** the protection you had.

The full argument is on [`is-your-idea-protected.html`](./is-your-idea-protected.html).

## The design rule

**Every promise is paired with a mechanism that enforces it.** If the advantage were only a
nicer legal page, this would be the same product with better copy. So:

| Promise | Mechanism |
|---|---|
| NDA before disclosure | `requireSignedNda()` gates `api/submit-idea.js` *before it reads the content field* |
| Identity can't be forged | Every protected endpoint derives the account from the session cookie, never from the request body |
| You signed what we stored | One canonical text (`lib/nda-text.js`), served by `api/agreement.js`, hashed on both ends, mismatch → 409 |
| Verifiable by third parties | Ed25519 countersignature with a **published public key** — verifiable without our cooperation |
| The log wasn't rewritten | Append-only, hash-chained execution records (`lib/store.js`) |
| We can't train on your idea | AES-256-GCM under a per-account key; we don't hold readable content |
| Deletion is real | Cryptographic erasure — destroy the account key, ciphertext is unrecoverable |
| Export is never paywalled | `api/export-all.js` consults no billing state; a test asserts the source contains no payment check |
| Your history survives edits | Revisions accumulate and are never overwritten — the record of what you disclosed, and when |

An asymmetric signing key is deliberate: an HMAC would let us prove a countersignature only to
ourselves, which is worth nothing to a user in a dispute.

Auth is passwordless on the same principle: a site that asks you to keep as little with us as
possible has no business storing a credential it doesn't need. Sign-in links are single use, and
sessions are stored as digests, so a read-only leak of the session store lets nobody in.

## Running it

```bash
npm run dev     # http://localhost:8888 — static pages + API on the real handlers
npm test        # 24 tests covering the claims above
npm run keygen  # generate production keys
```

No dependencies, no build step, no CDN. The site's thesis is confidentiality, so it doesn't ship
a script tag that phones a third party on every pageview — every asset is first-party, which is
also what makes the strict CSP in `netlify.toml` possible.

### Environment

| Variable | Purpose |
|---|---|
| `COUNTERSIGN_PRIVATE_KEY` | Ed25519 PKCS8 PEM. **Required in production.** |
| `MASTER_KEK` | 32 bytes base64, wraps per-account content keys. **Required in production.** Losing it makes every submission permanently unreadable. |
| `DATA_DIR` | Filesystem backend only. Storage root, defaults to `.data/`. |
| `STORE_BACKEND` | `fs` or `blobs`. Auto-selected; set only to override. |

Without the first two, the code runs with loud dev-only fallbacks and refuses to start in
production.

## Deploying

```bash
npm run keygen        # prints the two required secrets
```

Then in Netlify: **Add new site → Import an existing project → GitHub → this repo.**

Three settings that are easy to miss:

1. **Branch to deploy** — the work is on `claude/competitor-platform-nda-w4jg6b`, not the default
   branch. Netlify will offer the default; change it.
2. **Build command** — leave empty. Publish directory `.`, functions directory `api`. Already set
   in `netlify.toml`.
3. **Environment variables** — add `COUNTERSIGN_PRIVATE_KEY` and `MASTER_KEK` as **secrets**,
   scoped to Functions, *before* the first deploy. Without them the functions throw on boot.

Storage needs no setup: `NETLIFY=true` is set automatically at runtime, which selects the Blobs
backend, and Blobs provisions itself.

**Rotating keys.** `MASTER_KEK` has no recovery path — losing it makes every stored submission
permanently unreadable, which is the design working correctly. Back it up before there is anything
to lose. Rotating `COUNTERSIGN_PRIVATE_KEY` invalidates verification of every signature made under
the old one; if you ever rotate, keep the old public key published alongside the new one.

## Layout

```
index.html                     Landing
is-your-idea-protected.html    The legal analysis — the core marketing asset
compare.html                   Sourced comparison (UNVERIFIED — see SOURCES.md)
nda.html                       Read, scroll, sign, then disclose
verify.html                    Public verification
signin.html                    Passwordless sign-in
dashboard.html                 The vault: submissions, revisions, export
legal/                         Our own terms, privacy, IP, subprocessors
lib/                           nda-text · crypto · store · auth · mailer · pdf · http
api/                           agreement · execute-nda · verify-nda · submit-idea
                               submissions · export-all · countersigned-pdf
                               me · auth-request-link · auth-verify · auth-logout
test/gate.test.js              The claims, as assertions (46 tests)
```

### Environment (optional)

| Variable | Purpose |
|---|---|
| `MAIL_PROVIDER` / `MAIL_FROM` | Transactional email. Unset in dev logs mail to the console; unset in **production it throws**, rather than silently dropping a sign-in link someone is waiting for. |

## Before this can launch

1. **Verify every competitor claim.** `compare.html` ships `noindex` behind a draft banner
   because it was drafted from search-engine extraction, not from reading the live documents.
   The checklist is in [`SOURCES.md`](./SOURCES.md). **Quote, never characterise.**
2. **Secure zero-data-retention with the model vendor.** The "never trained on" claim is blocked
   until that term is signed — a promise that depends on an unsecured vendor term is not a promise.
3. **Legal review** of the NDA, terms, and comparison page.
4. **Choose the brand.** Everything brand-facing is in `assets/brand.js` and the `--brand-*`
   tokens in `assets/theme.css`. Filling the `[BRAND]` placeholder in the agreement requires a
   version bump, because it changes the document hash.
5. **Generate and store production keys** (`npm run keygen`).
6. **Replace the file-backed store** in `lib/store.js` with a real database. Its exported functions
   are the seam — nothing else touches storage. This is required, not optional: serverless
   filesystems are ephemeral, so the current store will lose data on any real deploy.
7. **Pick a transactional email vendor**, implement `deliver()` in `lib/mailer.js`, and add it to
   `legal/subprocessors.html`. Sign-in links and countersigned copies don't reach anyone until then.

## Still to build

Team invites, billing, rate limiting on the sign-in endpoint, and the build agents themselves.
