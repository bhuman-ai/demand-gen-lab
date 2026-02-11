import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

type EncryptedEnvelope = {
  iv: string;
  tag: string;
  data: string;
};

function getEncryptionKey() {
  const raw = process.env.OUTREACH_ENCRYPTION_KEY || "factory-dev-insecure-key";
  return createHash("sha256").update(raw).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptJson<T>(ciphertext: string, fallback: T): T {
  if (!ciphertext.trim()) return fallback;
  try {
    const decoded = Buffer.from(ciphertext, "base64").toString("utf8");
    const envelope = JSON.parse(decoded) as EncryptedEnvelope;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return fallback;
  }
}
