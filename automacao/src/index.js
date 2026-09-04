import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarConfig, carregarEmpresas, obterSenhaCertificado } from './config.js';
import { abrirNavegador, salvarDebug } from './navegador.js';
import {
  baixarRelatorioPendencias,
  entrar,
  formatarCnpj,
  somenteDigitos,
  trocarPerfil,
} from './ecac.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lerArgumento(nome) {
  const indice = process.argv.indexOf(`--${nome}`);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

function dataDeHoje() {
  return new Date().toISOString().slice(0, 10);
}

function nomeArquivo(empresa) {
  const apelido = (empresa.apelido ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  const cnpj = somenteDigitos(empresa.cnpj);
  return apelido ? `${cnpj}_${apelido}.pdf` : `${cnpj}.pdf`;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Uma empresa: troca de perfil, gera e salva o relatório. Com retentativa. */
async function processarEmpresa(page, empresa, config, pastaDoDia, pastaSaida) {
  const rotulo = `${formatarCnpj(empresa.cnpj)}${empresa.apelido ? ` (${empresa.apelido})` : ''}`;
  const destino = path.join(pastaDoDia, nomeArquivo(empresa));

  for (let tentativa = 1; tentativa <= config.tentativasPorEmpresa; tentativa += 1) {
    try {
      await trocarPerfil(page, empresa.cnpj);
      const arquivo = await baixarRelatorioPendencias(
        page,
        destino,
        config.timeoutRelatorioMs
      );
      console.log(`  OK      ${rotulo} -> ${path.relative(RAIZ, arquivo)}`);
      return { cnpj: somenteDigitos(empresa.cnpj), status: 'ok', arquivo };
    } catch (erro) {
      const ultima = tentativa === config.tentativasPorEmpresa;
      const print = await salvarDebug(
        page,
        `${somenteDigitos(empresa.cnpj)}_tentativa${tentativa}`,
        pastaSaida
      );

      if (!ultima) {
        console.log(`  RETRY   ${rotulo}: ${erro.message}`);
        // Volta para um estado conhecido antes de tentar de novo.
        await entrar(page).catch(() => {});
        await esperar(config.esperaEntreEmpresasMs);
        continue;
      }

      console.log(`  FALHOU  ${rotulo}: ${erro.message}`);
      if (print) console.log(`          debug: ${path.relative(RAIZ, print)}`);
      return {
        cnpj: somenteDigitos(empresa.cnpj),
        status: 'falha',
        erro: erro.message,
        debug: print,
      };
    }
  }
}

async function main() {
  const config = await carregarConfig(RAIZ);
  const empresas = await carregarEmpresas(RAIZ, lerArgumento('cnpj'));

  if (empresas.length === 0) {
    console.log('Nenhuma empresa a processar (verifique empresas.json ou o filtro --cnpj).');
    return;
  }

  const senha = await obterSenhaCertificado(config);
  const pastaSaida = path.resolve(RAIZ, config.saida);
  const pastaDoDia = path.join(pastaSaida, dataDeHoje());
  await fs.mkdir(pastaDoDia, { recursive: true });

  console.log(`\n${empresas.length} empresa(s) na fila. Saída: ${path.relative(RAIZ, pastaDoDia)}\n`);

  const { browser, page } = await abrirNavegador(config, senha);
  const resultados = [];

  try {
    console.log('Autenticando com o certificado...');
    await entrar(page);
    console.log('Autenticado.\n');

    for (const [indice, empresa] of empresas.entries()) {
      console.log(`[${indice + 1}/${empresas.length}]`);
      resultados.push(await processarEmpresa(page, empresa, config, pastaDoDia, pastaSaida));

      // Ritmo humano entre empresas: rajada de requisições é o jeito mais
      // rápido de a sessão ser derrubada.
      if (indice < empresas.length - 1) await esperar(config.esperaEntreEmpresasMs);
    }
  } catch (erro) {
    console.error(`\nErro fatal: ${erro.message}`);
    const print = await salvarDebug(page, 'erro-fatal', pastaSaida);
    if (print) console.error(`Debug salvo em ${path.relative(RAIZ, print)}`);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }

  const ok = resultados.filter((r) => r?.status === 'ok').length;
  const falhas = resultados.filter((r) => r?.status === 'falha');

  await fs.writeFile(
    path.join(pastaDoDia, '_execucao.json'),
    JSON.stringify(
      { executadoEm: new Date().toISOString(), total: empresas.length, ok, resultados },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\nResumo: ${ok} de ${empresas.length} baixado(s).`);
  if (falhas.length > 0) {
    console.log('Falharam:');
    for (const f of falhas) console.log(`  ${formatarCnpj(f.cnpj)} - ${f.erro}`);
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
});
