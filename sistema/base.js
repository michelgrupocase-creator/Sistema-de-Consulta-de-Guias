/**
 * Banco do sistema. SQLite nativo do Node 22+ — sem dependência externa,
 * um arquivo só, backup é copiar o arquivo.
 *
 * Por que SQLite e não Postgres: o sistema roda numa máquina do escritório,
 * com cinco a dez pessoas. Postgres aqui seria infraestrutura para manter
 * sem problema para resolver.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const ARQUIVO = process.env.RADAR_DB ?? path.join(process.cwd(), 'dados', 'radar.db');
fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });

export const bd = new DatabaseSync(ARQUIVO);

bd.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS usuarios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT UNIQUE NOT NULL,
  nome      TEXT NOT NULL,
  senha     TEXT NOT NULL,
  papel     TEXT NOT NULL DEFAULT 'leitor',   -- admin | editor | leitor
  ativo     INTEGER NOT NULL DEFAULT 1,
  criadoEm  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id        TEXT PRIMARY KEY,
  cnpj      TEXT,
  dados     TEXT NOT NULL,                    -- JSON do cadastro (mesmo formato do painel)
  atualizadoEm TEXT NOT NULL,
  atualizadoPor TEXT
);

CREATE TABLE IF NOT EXISTS documentos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj      TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  caminho   TEXT NOT NULL,
  hash      TEXT NOT NULL,
  bytes     INTEGER NOT NULL,
  coletadoEm TEXT NOT NULL,
  mudou     INTEGER NOT NULL DEFAULT 0,
  resumo    TEXT                              -- JSON extraído do PDF
);
CREATE INDEX IF NOT EXISTS ix_doc_cnpj ON documentos(cnpj, tipo, coletadoEm);

CREATE TABLE IF NOT EXISTS auditoria (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  em        TEXT NOT NULL,
  usuario   TEXT,
  acao      TEXT NOT NULL,
  alvo      TEXT,
  detalhe   TEXT
);

CREATE TABLE IF NOT EXISTS coletas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  em        TEXT NOT NULL,
  usuario   TEXT,
  cnpj      TEXT,
  estado    TEXT NOT NULL,                    -- rodando | ok | falha
  via       TEXT,
  motivo    TEXT
);
`);

export function registrar(usuario, acao, alvo = null, detalhe = null) {
  bd.prepare(
    'INSERT INTO auditoria (em, usuario, acao, alvo, detalhe) VALUES (?, ?, ?, ?, ?)'
  ).run(new Date().toISOString(), usuario ?? null, acao, alvo, detalhe ? JSON.stringify(detalhe) : null);
}
