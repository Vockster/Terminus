import test from "node:test";
import assert from "node:assert/strict";

import {
  STARTUP_INCOMPLETE_MESSAGE,
  createSingleFlightInitializer,
  runStartupSteps,
  startupFailureCode
} from "../../src/core/runtime-initializer.js";

test("runtime initialization coalesces concurrent and later successful callers", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const ensureInitialized = createSingleFlightInitializer(async () => {
    calls += 1;
    await pending;
    return "ready";
  });

  const first = ensureInitialized();
  const second = ensureInitialized();
  assert.equal(first, second);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "ready");
  assert.equal(await ensureInitialized(), "ready");
  assert.equal(calls, 1);
});

test("runtime initialization shares a rejection and permits a later retry", async () => {
  const expected = new Error("startup failed");
  let calls = 0;
  const ensureInitialized = createSingleFlightInitializer(async () => {
    calls += 1;
    if (calls === 1) {
      throw expected;
    }
    return "recovered";
  });

  const first = ensureInitialized();
  const second = ensureInitialized();
  assert.equal(first, second);
  await assert.rejects(first, (error) => error === expected);
  await Promise.resolve();
  assert.equal(await ensureInitialized(), "recovered");
  assert.equal(calls, 2);
});

test("runtime initialization rejects an invalid initializer", () => {
  assert.throws(
    () => createSingleFlightInitializer(null),
    /initializer function/
  );
});

test("startup steps keep running after a failure and log only bounded codes", async () => {
  const ran = [];
  const logged = [];
  const secret = "https://sentinel.invalid/secret SENTINEL-TITLE";
  class StorageBroken extends Error {}
  const coded = Object.assign(new Error(secret), { code: "INVALID_STATE" });
  const oddCode = Object.assign(new StorageBroken(secret), { code: secret });

  await assert.rejects(
    runStartupSteps([
      ["first", async () => { ran.push("first"); throw coded; }],
      ["second", async () => { ran.push("second"); }],
      ["third", () => { ran.push("third"); throw oddCode; }],
      ["fourth", async () => { ran.push("fourth"); }]
    ], { logFailure: (name, code) => logged.push([name, code]) }),
    (error) => error.message === STARTUP_INCOMPLETE_MESSAGE && !error.message.includes("sentinel")
  );

  assert.deepEqual(ran, ["first", "second", "third", "fourth"]);
  assert.deepEqual(logged, [["first", "INVALID_STATE"], ["third", "StorageBroken"]]);
  assert.equal(JSON.stringify(logged).includes("sentinel"), false);
});

test("successful startup steps resolve without logging", async () => {
  const logged = [];
  await runStartupSteps([["only", async () => undefined]], {
    logFailure: (...entry) => logged.push(entry)
  });
  assert.deepEqual(logged, []);
  assert.equal(startupFailureCode(undefined), "UnknownError");
  assert.equal(startupFailureCode({ code: "lowercase" }), "Object");
});

test("a failed startup run lets the single-flight gate retry every step", async () => {
  let attempts = 0;
  const ensureInitialized = createSingleFlightInitializer(() =>
    runStartupSteps([
      ["flaky", async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first start failed");
      }]
    ], { logFailure: () => undefined })
  );

  await assert.rejects(ensureInitialized(), new RegExp(STARTUP_INCOMPLETE_MESSAGE));
  await ensureInitialized();
  assert.equal(attempts, 2);
});
