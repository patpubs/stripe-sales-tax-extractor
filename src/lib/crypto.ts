import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

// AES-256-GCM. The key lives only in the server environment (Vercel), the
// ciphertext lives only in Supabase, so neither system alone can reveal a
// Stripe key.

// Accepts either 32 random bytes in base64 (openssl rand -base64 32) or any
// long random passphrase, which is hashed down to a 32-byte key.
function key(): Buffer {
  const raw = env.encryptionKey.trim();
  if (raw.length < 32) throw new Error("STRIPE_KEY_ENCRYPTION_KEY must be at least 32 characters");
  const buf = Buffer.from(raw, "base64");
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw) && buf.length === 32) return buf;
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, ciphertext] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !ciphertext) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function keyHint(secret: string): string {
  const prefix = secret.split("_").slice(0, 2).join("_");
  return `${prefix}_…${secret.slice(-4)}`;
}
