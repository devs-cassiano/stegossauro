import type {
  EmbedRequest,
  EmbedResult,
  ExtractRequest,
  ExtractResult,
  WorkerRequest,
  WorkerResponse,
} from '../types';

type ProgressHandler = (percent: number, message: string) => void;

interface Pending {
  resolve: (value: EmbedResult | ExtractResult) => void;
  reject: (reason: Error) => void;
  onProgress?: ProgressHandler | undefined;
}

export class StegoWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private onTerminated: (() => void) | null = null;

  /** Optional audit hook when the worker thread is fully released. */
  setOnTerminated(cb: (() => void) | null): void {
    this.onTerminated = cb;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../workers/stego.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      this.handleResponse(ev.data);
    };
    this.worker.onerror = (ev) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(ev.message || 'Worker crash'));
      }
      this.pending.clear();
      this.terminate();
    };
    return this.worker;
  }

  private finishJob(id: string): Pending | undefined {
    const job = this.pending.get(id);
    if (!job) return undefined;
    this.pending.delete(id);
    if (this.pending.size === 0) {
      this.terminate();
    }
    return job;
  }

  private handleResponse(msg: WorkerResponse): void {
    if (msg.type === 'progress') {
      const job = this.pending.get(msg.id);
      job?.onProgress?.(msg.percent, msg.message);
      return;
    }

    const job = this.finishJob(msg.id);
    if (!job) return;

    if (msg.type === 'embed-ok') {
      job.resolve(msg.result);
      return;
    }
    if (msg.type === 'extract-ok') {
      job.resolve(msg.result);
      return;
    }
    if (msg.type === 'error') {
      job.reject(new Error(msg.message));
    }
  }

  private nextId(): string {
    this.seq += 1;
    return `job-${this.seq}-${Date.now()}`;
  }

  embed(req: EmbedRequest, onProgress?: ProgressHandler): Promise<EmbedResult> {
    return this.dispatch('embed', req, onProgress) as Promise<EmbedResult>;
  }

  extract(req: ExtractRequest, onProgress?: ProgressHandler): Promise<ExtractResult> {
    return this.dispatch('extract', req, onProgress) as Promise<ExtractResult>;
  }

  private dispatch(
    type: 'embed' | 'extract',
    payload: EmbedRequest | ExtractRequest,
    onProgress?: ProgressHandler,
  ): Promise<EmbedResult | ExtractResult> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });

      try {
        const worker = this.ensureWorker();
        const message: WorkerRequest =
          type === 'embed'
            ? { id, type: 'embed', payload: payload as EmbedRequest }
            : { id, type: 'extract', payload: payload as ExtractRequest };

        const transfer: Transferable[] = [payload.imageData.buffer];
        if (type === 'embed') {
          const embed = payload as EmbedRequest;
          if (embed.secretBytes.buffer instanceof ArrayBuffer) {
            transfer.push(embed.secretBytes.buffer);
          }
        }
        worker.postMessage(message, transfer);
      } catch (err) {
        this.pending.delete(id);
        this.terminate();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  terminate(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    try {
      this.onTerminated?.();
    } catch {
      /* ignore audit hook failures */
    }
  }
}
