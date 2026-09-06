/**
 * Espelho do acervo do robô no banco do sistema.
 *
 * O acervo em ../automacao/acervo continua sendo a FONTE DA VERDADE: os PDFs
 * e o _indice.json com os hashes. Aqui é só uma cópia consultável, para a
 * tela não precisar varrer o disco a cada clique.
 *
 * Documento com hash já registrado não vira linha nova — é o mesmo princípio
 * do acervo: idêntico não é coleta nova, é confirmação de que nada mudou.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bd } from './base.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const AUTOMACAO = path.resolve(RAIZ, '..', 'automacao');

export function importarAcervo() {
  const indice = path.join(AUTOMACAO, 'acervo', '_indice.json');
  if (!fs.existsSync(indice)) return { novos: 0, total: 0 };

  const { documentos = [] } = JSON.parse(fs.readFileSync(indice, 'utf8'));
  const jaTem = bd.prepare('SELECT 1 FROM documentos WHERE cnpj = ? AND hash = ?');
  const inserir = bd.prepare(`
    INSERT INTO documentos (cnpj, tipo, caminho, hash, bytes, coletadoEm, mudou, resumo)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  let novos = 0;
  for (const d of documentos) {
    if (jaTem.get(d.cnpj, d.hash)) continue;
    inserir.run(d.cnpj, d.tipo, d.caminho, d.hash, d.bytes, d.coletadoEm, d.mudou ? 1 : 0);
    novos += 1;
  }
  return { novos, total: documentos.length };
}

export const PASTA_ACERVO = path.join(AUTOMACAO, 'acervo');
