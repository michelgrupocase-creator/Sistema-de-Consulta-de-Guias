/**
 * Le os PDFs do acervo e transforma em DADO ESTRUTURADO.
 *
 * O PDF da Receita e um relatorio para humano ler: colunas quebradas, rotulos
 * grudados no valor. Este arquivo e o unico lugar do projeto que sabe a forma
 * desse texto. Quando a Receita mudar o layout do relatorio, quebra AQUI.
 *
 * Regra que vale para tudo abaixo: campo que nao foi encontrado vira null, e
 * NUNCA um palpite. Um valor inventado numa tela de decisao e pior do que um
 * campo vazio - foi o erro que zerou as certidoes da planilha antiga.
 *
 * Uso:  npm.cmd run extrair
 * Saida: acervo/_situacao.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const limpo = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const data = (s) => {
  const m = String(s ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function extrair(texto, cnpj) {
  const t = texto.replace(/\s+/g, ' ');

  const nome = (t.match(new RegExp(`CNPJ:\\s*[\\d.]+\\s+(.+?)\\s+Dados`, 'i')) ?? [])[1] ?? null;
  const situacao = (t.match(/Situa[çc][ãa]o:\s*([A-ZÇÃÁÉÍÓÚ ]{4,30}?)\s+Natureza/i) ?? [])[1] ?? null;
  const abertura = data((t.match(/Data de Abertura:\s*([\d/]+)/i) ?? [])[1]);
  const municipio = (t.match(/Munic[íi]pio:\s*([A-ZÇÃÁÉÍÓÚ .-]{3,40}?)\s+UF/i) ?? [])[1] ?? null;

  // Certidao emitida: pode ser "Certidao Negativa" ou "Certidao Positiva com
  // Efeitos de Negativa". A distincao importa: a segunda tem debito com
  // exigibilidade suspensa por tras.
  const blocoCert = t.match(/Certid[ãa]o (Negativa|Positiva[^:]{0,40}Negativa):\s*([0-9A-F.]{10,25})\s*Emiss[ãa]o:\s*([\d/]+)\s*Data de Validade:\s*([\d/]+)/i);
  const certidao = blocoCert
    ? {
        tipo: /Positiva/i.test(blocoCert[1]) ? 'positiva-com-efeito-negativa' : 'negativa',
        codigo: limpo(blocoCert[2]),
        emissao: data(blocoCert[3]),
        validade: data(blocoCert[4]),
      }
    : null;

  // Pendencias. Conto ocorrencias em vez de tentar ler cada linha: o que a
  // tela precisa e "tem quanto", nao a tabela inteira - essa fica no PDF.
  const debitos = (t.match(/DEVEDOR/g) ?? []).length;
  const atrasoM = t.match(/Parcelas em atraso\s*(\d+)/i);
  const dividaAtiva = (t.match(/\d{2}\.\d\.\d{2}\.\d{6}-\d{2}/g) ?? []).length;

  const pgfnLimpa = /N[ãa]o foram detectadas\s*pend[êe]ncias\/exigibilidades suspensas/i.test(t);

  return {
    cnpj,
    nome: limpo(nome) || null,
    situacaoCadastral: limpo(situacao) || null,
    municipio: limpo(municipio) || null,
    abertura,
    certidao,
    pendencias: {
      debitosDevedor: debitos,
      parcelamento: /EM PARCELAMENTO/i.test(t),
      parcelasEmAtraso: atrasoM ? Number(atrasoM[1]) : 0,
      inscricoesDividaAtiva: dividaAtiva,
    },
    pgfn: pgfnLimpa ? 'sem-pendencia' : 'com-pendencia',
  };
}
