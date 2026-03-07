import cron from "node-cron";
import { getOpenJobs, updateQueueItemStatus } from "./mongo";
import { triggerCall } from "./vapi";

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;

  console.log("Donna scheduler started — checking queue every 5 minutes");

  //Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      const jobs = await getOpenJobs();

      if (jobs.length === 0) return;

      console.log(`Scheduler: ${jobs.length} job(s) ready to fire`);

      for (const job of jobs) {
        try {
          //Mark in-progress before calling so we don't double-fire
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
