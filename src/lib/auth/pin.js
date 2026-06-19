import crypto from "node:crypto";

const HASH_PREFIX = "sha256:";

export function hashPinSha256(pin) {
  return `${HASH_PREFIX}${crypto.createHash("sha256").update(String(pin)).digest("hex")}`;
}

export function verifyPin(pin, pinHash) {
  const expected = String(pinHash || "");
  if (!expected || expected === "SET_BY_COMMISSIONER") return false;

  if (expected.startsWith(HASH_PREFIX)) {
    const actual = hashPinSha256(pin);
    return safeEqual(actual, expected);
  }

  return false;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
