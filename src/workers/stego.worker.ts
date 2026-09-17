/// <reference lib="webworker" />

/**
 * Dedicated worker — binary / PRNG / LSB only.
 * No DOM, no window, no anti-debug.
 */
import { embed, extract } from '../stego/engine';
import type { WorkerRequest, WorkerResponse } from '../types';

declare const self: DedicatedWorkerGlobalScope;

function reply(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'embed') {
      const result = await embed(msg.payload, (percent, message) => {
        reply({ id: msg.id, type: 'progress', percent, message });
      });
      reply(
        { id: msg.id, type: 'embed-ok', result },
        [result.imageData.buffer],
      );
      return;
    }

    if (msg.type === 'extract') {
      const result = await extract(msg.payload, (percent, message) => {
        reply({ id: msg.id, type: 'progress', percent, message });
      });
      reply(
        { id: msg.id, type: 'extract-ok', result },
        [result.payload.buffer],
      );
      return;
    }

    reply({
      id: (msg as WorkerRequest).id,
      type: 'error',
      message: 'Tipo de tarefa desconhecido',
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Falha no processamento esteganográfico';
    reply({ id: msg.id, type: 'error', message });
  }
};
