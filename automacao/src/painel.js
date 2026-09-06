// Monta o HTML do painel: molde + lógica + logo.
//
// O painel NÃO leva dado embutido. O cadastro vive no banco do artefato
// publicado, compartilhado entre as máquinas do escritório — é isso que
// faz a alteração de uma pessoa aparecer para as outras.
//
//   npm run painel        -> painel/radar-fiscal.html (para publicar)
//   npm run semear        -> imprime os documentos a carregar no banco
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

const BASE = path.join(RAIZ, 'painel', 'base.html');
const APP = path.join(RAIZ, 'painel', 'app.js');
const LOGO = path.join(RAIZ, 'painel', 'logo.png');
const SAIDA = path.join(RAIZ, 'painel', 'radar-fiscal.html');

for (const f of [BASE, APP, LOGO]) {
  if (!fs.existsSync(f)) throw new Error(`Arquivo não encontrado: ${f}`);
}

const html =
  fs.readFileSync(BASE, 'utf8').replace('__LOGO_URI__', `data:image/png;base64,${fs.readFileSync(LOGO).toString('base64')}`) +
  '\n' +
  fs.readFileSync(APP, 'utf8');

if (html.includes('__LOGO_URI__')) throw new Error('Substituição incompleta do logo.');

fs.writeFileSync(SAIDA, html, 'utf8');
console.log(`Painel montado: ${(html.length / 1024).toFixed(0)} KB`);
console.log(`  ${SAIDA}`);
