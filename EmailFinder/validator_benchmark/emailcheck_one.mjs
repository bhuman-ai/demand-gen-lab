import { verifyEmail } from '@emailcheck/email-validator-js';

const email = process.argv[2];
if (!email) {
  console.error('usage: node emailcheck_one.mjs <email>');
  process.exit(2);
}

try {
  const result = await verifyEmail({
    emailAddress: email,
    verifyMx: true,
    verifySmtp: true,
    checkDisposable: false,
    checkFree: false,
    suggestDomain: false,
    timeout: 10000,
  });

  let pred = null;
  if (typeof result?.validSmtp === 'boolean') pred = result.validSmtp;
  else if (typeof result?.smtpValid === 'boolean') pred = result.smtpValid;
  else if (result?.smtp && typeof result.smtp.valid === 'boolean') pred = result.smtp.valid;

  console.log(JSON.stringify({ predicted_accept: pred, raw: result }));
} catch (err) {
  console.log(JSON.stringify({ predicted_accept: null, error: String(err?.message || err) }));
}
