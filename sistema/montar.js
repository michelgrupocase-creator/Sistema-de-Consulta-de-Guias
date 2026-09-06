/**
 * Monta publico/index.html a partir do painel já aprovado.
 *
 * A tela do Radar Fiscal continua sendo a fonte: ../painel/base.html e
 * ../painel/app.js. Aqui só se acrescenta o que o sistema tem e o artifact
 * não tinha — login, coleta e o estilo dessas duas coisas.
 *
 * Nunca edite publico/index.html na mão: ele é gerado. Edite o painel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PAINEL = path.resolve(RAIZ, '..', 'painel');

const ler = (p) => fs.readFileSync(p, 'utf8');
for (const f of ['base.html', 'app.js', 'logo.png']) {
  const alvo = path.join(PAINEL, f);
  if (!fs.existsSync(alvo)) throw new Error(`Falta ${alvo}. O painel é a fonte da tela.`);
}

const logo = fs.readFileSync(path.join(PAINEL, 'logo.png')).toString('base64');
const base = ler(path.join(PAINEL, 'base.html')).replace('__LOGO_URI__', `data:image/png;base64,${logo}`);

// app.js JA traz <script> e </script> proprios - foi assim que o painel.js
// original montou o artifact. Envolver de novo cria <script> dentro de
// <script>, o navegador fecha no primeiro </script> e o arquivo inteiro vira
// texto solto: "Unexpected token '<'". Aconteceu em 06/09/2026.
const app = ler(path.join(PAINEL, 'app.js'));
if (!app.trimStart().startsWith('<script')) {
  throw new Error('app.js perdeu a tag <script> de abertura - ajuste montar.js.');
}
if (base.includes('__LOGO_URI__')) throw new Error('Substituição do logo incompleta.');

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/estilo.css">
<script src="/dados.js"></script>
</head>
<body>
${base}
${app}
<script src="/coleta.js"></script>
</body>
</html>
`;

fs.mkdirSync(path.join(RAIZ, 'publico'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'publico', 'index.html'), html, 'utf8');
console.log(`index.html montado: ${(html.length / 1024).toFixed(0)} KB`);
