/**
 * Canonical mutual NDA text.
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THE AGREEMENT.
 *
 * Rules that must never be broken:
 *
 *  1. The exact bytes of AGREEMENT_TEXT are what get hashed, displayed, signed,
 *     and rendered into the countersigned PDF. The client never composes its own
 *     copy — it fetches this one. If the displayed text and the hashed text could
 *     ever diverge, the entire verification story is theatre.
 *
 *  2. ANY edit to AGREEMENT_TEXT — including whitespace, including fixing a typo,
 *     including filling in the [BRAND] placeholder once branding is chosen —
 *     is a NEW VERSION. Bump AGREEMENT_VERSION and add a CHANGELOG entry below.
 *     Never mutate a version that has been executed by even one user: their
 *     execution record points at a hash, and that hash must keep resolving to
 *     the text they actually read.
 *
 *  3. Superseded versions stay in PRIOR_VERSIONS forever so that /verify can
 *     still resolve historical executions.
 */

export const AGREEMENT_VERSION = '1.0.0';

export const AGREEMENT_TEXT = `MUTUAL CONFIDENTIALITY AND IDEA PROTECTION AGREEMENT
Version 1.0.0

THIS AGREEMENT is entered into between [BRAND] ("Company") and the individual or
entity executing it below ("You"). It takes effect at the moment You execute it,
which is BEFORE You disclose anything to Company.

RECITAL

You are considering disclosing an idea, concept, invention, business plan, or
other proprietary information to Company so that Company may help You build it.
Company's position is that such a disclosure should never happen without a
binding duty of confidence already in place. This Agreement creates that duty
first. Nothing You submit is received by Company outside its protection.

1. DEFINITIONS

1.1 "Confidential Information" means any non-public information disclosed by
either party to the other under this Agreement, in any form, whether or not
marked confidential. It expressly includes Your Submission.

1.2 "Submission" means everything You provide to Company relating to Your idea:
descriptions, documents, specifications, designs, data, code, models, financials,
customer information, and every revision of any of the foregoing.

1.3 "Work Product" means everything Company or its automated systems create for
You in performing the Services: source code, configuration, documentation, copy,
designs, brand assets, and data generated in the course of operating what is
built.

1.4 "Permitted Purpose" means solely and exclusively: performing the services You
have requested from Company for Your benefit.

1.5 "Receiving Party" means the party receiving Confidential Information;
"Disclosing Party" means the party disclosing it. This Agreement is mutual and
both parties occupy both roles.

2. OBLIGATION OF CONFIDENCE

2.1 The Receiving Party shall hold the Disclosing Party's Confidential
Information in strict confidence, shall use at least the degree of care it uses
for its own confidential information and in no event less than a reasonable
degree of care, and shall not disclose it to any third party except as this
Agreement expressly permits.

2.2 The Receiving Party shall limit access to those of its personnel and
subprocessors who have a genuine need to access it for the Permitted Purpose and
who are bound by written obligations at least as protective as this Agreement.

3. PERMITTED USE, AND THE LIMITS ON IT

3.1 You grant Company a limited, revocable, non-exclusive, non-sublicensable
(except to subprocessors under Section 6), non-transferable license to use Your
Submission solely for the Permitted Purpose, for only as long as Company is
performing the Services for You. This license exists so that Company can build
what You asked for. It grants Company no other right of any kind.

3.2 Company expressly shall NOT, without Your separate, specific, written, and
revocable consent obtained after the date of this Agreement:

  (a) use Your Submission or any part of it to train, fine-tune, pre-train,
      distill, align, evaluate, benchmark, or otherwise improve any machine
      learning model, whether Company's own or a third party's;

  (b) use Your Submission to improve, develop, or inform Company's own products,
      services, or technology, other than by performing the Services for You;

  (c) analyze Your Submission's content to produce aggregate statistics, market
      research, trend reports, or datasets, whether or not identified to You;

  (d) sell, rent, license, publish, or otherwise transfer Your Submission or Your
      Work Product to any third party;

  (e) use Your Submission to build, fund, staff, or advise any venture that
      competes with the venture described in Your Submission;

  (f) subject Your Submission to human review, except where strictly necessary to
      investigate a specific, documented security incident or a specific,
      documented violation of law, and then only to the minimum extent necessary
      and with notice to You within seventy-two (72) hours unless a court order
      prohibits notice.

3.3 The prohibitions in Section 3.2 are material terms. Company's compliance with
them is not merely a policy that Company may revise; it is a contractual promise
enforceable by You.

4. OWNERSHIP

4.1 As between the parties, You own Your Submission entirely. Nothing in this
Agreement transfers, assigns, or licenses to Company any patent, copyright, trade
secret, trademark, or other intellectual property right in it, except the narrow
Permitted Purpose license in Section 3.1.

4.2 You own all Work Product. To the extent Work Product qualifies as a work made
for hire, it is a work made for hire for You. To the extent it does not, Company
hereby irrevocably assigns to You, at the moment of creation and without further
consideration, all right, title, and interest in it worldwide. Company will
execute any further documents reasonably necessary to perfect this assignment.

4.3 Company retains ownership of its own pre-existing platform, infrastructure,
and generally applicable tooling. Company grants You a perpetual, irrevocable,
royalty-free license to any such component embedded in Your Work Product to the
extent necessary for You to use, modify, and exploit that Work Product without
Company.

4.4 Company claims no equity, no royalty, no revenue share, and no security
interest in Your venture. Company is never a party to Your customer payment flow.

5. EXCLUSIONS

5.1 The obligations in Section 2 do not apply to information the Receiving Party
can demonstrate by contemporaneous written record:

  (a) was already lawfully in its possession without a duty of confidence before
      the Disclosing Party disclosed it;
  (b) is or becomes publicly available through no act or omission of the
      Receiving Party;
  (c) is rightfully received from a third party with no duty of confidence; or
  (d) was independently developed by personnel with no access to the Disclosing
      Party's Confidential Information.

5.2 Company states plainly, rather than burying, what Section 5.1(d) means: an
NDA cannot stop genuinely independent invention by someone who never saw Your
idea. No agreement can. What this Agreement does is create a duty, and a claim
against anyone who breaches it. That is the protection that is otherwise absent.

6. SUBPROCESSORS

6.1 Company may disclose Confidential Information to subprocessors only where
necessary for the Permitted Purpose, and only where that subprocessor is bound by
written terms at least as protective as this Agreement, including the
prohibitions in Section 3.2.

6.2 Where Company uses a third-party machine learning provider, Company shall use
only endpoints operating under a zero-data-retention arrangement, under which the
provider does not retain, log, or train on the content transmitted.

6.3 Company shall maintain a current, public list of its subprocessors and shall
give at least thirty (30) days' notice before adding one. Company remains fully
liable for its subprocessors' acts and omissions.

7. COMPELLED DISCLOSURE

7.1 If the Receiving Party is compelled by law to disclose Confidential
Information, it shall, unless legally prohibited, give the Disclosing Party
prompt written notice sufficient to permit the Disclosing Party to seek a
protective order, shall disclose only the minimum legally required, and shall
seek confidential treatment of what it discloses.

8. SUCCESSORS, ACQUISITION, AND INSOLVENCY

8.1 This Agreement binds and inures to the benefit of the parties' successors and
permitted assigns. Company's obligations travel with the data. Any acquirer,
successor, assignee, receiver, trustee, or purchaser of Company's assets takes
Your Submission subject to every obligation in this Agreement, and Company shall
make acceptance of these obligations an express condition of any such transfer.

8.2 Company shall give You at least thirty (30) days' written notice before any
merger, acquisition, or sale of assets that would transfer custody of Your
Submission. During that period You may export everything and demand deletion
under Section 10, and Company shall comply before the transfer completes.

8.3 Your Submission is not, and shall not be treated as, a saleable asset of
Company's estate in any bankruptcy, insolvency, receivership, or liquidation
proceeding.

9. TERM AND SURVIVAL

9.1 This Agreement takes effect on execution and continues while Company holds
any of Your Confidential Information.

9.2 The obligations in Sections 2, 3, 4, 6, 7, and 8 survive termination and
continue for five (5) years after Company last holds Your Confidential
Information — except that with respect to any Confidential Information
constituting a trade secret, the obligations continue for as long as it remains a
trade secret under applicable law.

10. EXPORT, DELETION, AND NON-HOSTAGE

10.1 You may export Your Submission and Your Work Product in full, in a
non-proprietary machine-readable format, at any time and at no charge.

10.2 Suspension or termination of the Services for any reason, including
non-payment, suspends Company's performance only. It never suspends Your ability
to export. Company shall keep export available for at least ninety (90) days
after termination and shall never place export behind a payment.

10.3 On Your written request, Company shall permanently delete Your Submission
and Your Work Product within thirty (30) days and shall issue You a signed
deletion certificate. Company's architecture encrypts Your content under a key
unique to You; deletion destroys that key, rendering any residual ciphertext
cryptographically unrecoverable.

11. SECURITY AND BREACH NOTICE

11.1 Company shall maintain administrative, technical, and physical safeguards
appropriate to the sensitivity of Your Submission, including encryption in
transit and at rest.

11.2 Company shall notify You without undue delay and in any event within
seventy-two (72) hours of becoming aware of any unauthorized access to or
disclosure of Your Confidential Information.

12. REMEDIES

12.1 Each party acknowledges that breach of this Agreement may cause irreparable
harm for which monetary damages are inadequate, and that the non-breaching party
is entitled to seek injunctive relief in addition to any other remedy, without
the necessity of posting a bond.

13. WHAT THIS AGREEMENT DOES NOT DO

13.1 Company states the following plainly because You are entitled to accurate
expectations:

  (a) This Agreement does not create intellectual property rights that do not
      otherwise exist. Copyright protects expression, not ideas. Patent rights
      require filing.
  (b) This Agreement does not prevent independent development by parties who
      never received Your Confidential Information.
  (c) This Agreement is not a substitute for legal advice or for a patent filing.
      If Your idea is patentable, You should consult a qualified attorney about a
      provisional application.
  (d) What this Agreement does do is place Company under an enforceable duty of
      confidence before You disclose, so that Your disclosure to Company is a
      disclosure under a confidentiality obligation and can support, rather than
      defeat, the reasonable-measures element of trade secret protection.

14. ELECTRONIC EXECUTION

14.1 The parties consent to execute this Agreement electronically under the
federal ESIGN Act and applicable state UETA. You have the right to receive this
Agreement on paper, to withdraw consent to electronic records, and to retain a
copy; a countersigned PDF is provided to You at execution and remains available
for download.

14.2 Company records, at execution, the version of this Agreement, a SHA-256
hash of its exact text, the UTC timestamp, Your identity, Your network address,
and Your affirmative assent, in an append-only record. Any person may verify a
copy of this Agreement against that record using Company's public verification
endpoint.

14.3 Company countersigns at execution. This Agreement is mutual and binding on
both parties from that moment.

15. GENERAL

15.1 This Agreement is the entire agreement between the parties on its subject
matter and supersedes all prior understandings on that subject.

15.2 This Agreement may be amended only by a new version, which applies only
prospectively and only if You execute it. Company cannot unilaterally alter the
terms governing a Submission You have already made.

15.3 If any provision is held unenforceable, it shall be limited to the minimum
extent necessary and the remainder shall continue in full force.

15.4 No failure or delay in exercising a right operates as a waiver of it.

15.5 This Agreement is governed by the laws of [GOVERNING_JURISDICTION], without
regard to its conflict of laws rules.

BY EXECUTING BELOW, YOU CONFIRM THAT YOU HAVE READ THIS AGREEMENT IN FULL, THAT
YOU INTEND YOUR TYPED NAME AS YOUR SIGNATURE, AND THAT YOU ARE AUTHORIZED TO BIND
THE PARTY NAMED.
`;

/**
 * Superseded agreement versions, kept forever so /verify can resolve historical
 * executions. Move the outgoing AGREEMENT_TEXT into this map on every bump.
 * @type {Record<string, string>}
 */
export const PRIOR_VERSIONS = {};

/**
 * CHANGELOG
 *
 * 1.0.0 — Initial version. Contains the [BRAND] and [GOVERNING_JURISDICTION]
 *         placeholders. Filling either one REQUIRES a version bump to 1.1.0,
 *         because the hash of the text changes. Do not ship to production users
 *         with placeholders unresolved.
 */

/** Resolve any known version's text, current or historical. */
export function textForVersion(version) {
  if (version === AGREEMENT_VERSION) return AGREEMENT_TEXT;
  return PRIOR_VERSIONS[version] ?? null;
}
