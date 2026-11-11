import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";

// AES-256-GCM envelope. In a hosted deployment set DB_ARCHITECT_SECRET to a
// managed secret. The DATABASE_URL fallback keeps local development stable and
// avoids a hard-coded key; production should always use a dedicated KMS secret.
function encryptionKey(): Buffer {
  const material = process.env.DB_ARCHITECT_SECRET ?? process.env.DATABASE_URL;
  if (!material) throw new Error("DB_ARCHITECT_SECRET is required for connection credentials");
  return createHash("sha256").update(material).digest();
}

export function encryptCredentials(payload: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secretRef: `local-kms:${randomUUID()}`,
    secretCiphertext: `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`,
  };
}

export function decryptCredentials<T extends Record<string, unknown>>(ciphertext: string | null): T {
  if (!ciphertext) throw new Error("Connection credentials have been revoked; rotate them to reconnect");
  const [version, iv, tag, body] = ciphertext.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unsupported credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}
