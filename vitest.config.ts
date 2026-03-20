import { defineConfig } from "vitest/config";

const parsedMaxWorkers = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? "1", 10);
const maxWorkers =
  Number.isFinite(parsedMaxWorkers) && parsedMaxWorkers > 0 ? parsedMaxWorkers : 1;

export default defineConfig({
  test: {
    // The embedded-postgres migration test is stable in isolation but flakes under
    // multi-worker runs inside the contributor container workflow. Keep the suite
    // serialized by default so the repo has a reliable green baseline, with an
    // escape hatch for faster local experimentation.
    maxWorkers,
    projects: ["packages/db", "packages/adapters/opencode-local", "server", "ui", "cli"],
  },
});
