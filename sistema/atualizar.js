/**
 * Leva o que o robô coletou para dentro do sistema.
 *
 * Lê os PDFs do acervo, extrai o que a tela precisa e grava:
 *   - documentos.resumo  -> o extrato estruturado de cada relatório
 *   - clientes.cd[0]     -> a certidão Federal do cliente
 *
 * REGRA QUE MANDA AQUI: campo não encontrado vira null, nunca palpite.
 * O painel foi feito para dizer "Não consultada" quando não sabe, e isso é
 * melhor do que um valor inventado numa tela usada para decidir. Foi ler
 * data solta da planilha sem saber se era emissão ou validade que apontou
 * dezenas de vencimentos falsos na primeira versão.
 *
 * O que o painel espera em cd[n]:
 *   data  -> "Válida até" / "Vencida em"
 *   texto -> impedimento
 *   null  -> não consultada
 *
 * Uso:  npm run atualizar
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bd, registrar } from './base.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const ACERVO = path.resolve(RAIZ, '..', 'automacao', 'acervo');
const require = createRequire(import.meta.url);
const { PDFParse } = require(path.resolve(RAIZ, '..', 'automacao', 'node_modules', 'pdf-parse'));

const iso = (br) => {
  const m = String(br ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

async function texto(arquivo) {
  const p = new PDFParse({ data: new Uint8Array(fs.readFileSync(arquivo)) });
  const r = await p.getText();
  await p.destroy();
  return r.text.replace(/\s+/g, ' ');
}

/** Transforma o texto do relatório em dado. Só o que dá para afirmar. */
function extrair(t, cnpj) {
  const fmt = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (!t.includes(fmt)) {
    throw new Error(`O PDF não contém o CNPJ ${fmt} — arquivo na pasta errada.`);
  }

  const nome = (t.match(/CNPJ:\s*[\d.]+\s+(.{5,70}?)\s+Dados/) ?? [])[1] ?? null;
  const situacao = (t.match(/Situa[çc][ãa]o:\s*([A-ZÇÃÁÉÍÓÚ ]{4,30}?)\s+Natureza/) ?? [])[1] ?? null;

  // A certidão pode ser Negativa (nada devendo) ou Positiva com Efeitos de
  // Negativa (deve, mas com exigibilidade suspensa). A diferença importa:
  // as duas servem para provar regularidade, mas a segunda tem dívida atrás.
  const c = t.match(/Certid[ãa]o (Negativa|Positiva[^:]{0,45}Negativa):\s*([0-9A-F.]{10,25})\s*Emiss[ãa]o:\s*([\d/]+)\s*Data de Validade:\s*([\d/]+)/);

  const debitos = (t.match(/DEVEDOR/g) ?? []).length;
  const atraso = t.match(/Parcelas em atraso\s*(\d+)/);
  const inscricoes = (t.match(/\d{2}\.\d\.\d{2}\.\d{6}-\d{2}/g) ?? []).length;
  const pgfnLimpa = /N[ãa]o foram detectadas\s*pend[êe]ncias\/exigibilidades suspensas/.test(t);

  return {
    cnpj,
    nome: nome?.trim() ?? null,
    situacaoCadastral: situacao?.trim() ?? null,
    certidao: c
      ? {
          tipo: /Positiva/.test(c[1]) ? 'positiva-com-efeitos-de-negativa' : 'negativa',
          codigo: c[2],
          emissao: iso(c[3]),
          validade: iso(c[4]),
        }
      : null,
    pendencias: {
      debitosDevedor: debitos,
      emParcelamento: /EM PARCELAMENTO/.test(t),
      parcelasEmAtraso: atraso ? Number(atraso[1]) : 0,
      inscricoesDividaAtiva: inscricoes,
    },
    pgfn: pgfnLimpa ? 'sem-pendencia' : 'com-pendencia',
  };
}

