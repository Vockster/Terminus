import test from "node:test";
import assert from "node:assert/strict";

import { createSerialOperationExecutor } from "../../src/core/serial-operation-executor.js";

test("exclusive executor leases are valid only during their serialized operation", async () => {
  const executor = createSerialOperationExecutor();
  let capturedLease = null;
  await executor.runExclusive(async (lease) => {
    capturedLease = lease;
    assert.equal(executor.ownsLease(lease), true);
    assert.equal(executor.ownsLease(Object.freeze({})), false);
  });
  assert.equal(executor.ownsLease(capturedLease), false);
});

test("ordinary and exclusive operations retain queue order after a rejection", async () => {
  const executor = createSerialOperationExecutor();
  const order = [];
  const first = executor.run(async () => {
    order.push("first");
    throw new Error("synthetic failure");
  });
  const second = executor.runExclusive(async (lease) => {
    assert.equal(executor.ownsLease(lease), true);
    order.push("second");
  });
  const third = executor.run(async () => { order.push("third"); });
  await assert.rejects(first, /synthetic failure/);
  await Promise.all([second, third]);
  assert.deepEqual(order, ["first", "second", "third"]);
});
