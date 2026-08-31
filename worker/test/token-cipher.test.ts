import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEncryptionKey, open, seal } from "../src/crypto/token-cipher.js";

const key = randomBytes(32);
const otherKey = randomBytes(32);

describe("token-cipher", () => {
  it("seal/open es un roundtrip exacto", () => {
    const blob = seal("mock_valid_secreto", key);
    expect(open(blob, key)).toBe("mock_valid_secreto");
  });

  it("dos sellados del mismo texto producen blobs distintos (nonce nuevo cada vez)", () => {
    const a = seal("mismo-texto", key);
    const b = seal("mismo-texto", key);
    expect(a.equals(b)).toBe(false);
  });

  it("abrir con la clave equivocada falla (el authTag no valida)", () => {
    const blob = seal("secreto", key);
    expect(() => open(blob, otherKey)).toThrow();
  });

  it("un blob manipulado falla al abrir en vez de devolver texto corrupto en silencio", () => {
    const blob = seal("secreto", key);
    blob[blob.length - 1] ^= 0xff; // corrompe un byte del authTag
    expect(() => open(blob, key)).toThrow();
  });

  describe("loadEncryptionKey", () => {
    it("decodifica una clave base64 de 32 bytes", () => {
      const loaded = loadEncryptionKey({ TOKEN_ENCRYPTION_KEY: key.toString("base64") } as NodeJS.ProcessEnv);
      expect(loaded.equals(key)).toBe(true);
    });

    it("lanza si falta la variable de entorno", () => {
      expect(() => loadEncryptionKey({} as NodeJS.ProcessEnv)).toThrow();
    });

    it("lanza si la clave no decodifica a 32 bytes", () => {
      const shortKey = Buffer.from("demasiado-corta").toString("base64");
      expect(() => loadEncryptionKey({ TOKEN_ENCRYPTION_KEY: shortKey } as NodeJS.ProcessEnv)).toThrow();
    });
  });
});
