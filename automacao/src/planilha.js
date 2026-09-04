/**
 * Converte o CONTROLE (.xlsx) na base do sistema.
 *
 * A planilha é a fonte da verdade do escritório hoje: cadastro, certidões,
 * procurações, certificados, vinculação Onvio, folha e aniversários. Este
 * módulo lê tudo e devolve UMA lista de clientes, cruzada pelo CNPJ (e pelo
 * nome, quando o CNPJ falta numa aba).
 *
 * Uso:  npm run planilha -- ./CONTROLE.xlsx
 * Saída: dados/clientes.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function digitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * Normaliza o nome da empresa para cruzar abas.
 *
 * As abas não usam a mesma grafia: "MERCADO PADRE CICERO LTDA - ME" na GERAL
 * vira "MERCADO PADRE CICERO LTDA" nas CERTIDÕES, e vários nomes aparecem
 * truncados. Então tiramos acento, pontuação e os sufixos societários, que são
 * exatamente a parte que varia.
 */
const SUFIXOS = /\b(LTDA|ME|EPP|EIRELI|MEI|EP|SA|S A|S\/A|SOCIEDADE|INDIVIDUAL|DE RESPONSABILIDADE LIMITADA)\b/g;

export function normalizarNome(nome) {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(SUFIXOS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chave de cruzamento: CNPJ quando existe, senão o nome normalizado. */
export function chave(cnpj, nome) {
  const d = digitos(cnpj);
  if (d.length >= 11) return d;
  return normalizarNome(nome);
}

function texto(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
  if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim() || null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
}

function data(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  // A planilha tem datas digitadas como texto em alguns pontos (07/18/2025).
  const s = texto(v);
  if (!s) return null;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, a, b, ano] = br;
    // Formato ambíguo: acima de 12 no primeiro campo só pode ser dia.
    const [dia, mes] = Number(a) > 12 ? [a, b] : [b, a];
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return null;
}

function booleano(v) {
  if (typeof v === 'boolean') return v;
  const s = (texto(v) ?? '').toUpperCase();
  if (['TRUE', 'SIM', 'X', 'OK'].includes(s)) return true;
  if (['FALSE', 'NAO', 'NÃO', ''].includes(s)) return false;
  return null;
}

/**
 * Cada célula de certidão é uma data OU um texto de impedimento
 * ("PENDÊNCIAS", "EMPREGADOR NÃO CADASTRADO", "CERTIDÃO POSITIVA"…).
 * Guardamos os dois: a data quando é data, o motivo quando não é.
 */
function certidao(v) {
  const d = data(v);
  if (d) return { data: d, situacao: null };
  const t = texto(v);
  return { data: null, situacao: t ? t.toUpperCase() : null };
}

/** Lê uma aba como matriz, achando a linha de cabeçalho. */
function matriz(ws) {
  const linhas = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    linhas.push(row.values.slice(1)); // ExcelJS indexa a partir de 1
  });
  const cabIdx = linhas.findIndex((r) => r.filter((c) => c !== null && c !== undefined).length >= 2);
  return { cab: linhas[cabIdx] ?? [], dados: linhas.slice(cabIdx + 1) };
}

