import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("hash-pin script emits a sha256 hash", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/hash-pin.mjs", "12345"]);
  assert.match(stdout.trim(), /^sha256:[a-f0-9]{64}$/);
});
