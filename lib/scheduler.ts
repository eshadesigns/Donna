import cron from "node-cron";
import { getOpenJobs, updateQueueItemStatus } from "./mongo";
import { triggerCall } from "./vapi";

// node-cron v4 removed the recoverMissedExecutions option. When the process is
// suspended (e.g. laptop sleep) and resumes, it floods the log with one WARN
// per missed 5-minute slot. Suppress only that specific pattern — everything
// else from console.warn still passes through.
const _warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("[NODE-CRON]") && args[0].includes("missed execution")) return;
  _warn.apply(console, args);
};

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;

  console.log("Donna scheduler started — checking queue every 5 minutes");

  cron.schedule("*/5 * * * *", async () => {
    try {
      const jobs = await getOpenJobs();

      if (jobs.length === 0) return;

      console.log(`Scheduler: ${jobs.length} job(s) ready to fire`);

      for (const job of jobs) {
        try {
          // Mark in-progress before calling so we don't double-fire
          await updateQueueItemStatus(job.businessName, "in-progress");

          const { callId } = await triggerCall(job.phone, {
            businessName: job.businessName,
            task: job.context.task,
            timeWindow: job.context.timeWindow,
            budget: job.context.budget,
            userId: job.userId,
          });

          await updateQueueItemStatus(job.businessName, "in-progress", callId);

          console.log(`Scheduler: called ${job.businessName} → callId ${callId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error(`Scheduler: failed to call ${job.businessName}:`, msg);
          await updateQueueItemStatus(job.businessName, "failed");
        }
      }
    } catch (err) {
      console.error("Scheduler tick error:", err);
    }
  });
}