export async function lerPlanilha(arquivo) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);

  const porChave = new Map();
  const porNome = new Map();   // nome normalizado -> cliente
  const porId = new Map();     // número da GERAL -> cliente
  let permitirNovos = true;    // desligado depois do cadastro base

  /** Casa por prefixo: nomes truncados na planilha ainda apontam o mesmo cliente. */
  function acharPorNome(n) {
    if (!n) return null;
    if (porNome.has(n)) return porNome.get(n);
    const curto = n.slice(0, 18);
    if (curto.length < 10) return null;
    for (const [k, c] of porNome) {
      if (k.startsWith(curto) || n.startsWith(k.slice(0, 18))) return c;
    }
    return null;
  }

  /**
   * O número da coluna 0 é o ID do cliente no escritório e se repete em TODAS
   * as abas — é a chave de cruzamento confiável. Nome só entra como reserva,
   * porque a grafia varia entre abas.
   */
  function cliente(id, cnpj, nome) {
    const i = id === null || id === undefined || id === '' ? null : String(id).trim();
    const d = digitos(cnpj);
    const n = normalizarNome(nome);

    // O ID manda. Se ele existe e é novo, é cliente novo — não pode cair no
    // casamento por nome, senão duas empresas de nome parecido viram uma só
    // (foi assim que 112 clientes viraram 108 na primeira versão).
    let c = null;
    if (i && porId.has(i)) {
      c = porId.get(i);
    } else if (i && permitirNovos) {
      c = null;
    } else {
      c = (d.length >= 11 && porChave.get(d)) || acharPorNome(n) || null;
    }

    if (!c) {
      if (!permitirNovos || !n) return null;
      c = { id: i, chave: i || (d.length >= 11 ? d : n), nome: texto(nome), cnpj: d || null, certidoes: {}, procuracoes: {} };
      porChave.set(c.chave, c);
    }

    if (i && !c.id) c.id = i;
    if (i) porId.set(i, c);
    if (!c.nome && nome) c.nome = texto(nome);
    if (!c.cnpj && d.length >= 11) { c.cnpj = d; porChave.set(d, c); }
    if (n) porNome.set(n, c);
    return c;
  }

  // ---------- GERAL: cadastro ----------
  const geral = wb.getWorksheet('GERAL');
  if (geral) {
    for (const r of matriz(geral).dados) {
      const c = cliente(r[0], r[2], r[1]);
      if (!c) continue;
      c.id = texto(r[0]);
      c.naGeral = true;   // a GERAL é o cadastro oficial; as outras abas só complementam
      c.caceal = texto(r[4]);
      c.inscricaoMunicipal = texto(r[5]);
      c.nire = texto(r[6]);
      c.arquivamentoJucea = data(r[7]);
      c.proximoArquivamento = data(r[8]);
      c.cidade = texto(r[9]);
      c.regime = texto(r[10]);
    }
  }

  // ---------- PROCURAÇÕES ----------
  const proc = wb.getWorksheet('Controle de Procurações');
  if (proc) {
    for (const r of matriz(proc).dados) {
      const c = cliente(r[0], r[2], r[1]);
      if (!c) continue;
      c.procuracoes = {
        ecacResponsavel:  { tem: booleano(r[3]),  validade: data(r[4]) },
        ecacEscritorio:   { tem: booleano(r[5]),  validade: data(r[6]) },
        empregadorWeb:    { tem: booleano(r[7]),  validade: null },
        fgtsResponsavel:  { tem: booleano(r[8]),  validade: data(r[9]) },
        fgtsEscritorio:   { tem: booleano(r[10]), validade: data(r[11]) },
        gestaoDemandas:   { tem: booleano(r[12]), validade: null },
        conectividade:    { tem: booleano(r[13]), validade: data(r[14]) },
        det:              { tem: booleano(r[15]), validade: null },
      };
    }
  }

  // ---------- CERTIDÕES ----------
  const cert = wb.getWorksheet('CONTROLE DE CERTIDÕES');
  if (cert) {
    for (const r of matriz(cert).dados) {
      const c = cliente(r[0], null, r[1]);
      if (!c) { if (texto(r[1])) naoCasaram.push({ aba: 'CERTIDÕES', nome: texto(r[1]) }); continue; }
      c.certidoes = {
        federal: certidao(r[2]),
        fgts: certidao(r[3]),
        prefeitura: certidao(r[4]),
        trabalhista: certidao(r[5]),
        estadual: certidao(r[6]),
      };
    }
  }

  // A partir daqui as abas não têm CNPJ. Se um nome não casar com o cadastro,
  // é divergência de grafia — vira aviso, não um cliente fantasma.
  permitirNovos = false;
  const naoCasaram = [];

  // ---------- VINCULAÇÕES ONVIO ----------
  const onvio = wb.getWorksheet('VINCULAÇÕES ONVIO');
  if (onvio) {
    // Esta aba não tem cabeçalho: coluna 1 = nº, 2 = empresa, 3 = responsável.
    onvio.eachRow({ includeEmpty: false }, (row) => {
      const v = row.values.slice(1);
      const c = cliente(v[0], null, v[1]);
      if (!c) return;
      const resp = texto(v[2]);
      if (resp && resp.toLowerCase() !== 'sem cadastro') c.responsavelOnvio = resp;
      else if (resp) c.responsavelOnvio = null;
    });
  }

  // ---------- CERTIFICADOS ----------
  const cd = wb.getWorksheet('CERTIFICADOS');
  if (cd) {
    for (const r of matriz(cd).dados) {
      const c = cliente(r[0], null, r[1]);
      if (c) c.certificadoVence = data(r[2]);
      else if (texto(r[1])) naoCasaram.push({ aba: 'CERTIFICADOS', nome: texto(r[1]) });
    }
  }

  // ---------- FOLHA ----------
  const folha = wb.getWorksheet('FOLHA');
  if (folha) {
    for (const r of matriz(folha).dados) {
      const c = cliente(r[0], null, r[1]);
      if (!c) { if (texto(r[1])) naoCasaram.push({ aba: 'FOLHA', nome: texto(r[1]) }); continue; }
      c.folha = {
        responsavel: texto(r[2]),
        possui: (texto(r[3]) ?? '').toLowerCase().startsWith('s'),
        colaboradores2023: Number(r[4]) || 0,
        proLabore2023: Number(r[5]) || 0,
        colaboradores2024: Number(r[6]) || 0,
        proLabore2024: Number(r[7]) || 0,
      };
    }
  }

  // ---------- ANIVERSÁRIOS (lista à parte: é pessoa, não empresa) ----------
  const aniv = wb.getWorksheet('ANIVERSÁRIOS');
  const aniversarios = [];
  if (aniv) {
    for (const r of matriz(aniv).dados) {
      const nome = texto(r[0]);
      const d = data(r[1]);
      if (nome && d) aniversarios.push({ nome, data: d.slice(5) }); // MM-DD
    }
  }

  // porChave guarda o mesmo cliente sob CNPJ e sob nome; desduplica por objeto.
  const clientes = [...new Set(porChave.values())]
    .filter((c) => c.nome)
    .sort((a, b) => (Number(a.id) || 9e9) - (Number(b.id) || 9e9));

  return {
    geradoEm: new Date().toISOString(),
    clientes,
    aniversarios,
    naoCasaram,
  };
}

// ---------- execução direta ----------
if (process.argv[1] && process.argv[1].endsWith('planilha.js')) {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('Uso: npm run planilha -- ./CONTROLE.xlsx');
    process.exit(1);
  }

  const base = await lerPlanilha(path.resolve(arquivo));
  const destino = path.join(RAIZ, 'dados', 'clientes.json');
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, JSON.stringify(base, null, 2), 'utf8');

  console.log(`${base.clientes.length} clientes · ${base.aniversarios.length} aniversários`);
  if (base.naoCasaram.length) {
    console.log(`\n${base.naoCasaram.length} linha(s) não casaram com o cadastro (grafia divergente):`);
    for (const x of base.naoCasaram) console.log(`  [${x.aba}] ${x.nome}`);
  }
  console.log(`-> ${path.relative(RAIZ, destino)}`);
}
