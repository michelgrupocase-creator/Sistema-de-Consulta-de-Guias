/**
 * MAPEAMENTO SEM CERTIFICADO.
 *
 * Mesmo objetivo do `mapear.js`: descobrir como ficou o portal depois da
 * troca de 09/03/2026 ("Consulta Situacao Fiscal" -> "Minhas Dividas e
 * Pendencias"). A diferenca e que este NAO carrega o .pfx.
 *
 * Por que existe: calibrar seletor nao depende do certificado, depende de
 * estar logado. Aqui o navegador abre visivel, VOCE loga do jeito que
 * preferir (gov.br, certificado do Windows, app), e o script segue sozinho
 * assim que detecta a sessao. Assim ninguem precisa digitar senha de
 * certificado para descobrir o layout novo.
 *
 * Nao clica em nada que altere dado. So le, fotografa e testa seletores.
 *
 * Uso:  npm.cmd run mapear-manual
 *       npm.cmd run mapear-manual -- --espera 600
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { carregarConfig } from './config.js';
import { salvarDebug } from './navegador.js';
import { diagnosticar, primeiroVisivel } from './localizador.js';
import { SELETORES, URLS } from './seletores.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PALAVRAS_ALVO = [
  'divida', 'dívida', 'pendencia', 'pendência', 'situacao fiscal',
  'situação fiscal', 'certidao', 'certidão', 'perfil', 'procurador',
  'regulariz', 'debito', 'débito', 'caixa postal', 'consulta',
  'diagnostico', 'diagnóstico',
];

const linhas = [];

function esc(texto = '') {
  linhas.push(texto);
  console.log(texto);
}

function tit(texto) {
  esc('');
  esc('='.repeat(72));
  esc(texto);
  esc('='.repeat(72));
}

async function onde(page, etapa) {
  esc(`URL:    ${page.url()}`);
  esc(`Titulo: ${await page.title().catch(() => '(sem titulo)')}`);
  esc(`Print:  _debug/..._${etapa}.png`);
}

/** Lista tudo que e clicavel. E isto que revela o caminho novo. */
async function listar(page) {
  const itens = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(
      document.querySelectorAll('a, button, [role="button"], input[type="submit"]')
    )
      .filter(vis)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        texto: (el.innerText || el.value || el.getAttribute('aria-label') || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 90),
        href: el.getAttribute('href') || '',
        id: el.id || '',
      }))
      .filter((x) => x.texto.length > 1);
  }).catch(() => []);

  const rel = itens.filter((x) =>
    PALAVRAS_ALVO.some((p) => x.texto.toLowerCase().includes(p))
  );

  esc('');
  esc(`-- Links/botoes visiveis: ${itens.length} (${rel.length} relevantes)`);
  if (rel.length) {
    esc('   RELEVANTES:');
    for (const x of rel) {
      esc(`     [${x.tag}] "${x.texto}"${x.href ? ' -> ' + x.href : ''}${x.id ? ' #' + x.id : ''}`);
    }
  }
  esc('   TODOS (ate 80):');
  for (const x of itens.slice(0, 80)) {
    esc(`     [${x.tag}] "${x.texto}"${x.href ? ' -> ' + x.href : ''}`);
  }
  return rel;
}

/** Testa um grupo de candidatos e diz quais casaram. Nao clica. */
async function grupo(page, nome, candidatos) {
  const r = await diagnosticar(page, candidatos);
  const achou = r.filter((x) => x.visivel);
  esc(`  ${achou.length ? 'OK  ' : 'NAO '} ${nome}`);
  for (const item of r) {
    esc(`        ${item.visivel ? 'v' : '.'} ${item.candidato}${item.erro ? '  (erro: ' + item.erro + ')' : ''}`);
  }
  return achou.length > 0;
}

