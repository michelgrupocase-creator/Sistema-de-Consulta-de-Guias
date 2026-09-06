/**
 * COLETA ASSISTIDA - o robo faz tudo, menos o CAPTCHA.
 *
 * Por que existe: em 05/09/2026 se descobriu que a Receita exige CAPTCHA
 * visual (hCaptcha) na troca de perfil, dentro do portal novo. Um CAPTCHA por
 * empresa. Isso mata a execucao desassistida, mas NAO mata o projeto: o
 * CAPTCHA ja existe hoje, quando a consulta e feita na mao. O robo continua
 * eliminando tudo o que esta em volta dele - navegar, digitar, escolher o
 * perfil, baixar, renomear, arquivar, comparar com a semana passada.
 *
 * Como funciona: para cada empresa o robo prepara a troca de perfil e PARA.
 * Voce resolve o CAPTCHA. Ele detecta sozinho que a troca pegou, confere que
 * a empresa na tela e a certa, baixa o PDF e guarda no acervo. Depois segue
 * para a proxima.
 *
 * Voce precisa ficar presente a rodada inteira: o CAPTCHA e serial.
 *
 * Uso:
 *   npm.cmd run coletar                      (todas de empresas.json)
 *   npm.cmd run coletar -- --cnpj <CNPJ de teste>
 *   npm.cmd run coletar -- --espera 300      (segundos por CAPTCHA)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { carregarConfig } from './config.js';
import { primeiroVisivel } from './localizador.js';
import { SELETORES, URLS } from './seletores.js';
import { somenteDigitos, formatarCnpj } from './ecac.js';
import { abrirAcervo } from './acervo.js';
import { conectar } from './navegador-persistente.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERFIL = path.join(RAIZ, '.perfil-navegador');

const log = (t = '') => console.log(t);
const tit = (t) => { log(''); log('='.repeat(68)); log(t); log('='.repeat(68)); };

/** Chama a sua atencao: o robo so para quando precisa de voce. */
function chamar() {
  for (let i = 0; i < 3; i += 1) process.stdout.write('\x07');
}

async function lerEmpresas(cnpjUnico) {
  if (cnpjUnico) return [{ cnpj: cnpjUnico, apelido: null }];
  const bruto = await fs.readFile(path.join(RAIZ, 'empresas.json'), 'utf8');
  return JSON.parse(bruto).map((e) => ({
    cnpj: somenteDigitos(e.cnpj),
    apelido: e.apelido ?? null,
  })).filter((e) => e.cnpj.length === 14);
}

/**
 * Texto do CONTEUDO da pagina, sem o painel "Representar" nem o cabecalho.
 *
 * Por que o recorte importa: o painel lateral contem o CNPJ que o proprio robo
 * acabou de digitar. Procurar o CNPJ no body inteiro daria positivo SEMPRE,
 * mesmo com a troca de perfil fracassada - exatamente o falso positivo que
 * faria o robo gravar o relatorio da pessoa errada. A conferencia tem que
 * olhar so onde a Receita responde: os Dados Cadastrais.
 */
async function tela(page) {
  return page.evaluate(() => {
    const c = document.body.cloneNode(true);
    c.querySelectorAll('area-representacao, header, aside, .br-header, nav, footer')
      .forEach((e) => e.remove());
    return (c.innerText || c.textContent || '').replace(/\s+/g, ' ');
  }).catch(() => '');
}

/**
 * Preenche o painel "Representar" e clica. NAO resolve o CAPTCHA: depois
 * disto quem age e o humano.
 *
 * Detalhes do painel, confirmados em 05/09/2026:
 *  - #input-representar-cpfcnpj aplica mascara sozinho;
 *  - o perfil e um ng-select do Angular; as opcoes so existem depois de abrir,
 *    em .ng-dropdown-panel .ng-option, e sao fixas: Procurador / Representante
 *    no CNPJ / Agente Publico;
 *  - o id do input interno do ng-select muda a cada carga: nunca usar id.
 */
