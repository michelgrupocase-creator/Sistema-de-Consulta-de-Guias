/**
 * SEGUNDA PASSADA DO MAPEAMENTO - os enderecos reais dos servicos.
 *
 * O que a primeira passada revelou: o e-CAC classico continua vivo, e o menu
 * lateral e sanfona (todos os itens tem href="#"). Os links de verdade -
 * Aplicacao.aspx?id=XXXXX - existem no DOM mas ficam escondidos ate o clique.
 * Por isso o mapeamento visivel nao os encontrou.
 *
 * Este script varre o DOM INTEIRO, visivel ou nao, e lista todo Aplicacao.aspx
 * com o id e o texto do link. E assim que se descobre o id da Situacao Fiscal
 * sem adivinhar.
 *
 * Usa perfil de navegador PERSISTENTE: depois do primeiro login, as proximas
 * execucoes ja entram logadas.
 *
 * Uso:  npm.cmd run mapear-menu
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { carregarConfig } from './config.js';
import { primeiroVisivel } from './localizador.js';
import { SELETORES, URLS } from './seletores.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERFIL = path.join(RAIZ, '.perfil-navegador');

const linhas = [];
const esc = (t = '') => { linhas.push(t); console.log(t); };
const tit = (t) => { esc(''); esc('='.repeat(72)); esc(t); esc('='.repeat(72)); };

async function main() {
  const config = await carregarConfig(RAIZ);
  const saida = path.resolve(RAIZ, config.saida);
  await fs.mkdir(PERFIL, { recursive: true });

  const context = await chromium.launchPersistentContext(PERFIL, {
    headless: false,
    acceptDownloads: true,
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  context.setDefaultTimeout(config.timeoutPadraoMs);
  const page = context.pages()[0] ?? (await context.newPage());

  tit('MAPA DOS SERVICOS DO e-CAC - ' + new Date().toLocaleString('pt-BR'));
  esc('Se pedir login, faca na janela. Perfil persistente: so na primeira vez.');

  try {
    await page.goto(URLS.ecac, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);

    tit('Aguardando sessao (ate 600s)');
    const limite = Date.now() + 600000;
    let logado = false;
    while (Date.now() < limite) {
      if (await primeiroVisivel(page, SELETORES.marcadorLogado, { timeoutMs: 1500 })) {
        logado = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    esc(logado ? '>> Sessao ativa.' : '>> Sem sessao detectada; seguindo assim mesmo.');

    await page.goto('https://cav.receita.fazenda.gov.br/ecac/', { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await page.waitForTimeout(3000);

    // NAO clicar nas sanfonas: um dos itens com href="#" dispara navegacao e
    // destroi o contexto no meio da varredura (aconteceu em 05/09/2026).
    // Os sub-itens ja existem no DOM, apenas escondidos por CSS - basta ler.
    tit('Lendo o DOM (sem clicar em nada)');
    const totalLinks = await page.evaluate(() => document.querySelectorAll('a[href]').length).catch(() => 0);
    esc(`Ancoras com href no DOM: ${totalLinks}`);

    tit('TODOS os links de servico no DOM (visiveis ou nao)');
    const servicos = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map((el) => ({
          texto: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
          href: el.getAttribute('href') || '',
        }))
        .filter((x) => /Aplicacao\.aspx|servicos\.receita|\/ecac\//i.test(x.href));
    }).catch(() => []);

    esc(`Encontrados: ${servicos.length}`);
    for (const s of servicos) esc(`  "${s.texto}"  ->  ${s.href}`);

    tit('Filtro: o que cheira a situacao fiscal / certidao / divida');
    const chaves = /certid|situa|divid|pend|regulariz|diagn|fiscal/i;
    const quentes = servicos.filter((s) => chaves.test(s.texto));
    if (!quentes.length) esc('  (nada casou - veja a lista completa acima)');
    for (const s of quentes) esc(`  >> "${s.texto}"  ->  ${s.href}`);

    tit('Texto integral do menu lateral');
    const menu = await page.evaluate(() => {
      const el = document.querySelector('#menu-servicos, #menuServicos, nav, .menu');
      return el ? el.innerText.replace(/\n{2,}/g, '\n').slice(0, 4000) : '(menu nao localizado)';
    }).catch(() => '(falha ao ler o menu)');
    esc(menu);

    tit('Portal novo: para onde aponta o botao do banner');
    const banner = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button'))
        .filter((el) => /portal Servi|Servi.os da Receita/i.test(el.innerText || ''))
        .map((el) => ({
          texto: (el.innerText || '').trim().slice(0, 80),
          href: el.getAttribute('href') || '',
          onclick: (el.getAttribute('onclick') || '').slice(0, 200),
        }));
    }).catch(() => []);
    for (const b of banner) esc(`  "${b.texto}" href=${b.href} onclick=${b.onclick}`);

    const pasta = path.join(saida, '_debug');
    await fs.mkdir(pasta, { recursive: true });
    await page.screenshot({ path: path.join(pasta, 'menu-aberto.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(pasta, 'menu-aberto.html'), await page.content(), 'utf8').catch(() => {});

    tit('FIM - janela aberta por 30s');
    await page.waitForTimeout(30000);
  } catch (erro) {
    esc('');
    esc(`ERRO: ${erro.message}`);
  } finally {
    const destino = path.join(saida, '_debug', 'mapa-menu.txt');
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, linhas.join('\n'), 'utf8');
    console.log(`\nRelatorio salvo em ${path.relative(RAIZ, destino)}`);
    await context.close().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
