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
| NDA before disclosure | `api/submit-idea.js` returns 403 for any account with no execution record, *before reading the content field* |
| You signed what we stored | One canonical text (`lib/nda-text.js`), served by `api/agreement.js`, hashed on both ends, mismatch → 409 |
| Verifiable by third parties | Ed25519 countersignature with a **published public key** — verifiable without our cooperation |
| The log wasn't rewritten | Append-only, hash-chained execution records (`lib/store.js`) |
| We can't train on your idea | AES-256-GCM under a per-account key; we don't hold readable content |
| Deletion is real | Cryptographic erasure — destroy the account key, ciphertext is unrecoverable |

An asymmetric signing key is deliberate: an HMAC would let us prove a countersignature only to
ourselves, which is worth nothing to a user in a dispute.

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
| `DATA_DIR` | Storage root. Defaults to `.data/`. |

Without the first two, the code runs with loud dev-only fallbacks and refuses to start in
production.

## Layout

```
index.html                     Landing
is-your-idea-protected.html    The legal analysis — the core marketing asset
compare.html                   Sourced comparison (UNVERIFIED — see SOURCES.md)
nda.html                       Read, scroll, sign, then disclose
verify.html                    Public verification
legal/                         Our own terms, privacy, IP, subprocessors
lib/                           nda-text · crypto · store · pdf · http
api/                           agreement · execute-nda · verify-nda · submit-idea · countersigned-pdf
test/gate.test.js              The claims, as assertions
```

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
6. **Replace the file-backed store** in `lib/store.js` with a real database. The seven exported
   functions are the seam.

## Phase 2

Accounts and auth, member dashboard, idea vault with versioning, team invites, one-click
export-everything, billing, and the build agents themselves.
