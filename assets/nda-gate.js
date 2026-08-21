/* ---------------------------------------------------------------------------
   The signing gate.

   Sequence, and why each step is there:

     1. Fetch the agreement from the server. The page never contains its own copy
        of the text — one source of bytes only.
     2. Hash the rendered text in the browser and compare to the server's hash.
        A mismatch means something rewrote the document in transit; we refuse to
        offer a signature rather than proceed.
     3. Require the reader to reach the end of the document. Not proof of reading,
        but it removes "I was never shown the terms," and it is honest about what
        it is.
     4. Require a typed legal name, ESIGN consent, and an explicit assent tick.
     5. Execute server-side; render the receipt.

   Note that this file is a convenience, not the enforcement. The enforcement is
   in /api/submit-idea, which refuses content from any account without an
   execution record no matter what the browser does.
   --------------------------------------------------------------------------- */

const el = (id) => document.getElementById(id);

const state = {
  version: null,
  serverHash: null,
  clientHash: null,
  reachedEnd: false,
  executed: null,
};

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setStatus(node, message, tone = 'muted') {
  node.textContent = message;
  node.className = tone === 'muted' ? 'faint' : tone;
}

function refreshSubmitState() {
  const ready =
    state.reachedEnd &&
    el('fullName').value.trim().length > 0 &&
    el('email').value.trim().length > 0 &&
    el('assent').checked &&
    el('esign').checked &&
    state.clientHash !== null &&
    state.clientHash === state.serverHash;

  el('executeBtn').disabled = !ready;
}

/* -------------------------------------------------------------------------- */
/* Load and verify the agreement                                              */
/* -------------------------------------------------------------------------- */

async function loadAgreement() {
  const pane = el('agreementText');
  const meta = el('agreementMeta');

  let payload;
  try {
    const res = await fetch('/api/agreement');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    setStatus(meta, `Could not load the agreement (${err.message}). Nothing can be signed until it loads.`, 'no');
    pane.textContent = '';
    return;
  }

  // Render the server's bytes verbatim. textContent, never innerHTML.
  pane.textContent = payload.text;

  state.version = payload.version;
  state.serverHash = payload.hash;
  state.clientHash = await sha256Hex(payload.text);

  const match = state.clientHash === state.serverHash;
  el('hashDisplay').textContent = state.clientHash;
  el('versionDisplay').textContent = payload.version;

  if (match) {
    setStatus(meta,
      'The document below was hashed in your browser and matches the server’s copy exactly.',
      'yes');
  } else {
    setStatus(meta,
      'HASH MISMATCH — the document shown does not match the server’s copy. ' +
      'Signing is disabled. Do not proceed.', 'no');
    el('signForm').setAttribute('hidden', '');
  }

  // If the document fits without scrolling there is nothing to scroll to, so the
  // gate would never open. Treat "fully visible" as "reached the end".
  requestAnimationFrame(() => {
    if (pane.scrollHeight <= pane.clientHeight + 4) markReachedEnd();
  });

  refreshSubmitState();
}

function markReachedEnd() {
  if (state.reachedEnd) return;
  state.reachedEnd = true;
  el('scrollGate').classList.add('is-complete');
  el('scrollGateLabel').textContent = 'You have reached the end of the agreement.';
  refreshSubmitState();
}

function watchScroll() {
  const pane = el('agreementText');
  pane.addEventListener('scroll', () => {
    const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 24;
    if (atEnd) markReachedEnd();
    const pct = Math.min(100, Math.round(
      ((pane.scrollTop + pane.clientHeight) / pane.scrollHeight) * 100));
    el('scrollProgress').style.width = `${pct}%`;
    el('scrollProgress').parentElement.setAttribute('aria-valuenow', String(pct));
  }, { passive: true });
}

/* -------------------------------------------------------------------------- */
/* Execute                                                                     */
/* -------------------------------------------------------------------------- */

async function execute(event) {
  event.preventDefault();
  const btn = el('executeBtn');
  const result = el('executeResult');

  btn.disabled = true;
  btn.textContent = 'Executing…';
  result.textContent = '';

  try {
    const res = await fetch('/api/execute-nda', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: el('fullName').value,
        email: el('email').value,
        agreementVersion: state.version,
        agreementHash: state.clientHash,
        assent: el('assent').checked,
        consentToElectronicRecords: el('esign').checked,
        signatoryCapacity: el('capacity').value,
      }),
    });

    const payload = await res.json();

    if (!res.ok) {
      result.innerHTML =
        `<div class="note note--bad"><p><strong>Not executed.</strong> ` +
        `${payload.error?.message ?? 'Unknown error.'}</p></div>`;
      btn.disabled = false;
      btn.textContent = 'Execute the agreement';
      return;
    }

    state.executed = payload;
    // Executing signs you in — the server set a session cookie on the response,
    // so nothing downstream needs to carry an email around.
    renderReceipt(payload);
  } catch (err) {
    result.innerHTML =
      `<div class="note note--bad"><p><strong>Not executed.</strong> ${err.message}</p></div>`;
    btn.disabled = false;
    btn.textContent = 'Execute the agreement';
  }
}