/**
 * Le a representacao ativa agora, se houver. Devolve so os digitos do CNPJ.
 * O painel mostra "Representacao Atual / Procurador de: <nome> <CNPJ>".
 */
/**
 * O portal devolve "Pagina nao encontrada" para /servico, que e justamente
 * onde o link de login manda o usuario. Cair no 404 nao e erro de sessao:
 * e so ir para a raiz. Sem isto o robo ficaria preso numa pagina que nao tem
 * o painel de representacao, achando que perdeu o login.
 */
async function corrigir404(page) {
  const t = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (!/P[Ã¡a]gina n[Ã£a]o encontrada/i.test(t)) return false;
  log('   Caiu na pagina inexistente (/servico). Indo para a home do portal.');
  await page.goto(URLS.portalHome, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3500);
  return true;
}

async function representacaoAtual(page) {
  const t = await page.evaluate(() => {
    const m = document.body.innerText.match(/Representa[Ã§c][Ã£a]o Atual[\s\S]{0,220}/);
    return m ? m[0] : '';
  }).catch(() => '');
  const m = t.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  return m ? m[1].replace(/\D/g, '') : null;
}

/**
 * Quem esta sendo representado AGORA, lido no cabecalho da pagina.
 *
 * Este e o sinal confiavel, e nao o painel: depois de escolher uma
 * "Representacao Recente" o painel FECHA, e o bloco "Representacao Atual"
 * some do DOM. Confirmar por ele deixava o robo esperando para sempre um
 * sinal que tinha acabado de desaparecer (06/09/2026).
 *
 * O cabecalho mostra, ao lado do avatar, o nome e o CNPJ representado, e fica
 * visivel em qualquer tela do portal.
 */
async function representadoNoTopo(page) {
  const t = await page.evaluate(() => {
    const topo = document.querySelector('header')
      ?? document.querySelector('#avatar-dropdown-trigger')?.closest('div');
    return topo ? topo.innerText : '';
  }).catch(() => '');
  const m = t.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g) ?? [];
  return m.map((x) => x.replace(/\D/g, ''));
}

/**
 * Tenta reusar "Representacoes Recentes": um clique, sem digitar nada.
 * Devolve true se achou e clicou. Guarda ate 7 empresas.
 */
async function usarRecente(page, cnpj) {
  const formatado = formatarCnpj(cnpj);
  const indice = await page.evaluate((alvo) => {
    const botoes = Array.from(document.querySelectorAll('button[aria-label="Representar"]'));
    for (let i = 0; i < botoes.length; i += 1) {
      let no = botoes[i];
      for (let up = 0; up < 5 && no; up += 1) {
        if ((no.innerText || '').includes(alvo)) return i;
        no = no.parentElement;
      }
    }
    return -1;
  }, formatado).catch(() => -1);

  if (indice < 0) return false;
  await page.locator('button[aria-label="Representar"]').nth(indice)
    .click({ timeout: 8000 });
  return true;
}

