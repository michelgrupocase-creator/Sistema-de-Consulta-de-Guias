/**
 * Painel de coleta: o botão que dispara o robô, com o andamento ao vivo.
 *
 * Fica fora do app.js de propósito. O painel original foi aprovado como está,
 * e a regra do projeto é não mexer no que já estava certo sem necessidade.
 * Esta é uma camada por cima, que conversa com o servidor.
 *
 * O que ele NÃO faz, e não deve fingir que faz: resolver o CAPTCHA. A Receita
 * exige um desafio visual a cada troca de empresa. O robô abre a janela nesta
 * máquina e para; a pessoa resolve; ele segue sozinho.
 */
(function () {
  let fonte = null;
  let rodando = false;

  function el(id) { return document.getElementById(id); }

  function montar() {
    const barra = document.createElement('div');
    barra.id = 'barra-coleta';
    barra.innerHTML = `
      <button id="btn-coleta" type="button" title="Consultar situação fiscal na Receita">
        <span class="pt"></span> Consultar Receita
      </button>
      <div id="painel-coleta" hidden>
        <header>
          <strong>Consulta de situação fiscal</strong>
          <button id="fechar-coleta" type="button" aria-label="Fechar">&times;</button>
        </header>
        <div class="corpo">
          <p class="aviso">
            A Receita pede um <b>CAPTCHA a cada empresa</b>. A janela do navegador
            abre <b>nesta máquina</b> e para em cada desafio — resolva e ele segue
            sozinho. Empresa cuja procuração não cobre o serviço é registrada como
            falha e pulada.
          </p>
          <label for="alvo-coleta">Quais empresas</label>
          <select id="alvo-coleta">
            <option value="selecionado">Só a empresa aberta na ficha</option>
            <option value="todos">A carteira inteira</option>
          </select>
          <div class="acoes">
            <button id="iniciar-coleta" type="button">Iniciar</button>
            <button id="parar-coleta" type="button" hidden>Parar</button>
          </div>
          <pre id="log-coleta" aria-live="polite"></pre>
        </div>
      </div>`;
    document.body.appendChild(barra);

    el('btn-coleta').addEventListener('click', () => {
      const p = el('painel-coleta');
      p.hidden = !p.hidden;
    });
    el('fechar-coleta').addEventListener('click', () => { el('painel-coleta').hidden = true; });
    el('iniciar-coleta').addEventListener('click', iniciar);
    el('parar-coleta').addEventListener('click', parar);
  }

  function escrever(texto) {
    const alvo = el('log-coleta');
    alvo.textContent += texto + '\n';
    alvo.scrollTop = alvo.scrollHeight;
  }

  /** Descobre o CNPJ da ficha aberta, lendo a própria tela. */
  function cnpjDaFicha() {
    const texto = document.body.innerText;
    const m = texto.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
    return m ? m[0].replace(/\D/g, '') : null;
  }

  async function iniciar() {
    const modo = el('alvo-coleta').value;
    let cnpjs = [];

    if (modo === 'selecionado') {
      const c = cnpjDaFicha();
      if (!c) { escrever('Abra a ficha de um cliente antes de consultar só uma empresa.'); return; }
      cnpjs = [c];
    } else {
      const { clientes } = await window.RADAR.api('/api/clientes');
      cnpjs = clientes.map((x) => String(x.j ?? '').replace(/\D/g, '')).filter((x) => x.length === 14);
      if (!confirm(`Consultar ${cnpjs.length} empresas? Você precisa ficar presente: há um CAPTCHA por empresa.`)) return;
    }

    try {
      await window.RADAR.api('/api/coleta', { method: 'POST', body: JSON.stringify({ cnpjs }) });
      el('log-coleta').textContent = '';
      escrever(`Iniciando ${cnpjs.length} empresa(s)...`);
      ligarEventos();
    } catch (e) {
      escrever(`Não deu para iniciar: ${e.message}`);
    }
  }

  async function parar() {
    try {
      await window.RADAR.api('/api/coleta/parar', { method: 'POST' });
      escrever('Interrompida por você.');
    } catch (e) { escrever(e.message); }
  }

  function estado(ligado) {
    rodando = ligado;
    el('iniciar-coleta').hidden = ligado;
    el('parar-coleta').hidden = !ligado;
    el('btn-coleta').classList.toggle('rodando', ligado);
  }

  function ligarEventos() {
    if (fonte) return;
    fonte = new EventSource('/api/coleta/eventos');
    fonte.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.tipo === 'linha') escrever(e.texto);
      else if (e.tipo === 'inicio') { estado(true); escrever(`Coleta iniciada por ${e.por}.`); }
      else if (e.tipo === 'estado') estado(e.rodando);
      else if (e.tipo === 'fim') { estado(false); escrever('— fim da coleta —'); }
      else if (e.tipo === 'acervo-atualizado') {
        escrever('Acervo sincronizado.');
        window.RADAR.banco.recarregar?.();
      }
    };
    fonte.onerror = () => { fonte.close(); fonte = null; setTimeout(ligarEventos, 5000); };
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (!document.getElementById('capa-login')) { montar(); ligarEventos(); }
    }, 600);
  });
})();
