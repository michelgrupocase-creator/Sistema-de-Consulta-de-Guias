import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { URLS } from './seletores.js';

/**
 * Sobe o Chromium já com o certificado A1 do procurador anexado ao handshake
 * TLS. É isso que dispensa instalar o certificado no Windows: o Playwright
 * apresenta o .pfx direto para os hosts do gov.br.
 *
 * IMPORTANTE: só funciona com certificado A1 (arquivo .pfx/.p12). Certificado
 * A3 (token USB ou cartão) exige PIN a cada uso e não roda desassistido.
 */
export async function abrirNavegador(config, senhaCertificado) {
  const pfxPath = path.resolve(config.certificado.pfxPath);

  try {
    await fs.access(pfxPath);
  } catch {
    throw new Error(
      `Certificado não encontrado em "${pfxPath}". ` +
        `Ajuste "certificado.pfxPath" no config.json.`
    );
  }

  const browser = await chromium.launch({
    headless: config.headless,
    // Opcional: usar um Chromium já instalado em vez do baixado pelo Playwright.
    ...(config.navegadorPath ? { executablePath: config.navegadorPath } : {}),
    // O gov.br costuma barrar sessões óbvias de automação.
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    clientCertificates: URLS.origensCertificado.map((origin) => ({
      origin,
      pfxPath,
      passphrase: senhaCertificado,
    })),
    viewport: { width: 1440, height: 900 },
  });

  context.setDefaultTimeout(config.timeoutPadraoMs);
  context.setDefaultNavigationTimeout(config.timeoutPadraoMs);

  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Congela o estado da página quando algo dá errado: print + HTML.
 * É esse par de arquivos que permite consertar um seletor sem precisar
 * reproduzir o erro na mão.
 */
export async function salvarDebug(page, nome, pastaSaida) {
  const pasta = path.join(pastaSaida, '_debug');
  await fs.mkdir(pasta, { recursive: true });

  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(pasta, `${carimbo}_${nome}`);

  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    await fs.writeFile(`${base}.html`, await page.content(), 'utf8');
    return `${base}.png`;
  } catch {
    // Se a própria página morreu, não há o que salvar — não derruba o robô.
    return null;
  }
}
