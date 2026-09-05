import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  agruparPorCertificado,
  carregarConfig,
  carregarEmpresas,
  obterSenhas,
} from './config.js';
import { abrirNavegador, salvarDebug } from './navegador.js';
import { abrirAcervo } from './acervo.js';
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
async function processarEmpresa(page, empresa, config, pastaDoDia, pastaSaida, acervo, nomeCert) {
  const rotulo = `${formatarCnpj(empresa.cnpj)}${empresa.apelido ? ` (${empresa.apelido})` : ''}`;
  // Baixa para a pasta do dia e, em seguida, arquiva no acervo. A pasta do dia
  // continua existindo porque é onde se olha "o que rodou hoje"; o acervo é
  // onde se olha "o histórico deste cliente".
  const destino = path.join(pastaDoDia, nomeArquivo(empresa));

  for (let tentativa = 1; tentativa <= config.tentativasPorEmpresa; tentativa += 1) {
    try {
      await trocarPerfil(page, empresa.cnpj);
      const arquivo = await baixarRelatorioPendencias(
        page,
        destino,
        config.timeoutRelatorioMs
      );
      // Arquiva. Se o conteúdo for idêntico ao da última coleta, o acervo
      // registra "conferido de novo" em vez de duplicar o PDF — é assim que
      // o histórico passa a mostrar mudança em vez de repetição.
      const guardado = await acervo.guardar({
        cnpj: empresa.cnpj,
        tipo: 'situacao-fiscal',
        conteudo: await fs.readFile(arquivo),
        apelido: empresa.apelido ?? null,
        certificado: nomeCert,
      });

      const nota =
        guardado.estado === 'igual'
          ? `igual ao de ${guardado.desde.slice(0, 10)}`
          : guardado.mudou
            ? 'MUDOU desde a última coleta'
            : 'primeira coleta';
      console.log(`  OK      ${rotulo} -> ${nota}`);

      return {
        cnpj: somenteDigitos(empresa.cnpj),
        status: 'ok',
        arquivo,
        acervo: guardado.caminho,
        mudou: guardado.estado === 'novo' && guardado.mudou,
      };
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

/** Processa um grupo da carteira com um certificado só. */
async function rodarGrupo(nomeCert, empresas, config, senha, pastaDoDia, pastaSaida, acervo) {
  console.log(`\n--- Certificado "${nomeCert}" · ${empresas.length} empresa(s) ---`);

  const resultados = [];

  // Abrir o navegador pode falhar sozinho (certificado ausente, senha errada).
  // Se isso derrubasse a função, um certificado ruim levaria junto os grupos
  // que ainda nem tentaram rodar.
  let browser;
  let page;
  try {
    ({ browser, page } = await abrirNavegador(config, config.certificados[nomeCert], senha));
  } catch (erro) {
    console.error(`  FALHOU  sessão "${nomeCert}": ${erro.message}`);
    return empresas.map((e) => ({
      cnpj: somenteDigitos(e.cnpj),
      certificado: nomeCert,
      status: 'falha',
      erro: `Não abriu a sessão: ${erro.message}`,
    }));
  }

  try {
    console.log('Autenticando...');
    await entrar(page);
    console.log('Autenticado.\n');

    for (const [indice, empresa] of empresas.entries()) {
      console.log(`[${indice + 1}/${empresas.length}]`);
      const r = await processarEmpresa(page, empresa, config, pastaDoDia, pastaSaida, acervo, nomeCert);
      resultados.push({ ...r, certificado: nomeCert });

      // Ritmo humano entre empresas: rajada de requisições é o jeito mais
      // rápido de a sessão ser derrubada.
      if (indice < empresas.length - 1) await esperar(config.esperaEntreEmpresasMs);
    }
  } catch (erro) {
    // Um certificado que falha não pode levar os outros grupos junto.
    console.error(`Erro na sessão do certificado "${nomeCert}": ${erro.message}`);
    const print = await salvarDebug(page, `erro-${nomeCert}`, pastaSaida);
    if (print) console.error(`Debug: ${path.relative(RAIZ, print)}`);

    for (const e of empresas.slice(resultados.length)) {
      resultados.push({
        cnpj: somenteDigitos(e.cnpj),
        certificado: nomeCert,
        status: 'falha',
        erro: `Sessão interrompida: ${erro.message}`,
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return resultados;
}

async function main() {
  const config = await carregarConfig(RAIZ);
  const empresas = await carregarEmpresas(RAIZ, lerArgumento('cnpj'));

  if (empresas.length === 0) {
    console.log('Nenhuma empresa a processar (verifique empresas.json ou o filtro --cnpj).');
    return;
  }

  // Parte das procurações vai para o e-CNPJ do escritório e parte para o
  // e-CPF do responsável, então a carteira roda em sessões separadas — não dá
  // para trocar o certificado de uma conexão TLS já aberta.
  const grupos = agruparPorCertificado(empresas, config);

  // Todas as senhas antes de abrir qualquer navegador: numa execução agendada,
  // travar pedindo senha no meio da madrugada é o pior desfecho.
  const senhas = await obterSenhas(config, [...grupos.keys()]);

  const pastaSaida = path.resolve(RAIZ, config.saida);
  const pastaDoDia = path.join(pastaSaida, dataDeHoje());
  await fs.mkdir(pastaDoDia, { recursive: true });

  // O acervo é o que sobrevive: pasta por cliente, histórico por tipo.
  const acervo = await abrirAcervo(path.resolve(RAIZ, config.acervo ?? './acervo'));

  console.log(`\n${empresas.length} empresa(s) em ${grupos.size} certificado(s).`);
  console.log(`Saída: ${path.relative(RAIZ, pastaDoDia)}`);

  let resultados = [];
  for (const [nomeCert, doGrupo] of grupos) {
    resultados = resultados.concat(
      await rodarGrupo(nomeCert, doGrupo, config, senhas[nomeCert], pastaDoDia, pastaSaida, acervo)
    );
  }

  const ok = resultados.filter((r) => r?.status === 'ok').length;
  const falhas = resultados.filter((r) => r?.status === 'falha');

  await fs.writeFile(
    path.join(pastaDoDia, '_execucao.json'),
    JSON.stringify(
      {
        executadoEm: new Date().toISOString(),
        total: empresas.length,
        ok,
        certificados: [...grupos.keys()],
        resultados,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\nResumo: ${ok} de ${empresas.length} baixado(s).`);
  if (falhas.length > 0) {
    console.log('Falharam:');
    for (const f of falhas) {
      console.log(`  ${formatarCnpj(f.cnpj)} [${f.certificado}] - ${f.erro}`);
    }
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(`\n${erro.message}`);
  process.exitCode = 1;
});
