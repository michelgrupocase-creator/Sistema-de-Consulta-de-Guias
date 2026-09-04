/**
 * MODO DE MAPEAMENTO — rode isto ANTES da primeira coleta de verdade.
 *
 * Por que existe: em 09/03/2026 a Receita aposentou a "Consulta Situação
 * Fiscal" do e-CAC e pôs no lugar o "Minhas Dívidas e Pendências", no Portal
 * de Serviços, com layout novo. Os seletores deste projeto são hipóteses — sem
 * ver a tela real, ninguém sabe quais valem.
 *
 * O que este modo faz: percorre as telas SEM CLICAR EM NADA QUE MUDE DADOS,
 * fotografa cada etapa, lista os links e botões que existem de verdade e testa
 * cada candidato de src/seletores.js contra a tela. No fim escreve um relatório
 * único em relatorios/_debug/mapa.txt.
 *
 * Nada aqui derruba a execução: cada etapa falha em silêncio e segue.
 *
 * Uso:  npm run mapear -- --cnpj 12345678000190
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarConfig, obterSenhaCertificado } from './config.js';
import { abrirNavegador, salvarDebug } from './navegador.js';
import { diagnosticar } from './localizador.js';
import { SELETORES, URLS } from './seletores.js';
import { formatarCnpj, somenteDigitos } from './ecac.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Palavras que denunciam um caminho útil no menu do portal. */
const PALAVRAS_ALVO = [
  'dívida', 'divida', 'pendência', 'pendencia', 'situação fiscal', 'situacao fiscal',
  'certidão', 'certidao', 'perfil', 'procurador', 'regulariz', 'débito', 'debito',
  'caixa postal', 'consulta',
];

const linhas = [];

function escrever(texto = '') {
  linhas.push(texto);
  console.log(texto);
}

function titulo(texto) {
  escrever('');
  escrever('='.repeat(72));
  escrever(texto);
  escrever('='.repeat(72));
}

/** Onde estamos agora: URL e título da aba. */
async function ondeEstamos(page, etapa) {
  escrever(`URL:    ${page.url()}`);
  escrever(`Título: ${await page.title().catch(() => '(sem título)')}`);
  escrever(`Print:  _debug/…_${etapa}.png`);
}

/**
 * Lista o que é clicável na tela. É isto que permite descobrir o caminho novo
 * sem adivinhação: se "Minhas Dívidas e Pendências" existe, aparece aqui.
 */
async function listarNavegacao(page) {
  const itens = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"]'))
      .filter(vis)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        texto: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 90),
        href: el.getAttribute('href') || '',
        id: el.id || '',
      }))
      .filter((x) => x.texto.length > 1);
  }).catch(() => []);

  const relevantes = itens.filter((x) =>
    PALAVRAS_ALVO.some((p) => x.texto.toLowerCase().includes(p))
  );

  escrever('');
  escrever(`-- Links/botões visíveis: ${itens.length} (${relevantes.length} parecem relevantes)`);

  if (relevantes.length) {
    escrever('   RELEVANTES:');
    for (const x of relevantes) {
      escrever(`     [${x.tag}] "${x.texto}"${x.href ? ' -> ' + x.href : ''}${x.id ? ' #' + x.id : ''}`);
    }
  }

  escrever('   TODOS (primeiros 60):');
  for (const x of itens.slice(0, 60)) {
    escrever(`     [${x.tag}] "${x.texto}"${x.href ? ' -> ' + x.href : ''}`);
  }

  return relevantes;
}

/** Testa um grupo de candidatos e diz quais casaram. */
async function testarGrupo(page, nome, candidatos) {
  const r = await diagnosticar(page, candidatos);
  const achou = r.filter((x) => x.visivel);
  const marca = achou.length ? 'OK  ' : 'NAO ';
  escrever(`  ${marca} ${nome}`);
  for (const item of r) {
    escrever(`        ${item.visivel ? '✓' : '·'} ${item.candidato}${item.erro ? '  (erro: ' + item.erro + ')' : ''}`);
  }
  return achou.length > 0;
}

