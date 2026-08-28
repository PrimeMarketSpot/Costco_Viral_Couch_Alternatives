# Source verification checklist

`compare.html` is **unpublished** until this checklist is complete. It currently ships with
`<meta name="robots" content="noindex,nofollow">` and a visible draft banner, driven by
`BRAND.comparisonVerified` in `assets/brand.js`.

## Why this file exists

The comparison page was drafted in an environment whose network policy blocked
`polsia.com`, `preuve.ai`, and `agentaya.com`. Every competitor claim on that page came from
**search-engine extraction** of the source pages plus third-party reviews — not from reading
the live documents.

That is good enough to design a product around. It is **not** good enough to publish as fact
about a named company. Quoting a document you have not personally read is how a comparison
page becomes a defamation problem.

## The rule

> Quote, never characterise. Date every retrieval. Archive every source.
> Anything that does not verify gets **cut**, not softened.

A claim that turns out to be wrong costs more than the claim was ever worth. There is no
version of this page that needs to be maximally damning — it needs to be unimpeachably
accurate, which is more persuasive anyway.

## Checklist

For each row below: open the live URL, find the clause, copy the text **verbatim**, record the
date, capture an archive.org snapshot, then replace the `¶?` placeholder in the `.src` link
with the real section reference.

### polsia.com/terms

- [ ] **Revenue share.** Confirm the rate and the exact wording. Draft has: a fee
      *"currently 20%"* on all customer payments received through the Services.
      → Also determine whether the rate can be changed unilaterally, and on what notice.
- [ ] **Payment routing.** Confirm money flows through the platform's Stripe Connect rather
      than the user's own account.
- [ ] **Hold period.** Draft has 14 days. Verify.
- [ ] **Minimum withdrawal.** Draft has $50. Verify.
- [ ] **Withdrawal cap.** Draft has ~$500 per calendar month. Verify, and note whether it
      varies by plan.
- [ ] **Code ownership.** Find the precise ownership language. Draft asserts the user does not
      own the code but may export it. This row needs an exact quote or it gets cut — "you don't
      own it" is a strong claim to make about someone else's contract.
- [x] **Confidentiality — VERIFIED 2026-08-28.** The premise holds, and in a stronger form than
      "no clause". `confidential` appears twice in the Terms, and **both obligations run from the
      user to the company**:

      §F (Beta Offerings): "For any such confidential Beta Offerings, you agree to not disclose,
      divulge, display, or otherwise make available any of the Beta Offerings without our prior
      written consent."

      §2 (Eligibility and Accounts): "You are solely responsible for maintaining the
      confidentiality and security of your credentials."

      The first protects their beta features; the second is about the user's password. Neither
      places the company under a duty of confidence toward a submitted idea. This is a better
      finding than absence would have been: they know how to draft a confidentiality clause, and
      drafted one for their own benefit and not the user's.

      **Still outstanding for this row before publish:**
      - [ ] Confirm the browser's find bar reported only these hits (e.g. "3 of 3") — a missed
            occurrence elsewhere in the document would undercut the claim.
      - [ ] Search `/privacy` for `confidential` too, and record what is there.
      - [ ] archive.org snapshot of `/terms`, so the quotes can be dated and shown as-of.
- [ ] **Export after termination.** What survives cancellation? Is export gated on an active
      subscription?
- [ ] **Feedback clause.** Check for a perpetual/irrevocable licence over "Feedback", which
      often sweeps in more than users expect.

### polsia.com/privacy

- [ ] **Model training.** Draft quote: *"may use Input and Output to improve their products and
      technology, including by training or fine-tuning the AI models that power their tools."*
      Verify verbatim, and capture how "Input" is defined — the strength of this row depends
      entirely on whether submitted ideas fall inside that definition.
- [ ] **Business transfer.** Draft quote: discloses information *"in connection with or
      anticipation of an asset sale, merger, acquisition, or other business transaction,
      including in the context of a bankruptcy proceeding or other restructuring matter."*
- [ ] **Retention.** Draft quote: retained *"for as long as is reasonably necessary for the
      purposes specified."*
- [ ] **Third parties and subprocessors.** Is there a published subprocessor list?
- [ ] **Sensitive information advisory.** Draft notes the policy advises users not to send
      sensitive or confidential information over unsecure channels. Verify wording and
      context before using it — read fairly, this may be boilerplate about email rather than
      about the product's own submission flow, in which case it is not a fair row and
      should be cut.

### Pricing

- [ ] Confirm tiers. Draft has $20 / $50 / $200 / $500 / $1,000 per month. Note that one
      third-party review cited $49, which conflicts. **Do not publish a price until it is read
      off the live pricing page.**

### Third-party signals

- [ ] Trustpilot rating and review count, with the date observed. Draft has ~1.8/5 across ~79
      reviews as of mid-2026. This is a live figure that moves — either cite it with an
      explicit "as of" date and re-check periodically, or leave it off. A stale rating is a
      false statement with a timestamp on it.

## When the checklist is complete

1. Replace every `¶?` in `compare.html` with a real section reference.
2. Add retrieval dates and archive.org links to each `.src` anchor.
3. Delete the `<meta name="robots" content="noindex,nofollow">` tag.
4. Set `comparisonVerified: true` in `assets/brand.js`.
5. Do all four in **one commit**, so the page is never live in a half-verified state.

## Ongoing

Source documents change. Re-verify quarterly, and keep superseded snapshots — being able to
show what a document said on the date you quoted it is the whole defence.

## Before launch

Have a lawyer read `compare.html`, the NDA in `lib/nda-text.js`, and `legal/terms.html`.
Comparative advertising that quotes accurately is on solid ground, but "solid ground" is a
judgement a qualified attorney should make, not this repository.
