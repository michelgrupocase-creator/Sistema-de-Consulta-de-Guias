/**
 * Servidor do Radar Fiscal CASE.
 *
 * Roda numa máquina do escritório. A equipe acessa pelo navegador, cada um
 * com sua conta. O robô de coleta é disparado por aqui — ninguém precisa
 * abrir terminal.
 *
 * Decisões que não devem ser desfeitas sem conversa:
 *
 * - A INTERFACE É A MESMA do painel já aprovado. Só a camada de dados mudou:
 *   onde havia o banco do artifact, agora há a API deste servidor. Refazer a
 *   tela seria jogar fora trabalho que já estava certo.
 *
 * - O ROBÔ RODA AQUI, no servidor, porque precisa de navegador de verdade e
 *   da sessão gov.br. Não há versão em nuvem disso: o CAPTCHA da troca de
 *   perfil exige uma pessoa. Quem clica em "Consultar" vê o progresso ao
 *   vivo e resolve o CAPTCHA na janela que abre NESTA máquina.
 *
 * - SIGILO FISCAL. O banco e os PDFs ficam no disco do escritório. Nada sai
 *   para nuvem de terceiro. É por isso que o sistema é local.
 */
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bd, registrar } from './base.js';
import { importarAcervo } from './acervo.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const AUTOMACAO = path.resolve(RAIZ, '..', 'automacao');
const PORTA = Number(process.env.PORTA ?? 4400);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.RADAR_SEGREDO ?? 'troque-este-segredo-no-servidor',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 },
}));

/* ---------- Autenticação e permissão ---------- */

const PODE_EDITAR = new Set(['admin', 'editor']);

function exigirLogin(req, res, prox) {
  if (!req.session?.usuario) return res.status(401).json({ erro: 'Faça login.' });
  prox();
}

function exigirEdicao(req, res, prox) {
  const u = req.session?.usuario;
  if (!u) return res.status(401).json({ erro: 'Faça login.' });
  if (!PODE_EDITAR.has(u.papel)) {
    return res.status(403).json({ erro: 'Seu acesso é somente leitura.' });
  }
  prox();
}

app.post('/api/entrar', (req, res) => {
  const { email, senha } = req.body ?? {};
  const u = bd.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(String(email ?? '').toLowerCase());
  // Mensagem única para e-mail errado e senha errada: dizer qual dos dois
  // falhou entrega a lista de quem tem conta.
  if (!u || !bcrypt.compareSync(String(senha ?? ''), u.senha)) {
    registrar(email, 'login-negado');
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }
  req.session.usuario = { id: u.id, email: u.email, nome: u.nome, papel: u.papel };
  registrar(u.email, 'login');
  res.json({ usuario: req.session.usuario });
});

app.post('/api/sair', (req, res) => {
  registrar(req.session?.usuario?.email, 'logout');
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/eu', (req, res) => {
  if (!req.session?.usuario) return res.status(401).json({ erro: 'sem sessão' });
  res.json({ usuario: req.session.usuario });
});

/* ---------- Clientes: o cadastro que a tela consome ---------- */

app.get('/api/clientes', exigirLogin, (req, res) => {
  const linhas = bd.prepare('SELECT id, dados FROM clientes').all();
  res.json({
    clientes: linhas.map((l) => ({ id: l.id, ...JSON.parse(l.dados) })),
  });
});

app.put('/api/clientes/:id', exigirEdicao, (req, res) => {
  const id = String(req.params.id);
  const dados = req.body ?? {};
  const agora = new Date().toISOString();
  bd.prepare(`
    INSERT INTO clientes (id, cnpj, dados, atualizadoEm, atualizadoPor)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cnpj = excluded.cnpj, dados = excluded.dados,
      atualizadoEm = excluded.atualizadoEm, atualizadoPor = excluded.atualizadoPor
  `).run(id, String(dados.j ?? '').replace(/\D/g, '') || null, JSON.stringify(dados), agora, req.session.usuario.email);
  registrar(req.session.usuario.email, 'cliente-gravado', id);
  res.json({ ok: true });
});

app.delete('/api/clientes/:id', exigirEdicao, (req, res) => {
  bd.prepare('DELETE FROM clientes WHERE id = ?').run(String(req.params.id));
  registrar(req.session.usuario.email, 'cliente-excluido', String(req.params.id));
  res.json({ ok: true });
});

/* ---------- Documentos coletados ---------- */

app.get('/api/documentos/:cnpj', exigirLogin, (req, res) => {
  const cnpj = String(req.params.cnpj).replace(/\D/g, '');
  res.json({
    documentos: bd.prepare(
      'SELECT id, tipo, hash, bytes, coletadoEm, mudou, resumo FROM documentos WHERE cnpj = ? ORDER BY coletadoEm DESC'
    ).all(cnpj).map((d) => ({ ...d, resumo: d.resumo ? JSON.parse(d.resumo) : null })),
  });
});

