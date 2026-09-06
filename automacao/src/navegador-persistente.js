/**
 * O navegador do robô — aberto UMA VEZ, reusado sempre.
 *
 * Por que existe: cada execução do coletor subia e derrubava o próprio
 * Chromium. Fechar o navegador derruba a sessão do portal (cookie de sessão),
 * e o resultado era pedir login a cada rodada. Além de irritante, tornava a
 * carteira inteira inviável.
 *
 * Agora o navegador é um processo INDEPENDENTE, com depuração remota ligada.
 * O coletor se conecta a ele e nunca o fecha. A sessão sobrevive entre
 * execuções, e você loga uma vez por dia — não uma vez por empresa.
 *
 *   npm run navegador        abre (ou avisa que já está aberto)
 *   npm run navegador -- --fechar   fecha de propósito
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PERFIL = path.join(RAIZ, '.perfil-navegador');
export const PORTA_CDP = 9222;

/** Já existe navegador escutando na porta de depuração? */
export async function jaAberto() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Sobe o Chromium DESACOPLADO deste processo. É isso que faz o navegador
 * sobreviver quando a coleta termina: se ele fosse filho do coletor, morreria
 * junto e a sessão iria embora com ele.
 */
export async function abrir() {
  if (await jaAberto()) return { novo: false };

  fs.mkdirSync(PERFIL, { recursive: true });
  const exe = chromium.executablePath();
  const filho = spawn(exe, [
    `--remote-debugging-port=${PORTA_CDP}`,
    `--user-data-dir=${PERFIL}`,
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    'https://servicos.receitafederal.gov.br/servico/pendencias/#/analise-pendencias',
  ], { detached: true, stdio: 'ignore' });
  filho.unref();

  for (let i = 0; i < 40; i += 1) {
    if (await jaAberto()) return { novo: true };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('O navegador não respondeu na porta de depuração.');
}

/** Conecta no navegador que está aberto e devolve a aba de trabalho. */
export async function conectar() {
  await abrir();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORTA_CDP}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /receitafederal/i.test(p.url())) ?? ctx.pages()[0] ?? (await ctx.newPage());
  return { browser, ctx, page };
}

if (process.argv[1] && process.argv[1].endsWith('navegador-persistente.js')) {
  if (process.argv.includes('--fechar')) {
    try { execSync(`powershell -c "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${PORTA_CDP}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`); } catch { /* já fechado */ }
    console.log('Navegador fechado.');
  } else {
    const { novo } = await abrir();
    console.log(novo ? 'Navegador aberto. Faça o login uma vez — ele fica aberto.' : 'O navegador já estava aberto.');
  }
}
