import fs from 'node:fs/promises';
import path from 'node:path';
import { URLS, SELETORES } from './seletores.js';
import { clicar, exigirVisivel, existe, primeiroVisivel } from './localizador.js';

export function somenteDigitos(valor) {
  return String(valor).replace(/\D/g, '');
}

export function formatarCnpj(cnpj) {
  const d = somenteDigitos(cnpj).padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Autentica no e-CAC usando o certificado já anexado ao contexto do navegador.
 * Feito UMA vez por execução — a sessão é reaproveitada em todas as empresas.
 */
export async function entrar(page) {
  await page.goto(URLS.ecac, { waitUntil: 'domcontentloaded' });

  // Sessão pode já estar de pé (reexecução rápida, cookie ainda válido).
  if (await existe(page, SELETORES.marcadorLogado, 3000)) return;

  await clicar(page, SELETORES.botaoEntrarCertificado, 'botão de login por certificado', {
    timeoutMs: 20000,
  });

  // O gov.br faz vários redirecionamentos antes de devolver ao e-CAC.
  await exigirVisivel(page, SELETORES.marcadorLogado, 'confirmação de login', {
    timeoutMs: 90000,
  });
}

/**
 * Troca o perfil ativo para procurador do CNPJ informado.
 *
 * A conferência no fim não é paranoia: se a troca falhar silenciosamente, o
 * robô baixaria o relatório do procurador e salvaria com o nome da empresa —
 * um erro que só aparece semanas depois, quando alguém abre o PDF.
 */
export async function trocarPerfil(page, cnpj) {
  const digitos = somenteDigitos(cnpj);

  await clicar(page, SELETORES.abrirTrocaPerfil, 'link de alterar perfil', { timeoutMs: 20000 });
  await clicar(page, SELETORES.opcaoProcurador, 'opção "Procurador"', { timeoutMs: 15000 });

  const campo = await exigirVisivel(page, SELETORES.campoCnpjPerfil, 'campo de CNPJ', {
    timeoutMs: 15000,
  });
  await campo.fill('');
  await campo.type(digitos, { delay: 40 });

  await clicar(page, SELETORES.confirmarTrocaPerfil, 'botão de confirmar troca de perfil', {
    timeoutMs: 15000,
  });
  await page.waitForLoadState('domcontentloaded');

  if (await existe(page, SELETORES.erroSemProcuracao, 3000)) {
    throw new Error(
      `Sem procuração válida para ${formatarCnpj(digitos)} — ` +
        `peça ao cliente para cadastrar/renovar a procuração eletrônica no e-CAC.`
    );
  }

  const conteudo = await page.content();
  const encontrouCnpj =
    conteudo.includes(formatarCnpj(digitos)) || conteudo.includes(digitos);

  if (!encontrouCnpj) {
    throw new Error(
      `Troquei de perfil mas não confirmei ${formatarCnpj(digitos)} na tela. ` +
        `Abortei por segurança para não salvar o relatório da empresa errada.`
    );
  }
}

/**
 * Abre a tela das pendências.
 *
 * Desde 09/03/2026 o serviço mudou de lugar (virou "Minhas Dívidas e
 * Pendências", no Portal de Serviços), então tentamos as URLs conhecidas em
 * ordem e, se nenhuma servir, caímos na navegação por menu.
 */
async function abrirTelaSituacaoFiscal(page) {
  for (const url of URLS.pendencias) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (await existe(page, SELETORES.botaoGerarRelatorio, 3000)) return;
    if (await existe(page, SELETORES.linkConsultaPendencias, 2000)) {
      await clicar(page, SELETORES.linkConsultaPendencias, 'link das pendências', {
        timeoutMs: 10000,
      });
      if (await existe(page, SELETORES.botaoGerarRelatorio, 4000)) return;
    }
  }

  // Última tentativa: navegar pelos menus a partir de onde estivermos.
  await clicar(page, SELETORES.menuCertidoes, 'menu de dívidas/certidões', {
    timeoutMs: 15000,
  });
  await clicar(page, SELETORES.linkConsultaPendencias, 'link das pendências', {
    timeoutMs: 15000,
  });
}

/**
 * Espera o relatório assíncrono ficar pronto.
 * A Receita monta o PDF em segundo plano; enquanto o sinal de "processando"
 * estiver na tela, insistir é inútil — só esperar resolve.
 */
async function aguardarRelatorioPronto(page, timeoutMs) {
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    const pronto = await primeiroVisivel(page, SELETORES.linkPdfPronto, { timeoutMs: 2000 });
    if (pronto) return pronto.locator;

    if (await existe(page, SELETORES.erroSemProcuracao, 1000)) {
      throw new Error('A Receita recusou a consulta (procuração ausente ou vencida).');
    }

    const processando = await existe(page, SELETORES.sinalProcessando, 1000);
    if (!processando) {
      // Nem pronto, nem processando: a página foi para um estado inesperado.
      // Recarrega uma vez — o e-CAC às vezes devolve tela intermediária vazia.
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    await page.waitForTimeout(3000);
  }

  throw new Error(
    `O relatório não ficou pronto em ${Math.round(timeoutMs / 1000)}s. ` +
      `Aumente "timeoutRelatorioMs" no config.json se a Receita estiver lenta.`
  );
}

/**
 * Persiste o PDF, cobrindo os dois comportamentos possíveis do e-CAC:
 * download direto ou abertura do PDF numa aba nova.
 */
async function salvarPdf(page, locatorPdf, destino) {
  await fs.mkdir(path.dirname(destino), { recursive: true });

  const esperaDownload = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  const esperaAba = page.context().waitForEvent('page', { timeout: 20000 }).catch(() => null);

  await locatorPdf.click();
  const [download, abaNova] = await Promise.all([esperaDownload, esperaAba]);

  if (download) {
    await download.saveAs(destino);
    return destino;
  }

  if (abaNova) {
    await abaNova.waitForLoadState('domcontentloaded').catch(() => {});
    const url = abaNova.url();
    // Baixa pelo contexto autenticado — os cookies de sessão vão junto.
    const resposta = await page.context().request.get(url);
    if (!resposta.ok()) {
      await abaNova.close().catch(() => {});
      throw new Error(`Não consegui baixar o PDF (HTTP ${resposta.status()}).`);
    }
    await fs.writeFile(destino, await resposta.body());
    await abaNova.close().catch(() => {});
    return destino;
  }

  throw new Error('Cliquei para gerar o PDF mas nem download nem aba nova apareceram.');
}

/** Fluxo completo do relatório de pendências para o perfil já ativo. */
export async function baixarRelatorioPendencias(page, destino, timeoutRelatorioMs) {
  await abrirTelaSituacaoFiscal(page);
  await clicar(page, SELETORES.botaoGerarRelatorio, 'botão de gerar relatório', {
    timeoutMs: 20000,
  });

  const locatorPdf = await aguardarRelatorioPronto(page, timeoutRelatorioMs);
  return salvarPdf(page, locatorPdf, destino);
}