async function prepararTroca(page, cnpj) {
  await page.locator('#avatar-dropdown-trigger').first()
    .click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // 1) Ja estou nesta empresa? Entao nao troco nada - e o caso mais barato,
  //    e forcar a troca aqui cobraria um CAPTCHA do usuario a toa.
  const atual = await representacaoAtual(page);
  if (atual === cnpj) {
    log('   Ja estou representando esta empresa. Sem troca, sem CAPTCHA.');
    return 'ja-estava';
  }

  // 2) Esta nas "Representacoes Recentes"? Um clique resolve.
  if (await usarRecente(page, cnpj).catch(() => false)) {
    log('   Reusando de "Representacoes Recentes" (um clique).');
    return 'recente';
  }

  // 3) Ha outra empresa ativa: NAO encerrar. O portal aceita representar uma
  //    empresa por cima da outra, e foi assim que a primeira rodada de 5
  //    funcionou. Encerrar antes foi invencao minha em 06/09/2026 e quebrou
  //    a coleta: o clique no "Encerrar representacao" recarrega o painel e
  //    derruba o formulario que vem depois. A unica economia real e nao trocar
  //    quando a empresa desejada JA esta ativa - isso o passo 1 acima resolve.
  if (atual) log(`   Representando por cima da atual (${formatarCnpj(atual)}).`);

  log('   Preenchendo o formulario de representacao...');
  const campo = page.locator('#input-representar-cpfcnpj').first();
  if (!(await campo.isVisible({ timeout: 6000 }).catch(() => false))) {
    log('   Campo nao visivel; abrindo a secao "Representar".');
    await page.getByRole('button', { name: /^Representar$/i }).first()
      .click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  if (!(await campo.isVisible({ timeout: 6000 }).catch(() => false))) {
    throw new Error('Campo de CPF/CNPJ nao apareceu no painel.');
  }
  await campo.fill('').catch(() => {});
  await campo.type(cnpj, { delay: 50 });
  await page.waitForTimeout(1200);

  log('   Abrindo o perfil de representacao...');
  await page.locator('br-select[name="perfil-select"] .ng-select-container').first()
    .click({ timeout: 8000 })
    .catch(async () => {
      await page.locator('br-select[name="perfil-select"] input[role="combobox"]').first()
        .click({ timeout: 5000 });
    });
  await page.waitForTimeout(1500);

  const opcao = page.locator('.ng-dropdown-panel .ng-option')
    .filter({ hasText: /^\s*Procurador\s*$/i }).first();
  if (!(await opcao.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('Perfil "Procurador" nao apareceu na lista.');
  }
  await opcao.click({ timeout: 5000 });
  await page.waitForTimeout(1200);

  log('   Enviando...');
  const btn = page.locator('button[type="submit"]').filter({ hasText: /Representar/i }).first();
  if (!(await btn.isEnabled({ timeout: 5000 }).catch(() => false))) {
    throw new Error('Botao "Representar" continuou desabilitado.');
  }
  await btn.click({ timeout: 8000 }).catch(async () => {
    await btn.click({ timeout: 4000, force: true });
  });
  return 'formulario';
}

/**
 * Espera VOCE resolver o CAPTCHA. Termina quando o CNPJ alvo aparece na tela.
 *
 * A condicao de parada e o CNPJ ALVO aparecer - nao "o CPF sumir". Sao coisas
 * diferentes: uma troca que falhou em silencio deixaria a tela antiga no lugar
 * e o robo gravaria o relatorio da empresa errada. Documento fiscal trocado e
 * um erro que so aparece semanas depois.
 */
/**
 * Mensagens do portal que significam "esta empresa nao vai dar certo agora".
 * Sem isto o robo esperaria o CAPTCHA inteiro (minutos) por empresa sem
 * procuracao - e numa carteira de 111 isso e a diferenca entre uma hora e
 * uma tarde perdida.
 */
const SEM_PROCURACAO = [
  // Mensagem real vista em 06/09/2026, num aviso vermelho FORA do painel:
  // "Sua autorizacao como procurador nao permite acesso a este servico."
  // Nao e ausencia de procuracao - e procuracao que NAO cobre o servico de
  // situacao fiscal. Para o robo da no mesmo: pula. Para o escritorio nao:
  // significa refazer a procuracao marcando esse servico.
  /autoriza[Ã§c][Ã£a]o[\s\S]{0,40}n[Ã£a]o permite acesso/i,
  /n[Ã£a]o permite acesso a este servi[Ã§c]o/i,
  /n[Ã£a]o (foi|foram) encontrad[ao]s? procura/i,
  /n[Ã£a]o possui procura/i,
  /sem procura[Ã§c][Ã£a]o/i,
  /procura[Ã§c][Ã£a]o (inv[Ã¡a]lida|expirada|vencida)/i,
  /n[Ã£a]o (est[Ã¡a] )?autorizad/i,
  /nenhuma procura[Ã§c][Ã£a]o/i,
];

const recusado = (texto) => SEM_PROCURACAO.some((r) => r.test(texto));

async function esperarHumano(page, cnpj, segundos) {
  const formatado = formatarCnpj(cnpj);
  const limite = Date.now() + segundos * 1000;
  let avisou = false;

  while (Date.now() < limite) {
    // A confirmacao e o bloco "Representacao Atual" do painel dizer o CNPJ
    // ALVO. Nao serve procurar o CNPJ na pagina: o painel contem o numero que
    // o proprio robo digitou, e isso daria positivo mesmo com a troca
    // fracassada - o erro que faria gravar o relatorio da empresa errada.
    // Na home do portal nao ha "Dados Cadastrais" para conferir; a fonte
    // confiavel e a representacao ativa.
    if ((await representacaoAtual(page)) === cnpj) return { ok: true };
    if ((await representadoNoTopo(page)).includes(cnpj)) return { ok: true };

    // A recusa aparece num aviso vermelho FORA do painel de representacao -
    // por isso olho o documento inteiro, e nao so o painel como eu fazia.
    // As frases sao especificas o bastante para nao dar falso positivo.
    const corpo = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      .catch(() => '');

    if (recusado(corpo)) {
      const frase = (corpo.match(/[^.!?]{0,120}n[Ã£a]o permite acesso[^.!?]{0,40}/i)
        ?? corpo.match(/[^.!?]{0,120}procura[Ã§c][Ã£a]o[^.!?]{0,60}/i)
        ?? ['recusa de acesso'])[0].trim();
      return { ok: false, motivo: `Portal recusou: ${frase}` };
    }

    if (!avisou) {
      chamar();
      log('');
      log('   >>> RESOLVA O CAPTCHA NA JANELA DO NAVEGADOR <<<');
      log(`       Empresa: ${formatado}`);
      log('       Se esta empresa NAO tem procuracao, e so ignorar:');
      log('       o robo desiste sozinho e segue para a proxima.');
      avisou = true;
    }
    await page.waitForTimeout(2500);
  }
  return { ok: false, motivo: `Sem confirmacao em ${segundos}s (provavel falta de procuracao).` };
}

/** Baixa o PDF e devolve o Buffer. */
async function baixarPdf(page, timeoutMs) {
  const botao = await primeiroVisivel(page, SELETORES.linkPdfPronto, { timeoutMs: 15000 });
  if (!botao) throw new Error('Botao "Baixar Relatorio" nao apareceu.');

  await botao.locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const espera = page.waitForEvent('download', { timeout: timeoutMs });

  // Tres tentativas, da mais educada para a mais bruta. Sobrou algum resto de
  // overlay do painel lateral que intercepta o ponteiro sem estar visivel.
  await botao.locator.click({ timeout: 8000 }).catch(async () => {
    await botao.locator.click({ timeout: 5000, force: true }).catch(async () => {
      await page.evaluate(() => {
        const alvo = Array.from(document.querySelectorAll('button, a'))
          .find((e) => /Baixar Relat/i.test(e.innerText || ''));
        if (alvo) alvo.click();
      });
    });
  });

  const download = await espera;

  const temp = await download.path();
  if (!temp) throw new Error('Download sem arquivo no disco.');
  return fs.readFile(temp);
}

async function main() {
  const arg = (n) => process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null;
  const config = await carregarConfig(RAIZ);
  let empresas = await lerEmpresas(somenteDigitos(arg('--cnpj') ?? ''));

  // --limite N: roda so as N primeiras. Serve para medir a taxa real de
  // CAPTCHA antes de comprometer a carteira inteira numa sentada.
  // --pular N: retoma de onde parou, sem refazer o que ja deu certo.
  const pular = Number(arg('--pular') ?? 0);
  if (pular > 0) empresas = empresas.slice(pular);
  const limite = Number(arg('--limite') ?? 0);
  if (limite > 0) empresas = empresas.slice(0, limite);
  const esperaCaptcha = Number(arg('--espera') ?? 300);
  const acervo = await abrirAcervo(path.resolve(RAIZ, config.acervo ?? './acervo'));

  // NAO sobe navegador proprio. Conecta no que ja esta aberto.
  // Cada execucao subir e derrubar o proprio Chromium significava perder a
  // sessao do portal (cookie de sessao morre com a janela) e pedir login de
  // novo a cada rodada. Agora o navegador e um processo independente, aberto
  // uma vez, e o coletor apenas se conecta - e nunca o fecha.
  const { ctx: context, page } = await conectar();
  context.setDefaultTimeout(config.timeoutPadraoMs);
  await page.bringToFront().catch(() => {});

  tit(`COLETA ASSISTIDA - ${empresas.length} empresa(s)`);
  log('O robo para em cada CAPTCHA e continua sozinho quando voce resolve.');
  log('A janela NAO fecha no fim.');

  const resultado = [];

  try {
    // Vai DIRETO ao portal novo. Passar pelo e-CAC antigo era escada
    // desnecessaria: o portal tem SSO proprio no gov.br, e o unico motivo de
    // abrir o e-CAC antes era historico (foi assim que o fluxo foi descoberto).
    // O e-CAC so entra em cena se o caminho direto nao autenticar.
    log('');
    log('Abrindo o portal. Se pedir login, faca na janela (uma vez).');
    await page.goto(URLS.portalLogin, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(4000);

    // O redirectUrl do link de login aponta para /servico, que nao existe.
    // Depois de autenticar, cair no 404 e normal: basta ir para a raiz.
    await corrigir404(page);

    if (/\/login\//i.test(page.url())) {
      const b = await primeiroVisivel(page, SELETORES.botaoEntrarGovBr, { timeoutMs: 8000 });
      if (b) await b.locator.click({ timeout: 8000 }).catch(() => {});
      const t = Date.now() + 120000;
      while (Date.now() < t && /\/login\//i.test(page.url())) await page.waitForTimeout(2000);
      await page.waitForTimeout(4000);
    }

    let autenticado = Boolean(
      await primeiroVisivel(page, SELETORES.marcadorLogadoPortal, { timeoutMs: 10000 })
    );

    if (!autenticado) {
      // Espera o login NO PORTAL, nao no e-CAC antigo. O e-CAC deixou de ser
      // caminho: ele so autentica o dominio antigo, e o servico de pendencias
      // vive no portal novo, com sessao propria.
      log('Sem sessao. Abrindo a tela de login do portal para voce entrar.');
      await page.goto(URLS.portalLogin, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const ate = Date.now() + 900000;
      let ultimoAviso = 0;

      // Aceita QUALQUER um dos dois marcadores. A versao anterior so olhava o
      // do e-CAC antigo e ficava presa quando o login terminava no portal novo
      // - que e onde o gov.br costuma devolver o usuario.
      while (Date.now() < ate) {
        const eCac = await primeiroVisivel(page, SELETORES.marcadorLogado, { timeoutMs: 1200 });
        const portal = await primeiroVisivel(page, SELETORES.marcadorLogadoPortal, { timeoutMs: 1200 });
        if (eCac || portal) {
          log(`   Login detectado (${eCac ? 'e-CAC' : 'portal novo'}).`);
          autenticado = true;
          break;
        }
        if (Date.now() - ultimoAviso > 15000) {
          log(`   ...aguardando login. Estou em: ${page.url()}`);
          ultimoAviso = Date.now();
        }
        await page.waitForTimeout(2000);
      }
      if (!autenticado) throw new Error('Login nao detectado em 15 minutos.');
    }
    log('Sessao ok.');

    for (const [i, emp] of empresas.entries()) {
      const rotulo = `${emp.apelido ?? ''} ${formatarCnpj(emp.cnpj)}`.trim();
      tit(`[${i + 1}/${empresas.length}] ${rotulo}`);
      const registro = { cnpj: emp.cnpj, apelido: emp.apelido, em: new Date().toISOString() };

      try {
        // ORDEM CORRIGIDA EM 06/09/2026.
        // Antes o robo abria a tela de pendencias e SO DEPOIS trocava a
        // procuracao. Isso fazia a Receita rodar uma analise no CPF de quem
        // logou, antes de qualquer representacao - consulta desperdicada e um
        // diagnostico que ninguem pediu no historico da pessoa.
        // Agora: home do portal -> representar -> so entao a consulta.
        // ORDEM DEFINIDA PELO USUARIO, e a que ele faz na mao:
        //   1. login no portal
        //   2. ABRIR A TELA DE PENDENCIAS
        //   3. so ali informar o CNPJ da empresa com procuracao
        //
        // A representacao acontece DENTRO da tela de consulta. Foi assim que
        // as primeiras coletas funcionaram. Em 06/09/2026 eu inverti isso -
        // representava na home e depois navegava - e a representacao se perdia
        // na navegacao: a consulta abria com o CPF de quem logou. Nao inverta.
        if (!/pendencias/i.test(page.url())) {
          await page.goto(URLS.pendencias[0], { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(6000);
          await corrigir404(page);
        }

        if (/\/login\//i.test(page.url())) {
          log('   Portal pediu autenticacao propria; entrando pelo gov.br.');
          const b = await primeiroVisivel(page, SELETORES.botaoEntrarGovBr, { timeoutMs: 8000 });
          if (b) await b.locator.click({ timeout: 8000 }).catch(() => {});
          const t = Date.now() + 120000;
          while (Date.now() < t && /\/login\//i.test(page.url())) await page.waitForTimeout(2000);
          await page.waitForTimeout(4000);
        }

        const via = await prepararTroca(page, emp.cnpj);
        registro.via = via;

        const pegou = await esperarHumano(page, emp.cnpj, esperaCaptcha);
        const pasta0 = path.join(path.resolve(RAIZ, config.saida ?? './relatorios'), '_debug');
        await fs.mkdir(pasta0, { recursive: true });
        await page.screenshot({ path: path.join(pasta0, `coleta-${emp.cnpj}.png`), fullPage: true })
          .catch(() => {});
        if (!pegou.ok) throw new Error(pegou.motivo);
        log('   Representacao confirmada no painel.');

        // O painel lateral continua aberto depois da troca, com um fundo que
        // escurece a pagina inteira e engole todo clique - inclusive o do
        // "Baixar Relatorio". O botao que o fecha chama "Fechar Menu"
        // (confirmado no DOM em 05/09/2026). Escape nao fecha.
        log('   Fechando o painel de representacao...');
        await page.getByRole('button', { name: /Fechar Menu/i }).first()
          .click({ timeout: 6000 })
          .catch(async () => {
            await page.locator('#avatar-dropdown-trigger').first()
              .click({ timeout: 4000 }).catch(() => {});
          });
        await page.waitForTimeout(2000);

        // SO AGORA a consulta e aberta - com a empresa ja representada. E este
        // o pedido que faz a Receita analisar a EMPRESA, e nao o CPF de quem
        // logou.
        // JA ESTAMOS na tela de pendencias - a representacao foi feita aqui
        // dentro. NAO navegar de novo: recarregar derruba a representacao.
        //
        // ARMADILHA GRAVE (achada em 06/09/2026): trocar a representacao NAO
        // troca a analise que ja esta na tela. A partir da segunda empresa, os
        // Dados Cadastrais continuam sendo os da empresa ANTERIOR por alguns
        // segundos - e se o robo baixar nesse intervalo, grava o relatorio da
        // empresa errada com o nome da certa. E o erro que so aparece semanas
        // depois, quando alguem precisa do documento.
        //
        // Por isso a conferencia aqui e um LACO, nao uma checagem unica: ele
        // so segue quando a tela mostrar o CNPJ ALVO. Se em 25s ainda estiver
        // na empresa anterior, forca "Atualizar" e continua esperando.
        log('   Esperando a tela virar para esta empresa...');
        const alvoFmt = formatarCnpj(emp.cnpj);
        const prazo = Date.now() + 90000;
        let virou = false;
        let forcou = false;

        while (Date.now() < prazo) {
          const t = await tela(page);
          if (t.includes(alvoFmt) || t.includes(emp.cnpj)) { virou = true; break; }

          if (!forcou && Date.now() > prazo - 65000) {
            log('   Tela ainda na empresa anterior. Clicando em "Atualizar".');
            await page.getByRole('button', { name: /^Atualizar$/i }).first()
              .click({ timeout: 6000 }).catch(() => {});
            forcou = true;
          }
          await page.waitForTimeout(2000);
        }

        if (!virou) {
          throw new Error('A tela continuou mostrando outra empresa â€” nada foi baixado.');
        }
        log('   Tela confirmada nesta empresa.');

        // A analise da nova empresa e assincrona: a tela fica em "Carregando"
        // e o "Baixar Relatorio" ainda nao serve. Clicar aqui e o erro que
        // fazia o download estourar timeout.
        log('   Aguardando a analise da empresa carregar...');
        const fim = Date.now() + 120000;
        let pronto = false;
        while (Date.now() < fim) {
          const t = await tela(page);
          if (!/Carregando/i.test(t) && /Resultado da An[Ã¡a]lise/i.test(t)) { pronto = true; break; }
          await page.waitForTimeout(2000);
        }
        log(pronto ? '   Analise carregada.' : '   AVISO: ainda carregando apos 120s; tentando assim mesmo.');
        await page.waitForTimeout(2000);

        log('   Baixando o relatorio...');
        const pdf = await baixarPdf(page, config.timeoutRelatorioMs ?? 240000);

        const guardado = await acervo.guardar({
          cnpj: emp.cnpj,
          tipo: 'situacao-fiscal',
          conteudo: pdf,
          apelido: emp.apelido,
        });
        await acervo.salvarIndice();

        registro.estado = guardado.estado;
        registro.caminho = guardado.caminho;
        registro.hash = guardado.hash;
        log(guardado.estado === 'novo'
          ? `   NOVO documento guardado: ${path.relative(RAIZ, guardado.caminho)}`
          : '   Identico ao ultimo: nada mudou desde a coleta anterior.');
      } catch (erro) {
        registro.estado = 'falha';
        registro.erro = erro.message.split('\n')[0];
        log(`   FALHA: ${registro.erro}`);
      }

      resultado.push(registro);
      await page.waitForTimeout(config.esperaEntreEmpresasMs ?? 4000);
    }
  } catch (erro) {
    log(`\nERRO GERAL: ${erro.message}`);
  }

  const novos = resultado.filter((r) => r.estado === 'novo').length;
  const iguais = resultado.filter((r) => r.estado === 'igual').length;
  const falhas = resultado.filter((r) => r.estado === 'falha').length;

  tit('RESUMO');
  log(`   Novos:   ${novos}`);
  log(`   Iguais:  ${iguais}`);
  log(`   Falhas:  ${falhas}`);
  for (const r of resultado.filter((x) => x.estado === 'falha')) {
    log(`     - ${formatarCnpj(r.cnpj)}: ${r.erro}`);
  }

  const saida = path.resolve(RAIZ, config.saida ?? './relatorios');
  const pasta = path.join(saida, new Date().toISOString().slice(0, 10));
  await fs.mkdir(pasta, { recursive: true });
  await fs.writeFile(
    path.join(pasta, '_execucao.json'),
    JSON.stringify({ em: new Date().toISOString(), modo: 'assistido', resultado }, null, 2),
    'utf8'
  );
  log(`\nExecucao registrada em ${path.relative(RAIZ, path.join(pasta, '_execucao.json'))}`);
  log('O navegador continua aberto (processo proprio). Feche com: npm run navegador -- --fechar');

  // ENCERRA de verdade. Antes ficava numa espera infinita para nao fechar a
  // janela - mas o navegador agora e um processo independente e sobrevive
  // sozinho. A espera so servia para travar quem chamasse o coletor em fila:
  // a segunda empresa nunca comecava, porque a primeira nunca terminava.
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
