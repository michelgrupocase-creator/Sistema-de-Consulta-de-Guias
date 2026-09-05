// Monta o painel HTML a partir da base gerada pela planilha de controle.
//
// O painel é um arquivo único, sem servidor e sem rede: abre com dois cliques
// em qualquer máquina do escritório. Por isso os dados vão embutidos, e por
// isso o arquivo gerado NÃO pode ser versionado — são CNPJs e situação fiscal
// de terceiros, dado sob sigilo. O .gitignore já bloqueia a saída.
//
//   npm run painel
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

const BASE = path.join(RAIZ, 'painel', 'base.html');
const APP = path.join(RAIZ, 'painel', 'app.js');
const LOGO = path.join(RAIZ, 'painel', 'logo.png');
const DADOS = path.join(RAIZ, 'automacao', 'dados', 'clientes.json');
const SAIDA = path.join(RAIZ, 'painel', 'radar-fiscal.html');

// A ordem das certidões é a mesma da tabela na tela. Não reordene sem mexer lá.
const ORDEM_CERTIDOES = ['federal', 'fgts', 'prefeitura', 'trabalhista', 'estadual'];

// Uma certidão vira ou uma data, ou o texto do impedimento, ou nada.
// A tela distingue os três casos; achatar tudo em "pendente" perderia
// a diferença entre "venceu" e "a Receita não respondeu".
function certidao(c) {
  if (!c) return null;
  return c.data || c.situacao || null;
}

function validade(p) {
  if (!p || !p.tem) return null;
  // Procuração sem validade registrada existe, e isso é diferente de não ter
  // procuração: a tela mostra "sem validade registrada", não "sem procuração".
  return p.validade || 'sem validade';
}

// Todas as procurações da planilha, não só as duas do e-CAC: a ficha do
// cliente na tela é o cadastro dele, e o pessoal do escritório precisa
// consultar Conectividade, Empregador Web e Gestão de Demandas do mesmo lugar.
const PROCURACOES = {
  ecacE: 'ecacEscritorio',
  ecacR: 'ecacResponsavel',
  fgtsE: 'fgtsEscritorio',
  fgtsR: 'fgtsResponsavel',
  empWeb: 'empregadorWeb',
  conect: 'conectividade',
  gestao: 'gestaoDemandas',
  det: 'det',
};

function enxugar(c) {
  const pg = {};
  for (const [curto, longo] of Object.entries(PROCURACOES)) {
    pg[curto] = validade(c.procuracoes?.[longo]);
  }

  return {
    id: c.id ?? null,
    n: c.nome,
    j: c.cnpj || null,
    ci: c.cidade || null,
    rg: c.regime || null,
    r: c.responsavelOnvio || null,
    cv: c.certificadoVence || null,
    // Atalhos que o painel usa em contagem e filtro; saem de pg.
    pe: pg.ecacE,
    pr: pg.ecacR,
    det: Boolean(pg.det),
    fgd: Boolean(pg.fgtsE || pg.fgtsR),
    pg,
    // Inscrições e registros: é o que se procura na ficha, não no painel.
    ins: {
      ca: c.caceal || null,
      im: c.inscricaoMunicipal || null,
      ni: c.nire || null,
      aj: c.arquivamentoJucea || null,
      pa: c.proximoArquivamento || null,
    },
    fo: {
      rp: c.folha?.responsavel || null,
      po: Boolean(c.folha?.possui),
      c23: c.folha?.colaboradores2023 ?? null,
      p23: c.folha?.proLabore2023 ?? null,
      c24: c.folha?.colaboradores2024 ?? null,
      p24: c.folha?.proLabore2024 ?? null,
    },
    cd: ORDEM_CERTIDOES.map((k) => certidao(c.certidoes?.[k])),
  };
}

function montar() {
  for (const arquivo of [BASE, APP, LOGO, DADOS]) {
    if (!fs.existsSync(arquivo)) {
      const dica =
        arquivo === DADOS ? '\nRode `npm run planilha` antes: o painel lê a base que ele gera.' : '';
      throw new Error(`Arquivo não encontrado: ${arquivo}${dica}`);
    }
  }

  const base = fs.readFileSync(BASE, 'utf8');
  const app = fs.readFileSync(APP, 'utf8');
  const logo = fs.readFileSync(LOGO).toString('base64');
  const { clientes } = JSON.parse(fs.readFileSync(DADOS, 'utf8'));

  // Só a aba GERAL: é ela que define quem é cliente do escritório hoje.
  const naGeral = clientes.filter((c) => c.naGeral).map(enxugar);

  const html =
    base.replace('__LOGO_URI__', `data:image/png;base64,${logo}`) +
    '\n' +
    app.replace('__DADOS__', JSON.stringify(naGeral));

  if (html.includes('__DADOS__') || html.includes('__LOGO_URI__')) {
    throw new Error('Substituição incompleta: o painel sairia com marcador cru na tela.');
  }

  fs.writeFileSync(SAIDA, html, 'utf8');
  return { clientes: naGeral.length, bytes: html.length };
}

const r = montar();
console.log(`Painel montado: ${r.clientes} clientes, ${(r.bytes / 1024).toFixed(0)} KB`);
console.log(`  ${SAIDA}`);
console.log('  Abra esse arquivo no navegador. Ele não precisa de servidor nem de internet.');
