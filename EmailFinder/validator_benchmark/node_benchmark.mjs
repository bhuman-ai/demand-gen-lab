import fs from 'fs/promises';
import { validate as deepValidate } from 'deep-email-validator';
import { verifyEmail } from '@emailcheck/email-validator-js';

function timeoutWrap(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

function inferDeepPrediction(result) {
  if (!result || typeof result !== 'object') return null;
  const smtp = result.validators?.smtp;
  if (smtp && typeof smtp.valid === 'boolean') return smtp.valid;
  return null;
}

function inferEmailCheckPrediction(result) {
  if (!result || typeof result !== 'object') return null;
  if (typeof result.validSmtp === 'boolean') return result.validSmtp;
  if (typeof result.smtpValid === 'boolean') return result.smtpValid;
  if (typeof result.smtp_valid === 'boolean') return result.smtp_valid;
  if (result.smtp && typeof result.smtp.valid === 'boolean') return result.smtp.valid;
  if (result.checks && typeof result.checks.smtp === 'boolean') return result.checks.smtp;
  return null;
}

async function runOne(email) {
  const out = {
    email,
    deep_email_validator: {
      predicted_accept: null,
      error: null,
      elapsed_ms: null,
      raw: null,
    },
    email_validator_js: {
      predicted_accept: null,
      error: null,
      elapsed_ms: null,
      raw: null,
    },
  };

  const deepStart = Date.now();
  try {
    const deepResult = await timeoutWrap(
      deepValidate({
        email,
        sender: 'probe@example.net',
        validateRegex: true,
        validateMx: true,
        validateTypo: false,
        validateDisposable: false,
        validateSMTP: true,
      }),
      15000,
    );
    out.deep_email_validator.raw = deepResult;
    out.deep_email_validator.predicted_accept = inferDeepPrediction(deepResult);
  } catch (err) {
    out.deep_email_validator.error = String(err?.message || err);
  }
  out.deep_email_validator.elapsed_ms = Date.now() - deepStart;

  const ecStart = Date.now();
  try {
    const ecResult = await timeoutWrap(
      verifyEmail({
        emailAddress: email,
        verifyMx: true,
        verifySmtp: true,
        checkDisposable: false,
        checkFree: false,
        suggestDomain: false,
        timeout: 10000,
      }),
      15000,
    );
    out.email_validator_js.raw = ecResult;
    out.email_validator_js.predicted_accept = inferEmailCheckPrediction(ecResult);
  } catch (err) {
    out.email_validator_js.error = String(err?.message || err);
  }
  out.email_validator_js.elapsed_ms = Date.now() - ecStart;

  return out;
}

async function main() {
  const datasetPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!datasetPath || !outputPath) {
    console.error('Usage: node node_benchmark.mjs <dataset.json> <out.json>');
    process.exit(2);
  }
  const rows = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
  const results = [];

  for (const row of rows) {
    const email = row.email;
    const one = await runOne(email);
    results.push(one);
    const deepPred = one.deep_email_validator.predicted_accept;
    const ecPred = one.email_validator_js.predicted_accept;
    console.log(
      `${email} | deep=${String(deepPred)} (${one.deep_email_validator.elapsed_ms}ms) | emailcheck=${String(ecPred)} (${one.email_validator_js.elapsed_ms}ms)`,
    );
  }

  await fs.writeFile(outputPath, JSON.stringify({ results }, null, 2));
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
