/**
 * ARMAZENAMENTO NO GOOGLE DRIVE.
 *
 * O acervo local resolve o histórico, mas morre com a máquina: quem está em
 * casa não enxerga o PDF que o computador do escritório baixou. O Drive
 * resolve isso — e deixa o sistema apontar um link que abre o documento de
 * qualquer lugar.
 *
 * A ordem importa: GRAVA LOCAL PRIMEIRO, SOBE DEPOIS. Se a internet cair no
 * meio, o documento já está salvo e a subida entra na fila da próxima
 * execução. O contrário perderia o arquivo.
 *
 * DOIS MODOS DE ACESSO — a escolha depende do tipo de conta Google:
 *
 * 1. "oauth" (padrão) — autoriza uma vez, no navegador, com a conta do
 *    escritório. Os arquivos ficam no Drive DESSA conta e consomem o espaço
 *    dela. Funciona em conta Gmail comum.
 *
 * 2. "conta-de-servico" — chave de robô, sem navegador. Exige **Drive
 *    Compartilhado** (Google Workspace). Não funciona jogando numa pasta do
 *    "Meu Drive" de um Gmail comum: nesse caso o arquivo ficaria sob a conta
 *    de serviço, que não tem cota, e a subida falha com
 *    "Service Accounts do not have storage quota".
 *
 * Se você tem Workspace, prefira o modo 2 com um Drive Compartilhado: não
 * depende de token que expira nem de um humano reautorizar.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { google } from 'googleapis';

const ESCOPO = ['https://www.googleapis.com/auth/drive.file'];

const TIPO_MIME = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.json': 'application/json',
  '.png': 'image/png',
  '.xml': 'application/xml',
};

/** Cliente autenticado, pelo modo configurado. */
export async function autenticar(cfg) {
  const modo = cfg.modo ?? 'oauth';

  if (modo === 'conta-de-servico') {
    if (!cfg.chavePath) throw new Error('drive.chavePath não configurado (JSON da conta de serviço).');
    const auth = new google.auth.GoogleAuth({ keyFile: path.resolve(cfg.chavePath), scopes: ESCOPO });
    return google.drive({ version: 'v3', auth: await auth.getClient() });
  }

  if (modo === 'oauth') {
    const { clientId, clientSecret } = cfg;
    if (!clientId || !clientSecret) throw new Error('drive.clientId / drive.clientSecret não configurados.');
    const refresh = process.env[cfg.refreshEnv ?? 'DRIVE_REFRESH_TOKEN'] || cfg.refreshToken;
    if (!refresh) {
      throw new Error(
        'Sem token de acesso ao Drive. Rode `npm run drive-autorizar` uma vez e guarde o token que ele imprime.'
      );
    }
    const oauth = new google.auth.OAuth2(clientId, clientSecret, cfg.redirect ?? 'http://127.0.0.1:8123');
    oauth.setCredentials({ refresh_token: refresh });
    return google.drive({ version: 'v3', auth: oauth });
  }

  throw new Error(`drive.modo desconhecido: ${modo}`);
}

/** Opções comuns a toda chamada — Drive Compartilhado exige estes campos. */
function comuns(cfg) {
  return cfg.driveId
    ? { supportsAllDrives: true, includeItemsFromAllDrives: true, driveId: cfg.driveId, corpora: 'drive' }
    : { supportsAllDrives: true, includeItemsFromAllDrives: true };
}

/**
 * Garante que uma pasta existe sob `paiId` e devolve o id.
 * Cria só se não achar — assim rodar de novo não gera pasta duplicada.
 */
export async function garantirPasta(drive, cfg, nome, paiId) {
  const escapado = nome.replace(/'/g, "\\'");
  const busca = await drive.files.list({
    q: `name='${escapado}' and '${paiId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 1,
    ...comuns(cfg),
  });
  if (busca.data.files?.length) return busca.data.files[0].id;

  const nova = await drive.files.create({
    requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [paiId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return nova.data.id;
}

/**
 * Sobe um arquivo para <raiz>/<cnpj>/<tipo>/, criando as pastas se preciso.
 * Devolve { id, link }. O cache de pastas evita uma busca por arquivo.
 */
export class Drive {
  constructor(cfg) {
    this.cfg = cfg;
    this.drive = null;
    this.pastas = new Map();
  }

  async abrir() {
    this.drive = await autenticar(this.cfg);
    if (!this.cfg.pastaRaizId) {
      throw new Error('drive.pastaRaizId não configurado (id da pasta do acervo no Drive).');
    }
    return this;
  }

  async pastaDe(cnpj, tipo) {
    const chave = `${cnpj}/${tipo}`;
    if (this.pastas.has(chave)) return this.pastas.get(chave);

    let pai = this.pastas.get(cnpj);
    if (!pai) {
      pai = await garantirPasta(this.drive, this.cfg, cnpj, this.cfg.pastaRaizId);
      this.pastas.set(cnpj, pai);
    }
    const id = await garantirPasta(this.drive, this.cfg, tipo, pai);
    this.pastas.set(chave, id);
    return id;
  }

  async subir({ caminhoLocal, cnpj, tipo, nome }) {
    const pastaId = await this.pastaDe(cnpj, tipo);
    const ext = path.extname(nome).toLowerCase();
    const r = await this.drive.files.create({
      requestBody: { name: nome, parents: [pastaId] },
      media: { mimeType: TIPO_MIME[ext] ?? 'application/octet-stream', body: createReadStream(caminhoLocal) },
      fields: 'id,webViewLink,size',
      supportsAllDrives: true,
    });
    return { id: r.data.id, link: r.data.webViewLink, bytes: Number(r.data.size ?? 0) };
  }
}

export async function abrirDrive(cfg) {
  return new Drive(cfg).abrir();
}

/**
 * Autorização única (modo oauth). Abre um servidor local, imprime a URL para
 * colar no navegador e devolve o refresh token.
 *
 * O token NÃO é gravado em arquivo automaticamente: ele dá acesso ao Drive do
 * escritório e merece ir para variável de ambiente, não para um .json que
 * alguém commita sem perceber.
 */
export async function autorizar(cfg) {
  const redirect = cfg.redirect ?? 'http://127.0.0.1:8123';
  const porta = Number(new URL(redirect).port || 8123);
  const oauth = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, redirect);

  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // força vir o refresh_token, mesmo em reautorização
    scope: ESCOPO,
  });

  console.log('\nAbra este endereço no navegador, logado na conta do escritório:\n');
  console.log(url + '\n');

  const codigo = await new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      const c = new URL(req.url, redirect).searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        c
          ? '<h1>Autorizado</h1><p>Pode fechar esta aba e voltar ao terminal.</p>'
          : '<h1>Não veio o código</h1><p>Tente de novo.</p>'
      );
      servidor.close();
      c ? resolve(c) : reject(new Error('Autorização sem código.'));
    });
    servidor.listen(porta, '127.0.0.1');
    setTimeout(() => { servidor.close(); reject(new Error('Tempo esgotado esperando a autorização.')); }, 300000);
  });

  const { tokens } = await oauth.getToken(codigo);
  if (!tokens.refresh_token) {
    throw new Error('O Google não devolveu refresh_token. Revogue o acesso e autorize de novo.');
  }
  return tokens.refresh_token;
}
