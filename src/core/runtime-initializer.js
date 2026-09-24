export function createSingleFlightInitializer(initialize) {
  if (typeof initialize !== "function") {
    throw new TypeError("A runtime initializer function is required.");
  }

  let current = null;
  return function ensureInitialized() {
    if (current) {
      return current;
    }
    const attempt = Promise.resolve().then(initialize);
    current = attempt;
    void attempt.catch(() => {
      if (current === attempt) {
        current = null;
      }
    });
    return attempt;
  };
}

export const STARTUP_INCOMPLETE_MESSAGE = "Terminus startup incomplete";

const ERROR_CODE_PATTERN = /^[A-Z_]{1,64}$/;

// Only a bounded code or constructor name leaves this function: error messages
// can quote stored or imported values and are never logged.
export function startupFailureCode(error) {
  if (typeof error?.code === "string" && ERROR_CODE_PATTERN.test(error.code)) {
    return error.code;
  }
  const name = error?.constructor?.name;
  return typeof name === "string" && name.length > 0 ? name.slice(0, 64) : "UnknownError";
}

// Runs every step in order even when an earlier one fails, so one broken step
// cannot silently skip unrelated startup work. Any failure still rejects at the
// end so a single-flight gate permits a later retry.
export async function runStartupSteps(
  steps,
  { logFailure = (name, code) => console.error("Terminus startup step failed", name, code) } = {}
) {
  let failed = false;
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      failed = true;
      logFailure(name, startupFailureCode(error));
    }
  }
  if (failed) {
    throw new Error(STARTUP_INCOMPLETE_MESSAGE);
  }
}