async function main() {
  const config = await carregarConfig(RAIZ);
  const alvo = process.argv.includes('--cnpj')
    ? somenteDigitos(process.argv[process.argv.indexOf('--cnpj') + 1] ?? '')
    : null;

  const senha = await obterSenhaCertificado(config);
  const pastaSaida = path.resolve(RAIZ, config.saida);

  // Mapeamento é sempre com a tela visível: você precisa ver o que acontece.
  const { browser, page } = await abrirNavegador({ ...config, headless: false }, senha);

  titulo('MAPEAMENTO DO PORTAL — ' + new Date().toLocaleString('pt-BR'));
  escrever('Este relatório diz quais seletores ainda valem. Mande-o inteiro,');
  escrever('junto com os prints de relatorios/_debug/, para o ajuste.');
  escrever('');
  escrever(`CNPJ de teste: ${alvo ? formatarCnpj(alvo) : '(nenhum — só as telas públicas)'}`);

  try {
    // ---- Etapa 1: tela de entrada -------------------------------------
    titulo('ETAPA 1 — Tela de entrada');
    await page.goto(URLS.ecac, { waitUntil: 'domcontentloaded' }).catch((e) => {
      escrever(`Falha ao abrir ${URLS.ecac}: ${e.message}`);
    });
    await page.waitForTimeout(2500);
    await ondeEstamos(page, '01-entrada');
    await salvarDebug(page, '01-entrada', pastaSaida);
    await testarGrupo(page, 'botaoEntrarCertificado', SELETORES.botaoEntrarCertificado);
    await testarGrupo(page, 'marcadorLogado', SELETORES.marcadorLogado);
    await listarNavegacao(page);

    // ---- Etapa 2: login por certificado --------------------------------
    titulo('ETAPA 2 — Login com o certificado');
    const r = await diagnosticar(page, SELETORES.botaoEntrarCertificado);
    const alvoLogin = r.find((x) => x.visivel);

    if (!alvoLogin) {
      escrever('Nenhum candidato de login por certificado apareceu.');
      escrever('Faça o login MANUALMENTE nesta janela agora — o mapeamento');
      escrever('continua em 90 segundos e segue da tela onde você parar.');
      await page.waitForTimeout(90000);
    } else {
      escrever(`Clicando em: ${alvoLogin.candidato}`);
      await page.click('body').catch(() => {});
      await page.getByText('Seu certificado digital', { exact: false }).first()
        .click({ timeout: 8000 })
        .catch(async () => {
          escrever('Clique pelo texto falhou; tentando o candidato bruto.');
        });
      escrever('Aguardando o redirecionamento do gov.br (até 90s)...');
      await page.waitForTimeout(90000);
    }

    await ondeEstamos(page, '02-pos-login');
    await salvarDebug(page, '02-pos-login', pastaSaida);
    await testarGrupo(page, 'marcadorLogado', SELETORES.marcadorLogado);
    await testarGrupo(page, 'abrirTrocaPerfil', SELETORES.abrirTrocaPerfil);
    await testarGrupo(page, 'menuCertidoes', SELETORES.menuCertidoes);
    await testarGrupo(page, 'linkConsultaPendencias', SELETORES.linkConsultaPendencias);
    const nav = await listarNavegacao(page);

    escrever('');
    escrever('>> Caminho para as pendências: procure acima por "Minhas Dívidas e');
    escrever('   Pendências". Se aparecer, o serviço novo já está no ar para você');
    escrever('   e é para ele que os seletores precisam apontar.');
    if (nav.some((x) => /dívida|divida/i.test(x.texto))) {
      escrever('   >> ENCONTRADO um item com "dívida" no nome.');
    }

    // ---- Etapa 3: troca de perfil ---------------------------------------
    titulo('ETAPA 3 — Troca de perfil (procurador)');
    const perfil = await diagnosticar(page, SELETORES.abrirTrocaPerfil);
    const abrePerfil = perfil.find((x) => x.visivel);

    if (!abrePerfil) {
      escrever('Nenhum candidato de "alterar perfil" apareceu nesta tela.');
      escrever('Provavelmente mudou de lugar no portal novo — os links acima dizem onde.');
    } else {
      escrever(`Abrindo: ${abrePerfil.candidato}`);
      await page.getByText(abrePerfil.candidato.split('=')[1], { exact: false }).first()
        .click({ timeout: 8000 }).catch((e) => escrever(`Clique falhou: ${e.message}`));
      await page.waitForTimeout(3000);
      await ondeEstamos(page, '03-troca-perfil');
      await salvarDebug(page, '03-troca-perfil', pastaSaida);
      await testarGrupo(page, 'opcaoProcurador', SELETORES.opcaoProcurador);
      await testarGrupo(page, 'campoCnpjPerfil', SELETORES.campoCnpjPerfil);
      await testarGrupo(page, 'confirmarTrocaPerfil', SELETORES.confirmarTrocaPerfil);
      await listarNavegacao(page);
    }

    // ---- Etapa 4: tela das pendências -----------------------------------
    titulo('ETAPA 4 — Tela das pendências (URL antiga do e-CAC)');
    escrever('Aviso: esta URL é do serviço aposentado em 09/03/2026. Se ela');
    escrever('redirecionar ou dar erro, é exatamente o que precisamos saber.');
    await page.goto(URLS.situacaoFiscal, { waitUntil: 'domcontentloaded' })
      .catch((e) => escrever(`Falha: ${e.message}`));
    await page.waitForTimeout(3000);
    await ondeEstamos(page, '04-pendencias');
    await salvarDebug(page, '04-pendencias', pastaSaida);
    await testarGrupo(page, 'botaoGerarRelatorio', SELETORES.botaoGerarRelatorio);
    await testarGrupo(page, 'sinalProcessando', SELETORES.sinalProcessando);
    await testarGrupo(page, 'linkPdfPronto', SELETORES.linkPdfPronto);
    await listarNavegacao(page);

    titulo('FIM — a janela fica aberta por 60s para você conferir');
    await page.waitForTimeout(60000);
  } catch (erro) {
    escrever('');
    escrever(`ERRO NO MAPEAMENTO: ${erro.message}`);
    await salvarDebug(page, 'erro-mapeamento', pastaSaida);
  } finally {
    const destino = path.join(pastaSaida, '_debug', 'mapa.txt');
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, linhas.join('\n'), 'utf8');
    console.log(`\nRelatório salvo em ${path.relative(RAIZ, destino)}`);
    await browser.close().catch(() => {});
  }
}

main().catch((erro) => {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
});
