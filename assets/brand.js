/* ---------------------------------------------------------------------------
   Deferred-branding indirection.

   Branding was intentionally postponed until after the product concept settled.
   Every brand-facing string in the site lives HERE, and every page renders its
   header/footer from HERE. When the name is chosen:

     1. Edit BRAND below.
     2. Edit the --brand-* tokens at the top of assets/theme.css.
     3. Bump the NDA to a new version in lib/nda-text.js, because the agreement
        text contains the literal "[BRAND]" placeholder and changing it changes
        the document hash.

   Nothing else needs to be touched. Do not hard-code the company name into page
   markup — write [BRAND] in the copy and this file substitutes it.
   --------------------------------------------------------------------------- */

export const BRAND = {
  name: '[BRAND]',
  // One line, used in the footer and as the default meta description fallback.
  tagline: 'The NDA is signed before the idea is typed.',
  legalName: '[BRAND] — legal entity TBD',
  jurisdiction: '[GOVERNING_JURISDICTION]',
  email: 'hello@example.invalid',
  // Flip to true only after every claim on compare.html has been verified
  // against the live source pages. See SOURCES.md.
  comparisonVerified: false,
};

const NAV = [
  { href: '/is-your-idea-protected.html', label: 'Is your idea protected?' },
  { href: '/compare.html',                label: 'Compare' },
  { href: '/nda.html',                    label: 'The NDA' },
  { href: '/verify.html',                 label: 'Verify' },
];

const SEAL_SVG = `
<svg class="brand__seal" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 2.5 4 6v6.2c0 4.6 3.3 8 8 9.3 4.7-1.3 8-4.7 8-9.3V6z"/>
  <path d="M9 12.2l2.1 2.1L15.4 10"/>
</svg>`;

/** Replace [BRAND] placeholders in text nodes only — never in markup. */
function substitutePlaceholders(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('[BRAND]')) targets.push(walker.currentNode);
  }
  for (const node of targets) {
    node.nodeValue = node.nodeValue.replaceAll('[BRAND]', BRAND.name);
  }
}

function renderHeader(mount) {
  const here = location.pathname.replace(/index\.html$/, '') || '/';
  const links = NAV.map(({ href, label }) => {
    const current = href === here ? ' aria-current="page"' : '';
    return `<a href="${href}"${current}>${label}</a>`;
  }).join('');

  mount.outerHTML = `
    <header class="site-header">
      <div class="page site-header__inner">
        <a class="brand" href="/">${SEAL_SVG}<span>${BRAND.name}</span></a>
        <nav class="site-nav" aria-label="Primary">${links}</nav>
      </div>
    </header>`;
}

function renderFooter(mount) {
  const year = new Date().getFullYear();
  mount.outerHTML = `
    <footer class="site-footer">
      <div class="page footer-cols">
        <div>
          <a class="brand" href="/">${SEAL_SVG}<span>${BRAND.name}</span></a>
          <p class="faint" style="margin-top:.6rem;max-width:34ch">${BRAND.tagline}</p>
        </div>
        <div>
          <p style="font-weight:640;color:var(--ink);margin-bottom:.4rem">Product</p>
          <p style="display:grid;gap:.35rem;margin:0">
            <a href="/is-your-idea-protected.html">Is your idea protected?</a>
            <a href="/compare.html">Compare</a>
            <a href="/nda.html">Read the NDA</a>
            <a href="/verify.html">Verify a signature</a>
          </p>
        </div>
        <div>
          <p style="font-weight:640;color:var(--ink);margin-bottom:.4rem">Legal</p>
          <p style="display:grid;gap:.35rem;margin:0">
            <a href="/legal/terms.html">Terms</a>
            <a href="/legal/privacy.html">Privacy Notice</a>
            <a href="/legal/ip-assignment.html">IP &amp; ownership</a>
            <a href="/legal/subprocessors.html">Subprocessors</a>
          </p>
        </div>
      </div>
      <div class="page" style="margin-top:2rem;padding-top:1.2rem;border-top:1px solid var(--border)">
        <p class="faint" style="margin:0">
          &copy; ${year} ${BRAND.legalName}. Nothing on this site is legal advice.
          For patentable subject matter, consult a qualified attorney.
        </p>
      </div>
    </footer>`;
}

export function mountChrome() {
  const header = document.querySelector('[data-site-header]');
  const footer = document.querySelector('[data-site-footer]');
  if (header) renderHeader(header);
  if (footer) renderFooter(footer);
  substitutePlaceholders(document.body);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountChrome, { once: true });
} else {
  mountChrome();
}
