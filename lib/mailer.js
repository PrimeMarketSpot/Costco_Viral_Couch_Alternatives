/* ---------------------------------------------------------------------------
   Email delivery.

   A seam, not an implementation. The transactional email vendor is still TBD
   (see legal/subprocessors.html), and picking one is a decision with privacy
   consequences — that vendor sees every user's address — so it should be made
   deliberately rather than by whichever SDK got imported first.

   Until then this logs to the server console, which is enough to develop
   against and impossible to mistake for a working mailer in production: send()
   refuses to run in production without a configured provider, rather than
   silently dropping a login link a user is waiting for.

   To wire up a provider, implement deliver() and set MAIL_PROVIDER.
   --------------------------------------------------------------------------- */

const FROM = process.env.MAIL_FROM || 'no-reply@example.invalid';

/**
 * @typedef {{to: string, subject: string, text: string}} Mail
 */

/** @param {Mail} mail */
async function deliverToConsole(mail) {
  console.log('\n' + '─'.repeat(72));
  console.log(`  DEV MAILER — not actually sent`);
  console.log(`  To:      ${mail.to}`);
  console.log(`  Subject: ${mail.subject}`);
  console.log('─'.repeat(72));
  console.log(mail.text);
  console.log('─'.repeat(72) + '\n');
  return { delivered: false, provider: 'console' };
}

/**
 * Send an email.
 * @param {Mail} mail
 */
export async function send(mail) {
  const provider = process.env.MAIL_PROVIDER;

  if (!provider) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MAIL_PROVIDER is not configured. Refusing to silently drop mail in production.',
      );
    }
    return deliverToConsole(mail);
  }

  throw new Error(
    `MAIL_PROVIDER="${provider}" is set but no delivery implementation exists for it. ` +
    'Implement it in lib/mailer.js and add the vendor to legal/subprocessors.html ' +
    'before sending real mail.',
  );
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export function loginLinkMail({ to, url, expiresInMinutes }) {
  return {
    to,
    from: FROM,
    subject: 'Your sign-in link',
    text: `Sign in by opening this link:

  ${url}

It works once and expires in ${expiresInMinutes} minutes.

If you didn't request this, you can ignore it — no one can sign in to your
account without this link, and it will expire on its own.
`,
  };
}

export function countersignedCopyMail({ to, executionId, verifyUrl, downloadUrl }) {
  return {
    to,
    from: FROM,
    subject: 'Your countersigned confidentiality agreement',
    text: `The mutual NDA has been executed and countersigned.

  Execution id: ${executionId}

Download your countersigned copy:
  ${downloadUrl}

Verify it independently, at any time, without our involvement:
  ${verifyUrl}

Keep this email. The execution id is how you retrieve and verify the agreement
later, including in a dispute with us.
`,
  };
}
