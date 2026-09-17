# 🦕 Stegossauro

> Esteganografia client-side de alta densidade, guiada por chave e com isolamento total de rede (Zero-Knowledge).

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Zero-Knowledge](https://img.shields.io/badge/Zero--Knowledge-Strict-1b453b)](#pilares-de-segurança--modelo-zero-knowledge)
[![100% Client-Side](https://img.shields.io/badge/100%25_Client--Side-RAM_Only-132b25)](#pilares-de-segurança--modelo-zero-knowledge)
[![CSP Strict](https://img.shields.io/badge/CSP-connect--src_'none'-0c1517)](#pilares-de-segurança--modelo-zero-knowledge)
[![AWS Amplify](https://img.shields.io/badge/Deploy-AWS_Amplify-FF9900?logo=amazonaws&logoColor=white)](#deploy-e-hospedagem)

---

## Visão Geral

**Stegossauro** é uma aplicação web de produção, puramente client-side, que oculta arquivos arbitrários (PDF, vídeo, ZIP, ISO, binários) dentro de imagens PNG sem perdas, usando **dispersão LSB não-linear guiada por chave criptográfica**, e remove 100% dos metadados EXIF/GPS/XMP/IPTC da imagem de disfarce antes da injeção.

| Problema convencional | Abordagem Stegossauro |
| :--- | :--- |
| LSB sequencial detectável por χ² / PoV | Dispersão caótica via PRNG (PCG32) semeado pela chave |
| Backend / CDN / telemetria | Zero rede (`connect-src 'none'`), zero storage persistente |
| Metadados residuais na capa | Repaint Canvas 1:1 → PNG limpo |
| Nomes como `stego_secret.png` | Nomenclatura anti-forense (`IMG_YYYYMMDD_HHMMSS.png`) |
| Apenas textos/imagens pequenas | Raw binary stream + densidade 1–3 LSB + compressão seletiva |

**Para quem:** analistas de segurança, engenheiros de privacidade, jornalistas e qualquer fluxo que exija transportar dados sensíveis disfarçados em mídia visual inocente — **sem servidor e sem confiança em terceiros**.

---

## Pilares de Segurança & Modelo Zero-Knowledge

### 100% Client-Side na RAM

Todo o pipeline (leitura do arquivo, compressão, permutação de pixels, exportação PNG e restauração) ocorre **exclusivamente na memória volátil do navegador**.

- Nenhum byte de arquivo, chave ou imagem transita pela rede.
- Sem backend, sem banco de dados, sem `localStorage` / `sessionStorage` / IndexedDB para payloads.
- Adequado a operação **air-gapped** (abrir o build estático offline).

### CSP Hermética (`connect-src 'none'`)

Em produção (meta tag + headers Amplify/CloudFront):

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:;
  connect-src 'none'; object-src 'none'; frame-ancestors 'none';
  worker-src 'self' blob:;
```

Isso impede `fetch`, XHR, WebSocket, beacons e CDNs — mitigando exfiltração mesmo sob XSS parcial.

> Em desenvolvimento local, o Vite libera `ws://localhost:*` / `http://localhost:*` apenas para HMR.

### Higienização de Metadados (EXIF / GPS Purger)

A imagem de disfarce (JPG/PNG/WEBP) é decodificada e **redesenhada 1:1** em `OffscreenCanvas` / `<canvas>`. O `getImageData()` resultante contém apenas a malha RGBA — **EXIF, IPTC, XMP, ICC, GPS e timestamps de arquivo são descartados**. A saída é sempre **PNG lossless**, único formato que preserva LSBs.

### Anonimização e Anti-Forense

- Nomes gerados **nunca** usam prefixos reveladores (`stego_`, `secret_`, `hidden_`, `payload_`, `carrier_`, `vault_`).
- Sugestão padrão: `IMG_YYYYMMDD_HHMMSS.png` (ou `DSC_####.png` / `Screenshot_…`).
- Arquivo de chave: nomes neutros (`auth_token.key`, `[nome]_backup.key`).
- Buffers sensíveis passam por **`zeroize()`** (`.fill(0)`) após o uso; Object URLs são revogados; o Web Worker é **`terminate()`** ao fim de cada job.

---

## Engenharia Criptográfica & Esteganográfica

### Dispersão Guiada por Chave (Key-Guided PRNG)

1. Chave de **256 bits** via `crypto.getRandomValues` (CSPRNG do browser), formatada em hex por quartetos (`a1b2-c3d4-…`).
2. Semente uniforme: `SHA-256(keyBytes)`.
3. Motor **PCG32** (determinístico) + **Fisher-Yates parcial** → índices únicos de canais **R/G/B** (Alpha fixo em 255).
4. Bits do container são escritos nesses slots — **nunca em ordem raster linear**.

**Por que importa:** LSB sequencial concentra alterações no início da imagem e falha em testes qui-quadrado e histogramas de pares de valores (PoV). A trilha pseudoaleatória dependente da chave espalha o ruído e torna a recuperação impossível sem a chave correta (validada por checksum HMAC no cabeçalho).

| Campo | Tamanho | Descrição |
| :--- | :---: | :--- |
| Auth Checksum | 4 B | Prefixo HMAC-SHA256 da chave (tag ofuscada em build) |
| Config Flags | 1 B | Bit 0: compressão · Bits 1–2: densidade LSB (1\|2\|3) |
| Meta Length | 2 B BE | Tamanho do JSON de metadados |
| Metadata JSON | N B | `{ "name", "mimeType" }` — nome/extensão originais |
| Payload Length | 4 B BE | Bytes do payload (bruto ou deflate-raw) |
| Payload | M B | Conteúdo do arquivo secreto |

### Densidade LSB Adaptativa (1–3 bits/canal)

O motor escolhe automaticamente a **menor densidade** que acomoda o envelope:

| Modo | Bits/pixel | Discrição visual | Capacidade aproximada |
| :---: | :---: | :--- | :--- |
| **1-LSB** | 3 | Máxima (Δ ≈ 0,39% por canal) | ~0,37 MB / megapixel |
| **2-LSB** | 6 | Equilíbrio | ~0,75 MB / megapixel |
| **3-LSB** | 9 | Alta capacidade | ~1,12 MB / megapixel |

**Capacidade prática (envelope teórico, RGB):**

| Resolução | Megapixels | 1-LSB | 2-LSB | 3-LSB |
| :--- | ---: | ---: | ---: | ---: |
| Full HD (1920×1080) | 2,07 MP | ~0,78 MB | ~1,56 MB | ~2,33 MB |
| 4K UHD (3840×2160) | 8,29 MP | ~3,11 MB | ~6,22 MB | ~9,33 MB |
| 8K UHD (7680×4320) | 33,18 MP | ~12,4 MB | ~24,9 MB | ~37,3 MB |

Se o arquivo exceder mesmo o 3-LSB, a UI bloqueia e orienta o uso de capa de maior resolução (4K/8K / 30MP+).

### Agnóstico a Formatos (Raw Binary Stream)

- Input **sem `accept`**: qualquer extensão ou arquivo sem extensão.
- Tratamento exclusivo como `Uint8Array` / `ArrayBuffer`.
- Nome + MIME preservados no container e restaurados bit-a-bit na extração.
- **Compressão seletiva** com `CompressionStream('deflate-raw')`: mantida apenas se o tamanho cair abaixo de ~98% do original; mídia/arquivos já compactados (MP4, ZIP, JPEG…) são pulados por heurística de magic bytes.

### Processamento Assíncrono

- Web Worker dedicado (`stego.worker.ts`) para bit-shifting e PRNG.
- **Transferable Objects** (`postMessage(buf, [buf])`) evitam cópias desnecessárias em RAM.
- Barra de progresso por fase: sanitização → compressão → mapeamento → injeção → PNG.

---

## Funcionalidades & Interface (UI/UX)

- **Dark Slate Green** minimalista (`#0c1517` / `#1b453b`) — estética de mensageiro E2E.
- Layout fluido: mobile → tablet → desktop → ultrawide (cards de upload em 2 colunas ≥1024px).
- Dropzones amplas, inputs 52px, botão primário full-width.
- **Nome de saída** editável, pré-preenchido com `IMG_YYYYMMDD_HHMMSS.png`.
- Chave: regenerar · copiar · baixar `.key`.
- Console de auditoria local (log técnico em monospace).
- Abas segmentadas: **Ocultar** / **Extrair**.

---

## Guia de Uso

### Ocultação (Encode)

1. Selecione o **Arquivo Secreto** (qualquer formato).
2. Selecione a **Imagem de Disfarce** (JPG / PNG / WEBP).
3. **Copie ou salve a Chave Única** — sem ela a recuperação é impossível.
4. Ajuste o **Nome de Saída** (extensão `.png` forçada).
5. Clique em **Ocultar** → baixe o PNG gerado.

### Extração (Decode)

1. Carregue a **imagem combinada** (PNG stego).
2. Cole a **Chave de Acesso** correspondente.
3. Clique em **Extrair** → baixe o arquivo com nome, extensão e bytes originais.

---

## Instalação e Desenvolvimento Local

### Pré-requisitos

- **Node.js** LTS (18+ recomendado)
- npm 9+

### Setup

```bash
git clone <url-do-repositorio>
cd steg-file
npm install
npm run dev
```

Abra a URL local do Vite (tipicamente `http://localhost:5173`).

### Scripts

| Comando | Descrição |
| :--- | :--- |
| `npm run dev` | Servidor de desenvolvimento (HMR; anti-debug desligado) |
| `npm run build` | Build de produção + ofuscação (Terser + javascript-obfuscator) |
| `npm run build:plain` | Build sem ofuscador (debug de artefatos) |
| `npm run preview` | Preview do `dist/` |
| `npm run test:smoke` | Round-trip embed/extract (densidades + compressão) |

### Compilação estática

```bash
npm run build
```

Artefatos em `dist/` — abra `dist/index.html` via servidor estático local ou hospede offline.

---

## Deploy e Hospedagem

### AWS Amplify Hosting (CI/CD)

O repositório já inclui:

| Arquivo | Função |
| :--- | :--- |
| `amplify.yml` | `npm ci` → `npm run build` → artefatos `dist/` |
| `customHttp.yml` | HSTS, X-Frame-Options, CSP e demais headers na borda CloudFront |
| `amplify-spa-redirects.json` | Rewrite SPA → `/index.html` (status 200) |

**Passos resumidos:**

1. Conecte o repositório no [AWS Amplify Hosting](https://aws.amazon.com/amplify/hosting/).
2. Confirme que o build usa `amplify.yml` (detectado automaticamente).
3. Em **Rewrites and redirects**, cole o JSON de `amplify-spa-redirects.json`.
4. Faça o deploy — headers de `customHttp.yml` são aplicados na borda.

### Execução Offline (Air-Gapped)

```bash
npm run build
# Sirva dist/ sem rede, ex.:
npx --yes serve dist -l 4173
# ou abra via extensão “Web Server for Chrome” / similar apontando para dist/
```

Com CSP de produção, **nenhuma conexão de saída** é permitida pelo navegador.

---

## Limitações e Boas Práticas

> **Crítico — compressão lossy destrói LSBs.**  
> Não envie o PNG gerado pelo fluxo padrão de mensageiros (WhatsApp, Instagram, Facebook Messenger, etc.) que **recomprimem imagens**.  
> Envie sempre como **Arquivo / Documento** (ou use canal que preserve o binário intacto: e-mail anexo, Drive, Signal “as file”, scp, etc.).

**Outras práticas:**

- Guarde a chave **separada** da imagem; perda da chave = perda definitiva dos dados.
- Prefira capas com textura/ruído natural (fotos) a fundos lisos.
- Para payloads grandes, use capas 4K/8K ou densidades 2–3 LSB (o motor escolhe automaticamente).
- A blindagem anti-debug/ofuscação é **camada defensiva**, não substitui o segredo da chave de 256 bits.

---

## Arquitetura de Módulos

```
src/
├── crypto/          # CSPRNG, HMAC auth, PCG32, Fisher-Yates
├── stego/           # Canvas EXIF purge, compressão, motor LSB 1–3
├── workers/         # stego.worker.ts + client Transferable
├── security/        # CSP helpers, zeroize, veil (strings), shield, integrity
├── ui/              # Controller Dark Slate + auditoria local
└── util/            # Nomenclatura anti-forense
```

---

## Licença e Responsabilidade

Uso destinado a cenários legítimos de privacidade e proteção de dados. O operador é responsável por cumprir a legislação aplicável em sua jurisdição.

---

<p align="center">
  <sub>Stegossauro — Zero-Knowledge · Client-Side · PNG Lossless · connect-src none</sub>
</p>
