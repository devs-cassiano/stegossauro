/**
 * Post-build obfuscation for production main bundle only.
 * Workers are excluded — obfuscators often inject `window`, which breaks Worker scope.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, '..', 'dist', 'assets');

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.25,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  disableConsoleOutput: true,
  selfDefending: false,
  splitStrings: true,
  splitStringsChunkLength: 6,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: 'browser',
  ignoreImports: true,
};

function isWorkerChunk(file) {
  return /worker/i.test(file);
}

async function main() {
  const files = await readdir(assetsDir);
  const jsFiles = files.filter((f) => f.endsWith('.js') && !isWorkerChunk(f));
  for (const file of jsFiles) {
    const full = path.join(assetsDir, file);
    const src = await readFile(full, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(src, options);
    await writeFile(full, result.getObfuscatedCode(), 'utf8');
    console.log('obfuscated', file);
  }
  const skipped = files.filter((f) => f.endsWith('.js') && isWorkerChunk(f));
  for (const file of skipped) {
    console.log('skipped worker', file);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
