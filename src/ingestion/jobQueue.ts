import { UploadedDocument } from "../types.js";
import { processExtractDocumentJob } from "./documentWorker.js";
import { ExtractDocumentJob } from "./jobs.js";

type JobState = {
  job: ExtractDocumentJob;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: UploadedDocument;
  error?: Error;
  resolve: (value: UploadedDocument) => void;
  reject: (error: Error) => void;
  promise: Promise<UploadedDocument>;
};

class LocalDocumentJobQueue {
  private readonly queue: ExtractDocumentJob[] = [];
  private readonly states = new Map<string, JobState>();
  private activeCount = 0;

  constructor(private readonly concurrency = Number(process.env.DOCUMENT_WORKER_CONCURRENCY ?? 1)) {}

  enqueue(job: ExtractDocumentJob): string {
    if (this.states.has(job.jobId)) return job.jobId;
    let resolve!: (value: UploadedDocument) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<UploadedDocument>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    this.states.set(job.jobId, {
      job,
      status: "queued",
      resolve,
      reject,
      promise,
    });
    this.queue.push(job);
    this.drain();
    return job.jobId;
  }

  getStatus(jobId: string) {
    const state = this.states.get(jobId);
    if (!state) return undefined;
    return {
      jobId,
      status: state.status,
      fileId: state.job.fileId,
      error: state.error?.message,
    };
  }

  async wait(jobId: string): Promise<UploadedDocument> {
    const state = this.states.get(jobId);
    if (!state) throw new Error(`Unknown document job '${jobId}'.`);
    return state.promise;
  }

  private drain() {
    while (this.activeCount < Math.max(1, this.concurrency) && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      const state = this.states.get(job.jobId);
      if (!state) continue;
      state.status = "running";
      this.activeCount += 1;
      processExtractDocumentJob(job)
        .then((result) => {
          state.status = "succeeded";
          state.result = result;
          state.resolve(result);
        })
        .catch((error) => {
          state.status = "failed";
          state.error = error instanceof Error ? error : new Error(String(error));
          state.reject(state.error);
        })
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}

export const documentJobQueue = new LocalDocumentJobQueue();
