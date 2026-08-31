import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // recomendado por NIST para GCM
const AUTH_TAG_LENGTH = 16;

/**
 * TOKEN_ENCRYPTION_KEY vive fuera de Postgres (env/KMS): un dump de la BD por sí solo nunca
 * expone tokens en claro. 32 bytes en base64 porque es el tamaño exacto que exige AES-256.
 */
export function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY no está configurada");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY debe decodificar (base64) a ${KEY_LENGTH} bytes; decodificó a ${key.length}`
    );
  }
  return key;
}

/**
 * Cifra `plaintext` con un nonce nuevo y aleatorio en cada llamada, embebido en el propio blob
 * devuelto (nonce || ciphertext || authTag). Nunca reutilices la misma clave para sellar dos
 * secretos con un nonce compartido: en AES-GCM eso rompe tanto la confidencialidad como la
 * autenticación (ver el comentario en 0001_init.sql sobre por qué la tabla no tiene una columna
 * de nonce compartida entre el access y el refresh token).
 */
export function seal(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]);
}

/** Lanza si `blob` fue alterado o cifrado con otra clave: el authTag de GCM no valida. */
export function open(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
