/**
 * Web Worker for the in-game Balance Lab. The page hands it one job at a
 * time and gets each result back as soon as the battle ends, so several
 * workers can share a suite and the page can stream progress.
 *
 * Loaded with Vite's `?worker&inline`, so it also works in the single-file build.
 */
import { runJob } from './runner';
import type { JobResult } from './runner';
import type { BalanceJob } from './suites';

export type LabToWorker = { type: 'job'; index: number; job: BalanceJob };
export type WorkerToLab = { type: 'result'; index: number; result: JobResult };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<LabToWorker>) => {
  const m = e.data;
  if (m.type !== 'job') return;
  const msg: WorkerToLab = { type: 'result', index: m.index, result: runJob(m.job) };
  scope.postMessage(msg);
};
