import {
  formatKeyHex,
  generateKeyBytes,
  keyEntropyBits,
  parseKeyHex,
} from '../crypto/keys';
import {
  capacityExceededMessage,
  computeCapacity,
  containerByteLength,
  exportPngBlob,
  preserveFileName,
  purgeCoverImage,
  selectDensity,
} from '../stego/canvas';
import type { AuditEntry, AuditLevel, CoverImageInfo } from '../types';
import { zeroize } from '../security/zeroize';
import {
  fallbackRestoredName,
  normalizeOutputPngName,
  suggestAlternatePngName,
  suggestInnocentPngName,
  suggestKeyNameFromOutput,
  suggestNeutralKeyName,
} from '../util/naming';
import { StegoWorkerClient } from '../workers/client';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour12: false });
}

export class UiController {
  private root: HTMLElement;
  private worker = new StegoWorkerClient();

  private keyBytes: Uint8Array | null = null;
  private secretFile: File | null = null;
  private secretBytes: Uint8Array | null = null;
  private coverInfo: CoverImageInfo | null = null;
  private coverPixels: Uint8ClampedArray | null = null;

  private extractPixels: Uint8ClampedArray | null = null;
  private extractWidth = 0;
  private extractHeight = 0;

  private objectUrls: string[] = [];
  private audit: AuditEntry[] = [];
  private lastPngBlob: Blob | null = null;
  private lastPngName = suggestInnocentPngName();
  private lastSecretBlob: Blob | null = null;
  private lastSecretName = fallbackRestoredName();
  private lastKeyFileName = suggestNeutralKeyName();
  private docAbort: AbortController | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.mount();
  }

  private mount(): void {
    this.renderShell();
    this.bindGlobal();
    this.refreshOutputNameSuggestion();
    this.tickStatusTime();
    this.log('info', 'Online · 100% local · CSP connect-src none');
  }

  panicWipe(): void {
    this.scrubVolatile();
    this.mount();
    this.log('warn', 'Sessão reiniciada');
  }

  private scrubVolatile(): void {
    zeroize(this.keyBytes);
    zeroize(this.secretBytes);
    zeroize(this.coverPixels);
    zeroize(this.extractPixels);
    this.keyBytes = null;
    this.secretBytes = null;
    this.secretFile = null;
    this.coverPixels = null;
    this.coverInfo = null;
    this.extractPixels = null;
    this.extractWidth = 0;
    this.extractHeight = 0;
    this.lastPngBlob = null;
    this.lastSecretBlob = null;
    this.audit = [];
    this.worker.terminate();
    this.revokeAllUrls();
    this.docAbort?.abort();
    this.docAbort = null;
  }

  private $(sel: string): HTMLElement {
    const el = this.root.querySelector(sel);
    if (!el) throw new Error(`Elemento não encontrado: ${sel}`);
    return el as HTMLElement;
  }

  private tickStatusTime(): void {
    const el = this.root.querySelector('#status-time');
    if (el) el.textContent = formatTime(Date.now());
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <header class="header">
        <div class="brand">Stegos<span>sauro</span></div>
        <div class="status-bar">
          <span class="status-pill"><span class="dot"></span> Processado localmente</span>
          <span class="status-pill">100% offline</span>
          <span class="status-pill"><span class="time" id="status-time">--:--</span></span>
        </div>
      </header>

      <nav class="segment" role="tablist">
        <button class="tab active" data-tab="hide" type="button">Ocultar</button>
        <button class="tab" data-tab="extract" type="button">Extrair</button>
      </nav>

      <section class="panel active" id="panel-hide" role="tabpanel">
        <div class="upload-grid">
          <div class="field">
            <div class="field-label">Arquivo Secreto</div>
            <div class="field-hint">Qualquer formato (PDF, vídeo, zip, dados brutos).</div>
            <div class="drop-card" id="drop-secret" tabindex="0" role="button">
              <div class="drop-icon" aria-hidden="true">+</div>
              <div class="drop-body">
                <div class="drop-placeholder" id="secret-placeholder">Solte o arquivo ou clique para escolher</div>
                <div class="drop-name" id="secret-name" hidden></div>
                <div class="drop-size" id="secret-size" hidden></div>
              </div>
              <button class="btn-icon-clear" type="button" id="btn-clear-secret" title="Remover" aria-label="Remover">×</button>
              <input type="file" id="input-secret" />
            </div>
          </div>

          <div class="field">
            <div class="field-label">Imagem de Disfarce</div>
            <div class="field-hint">PNG ou JPG limpo. Todos os metadados são expurgados na RAM.</div>
            <div class="drop-card" id="drop-cover" tabindex="0" role="button">
              <div class="drop-icon" aria-hidden="true">▢</div>
              <div class="drop-body">
                <div class="drop-placeholder" id="cover-placeholder">Solte a imagem ou clique para escolher</div>
                <div class="drop-name" id="cover-name" hidden></div>
                <div class="drop-size" id="cover-size" hidden></div>
              </div>
              <button class="btn-icon-clear" type="button" id="btn-clear-cover" title="Remover" aria-label="Remover">×</button>
              <input type="file" id="input-cover" accept="image/jpeg,image/png,image/webp" />
            </div>
          </div>
        </div>

        <div class="field">
          <div class="field-label">Chave de Acesso</div>
          <div class="field-hint">Única por arquivo. Necessária para restaurar os dados.</div>
          <div class="key-field">
            <input class="key-input" id="key-display" readonly spellcheck="false" placeholder="Gere ao selecionar o arquivo secreto" />
            <div class="key-tools">
              <button class="tool-btn" type="button" id="btn-regen" disabled title="Gerar" aria-label="Gerar">↻</button>
              <button class="tool-btn" type="button" id="btn-copy" disabled title="Copiar" aria-label="Copiar">⎘</button>
              <button class="tool-btn" type="button" id="btn-download-key" disabled title="Salvar" aria-label="Salvar">💾</button>
            </div>
          </div>
          <div class="entropy" id="key-entropy"></div>
        </div>

        <div class="field">
          <div class="field-label">Nome de Saída</div>
          <div class="input-row">
            <input
              class="text-input"
              id="output-name"
              spellcheck="false"
              autocomplete="off"
              placeholder="IMG_20260917_134012.png"
            />
            <button class="btn btn-sm" type="button" id="btn-reshuffle-name" title="Sugerir outro">↻</button>
          </div>
        </div>

        <div class="plan-badge" id="plan-badge">Aguardando arquivos…</div>

        <button class="btn btn-primary" type="button" id="btn-embed" disabled>Ocultar</button>
        <div class="progress-wrap" id="embed-progress">
          <div class="progress-track"><div class="progress-fill" id="embed-fill"></div></div>
          <div class="progress-label" id="embed-status">Aguardando…</div>
        </div>
        <div class="flash" id="embed-flash"></div>
        <div class="preview" id="embed-preview">
          <img id="embed-preview-img" alt="Pré-visualização" />
          <div class="result-actions">
            <button class="btn btn-primary" type="button" id="btn-download-png" disabled>Baixar</button>
          </div>
        </div>
      </section>

      <section class="panel" id="panel-extract" role="tabpanel">
        <div class="field">
          <div class="field-label">Imagem Combinada</div>
          <div class="field-hint">PNG gerado anteriormente.</div>
          <div class="drop-card" id="drop-stego" tabindex="0" role="button">
            <div class="drop-icon" aria-hidden="true">▢</div>
            <div class="drop-body">
              <div class="drop-placeholder" id="stego-placeholder">Solte a imagem ou clique para escolher</div>
              <div class="drop-name" id="stego-name" hidden></div>
              <div class="drop-size" id="stego-size" hidden></div>
            </div>
            <button class="btn-icon-clear" type="button" id="btn-clear-stego" title="Remover" aria-label="Remover">×</button>
            <input type="file" id="input-stego" accept="image/png,image/jpeg,image/webp" />
          </div>
        </div>

        <div class="field">
          <div class="field-label">Chave de Acesso</div>
          <div class="field-hint">Cole a chave usada na ocultação.</div>
          <input class="key-input" id="extract-key" spellcheck="false" placeholder="a1b2-c3d4-e5f6-…" />
        </div>

        <button class="btn btn-primary" type="button" id="btn-extract" disabled>Extrair</button>
        <div class="progress-wrap" id="extract-progress">
          <div class="progress-track"><div class="progress-fill" id="extract-fill"></div></div>
          <div class="progress-label" id="extract-status">Aguardando…</div>
        </div>
        <div class="flash" id="extract-flash"></div>
        <div class="result-actions" id="extract-result" style="display:none">
          <button class="btn btn-primary" type="button" id="btn-download-secret">Baixar arquivo</button>
          <span class="meta" id="extract-meta"></span>
        </div>
      </section>

      <section class="audit">
        <div class="audit-header">
          <span>Log local</span>
          <button class="btn btn-ghost" type="button" id="btn-clear-audit">Limpar</button>
        </div>
        <div class="audit-log" id="audit-log"></div>
      </section>

      <p class="footer-note">RAM only · sem rede · PNG lossless</p>
    `;
  }

  private bindDropCard(
    cardId: string,
    inputId: string,
    onFiles: (files: FileList) => void,
  ): void {
    const card = this.$(cardId);
    const input = this.$(inputId) as HTMLInputElement;

    const open = () => input.click();
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-icon-clear')) return;
      open();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('dragover');
    });
    card.addEventListener('dragleave', () => card.classList.remove('dragover'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) onFiles(files);
    });
  }

  private setDropFileState(
    kind: 'secret' | 'cover' | 'stego',
    name: string | null,
    detail: string | null,
  ): void {
    const card = this.$(`#drop-${kind}`);
    const placeholder = this.$(`#${kind}-placeholder`);
    const nameEl = this.$(`#${kind}-name`);
    const sizeEl = this.$(`#${kind}-size`);
    if (!name) {
      card.classList.remove('has-file');
      placeholder.hidden = false;
      nameEl.hidden = true;
      sizeEl.hidden = true;
      nameEl.textContent = '';
      sizeEl.textContent = '';
      return;
    }
    card.classList.add('has-file');
    placeholder.hidden = true;
    nameEl.hidden = false;
    sizeEl.hidden = false;
    nameEl.textContent = name;
    sizeEl.textContent = detail ?? '';
  }

  private bindGlobal(): void {
    this.root.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = (tab as HTMLElement).dataset.tab;
        this.switchTab(name === 'extract' ? 'extract' : 'hide');
      });
    });

    this.bindDropCard('#drop-secret', '#input-secret', (files) => {
      const input = this.$('#input-secret') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(files[0]!);
      input.files = dt.files;
      void this.onSecretSelected({ target: input } as unknown as Event);
    });
    this.bindDropCard('#drop-cover', '#input-cover', (files) => {
      const input = this.$('#input-cover') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(files[0]!);
      input.files = dt.files;
      void this.onCoverSelected({ target: input } as unknown as Event);
    });
    this.bindDropCard('#drop-stego', '#input-stego', (files) => {
      const input = this.$('#input-stego') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(files[0]!);
      input.files = dt.files;
      void this.onStegoSelected({ target: input } as unknown as Event);
    });

    this.$('#input-secret').addEventListener('change', (e) =>
      void this.onSecretSelected(e),
    );
    this.$('#input-cover').addEventListener('change', (e) =>
      void this.onCoverSelected(e),
    );
    this.$('#input-stego').addEventListener('change', (e) =>
      void this.onStegoSelected(e),
    );

    this.$('#btn-clear-secret').addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearSecret();
    });
    this.$('#btn-clear-cover').addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearCover();
    });
    this.$('#btn-clear-stego').addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearStego();
    });

    this.$('#btn-regen').addEventListener('click', () => this.regenerateKey());
    this.$('#btn-copy').addEventListener('click', () => void this.copyKey());
    this.$('#btn-download-key').addEventListener('click', () => this.downloadKeyFile());
    this.$('#btn-embed').addEventListener('click', () => void this.runEmbed());
    this.$('#btn-download-png').addEventListener('click', () => this.downloadLastPng());
    this.$('#btn-extract').addEventListener('click', () => void this.runExtract());
    this.$('#btn-download-secret').addEventListener('click', () =>
      this.downloadLastSecret(),
    );
    this.$('#btn-clear-audit').addEventListener('click', () => this.clearAudit());
    this.$('#btn-reshuffle-name').addEventListener('click', () => {
      this.refreshOutputNameSuggestion(true);
    });
    this.$('#output-name').addEventListener('change', () => this.syncOutputNameField());
    this.$('#output-name').addEventListener('blur', () => this.syncOutputNameField());

    this.$('#extract-key').addEventListener('input', () => this.updateExtractEnabled());

    this.docAbort?.abort();
    this.docAbort = new AbortController();
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.revokeAllUrls();
      },
      { signal: this.docAbort.signal },
    );
  }

  private clearSecret(): void {
    this.secretFile = null;
    this.secretBytes = null;
    this.keyBytes = null;
    (this.$('#input-secret') as HTMLInputElement).value = '';
    (this.$('#key-display') as HTMLInputElement).value = '';
    this.$('#key-entropy').textContent = '';
    (this.$('#btn-regen') as HTMLButtonElement).disabled = true;
    (this.$('#btn-copy') as HTMLButtonElement).disabled = true;
    (this.$('#btn-download-key') as HTMLButtonElement).disabled = true;
    this.setDropFileState('secret', null, null);
    this.clearEmbedResult();
    this.updateEmbedEnabled();
    this.checkCapacityPreview();
  }

  private clearCover(): void {
    this.coverPixels = null;
    this.coverInfo = null;
    (this.$('#input-cover') as HTMLInputElement).value = '';
    this.setDropFileState('cover', null, null);
    this.clearEmbedResult();
    this.updateEmbedEnabled();
    this.checkCapacityPreview();
  }

  private clearStego(): void {
    this.extractPixels = null;
    this.extractWidth = 0;
    this.extractHeight = 0;
    this.lastSecretBlob = null;
    (this.$('#input-stego') as HTMLInputElement).value = '';
    this.setDropFileState('stego', null, null);
    this.$('#extract-result').style.display = 'none';
    this.setFlash('#extract-flash', null);
    this.updateExtractEnabled();
  }

  private refreshOutputNameSuggestion(alternate = false): void {
    const name = alternate ? suggestAlternatePngName() : suggestInnocentPngName();
    (this.$('#output-name') as HTMLInputElement).value = name;
    this.lastPngName = name;
    this.updateDownloadPngLabel();
  }

  private syncOutputNameField(): void {
    const input = this.$('#output-name') as HTMLInputElement;
    const normalized = normalizeOutputPngName(input.value);
    input.value = normalized;
    this.lastPngName = normalized;
    this.updateDownloadPngLabel();
  }

  private getOutputPngName(): string {
    const raw = (this.$('#output-name') as HTMLInputElement).value;
    const normalized = normalizeOutputPngName(raw);
    (this.$('#output-name') as HTMLInputElement).value = normalized;
    this.lastPngName = normalized;
    return normalized;
  }

  private updateDownloadPngLabel(): void {
    const btn = this.$('#btn-download-png') as HTMLButtonElement;
    btn.textContent = `Baixar ${this.lastPngName}`;
  }

  private switchTab(tab: 'hide' | 'extract'): void {
    this.root.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
    });
    this.$('#panel-hide').classList.toggle('active', tab === 'hide');
    this.$('#panel-extract').classList.toggle('active', tab === 'extract');
    this.revokeAllUrls();
    this.tickStatusTime();
    this.log('info', `Aba: ${tab === 'hide' ? 'Ocultar' : 'Extrair'}`);
  }

  private log(level: AuditLevel, message: string): void {
    const entry: AuditEntry = { ts: Date.now(), level, message };
    this.audit.push(entry);
    const log = this.$('#audit-log');
    const line = document.createElement('div');
    line.className = 'audit-line';
    line.innerHTML = `<span class="t">${formatTime(entry.ts)}</span><span class="lvl-${level}">${level.toUpperCase()}</span><span>${escapeHtml(message)}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  private clearAudit(): void {
    this.audit = [];
    this.$('#audit-log').innerHTML = '';
    this.log('info', 'Console limpo');
  }

  private setFlash(id: string, kind: 'ok' | 'error' | null, text = ''): void {
    const el = this.$(id);
    el.classList.remove('visible', 'ok', 'error');
    if (!kind) {
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.add('visible', kind);
  }

  private setProgress(
    wrapId: string,
    fillId: string,
    statusId: string,
    percent: number,
    message: string,
  ): void {
    const wrap = this.$(wrapId);
    wrap.classList.add('visible');
    (this.$(fillId) as HTMLElement).style.width = `${Math.max(0, Math.min(100, percent))}%`;
    this.$(statusId).textContent = message;
  }

  private updateEmbedEnabled(): void {
    const ok =
      !!this.secretBytes &&
      !!this.coverPixels &&
      !!this.keyBytes &&
      !!this.coverInfo;
    (this.$('#btn-embed') as HTMLButtonElement).disabled = !ok;
  }

  private updateExtractEnabled(): void {
    const key = (this.$('#extract-key') as HTMLInputElement).value.trim();
    const ok = !!this.extractPixels && key.length > 0;
    (this.$('#btn-extract') as HTMLButtonElement).disabled = !ok;
  }

  private issueKey(): void {
    this.keyBytes = generateKeyBytes();
    const formatted = formatKeyHex(this.keyBytes);
    (this.$('#key-display') as HTMLInputElement).value = formatted;
    this.$('#key-entropy').textContent =
      `${keyEntropyBits(this.keyBytes)} bits · CSPRNG`;
    (this.$('#btn-regen') as HTMLButtonElement).disabled = false;
    (this.$('#btn-copy') as HTMLButtonElement).disabled = false;
    (this.$('#btn-download-key') as HTMLButtonElement).disabled = false;
    this.log('ok', 'Chave 256-bit gerada');
  }

  private regenerateKey(): void {
    if (!this.secretFile) return;
    this.issueKey();
    this.log('warn', 'Chave regenerada');
    this.clearEmbedResult();
  }

  private async copyKey(): Promise<void> {
    const val = (this.$('#key-display') as HTMLInputElement).value;
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      this.log('ok', 'Chave copiada');
    } catch {
      this.log('error', 'Falha ao copiar');
    }
  }

  private downloadKeyFile(): void {
    const val = (this.$('#key-display') as HTMLInputElement).value;
    if (!val) return;
    this.lastKeyFileName = suggestKeyNameFromOutput(this.getOutputPngName());
    const blob = new Blob([val + '\n'], { type: 'text/plain' });
    this.triggerDownload(blob, this.lastKeyFileName);
    this.log('ok', `Arquivo de chave baixado: ${this.lastKeyFileName}`);
  }

  private async onSecretSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.clearEmbedResult();
    this.secretFile = file;
    this.secretBytes = new Uint8Array(await file.arrayBuffer());
    const name = preserveFileName(file.name);
    const mime = file.type || 'application/octet-stream';
    this.setDropFileState('secret', name, `${formatBytes(file.size)} · ${mime}`);

    this.issueKey();
    this.tickStatusTime();
    this.log('info', `Secreto: ${name} (${formatBytes(file.size)})`);
    this.updateEmbedEnabled();
    this.checkCapacityPreview();
  }

  private async onCoverSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.clearEmbedResult();
    try {
      this.log('info', `Disfarce: ${preserveFileName(file.name)}`);
      const purged = await purgeCoverImage(file);
      this.coverPixels = purged.imageData;
      this.coverInfo = computeCapacity(purged.width, purged.height);
      const mp = this.coverInfo.megapixels.toFixed(2);

      this.setDropFileState(
        'cover',
        preserveFileName(file.name),
        `${purged.width}×${purged.height} · ${mp} MP · máx ${formatBytes(this.coverInfo.capacityBytes3)}`,
      );

      this.log('ok', `Sanitizado ${purged.width}×${purged.height} (${mp} MP)`);
      this.tickStatusTime();
      this.updateEmbedEnabled();
      this.checkCapacityPreview();
    } catch (err) {
      this.coverPixels = null;
      this.coverInfo = null;
      this.setDropFileState('cover', null, null);
      this.log('error', err instanceof Error ? err.message : 'Erro no disfarce');
      this.updateEmbedEnabled();
    }
  }

  private checkCapacityPreview(): void {
    const badge = this.$('#plan-badge');
    if (!this.secretBytes || !this.coverInfo || !this.secretFile) {
      badge.textContent = 'Aguardando arquivos…';
      return;
    }
    const metaBytes = new TextEncoder().encode(
      JSON.stringify({
        name: preserveFileName(this.secretFile.name),
        mimeType: this.secretFile.type || 'application/octet-stream',
      }),
    ).length;
    const needed = containerByteLength(metaBytes, this.secretBytes.length);
    const density = selectDensity(
      this.coverInfo.width,
      this.coverInfo.height,
      needed,
    );

    if (!density) {
      badge.innerHTML =
        `<span style="color:var(--err)">Sem capacidade em 3-LSB — use imagem maior</span>`;
      this.log(
        'error',
        capacityExceededMessage(needed, this.coverInfo.capacityBytes3),
      );
      return;
    }

    const cap =
      density === 1
        ? this.coverInfo.capacityBytes1
        : density === 2
          ? this.coverInfo.capacityBytes2
          : this.coverInfo.capacityBytes3;
    const ratio = (needed / cap) * 100;
    badge.innerHTML =
      `<strong>${density}-LSB</strong> · ~${ratio.toFixed(0)}% · compressão no worker`;
    this.log(
      'info',
      `Plano: ${density}-LSB · ${formatBytes(needed)} / ${formatBytes(cap)}`,
    );
  }

  private clearEmbedResult(): void {
    this.lastPngBlob = null;
    this.$('#embed-preview').classList.remove('visible');
    (this.$('#btn-download-png') as HTMLButtonElement).disabled = true;
    this.updateDownloadPngLabel();
    this.setFlash('#embed-flash', null);
  }

  private async runEmbed(): Promise<void> {
    if (!this.secretBytes || !this.coverPixels || !this.keyBytes || !this.coverInfo || !this.secretFile) {
      return;
    }

    const metaName = preserveFileName(this.secretFile.name);
    const metaBytesLen = new TextEncoder().encode(
      JSON.stringify({
        name: metaName,
        mimeType: this.secretFile.type || 'application/octet-stream',
      }),
    ).length;
    const needed = containerByteLength(metaBytesLen, this.secretBytes.length);
    if (needed * 8 > this.coverInfo.capacityBits3) {
      const msg = capacityExceededMessage(needed, this.coverInfo.capacityBytes3);
      this.setFlash('#embed-flash', 'error', msg);
      this.log('error', msg);
      return;
    }

    (this.$('#btn-embed') as HTMLButtonElement).disabled = true;
    this.setFlash('#embed-flash', null);
    this.setProgress('#embed-progress', '#embed-fill', '#embed-status', 1, 'Processando…');
    this.log('info', 'Worker iniciado');
    this.tickStatusTime();

    // Dedicated copies for Transferable postMessage (keep originals for retry).
    const imageCopy = new Uint8ClampedArray(this.coverPixels);
    const secretCopy = new Uint8Array(this.secretBytes);

    try {
      const result = await this.worker.embed(
        {
          imageData: imageCopy,
          width: this.coverInfo.width,
          height: this.coverInfo.height,
          keyBytes: this.keyBytes,
          secretBytes: secretCopy,
          metadata: {
            name: metaName,
            mimeType: this.secretFile.type || 'application/octet-stream',
          },
        },
        (percent, message) => {
          this.setProgress('#embed-progress', '#embed-fill', '#embed-status', percent, message);
          if (
            percent <= 15 ||
            percent === 18 ||
            percent === 28 ||
            percent >= 95 ||
            message.includes('Compressão') ||
            message.includes('Densidade')
          ) {
            this.log('info', message);
          }
        },
      );

      const compLabel = result.compressed
        ? `Ativa (−${((1 - result.compressionRatio) * 100).toFixed(1)}%)`
        : 'Inativa';
      this.$('#plan-badge').innerHTML =
        `<strong>${result.density}-LSB</strong> · Compressão: ${compLabel} · ` +
        `${(result.occupancyRatio * 100).toFixed(0)}%`;

      this.log(
        'ok',
        `${result.density}-LSB · ${formatBytes(result.storedBytes)}` +
          (result.compressed ? ` (de ${formatBytes(result.originalBytes)})` : ''),
      );

      this.setProgress('#embed-progress', '#embed-fill', '#embed-status', 96, 'Montando PNG…');
      const png = await exportPngBlob(result.imageData, result.width, result.height);
      this.lastPngBlob = png;
      const outName = this.getOutputPngName();

      this.revokeAllUrls();
      const url = URL.createObjectURL(png);
      this.objectUrls.push(url);
      const img = this.$('#embed-preview-img') as HTMLImageElement;
      img.src = url;
      img.alt = outName;
      this.$('#embed-preview').classList.add('visible');
      (this.$('#btn-download-png') as HTMLButtonElement).disabled = false;
      this.updateDownloadPngLabel();

      this.setProgress('#embed-progress', '#embed-fill', '#embed-status', 100, 'Pronto');
      this.tickStatusTime();
      this.setFlash('#embed-flash', 'ok', `Pronto: ${outName}. Guarde a chave.`);
      this.log('ok', `Gerado: ${outName}`);
      zeroize(result.imageData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na injeção';
      this.setFlash('#embed-flash', 'error', msg);
      this.log('error', msg);
    } finally {
      zeroize(imageCopy);
      zeroize(secretCopy);
      this.updateEmbedEnabled();
    }
  }

  private downloadLastPng(): void {
    if (!this.lastPngBlob) return;
    const name = this.getOutputPngName();
    this.triggerDownload(this.lastPngBlob, name);
    this.log('ok', `Download iniciado: ${name}`);
  }

  private async onStegoSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.lastSecretBlob = null;
    this.$('#extract-result').style.display = 'none';
    this.setFlash('#extract-flash', null);

    try {
      this.log('info', `Imagem: ${preserveFileName(file.name)}`);
      const purged = await purgeCoverImage(file);
      this.extractPixels = purged.imageData;
      this.extractWidth = purged.width;
      this.extractHeight = purged.height;
      this.setDropFileState(
        'stego',
        preserveFileName(file.name),
        `${purged.width}×${purged.height}`,
      );
      this.log('ok', 'Pixels em RAM');
      this.tickStatusTime();
      this.updateExtractEnabled();
    } catch (err) {
      this.extractPixels = null;
      this.setDropFileState('stego', null, null);
      this.log('error', err instanceof Error ? err.message : 'Erro ao ler imagem');
      this.updateExtractEnabled();
    }
  }

  private async runExtract(): Promise<void> {
    if (!this.extractPixels) return;
    const rawKey = (this.$('#extract-key') as HTMLInputElement).value;

    let keyBytes: Uint8Array;
    try {
      keyBytes = parseKeyHex(rawKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chave inválida';
      this.setFlash('#extract-flash', 'error', msg);
      this.log('error', msg);
      return;
    }

    (this.$('#btn-extract') as HTMLButtonElement).disabled = true;
    this.setFlash('#extract-flash', null);
    this.setProgress('#extract-progress', '#extract-fill', '#extract-status', 1, 'Processando…');
    this.log('info', 'Extraindo…');
    this.tickStatusTime();

    const imageCopy = new Uint8ClampedArray(this.extractPixels);

    try {
      const result = await this.worker.extract(
        {
          imageData: imageCopy,
          width: this.extractWidth,
          height: this.extractHeight,
          keyBytes,
        },
        (percent, message) => {
          this.setProgress('#extract-progress', '#extract-fill', '#extract-status', percent, message);
          if (percent === 30 || percent === 100 || message.includes('Descomprimindo')) {
            this.log('ok', message);
          } else if (percent === 12 || percent === 60) {
            this.log('info', message);
          }
        },
      );

      const payloadCopy = new Uint8Array(result.payload);
      this.lastSecretBlob = new Blob([payloadCopy.slice()], {
        type: result.metadata.mimeType || 'application/octet-stream',
      });
      this.lastSecretName = preserveFileName(result.metadata.name);

      this.$('#extract-meta').innerHTML =
        `<strong>${escapeHtml(this.lastSecretName)}</strong> · ${formatBytes(result.payload.length)} · ${escapeHtml(result.metadata.mimeType)}`;
      this.$('#extract-result').style.display = 'flex';

      this.setProgress('#extract-progress', '#extract-fill', '#extract-status', 100, 'Pronto');
      this.tickStatusTime();
      this.setFlash('#extract-flash', 'ok', 'Arquivo restaurado.');
      this.log(
        'ok',
        `OK — ${this.lastSecretName} (${formatBytes(result.payload.length)}) · ${result.density}-LSB` +
          (result.compressed ? ' · deflate' : ''),
      );
      zeroize(result.payload);
      zeroize(payloadCopy);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Chave inválida ou nenhum dado detectado';
      this.setFlash('#extract-flash', 'error', msg);
      this.log('error', msg);
      this.$('#extract-result').style.display = 'none';
      this.lastSecretBlob = null;
    } finally {
      zeroize(imageCopy);
      this.updateExtractEnabled();
    }
  }

  private downloadLastSecret(): void {
    if (!this.lastSecretBlob) return;
    this.triggerDownload(this.lastSecretBlob, this.lastSecretName);
    this.log('ok', `Download: ${this.lastSecretName}`);
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      this.objectUrls = this.objectUrls.filter((u) => u !== url);
    }, 2500);
  }

  private revokeAllUrls(): void {
    for (const url of this.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    this.objectUrls = [];
  }

  destroy(): void {
    this.scrubVolatile();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
