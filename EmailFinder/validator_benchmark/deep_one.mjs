import { validate as deepValidate } from 'deep-email-validator';

const email = process.argv[2];
if (!email) {
  console.error('usage: node deep_one.mjs <email>');
  process.exit(2);
}

try {
  const result = await deepValidate({
    email,
    sender: 'probe@example.net',
    validateRegex: true,
    validateMx: true,
    validateTypo: false,
    validateDisposable: false,
    validateSMTP: true,
  });

  const pred = typeof result?.validators?.smtp?.valid === 'boolean' ? result.validators.smtp.valid : null;
  console.log(JSON.stringify({ predicted_accept: pred, raw: result }));
} catch (err) {
  console.log(JSON.stringify({ predicted_accept: null, error: String(err?.message || err) }));
}
