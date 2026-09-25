/**
 * A minimal in-process job queue: one worker, retries with exponential
 * backoff. Webhook handlers hand work to it so they can answer Shopify within
 * its timeout instead of doing API calls inline.
 *
 * This is enough for a single-process app on one development store. In
 * production the same interface would sit on SQS or BullMQ so that jobs
 * survive restarts and run across instances; the persisted `WebhookEvent`
 * rows already make unfinished work visible and re-runnable from the admin.
 */

export type Job = () => Promise<void>;

export type FailureHandler = (
  error: unknown,
  attempts: number,
) => Promise<void> | void;

export interface JobQueueOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** Injected in tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class JobQueue {
  private chain: Promise<void> = Promise.resolve();
  private readonly options: Required<JobQueueOptions>;

  constructor(options: JobQueueOptions) {
    this.options = { sleep: defaultSleep, ...options };
  }

  /**
   * Schedules a job after the ones already queued. Resolves once the job has
   * succeeded or given up; it never rejects, so callers may fire and forget.
   */
  enqueue(name: string, job: Job, onFailure?: FailureHandler): Promise<void> {
    const run = async () => {
      for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
        try {
          await job();
          return;
        } catch (error) {
          const isLast = attempt === this.options.maxAttempts;
          console.error(
            `[queue] ${name} failed on attempt ${attempt}/${this.options.maxAttempts}`,
            error,
          );
          if (isLast) {
            await onFailure?.(error, attempt);
            return;
          }
          await this.options.sleep(
            this.options.baseDelayMs * 2 ** (attempt - 1),
          );
        }
      }
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var jobQueueGlobal: JobQueue | undefined;
}

/** One queue per process, kept across dev-server reloads like the Prisma client. */
export const jobQueue: JobQueue =
  global.jobQueueGlobal ??
  (global.jobQueueGlobal = new JobQueue({ maxAttempts: 3, baseDelayMs: 500 }));