// Serve o PDF do acervo. Confere que o caminho resolvido continua DENTRO do
// acervo: sem isso, um id manipulado poderia ler qualquer arquivo do disco.
app.get('/api/documentos/:id/pdf', exigirLogin, (req, res) => {
  const d = bd.prepare('SELECT caminho FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!d) return res.status(404).send('Documento não encontrado.');
  const acervo = path.resolve(AUTOMACAO, 'acervo');
  const alvo = path.resolve(acervo, d.caminho);
  if (!alvo.startsWith(acervo + path.sep)) return res.status(400).send('Caminho inválido.');
  if (!fs.existsSync(alvo)) return res.status(404).send('Arquivo ausente no acervo.');
  res.type('application/pdf').sendFile(alvo);
});

/* ---------- Coleta: o botão que dispara o robô ---------- */

// Uma coleta por vez. O robô usa um perfil de navegador único e uma sessão
// gov.br única: duas execuções simultâneas brigariam pelo mesmo perfil e
// trocariam empresa uma da outra no meio do caminho.
let emAndamento = null;
const ouvintes = new Set();

function emitir(evento) {
  const linha = `data: ${JSON.stringify(evento)}\n\n`;
  for (const r of ouvintes) r.write(linha);
}

app.get('/api/coleta/eventos', exigirLogin, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ tipo: 'estado', rodando: Boolean(emAndamento) })}\n\n`);
  ouvintes.add(res);
  req.on('close', () => ouvintes.delete(res));
});

app.get('/api/coleta/estado', exigirLogin, (req, res) => {
  res.json({
    rodando: Boolean(emAndamento),
    desde: emAndamento?.desde ?? null,
    por: emAndamento?.por ?? null,
    alvo: emAndamento?.alvo ?? null,
  });
});

app.post('/api/coleta', exigirEdicao, (req, res) => {
  if (emAndamento) {
    return res.status(409).json({
      erro: `Já existe uma coleta rodando, iniciada por ${emAndamento.por}.`,
    });
  }

  const cnpjs = Array.isArray(req.body?.cnpjs)
    ? req.body.cnpjs.map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length === 14)
    : [];
  if (!cnpjs.length) return res.status(400).json({ erro: 'Informe ao menos um CNPJ válido.' });

  const usuario = req.session.usuario.email;
  const args = ['src/coletar.js', '--espera', String(req.body?.espera ?? 180)];
  if (cnpjs.length === 1) args.push('--cnpj', cnpjs[0]);
  else fs.writeFileSync(
    path.join(AUTOMACAO, 'empresas.json'),
    JSON.stringify(cnpjs.map((c) => ({ cnpj: c })), null, 2)
  );

  const filho = spawn(process.execPath, args, { cwd: AUTOMACAO });
  emAndamento = { proc: filho, por: usuario, desde: new Date().toISOString(), alvo: cnpjs };
  registrar(usuario, 'coleta-iniciada', cnpjs.join(','), { total: cnpjs.length });
  emitir({ tipo: 'inicio', por: usuario, total: cnpjs.length });

  const repassar = (buf) => {
    for (const linha of buf.toString('utf8').split('\n')) {
      const t = linha.trimEnd();
      if (t) emitir({ tipo: 'linha', texto: t });
    }
  };
  filho.stdout.on('data', repassar);
  filho.stderr.on('data', repassar);

  filho.on('close', (codigo) => {
    emitir({ tipo: 'fim', codigo });
    registrar(usuario, 'coleta-encerrada', cnpjs.join(','), { codigo });
    emAndamento = null;
    try { importarAcervo(); emitir({ tipo: 'acervo-atualizado' }); } catch { /* segue */ }
  });

  res.json({ ok: true, total: cnpjs.length });
});

app.post('/api/coleta/parar', exigirEdicao, (req, res) => {
  if (!emAndamento) return res.status(404).json({ erro: 'Nenhuma coleta rodando.' });
  emAndamento.proc.kill();
  registrar(req.session.usuario.email, 'coleta-interrompida');
  res.json({ ok: true });
});

/* ---------- Espelho do acervo ---------- */

app.post('/api/acervo/sincronizar', exigirEdicao, (req, res) => {
  res.json(importarAcervo());
});

/* ---------- Usuários (só admin) ---------- */

app.get('/api/usuarios', exigirLogin, (req, res) => {
  if (req.session.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Só administrador.' });
  res.json({ usuarios: bd.prepare('SELECT id, email, nome, papel, ativo, criadoEm FROM usuarios').all() });
});

app.post('/api/usuarios', exigirLogin, (req, res) => {
  if (req.session.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Só administrador.' });
  const { email, nome, senha, papel } = req.body ?? {};
  if (!email || !nome || !senha) return res.status(400).json({ erro: 'E-mail, nome e senha são obrigatórios.' });
  if (String(senha).length < 8) return res.status(400).json({ erro: 'A senha precisa de ao menos 8 caracteres.' });
  try {
    bd.prepare('INSERT INTO usuarios (email, nome, senha, papel, ativo, criadoEm) VALUES (?, ?, ?, ?, 1, ?)')
      .run(String(email).toLowerCase(), nome, bcrypt.hashSync(String(senha), 10),
           ['admin', 'editor', 'leitor'].includes(papel) ? papel : 'leitor', new Date().toISOString());
  } catch {
    return res.status(409).json({ erro: 'Já existe conta com esse e-mail.' });
  }
  registrar(req.session.usuario.email, 'usuario-criado', email);
  res.json({ ok: true });
});

/* ---------- Páginas ---------- */

app.use('/', express.static(path.join(RAIZ, 'publico')));

app.get('*', (req, res) => {
  res.sendFile(path.join(RAIZ, 'publico', 'index.html'));
});

app.listen(PORTA, () => {
  const n = bd.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  console.log('');
  console.log('  Radar Fiscal CASE');
  console.log(`  http://localhost:${PORTA}`);
  console.log(`  ${bd.prepare('SELECT COUNT(*) AS n FROM clientes').get().n} clientes | ${n} usuário(s)`);
  if (!n) console.log('  Nenhum usuário ainda: rode  npm run usuario');
  console.log('');
});
