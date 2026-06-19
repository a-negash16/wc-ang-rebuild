import { hashPinSha256 } from "../src/lib/auth/pin.js";

const pin = process.argv[2];

if (!pin) {
  console.error("Usage: node scripts/hash-pin.mjs <pin>");
  process.exit(1);
}

console.log(hashPinSha256(pin));
