export type WorkerJob = { name: string; run: () => Promise<unknown> };

export function redactWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/gi, "[redacted RPC URL]");
}

export async function runWorkerJobs(jobs: WorkerJob[], report: (name: string, message: string) => void = (name, message) => console.error(`${name} failed`, message)) {
  for (const job of jobs) {
    try { await job.run(); }
    catch (error) { report(job.name, redactWorkerError(error)); }
  }
}
