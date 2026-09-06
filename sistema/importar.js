/**
 * Carga inicial: leva a carteira e o acervo para o banco do sistema.
 *
 * Fonte dos clientes: um JSON no formato do painel — o mesmo que o Radar
 * Fiscal usa hoje. Passe o caminho como argumento:
 *
 *   npm run importar -- ../clientes.json
 *
 * Roda quantas vezes precisar: cliente existente é atualizado, não duplicado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bd, registrar } from './base.js';
import { importarAcervo } from './acervo.js';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Informe o JSON dos clientes:  npm run importar -- ../clientes.json');
  process.exit(1);
}

const bruto = JSON.parse(fs.readFileSync(path.resolve(arquivo), 'utf8'));
const lista = Array.isArray(bruto) ? bruto : (bruto.clientes ?? []);
if (!lista.length) { console.error('Nenhum cliente no arquivo.'); process.exit(1); }

const gravar = bd.prepare(`
  INSERT INTO clientes (id, cnpj, dados, atualizadoEm, atualizadoPor)
  VALUES (?, ?, ?, ?, 'importacao')
  ON CONFLICT(id) DO UPDATE SET
    cnpj = excluded.cnpj, dados = excluded.dados, atualizadoEm = excluded.atualizadoEm
`);

const agora = new Date().toISOString();
let n = 0;
for (const c of lista) {
  const id = String(c.id ?? c.j ?? '').trim();
  if (!id) continue;
  const { id: _, ...dados } = c;
  gravar.run(id, String(c.j ?? '').replace(/\D/g, '') || null, JSON.stringify(dados), agora);
  n += 1;
}

registrar('importacao', 'carga-clientes', null, { total: n });
console.log(`${n} clientes no banco.`);

const { novos } = importarAcervo();
console.log(`${novos} documentos novos vindos do acervo.`);
process.exit(0);
