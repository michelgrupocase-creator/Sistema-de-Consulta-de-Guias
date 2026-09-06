/**
 * Cria ou atualiza um usuário pela linha de comando.
 * A senha é pedida com digitação oculta — nunca vai em argumento, que ficaria
 * no histórico do terminal e na lista de processos.
 *
 * Uso:  npm run usuario
 */
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { bd } from './base.js';

const perguntar = (texto, oculto = false) => new Promise((ok) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(texto);
  if (oculto) rl._writeToOutput = () => {};
  rl.question('', (r) => { if (oculto) process.stdout.write('\n'); rl.close(); ok(r.trim()); });
});

const email = (await perguntar('E-mail: ')).toLowerCase();
if (!email) { console.error('E-mail é obrigatório.'); process.exit(1); }

const nome = await perguntar('Nome: ');
const papel = (await perguntar('Papel (admin/editor/leitor) [leitor]: ')) || 'leitor';
if (!['admin', 'editor', 'leitor'].includes(papel)) { console.error('Papel inválido.'); process.exit(1); }

const senha = await perguntar('Senha (mín. 8): ', true);
if (senha.length < 8) { console.error('Senha curta demais.'); process.exit(1); }
const conf = await perguntar('Repita a senha: ', true);
if (senha !== conf) { console.error('As senhas não conferem.'); process.exit(1); }

const hash = bcrypt.hashSync(senha, 10);
const existe = bd.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);

if (existe) {
  bd.prepare('UPDATE usuarios SET nome = ?, senha = ?, papel = ?, ativo = 1 WHERE email = ?')
    .run(nome || email, hash, papel, email);
  console.log(`\nUsuário ${email} atualizado (${papel}).`);
} else {
  bd.prepare('INSERT INTO usuarios (email, nome, senha, papel, ativo, criadoEm) VALUES (?, ?, ?, ?, 1, ?)')
    .run(email, nome || email, hash, papel, new Date().toISOString());
  console.log(`\nUsuário ${email} criado (${papel}).`);
}
