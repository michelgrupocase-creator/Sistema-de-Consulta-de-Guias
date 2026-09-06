import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const PADRAO = {
  saida: './relatorios',
  headless: false,
  esperaEntreEmpresasMs: 4000,
  tentativasPorEmpresa: 2,
  timeoutPadraoMs: 60000,
  timeoutRelatorioMs: 240000,
};

async function lerJson(arquivo) {
  try {
    return JSON.parse(await fs.readFile(arquivo, 'utf8'));
  } catch (erro) {
    if (erro.code === 'ENOENT') return null;
    throw new Error(`Arquivo "${arquivo}" não é um JSON válido: ${erro.message}`);
  }
}

export async function carregarConfig(raiz) {
  const config = await lerJson(path.join(raiz, 'config.json'));
  if (!config) {
    throw new Error(
      'config.json não encontrado. Copie config.example.json para config.json e preencha.'
    );
  }
  return { ...PADRAO, ...config, certificados: normalizarCertificados(config) };
}

/**
 * A carteira costuma estar dividida: parte das procurações foi outorgada ao
 * e-CNPJ do escritório, parte ao e-CPF do responsável. Então "o certificado"
 * não existe — existe um conjunto deles, cada um cobrindo um pedaço da lista.
 *
 * Aceita os dois formatos:
 *   "certificados": { "escritorio": {...}, "responsavel": {...} }   (atual)
 *   "certificado":  { pfxPath, senhaEnv }                           (antigo)
 */
function normalizarCertificados(config) {
  if (config.certificados && Object.keys(config.certificados).length) {
    return config.certificados;
  }
  if (config.certificado) {
    return { padrao: config.certificado };
  }
  throw new Error(
    'Nenhum certificado no config.json. Declare "certificados": ' +
      '{ "escritorio": { "pfxPath": "...", "senhaEnv": "..." } }.'
  );
}

/** Nome do certificado usado quando a empresa não declara um. */
export function certificadoPadrao(config) {
  return config.certificadoPadrao ?? Object.keys(config.certificados)[0];
}

/**
 * Agrupa a carteira por certificado. Cada grupo vira uma sessão de navegador
 * própria: não dá para trocar o certificado de uma sessão TLS já aberta.
 */
export function agruparPorCertificado(empresas, config) {
  const padrao = certificadoPadrao(config);
  const grupos = new Map();

  for (const empresa of empresas) {
    const nome = empresa.certificado ?? padrao;
    if (!config.certificados[nome]) {
      throw new Error(
        `A empresa ${empresa.cnpj} aponta para o certificado "${nome}", ` +
          `que não existe no config.json. Disponíveis: ${Object.keys(config.certificados).join(', ')}.`
      );
    }
    if (!grupos.has(nome)) grupos.set(nome, []);
    grupos.get(nome).push(empresa);
  }

  return grupos;
}

export async function carregarEmpresas(raiz, filtroCnpj) {
  const empresas = await lerJson(path.join(raiz, 'empresas.json'));
  if (!Array.isArray(empresas) || empresas.length === 0) {
    throw new Error(
      'empresas.json vazio ou ausente. Copie empresas.example.json para empresas.json.'
    );
  }

  const validas = empresas.filter((e) => e && e.cnpj);
  if (!filtroCnpj) return validas;

  const alvo = String(filtroCnpj).replace(/\D/g, '');
  return validas.filter((e) => String(e.cnpj).replace(/\D/g, '') === alvo);
}

/** Pergunta a senha do certificado sem ecoar os caracteres na tela. */
function perguntarSenha(rotulo) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write(`Senha do certificado "${rotulo}": `);
    // Silencia o eco do readline a partir daqui: o prompt já foi impresso.
    rl._writeToOutput = () => {};

    rl.question('', (resposta) => {
      process.stdout.write('\n');
      rl.close();
      resolve(resposta);
    });
  });
}

/**
 * A senha nunca fica em arquivo: vem de variável de ambiente ou é digitada na
 * hora. Certificado e senha juntos num repositório é vazamento esperando data.
 */
export async function obterSenhaCertificado(config, nome) {
  const cert = config.certificados[nome];
  if (!cert) throw new Error(`Certificado "${nome}" não existe no config.json.`);
  return process.env[cert.senhaEnv] || perguntarSenha(nome);
}

/**
 * Colhe TODAS as senhas antes de abrir qualquer navegador. Com execução
 * agendada de madrugada, descobrir na terceira hora que falta uma senha é o
 * pior momento possível.
 */
export async function obterSenhas(config, nomes) {
  const senhas = {};
  for (const nome of nomes) senhas[nome] = await obterSenhaCertificado(config, nome);
  return senhas;
}
