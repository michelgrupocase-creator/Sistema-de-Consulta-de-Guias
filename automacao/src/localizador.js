/**
 * Traduz os candidatos de `seletores.js` em locators do Playwright e escolhe
 * o primeiro que estiver realmente visível na tela.
 */

/** Converte um candidato em texto ('css=...', 'texto=...') num locator. */
function paraLocator(page, candidato) {
  const separador = candidato.indexOf('=');
  const tipo = candidato.slice(0, separador);
  const valor = candidato.slice(separador + 1);

  switch (tipo) {
    case 'css':
      return page.locator(valor);
    case 'texto':
      return page.getByText(valor, { exact: false }).first();
    case 'label':
      return page.getByLabel(valor, { exact: false }).first();
    case 'papel': {
      const [papel, nome] = valor.split('|');
      return page.getByRole(papel, { name: nome, exact: false }).first();
    }
    default:
      throw new Error(`Candidato de seletor inválido: "${candidato}"`);
  }
}

/**
 * Tenta cada candidato e devolve o primeiro visível.
 * Devolve null se nenhum aparecer dentro do tempo — quem chama decide se isso
 * é um erro ou apenas "ainda não".
 */
export async function primeiroVisivel(page, candidatos, { timeoutMs = 10000 } = {}) {
  const limite = Date.now() + timeoutMs;

  // Varre a lista inteira repetidamente até o prazo, em vez de gastar o
  // timeout todo no primeiro candidato.
  do {
    for (const candidato of candidatos) {
      try {
        const locator = paraLocator(page, candidato);
        if (await locator.isVisible({ timeout: 500 })) {
          return { locator, candidato };
        }
      } catch {
        // Candidato inválido para esta página; tenta o próximo.
      }
    }
    await page.waitForTimeout(400);
  } while (Date.now() < limite);

  return null;
}

/** Igual ao anterior, mas falha alto quando nada é encontrado. */
export async function exigirVisivel(page, candidatos, rotulo, opcoes) {
  const achado = await primeiroVisivel(page, candidatos, opcoes);
  if (!achado) {
    throw new Error(
      `Não encontrei "${rotulo}" na tela. ` +
        `Provavelmente o layout mudou — ajuste os candidatos de "${rotulo}" em src/seletores.js. ` +
        `Foi salvo um print e o HTML da página em relatorios/_debug/ para ajudar.`
    );
  }
  return achado.locator;
}

/** Clica no primeiro candidato visível. */
export async function clicar(page, candidatos, rotulo, opcoes) {
  const locator = await exigirVisivel(page, candidatos, rotulo, opcoes);
  await locator.click();
  return locator;
}

/** Diz se algum dos candidatos está visível agora (checagem rápida). */
export async function existe(page, candidatos, timeoutMs = 2000) {
  return Boolean(await primeiroVisivel(page, candidatos, { timeoutMs }));
}
