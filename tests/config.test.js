import test from "node:test";
import assert from "node:assert/strict";
import { positiveIntegerEnv } from "../src/config.js";

test("uses the fallback when a setting is absent or blank", () => {
  const key = "PDF_SERVICE_TEST_SETTING";
  delete process.env[key];
  assert.equal(positiveIntegerEnv(key, 2), 2);
  process.env[key] = "  ";
  assert.equal(positiveIntegerEnv(key, 3), 3);
  delete process.env[key];
});

test("accepts a positive integer setting", () => {
  const key = "PDF_SERVICE_TEST_SETTING";
  process.env[key] = "4";
  assert.equal(positiveIntegerEnv(key, 2), 4);
  delete process.env[key];
});

test("rejects zero, negative, fractional, non-numeric and unsafe settings", () => {
  const key = "PDF_SERVICE_TEST_SETTING";
  for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
    process.env[key] = value;
    assert.throws(() => positiveIntegerEnv(key, 2), new RegExp(key));
  }
  delete process.env[key];
});
