#!/usr/bin/env node
// Uso: npm run qr -- <id> [source]
// Genera ./qr/<id>_<source>.png (o ./qr/<id>.png senza source) che punta a ${BASE_URL}/v/<id>?s=<source>
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Carica .env.local e .env senza sovrascrivere variabili già presenti. */
function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

function fail(message) {
  console.error(message);
  console.error('Uso: npm run qr -- <id> [source]');
  process.exit(1);
}

loadEnvFiles();

const [id, source] = process.argv.slice(2);
if (!id || !ID_RE.test(id)) fail(`id non valido: ${id ?? '(mancante)'}`);
if (source !== undefined && !ID_RE.test(source)) fail(`source non valido (ammessi A-Z a-z 0-9 _ -): ${source}`);

const baseUrl = process.env.BASE_URL;
if (!baseUrl) fail('BASE_URL non impostato (usa .env.local o una variabile d\'ambiente)');

const url = new URL(`/v/${encodeURIComponent(id)}`, baseUrl);
if (source) url.searchParams.set('s', source);

const outDir = path.resolve('qr');
const outFile = path.join(outDir, source ? `${id}_${source}.png` : `${id}.png`);
fs.mkdirSync(outDir, { recursive: true });

await QRCode.toFile(outFile, url.toString(), { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' });
console.log(`${url} -> ${path.relative(process.cwd(), outFile)}`);
