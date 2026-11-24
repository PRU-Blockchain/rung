import statements from "./statements.json";

// Wallets check the Android app's identity against this document: the app's
// package and signing certificate must be listed on the site the app names.
// Their verifier (solana-mobile/digital-asset-links-android) compares the
// Content-Type header with the bare string "application/json". A static file
// is served with "; charset=utf-8" appended, which fails that check, so the
// document is answered from here with the header set by hand.
export function GET() {
  return new Response(JSON.stringify(statements), {
    headers: { "Content-Type": "application/json" },
  });
}
