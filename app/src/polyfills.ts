// Must be the first import of the app: web3.js needs crypto.getRandomValues
// (Keypair.generate) and a global Buffer before any of its modules run.
import "react-native-get-random-values";
import { Buffer } from "buffer";

if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer as unknown as typeof global.Buffer;
}
