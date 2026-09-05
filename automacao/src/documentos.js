/**
 * Leva o registro do acervo para o sistema.
 *
 * O PDF em si NÃO sobe: fica na máquina que rodou a coleta. O que sobe é a
 * FICHA do documento — que tipo é, de quando é, quantas versões existem, se
 * mudou desde a última coleta e onde está guardado. É o suficiente para a
 * equipe saber, de qualquer máquina, se o documento existe e se está velho,
 * sem que relatório de sigilo fiscal de terceiro atravesse a internet.
 *
 *   npm run documentos            -> imprime o que seria enviado
 *   npm run documentos -- --json  -> um arquivo por cliente, pronto para carregar
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarConfig } from './config.js';
import { abrirAcervo } from './acervo.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

const dias = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);

function main(argv) {
  return (async () => {
    const config = await carregarConfig();
    const acervo = await abrirAcervo(path.resolve(RAIZ, config.acervo ?? './acervo'));
    const porCliente = acervo.porCliente();
    const cnpjs = Object.keys(porCliente);

    if (!cnpjs.length) {
      console.log('Acervo vazio: nenhuma coleta rodou ainda.');
      console.log('Rode `npm run mapear` para calibrar os seletores, depois `npm start`.');
      return;
    }

    const saidaJson = argv.includes('--json');
    const pasta = path.join(RAIZ, 'dados', 'documentos');
    if (saidaJson) await fs.mkdir(pasta, { recursive: true });

    console.log(`\n${cnpjs.length} cliente(s) com documento guardado.\n`);

    for (const cnpj of cnpjs.sort()) {
      const tipos = porCliente[cnpj];
      const ficha = {};
      for (const [tipo, d] of Object.entries(tipos)) {
        ficha[tipo] = {
          rotulo: d.rotulo,
          em: d.coletadoEm.slice(0, 10),
          conferido: d.conferidoEm.slice(0, 10),
          idade: dias(d.conferidoEm),
          versoes: d.versoes,
          mudou: d.mudou,
          onde: d.caminho,
        };
      }
      const resumo = Object.entries(ficha)
        .map(([t, d]) => `${t}=${d.em}${d.mudou ? '*' : ''}`)
        .join('  ');
      console.log(`  ${cnpj}  ${resumo}`);

      if (saidaJson) {
        await fs.writeFile(
          path.join(pasta, `${cnpj}.json`),
          JSON.stringify(ficha, null, 1),
          'utf8'
        );
      }
    }

    console.log('\n* = o documento mudou em relação à coleta anterior.');
    if (saidaJson) console.log(`\nFichas em ${path.relative(RAIZ, pasta)}/ — carregue no sistema a partir daí.`);
    else console.log('\nUse --json para gerar os arquivos de carga.');
  })();
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
