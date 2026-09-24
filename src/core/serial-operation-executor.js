export function createSerialOperationExecutor() {
  let tail = Promise.resolve();
  let activeLease = null;

  function enqueue(operation) {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("A serialized operation must be a function."));
    }
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  }

  return Object.freeze({
    run(operation) {
      return enqueue(operation);
    },

    runExclusive(operation) {
      if (typeof operation !== "function") {
        return Promise.reject(new TypeError("A serialized operation must be a function."));
      }
      return enqueue(async () => {
        const lease = Object.freeze({});
        activeLease = lease;
        try {
          return await operation(lease);
        } finally {
          activeLease = null;
        }
      });
    },

    ownsLease(lease) {
      return lease !== null && lease === activeLease;
    }
  });
}
