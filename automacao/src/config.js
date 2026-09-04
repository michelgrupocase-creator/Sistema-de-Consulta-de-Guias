import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const PADRAO = {
  certificado: { pfxPath: './cert/certificado.pfx', senhaEnv: 'ECAC_CERT_SENHA' },
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
  return {
    ...PADRAO,
    ...config,
    certificado: { ...PADRAO.certificado, ...(config.certificado ?? {}) },
  };
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
function perguntarSenha() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write('Senha do certificado: ');
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
export async function obterSenhaCertificado(config) {
  const doAmbiente = process.env[config.certificado.senhaEnv];
  if (doAmbiente) return doAmbiente;
  return perguntarSenha();
}
