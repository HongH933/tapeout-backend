import { describe, expect, it, vi } from "vitest";
import { blockRanges } from "../../src/jobs/block-ranges.js";
import { redactWorkerError, runWorkerJobs } from "../../src/jobs/worker-jobs.js";

describe("worker RPC compatibility", () => {
  it("splits inclusive block ranges to the configured provider limit", () => {
    expect([...blockRanges(100n, 125n, 10)]).toEqual([
      { start: 100n, end: 109n }, { start: 110n, end: 119n }, { start: 120n, end: 125n },
    ]);
  });

  it("continues later jobs after a failure and redacts RPC URLs", async () => {
    const later = vi.fn(async () => undefined); const reports: Array<[string, string]> = [];
    await runWorkerJobs([
      { name: "factory sync", run: async () => { throw new Error("URL: https://provider.example/v2/secret-key\nrange rejected"); } },
      { name: "listing revalidation", run: later },
    ], (name, message) => reports.push([name, message]));
    expect(later).toHaveBeenCalledOnce();
    expect(reports).toEqual([["factory sync", "URL: [redacted RPC URL]\nrange rejected"]]);
    expect(redactWorkerError("https://provider.example/v2/secret-key failed")).not.toContain("secret-key");
  });
});
