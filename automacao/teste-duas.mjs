/**
 * TESTE AUTOMATICO — duas empresas seguidas.
 *
 * Existe para provar o que o usuario apontou: que a SEGUNDA consulta nao pega
 * o CNPJ da PRIMEIRA. Roda sozinho e termina com APROVADO ou REPROVADO.
 *
 * O que ele verifica, e nao "parece ter funcionado":
 *   1. os dois PDFs existem;
 *   2. cada PDF contem o CNPJ da pasta em que foi guardado;
 *   3. os dois PDFs sao ARQUIVOS DIFERENTES (hash distinto);
 *   4. o PDF da empresa 2 nao contem o CNPJ da empresa 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { conectar } from './src/navegador-persistente.js';

const { PDFParse } = createRequire(import.meta.url)('pdf-parse');
const A = process.argv[2];
const B = process.argv[3];
const fmt = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const log = (t = '') => console.log(t);

async function textoPdf(f) {
  const p = new PDFParse({ data: new Uint8Array(fs.readFileSync(f)) });
  const r = await p.getText();
  await p.destroy();
  return r.text.replace(/\s+/g, ' ');
}

function pdfDe(cnpj) {
  const dir = path.join('acervo', cnpj, 'situacao-fiscal');
  if (!fs.existsSync(dir)) return null;
  const arqs = fs.readdirSync(dir).filter((x) => x.endsWith('.pdf'))
    .map((x) => path.join(dir, x))
    .sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs);
  return arqs[0] ?? null;
}

// --- 1. esperar o login, uma vez -------------------------------------------
const { page } = await conectar();
log('Esperando o login no portal (ate 10 min)...');
const ate = Date.now() + 600000;
let logado = false;
while (Date.now() < ate) {
  if (await page.locator('#avatar-dropdown-trigger').count().catch(() => 0)) { logado = true; break; }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!logado) { log('REPROVADO: login nao aconteceu.'); process.exit(1); }
log('Login detectado. A partir daqui e comigo.\n');

// --- 2. rodar as duas empresas ---------------------------------------------
const antes = new Map([A, B].map((c) => [c, pdfDe(c) ? fs.statSync(pdfDe(c)).mtimeMs : 0]));

await new Promise((pronto) => {
  const f = spawn(process.execPath, ['src/coletar.js', '--cnpj', A, '--espera', '300'], { stdio: 'inherit' });
  f.on('close', pronto);
});
await new Promise((pronto) => {
  const f = spawn(process.execPath, ['src/coletar.js', '--cnpj', B, '--espera', '300'], { stdio: 'inherit' });
  f.on('close', pronto);
});

// --- 3. auditar -------------------------------------------------------------
log('\n' + '='.repeat(64));
log('AUDITORIA');
log('='.repeat(64));

const falhas = [];
const info = {};

for (const c of [A, B]) {
  const arq = pdfDe(c);
  if (!arq) { falhas.push(`${fmt(c)}: nenhum PDF foi gravado.`); continue; }
  if (fs.statSync(arq).mtimeMs <= antes.get(c)) {
    falhas.push(`${fmt(c)}: o PDF nao foi atualizado nesta execucao.`);
  }
  const t = await textoPdf(arq);
  info[c] = { arq, t, hash: crypto.createHash('sha256').update(fs.readFileSync(arq)).digest('hex') };
  const nome = (t.match(/CNPJ:\s*[\d.]+\s+(.{5,55}?)\s+Dados/) ?? [])[1] ?? '?';
  const bate = t.includes(fmt(c));
  log(`${bate ? 'OK  ' : 'ERRO'} ${fmt(c)}  ${nome.trim().slice(0, 45)}`);
  if (!bate) falhas.push(`${fmt(c)}: o PDF NAO contem o proprio CNPJ.`);
}

if (info[A] && info[B]) {
  if (info[A].hash === info[B].hash) falhas.push('Os dois PDFs sao o MESMO arquivo.');
  if (info[B].t.includes(fmt(A))) falhas.push(`O PDF da 2a empresa contem o CNPJ da 1a (${fmt(A)}).`);
}

log('');
if (falhas.length) {
  log('REPROVADO:');
  for (const f of falhas) log('  - ' + f);
  process.exit(1);
}
log('APROVADO: as duas empresas, cada uma com o seu relatorio.');
process.exit(0);
