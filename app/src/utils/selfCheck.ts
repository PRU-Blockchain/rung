import { Keypair, PublicKey } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";

const SELF_CHECK_KEY = "rung.selfcheck";

/**
 * Startup check that the polyfills and native modules work:
 * generate a keypair (needs crypto.getRandomValues + Buffer), round-trip its
 * secret key through expo-secure-store, and rebuild the same public key.
 * The secret is never logged and is deleted afterwards.
 */
export async function runSelfCheck(): Promise<string> {
  const keypair = Keypair.generate();
  const encoded = Buffer.from(keypair.secretKey).toString("base64");
  try {
    await SecureStore.setItemAsync(SELF_CHECK_KEY, encoded);
    const readBack = await SecureStore.getItemAsync(SELF_CHECK_KEY);
    if (readBack !== encoded) {
      throw new Error("secure-store round trip mismatch");
    }
    const restored = Keypair.fromSecretKey(Buffer.from(readBack, "base64"));
    if (!restored.publicKey.equals(keypair.publicKey)) {
      throw new Error("restored public key mismatch");
    }
    if (!PublicKey.isOnCurve(restored.publicKey.toBytes())) {
      throw new Error("public key not on curve");
    }
    return "ok";
  } finally {
    await SecureStore.deleteItemAsync(SELF_CHECK_KEY);
  }
}
