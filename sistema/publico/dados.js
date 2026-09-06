/**
 * Camada de dados do sistema.
 *
 * O painel foi escrito para o banco do artifact, com a API `claude.use('db')`.
 * Em vez de reescrever 1200 linhas de tela que já estavam certas, este arquivo
 * FINGE ser aquele banco e fala com o servidor do escritório por trás.
 *
 * A tela não sabe que mudou de banco — e é assim que deve continuar: se um dia
 * o armazenamento mudar de novo, muda só este arquivo.
 *
 * A API imitada é pequena:
 *   db.collection('clientes').onSnapshot(ok, erro)
 *   db.doc('clientes/<id>').set(obj)
 *   db.doc('clientes/<id>').delete()
 */
(function () {
  const INTERVALO = 20000; // recarrega sozinho: duas pessoas editando ao mesmo tempo

  async function api(caminho, opcoes = {}) {
    const r = await fetch(caminho, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opcoes,
    });
    if (r.status === 401) { mostrarLogin(); throw Object.assign(new Error('sem sessão'), { code: 401 }); }
    if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).erro ?? r.statusText), { code: r.status });
    return r.json();
  }

  function bancoFalso() {
    let aoAtualizar = null;
    let aoFalhar = null;
    let timer = null;

    async function puxar() {
      try {
        const { clientes } = await api('/api/clientes');
        aoAtualizar?.({ docs: clientes.map((c) => ({ id: c.id, data: () => c })) });
      } catch (e) {
        if (e.code !== 401) aoFalhar?.(e);
      }
    }

    return {
      collection(nome) {
        if (nome !== 'clientes') throw new Error(`Coleção desconhecida: ${nome}`);
        return {
          onSnapshot(ok, erro) {
            aoAtualizar = ok;
            aoFalhar = erro;
            puxar();
            clearInterval(timer);
            timer = setInterval(puxar, INTERVALO);
          },
        };
      },
      doc(caminho) {
        const id = String(caminho).split('/')[1];
        return {
          async set(dados) { await api(`/api/clientes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(dados) }); await puxar(); },
          async delete() { await api(`/api/clientes/${encodeURIComponent(id)}`, { method: 'DELETE' }); await puxar(); },
        };
      },
      recarregar: puxar,
    };
  }

  const banco = bancoFalso();
  window.RADAR = { api, banco };
  window.claude = {
    use: async (nome) => {
      if (nome !== 'db') return null;
      try { await api('/api/eu'); } catch { return null; }
      return banco;
    },
  };

  /* ---------- Tela de entrada ---------- */

  function mostrarLogin(mensagem = '') {
    if (document.getElementById('capa-login')) {
      if (mensagem) document.getElementById('login-erro').textContent = mensagem;
      return;
    }
    const capa = document.createElement('div');
    capa.id = 'capa-login';
    capa.innerHTML = `
      <div class="cartao-login">
        <div class="marca-login"></div>
        <h1>Radar Fiscal</h1>
        <p class="sub">Grupo Case &middot; acompanhamento fiscal da carteira</p>
        <form id="form-login" autocomplete="on">
          <label for="l-email">E-mail</label>
          <input id="l-email" name="email" type="email" required autocomplete="username" autofocus>
          <label for="l-senha">Senha</label>
          <input id="l-senha" name="senha" type="password" required autocomplete="current-password">
          <p id="login-erro" role="alert">${mensagem}</p>
          <button type="submit">Entrar</button>
        </form>
        <p class="rodape-login">Acesso restrito. Este sistema guarda dados sob sigilo fiscal.</p>
      </div>`;
    document.body.appendChild(capa);

    document.getElementById('form-login').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const botao = ev.target.querySelector('button');
      botao.disabled = true;
      botao.textContent = 'Entrando...';
      try {
        const r = await fetch('/api/entrar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('l-email').value,
            senha: document.getElementById('l-senha').value,
          }),
        });
        const corpo = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(corpo.erro ?? 'Não foi possível entrar.');
        capa.remove();
        location.reload();
      } catch (e) {
        document.getElementById('login-erro').textContent = e.message;
        botao.disabled = false;
        botao.textContent = 'Entrar';
      }
    });
  }

  window.mostrarLogin = mostrarLogin;

  // Se não há sessão, a tela de entrada aparece antes de qualquer dado.
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const { usuario } = await api('/api/eu');
      window.RADAR.usuario = usuario;
    } catch { /* mostrarLogin já foi chamado */ }
  });
})();