function renderReceipt(payload) {
  el('signForm').setAttribute('hidden', '');
  el('scrollGate').setAttribute('hidden', '');

  const pdfUrl = `/api/countersigned-pdf?id=${encodeURIComponent(payload.id)}`;

  const warning = payload.warning
    ? `<div class="note note--warn"><p><strong>Deployment warning.</strong> ${payload.warning}</p></div>`
    : '';

  el('executeResult').innerHTML = `
    <div class="card" style="border-color:var(--good)">
      <p class="pill pill--good">Executed and countersigned</p>
      <h2 style="margin-top:.75rem">The agreement is in force.</h2>
      <p class="muted">It was countersigned before you disclosed anything. You may now
      submit your idea, and it will be received under these terms.</p>

      <dl class="receipt">
        <dt>Execution id</dt><dd class="mono">${payload.id}</dd>
        <dt>Version</dt><dd class="mono">${payload.agreementVersion}</dd>
        <dt>Document hash</dt><dd class="mono wrap">${payload.agreementHash}</dd>
        <dt>Executed at</dt><dd class="mono">${payload.executedAt}</dd>
        <dt>Countersignature</dt><dd class="mono wrap">${payload.countersignature}</dd>
      </dl>

      <p style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.2rem">
        <a class="btn btn--primary" href="${pdfUrl}">Download countersigned PDF</a>
        <a class="btn btn--ghost" href="/verify.html?id=${encodeURIComponent(payload.id)}">Verify this signature</a>
        <a class="btn btn--ghost" href="/dashboard.html">Go to your vault</a>
      </p>
      <p class="faint" style="margin:.9rem 0 0">
        A copy has been emailed to you. Keep it — the execution id is how you retrieve
        and verify this agreement later, including in a dispute with us.
      </p>
    </div>
    ${warning}

    <div class="card" style="margin-top:1.5rem">
      <h2>Now you may disclose</h2>
      <p class="muted">Everything below is received under the agreement you just executed.
      It is encrypted under a key unique to your account before it is written to disk.</p>
      <form id="ideaForm" class="stack">
        <div>
          <label for="ideaTitle">Working title</label>
          <p class="faint" style="margin:.2rem 0 .4rem">Stored unencrypted so you can find it later. Put nothing confidential here.</p>
          <input id="ideaTitle" name="ideaTitle" type="text" required maxlength="300" autocomplete="off">
        </div>
        <div>
          <label for="ideaContent">Your idea</label>
          <p class="faint" style="margin:.2rem 0 .4rem">Encrypted at rest. Never used for training. Never sold.</p>
          <textarea id="ideaContent" name="ideaContent" rows="10" required></textarea>
        </div>
        <button class="btn btn--primary" type="submit">Submit under NDA</button>
      </form>
      <div id="ideaResult" style="margin-top:1rem"></div>
    </div>`;

  el('ideaForm').addEventListener('submit', submitIdea);
}

async function submitIdea(event) {
  event.preventDefault();
  const result = el('ideaResult');
  const btn = event.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/submit-idea', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: el('ideaTitle').value,
        content: el('ideaContent').value,
      }),
    });
    const payload = await res.json();

    if (!res.ok) {
      result.innerHTML =
        `<div class="note note--bad"><p>${payload.error?.message ?? 'Submission failed.'}</p></div>`;
    } else {
      result.innerHTML = `
        <div class="note">
          <p><strong>Received under NDA.</strong> ${payload.contentChars.toLocaleString()} characters,
          stored as ${payload.storedAs}.</p>
          <p style="margin-bottom:0">Content digest <code>${payload.contentDigest.slice(0, 32)}…</code>
          — keep this; it lets you prove later exactly what you submitted, without us
          retaining a readable copy.</p>
        </div>`;
      event.target.reset();
    }
  } catch (err) {
    result.innerHTML = `<div class="note note--bad"><p>${err.message}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit under NDA';
  }
}

/* -------------------------------------------------------------------------- */

export function initNdaGate() {
  watchScroll();
  loadAgreement();
  for (const id of ['fullName', 'email', 'assent', 'esign']) {
    el(id).addEventListener('input', refreshSubmitState);
    el(id).addEventListener('change', refreshSubmitState);
  }
  el('signForm').addEventListener('submit', execute);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNdaGate, { once: true });
} else {
  initNdaGate();
}
