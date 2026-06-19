import test from "node:test";
import assert from "node:assert/strict";

import { hashPinSha256, verifyPin } from "../src/lib/auth/pin.js";
import { createManagerSessionToken, verifyManagerSessionToken } from "../src/lib/auth/session.js";

test("PIN hashes verify without storing plaintext", () => {
  const hash = hashPinSha256("12345");
  assert.notEqual(hash, "12345");
  assert.equal(verifyPin("12345", hash), true);
  assert.equal(verifyPin("99999", hash), false);
  assert.equal(verifyPin("12345", "SET_BY_COMMISSIONER"), false);
});

test("manager session token round trips signed claims", () => {
  const { token, expires_at: expiresAt } = createManagerSessionToken({
    groupSlug: "squad",
    managerCode: "M001",
    managerName: "Abrham",
  });
  const claims = verifyManagerSessionToken(token);
  assert.equal(claims.group_slug, "squad");
  assert.equal(claims.manager_code, "M001");
  assert.equal(claims.manager_name, "Abrham");
  assert.ok(new Date(expiresAt).getTime() > Date.now());
});