async function main() {
  const config = await carregarConfig(RAIZ);
  const saida = path.resolve(RAIZ, config.saida);

  const espera = process.argv.includes('--espera')
    ? Number(process.argv[process.argv.indexOf('--espera') + 1])
    : 420;

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: null });
  context.setDefaultTimeout(config.timeoutPadraoMs);
  const page = await context.newPage();

  tit('MAPEAMENTO SEM CERTIFICADO - ' + new Date().toLocaleString('pt-BR'));
  esc('Faca o login na janela que abriu, do jeito que preferir.');
  esc(`O script espera ate ${espera}s e segue sozinho quando detectar a sessao.`);
  esc('Nada aqui altera dado: so le, fotografa e testa seletores.');

  try {
    tit('ETAPA 1 - Tela de entrada');
    await page.goto(URLS.ecac, { waitUntil: 'domcontentloaded' })
      .catch((e) => esc(`Falha ao abrir ${URLS.ecac}: ${e.message}`));
    await page.waitForTimeout(2500);
    await onde(page, '01-entrada');
    await salvarDebug(page, '01-entrada', saida);
    await grupo(page, 'botaoEntrarCertificado', SELETORES.botaoEntrarCertificado);
    await listar(page);

    tit('ETAPA 2 - Aguardando o login');
    const limite = Date.now() + espera * 1000;
    let logado = false;
    while (Date.now() < limite) {
      if (await primeiroVisivel(page, SELETORES.marcadorLogado, { timeoutMs: 1500 })) {
        logado = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    esc(logado ? '>> Login detectado.' : '>> Nao detectei login; seguindo assim mesmo.');
    await page.waitForTimeout(2500);
    await onde(page, '02-pos-login');
    await salvarDebug(page, '02-pos-login', saida);

    await grupo(page, 'marcadorLogado', SELETORES.marcadorLogado);
    await grupo(page, 'abrirTrocaPerfil', SELETORES.abrirTrocaPerfil);
    await grupo(page, 'menuCertidoes', SELETORES.menuCertidoes);
    await grupo(page, 'linkConsultaPendencias', SELETORES.linkConsultaPendencias);
    const nav = await listar(page);
    if (nav.some((x) => /d[ií]vida/i.test(x.texto))) {
      esc('   >> ENCONTRADO item com "divida" no nome.');
    }

    tit('ETAPA 3 - URLs candidatas de pendencias');
    for (let i = 0; i < URLS.pendencias.length; i++) {
      const url = URLS.pendencias[i];
      esc('');
      esc(`--> candidata ${i + 1}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' })
        .catch((e) => esc(`   Falha: ${e.message}`));
      await page.waitForTimeout(3500);
      await onde(page, `03-url${i + 1}`);
      await salvarDebug(page, `03-url${i + 1}`, saida);
      await grupo(page, 'botaoGerarRelatorio', SELETORES.botaoGerarRelatorio);
      await grupo(page, 'sinalProcessando', SELETORES.sinalProcessando);
      await grupo(page, 'linkPdfPronto', SELETORES.linkPdfPronto);
      await listar(page);
    }

    tit('ETAPA 4 - Troca de perfil (procurador)');
    await page.goto(URLS.ecac, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
    const perfil = await primeiroVisivel(page, SELETORES.abrirTrocaPerfil, { timeoutMs: 6000 });
    if (!perfil) {
      esc('Nenhum candidato de "alterar perfil" apareceu. Os links acima dizem onde foi parar.');
      await salvarDebug(page, '04-sem-troca-perfil', saida);
    } else {
      esc(`Abrindo: ${perfil.candidato}`);
      await perfil.locator.click({ timeout: 8000 }).catch((e) => esc(`Clique falhou: ${e.message}`));
      await page.waitForTimeout(3500);
      await onde(page, '04-troca-perfil');
      await salvarDebug(page, '04-troca-perfil', saida);
      await grupo(page, 'opcaoProcurador', SELETORES.opcaoProcurador);
      await grupo(page, 'campoCnpjPerfil', SELETORES.campoCnpjPerfil);
      await grupo(page, 'confirmarTrocaPerfil', SELETORES.confirmarTrocaPerfil);
      await grupo(page, 'perfilAtivo', SELETORES.perfilAtivo);
      await listar(page);
    }

    tit('FIM - a janela fica aberta por 45s para conferencia');
    await page.waitForTimeout(45000);
  } catch (erro) {
    esc('');
    esc(`ERRO NO MAPEAMENTO: ${erro.message}`);
    await salvarDebug(page, 'erro-mapeamento', saida).catch(() => {});
  } finally {
    const destino = path.join(saida, '_debug', 'mapa-manual.txt');
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, linhas.join('\n'), 'utf8');
    console.log(`\nRelatorio salvo em ${path.relative(RAIZ, destino)}`);
    await browser.close().catch(() => {});
  }
}

main().catch((erro) => {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
});