/**
 * Resumo da SITUACAO FISCAL, no formato que a tela consome.
 *
 * Nao mexe em certidao: o painel ja tinha um campo de certidoes, e encaixar
 * o relatorio ali seria dobrar o dado para caber na tela em vez de mostrar
 * o que a consulta trouxe. O relatorio de pendencias responde outra
 * pergunta - "esta empresa deve alguma coisa hoje?" - e e essa que vai
 * aparecer.
 */
function resumo(d, coletadoEm) {
  const p = d.pendencias;
  const limpo = p.debitosDevedor === 0
    && p.parcelasEmAtraso === 0
    && p.inscricoesDividaAtiva === 0
    && d.pgfn === 'sem-pendencia';

  return {
    consultadoEm: coletadoEm,
    resultado: limpo ? 'sem-pendencia' : 'com-pendencia',
    nome: d.nome,
    situacaoCadastral: d.situacaoCadastral,
    debitos: p.debitosDevedor,
    emParcelamento: p.emParcelamento,
    parcelasEmAtraso: p.parcelasEmAtraso,
    dividaAtiva: p.inscricoesDividaAtiva,
    pgfn: d.pgfn,
  };
}

/** Uma linha curta, para caber na lista de clientes. */
function frase(r) {
  if (r.resultado === 'sem-pendencia') return 'Sem pendência';
  const partes = [];
  if (r.debitos) partes.push(`${r.debitos} débito${r.debitos > 1 ? 's' : ''}`);
  if (r.parcelasEmAtraso) partes.push(`${r.parcelasEmAtraso} parcela${r.parcelasEmAtraso > 1 ? 's' : ''} em atraso`);
  if (r.dividaAtiva) partes.push(`${r.dividaAtiva} na dívida ativa`);
  if (r.pgfn === 'com-pendencia' && !partes.length) partes.push('pendência na PGFN');
  return partes.join(' · ') || 'Com pendência';
}

async function main() {
  if (!fs.existsSync(ACERVO)) { console.error('Acervo não encontrado.'); process.exit(1); }

  const pegarCliente = bd.prepare('SELECT id, dados FROM clientes WHERE cnpj = ?');
  const gravarCliente = bd.prepare('UPDATE clientes SET dados = ?, atualizadoEm = ?, atualizadoPor = ? WHERE id = ?');
  const gravarResumo = bd.prepare('UPDATE documentos SET resumo = ? WHERE cnpj = ? AND hash = ?');

  const indice = path.join(ACERVO, '_indice.json');
  const { documentos = [] } = fs.existsSync(indice)
    ? JSON.parse(fs.readFileSync(indice, 'utf8'))
    : { documentos: [] };

  let ok = 0, erro = 0, semCadastro = 0;

  for (const doc of documentos) {
    const arquivo = path.join(ACERVO, doc.caminho);
    if (!fs.existsSync(arquivo)) continue;
    try {
      const d = extrair(await texto(arquivo), doc.cnpj);
      const r = resumo(d, doc.coletadoEm);
      gravarResumo.run(JSON.stringify(r), doc.cnpj, doc.hash);

      const linha = pegarCliente.get(doc.cnpj);
      if (!linha) { semCadastro += 1; continue; }

      const dados = JSON.parse(linha.dados);
      dados.sf = r;                       // situação fiscal: o que a consulta trouxe
      gravarCliente.run(JSON.stringify(dados), new Date().toISOString(), 'coleta', linha.id);

      console.log(`OK   ${doc.cnpj}  ${frase(r)}   ${r.nome ?? ''}`);
      ok += 1;
    } catch (e) {
      console.log(`ERRO ${doc.cnpj}  ${e.message}`);
      erro += 1;
    }
  }

  registrar('coleta', 'situacao-fiscal-atualizada', null, { ok, erro, semCadastro });
  console.log(`\n${ok} atualizados | ${erro} com erro | ${semCadastro} sem cadastro no sistema`);
  process.exit(0);
}

main();
