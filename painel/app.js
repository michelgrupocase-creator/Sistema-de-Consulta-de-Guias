<script>
(() => {
  'use strict';

  /* ==========================================================
     Radar Fiscal CASE

     O cadastro vive no banco do artefato, compartilhado por todo
     mundo do escritório que abre a página — é o que faz o sistema
     funcionar de casa e de várias máquinas ao mesmo tempo.
     A planilha entrou uma vez, para não redigitar 112 cadastros;
     daqui para frente quem manda é este sistema.

     Regra de interação: todo número que a tela mostra é um
     caminho. Clicar num contador abre a lista exata daqueles
     clientes; clicar num cliente abre a ficha dele. Número que
     não leva a lugar nenhum é enfeite.
     ========================================================== */

  const HOJE = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  const DIA = 86400000;

  const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const dias = (v) => (ehData(v) ? Math.round((new Date(v + 'T00:00:00') - HOJE) / DIA) : null);

  function brData(v) {
    if (!ehData(v)) return v ?? '';
    const [a, m, d] = v.split('-');
    return `${d}/${m}/${a}`;
  }

  const digitos = (v) => String(v ?? '').replace(/\D/g, '');

  function brCnpj(j) {
    const d = digitos(j);
    if (d.length !== 14) return d || '';
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  // A planilha veio inteira em caixa alta. Numa tela de trabalho isso vira
  // ruído: quando tudo tem o mesmo peso, nada fica destacado.
  const MIUDAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);
  const SIGLAS = new Set(['ME', 'EPP', 'LTDA', 'MEI', 'EIRELI', 'SA', 'CIA', 'AL', 'BA', 'PE', 'SE', 'DP', 'CNPJ']);

  function capitular(v) {
    if (!v) return v;
    const t = String(v).trim();
    if (t !== t.toUpperCase()) return t; // já digitado normal: não mexe
    return t
      .toLowerCase()
      .split(/(\s+|[-/])/)
      .map((p, i) => {
        if (/^(\s+|[-/])$/.test(p)) return p;
        const alto = p.toUpperCase();
        if (SIGLAS.has(alto)) return alto;
        if (i > 0 && MIUDAS.has(p)) return p;
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join('');
  }

  const escapar = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CERTIDOES = ['Federal', 'FGTS', 'Prefeitura', 'Trabalhista', 'Estadual'];

  const PROCURACOES = [
    ['ecacE', 'e-CAC · escritório'],
    ['ecacR', 'e-CAC · responsável'],
    ['fgtsE', 'FGTS Digital · escritório'],
    ['fgtsR', 'FGTS Digital · responsável'],
    ['empWeb', 'Empregador Web'],
    ['conect', 'Conectividade Social'],
    ['gestao', 'Gestão de Demandas'],
    ['det', 'DET'],
  ];

  const SEM_VALIDADE = 'sem validade';

  // Documentos que o robô arquiva. O PDF fica na máquina que roda a coleta;
  // aqui guardamos a ficha dele — o que existe, de quando, e se mudou.
  const DOCUMENTOS = [
    ['situacao-fiscal', 'Relatório de Situação Fiscal'],
    ['cnd-federal', 'CND Federal (RFB/PGFN)'],
    ['cnd-fgts', 'CRF — FGTS'],
    ['cnd-trabalhista', 'CNDT — Trabalhista'],
    ['cnd-estadual', 'Certidão Estadual'],
    ['cnd-municipal', 'Certidão Municipal'],
    ['caixa-postal', 'Caixa Postal / DTE'],
  ];

  /* ---------- Leituras de estado ---------- */

  function procuracaoECac(c) {
    const cands = [
      { via: 'escritório', v: c.pg?.ecacE },
      { via: 'responsável', v: c.pg?.ecacR },
    ].filter((x) => x.v);

    if (!cands.length) return { estado: 'sem', texto: 'Sem procuração e-CAC' };
    const comData = cands.filter((x) => ehData(x.v));
    if (!comData.length) return { estado: 'sem-data', texto: 'Procuração sem validade registrada' };

    const melhor = comData.sort((a, b) => new Date(b.v) - new Date(a.v))[0];
    const d = dias(melhor.v);
    if (d < 0) return { estado: 'vencida', texto: `Procuração vencida em ${brData(melhor.v)}` };
    if (d <= 90) return { estado: 'vence', texto: `Procuração vence em ${d} dias` };
    return { estado: 'ok', texto: `Procuração até ${brData(melhor.v)}` };
  }

  function certificado(c) {
    if (!c.cv) return { estado: 'sem', texto: 'Sem certificado cadastrado' };
    const d = dias(c.cv);
    if (d === null) return { estado: 'sem', texto: String(c.cv) };
    if (d < 0) return { estado: 'vencido', texto: `Vencido em ${brData(c.cv)}` };
    if (d <= 90) return { estado: 'vence', texto: `Vence em ${d} dias` };
    return { estado: 'ok', texto: `Válido até ${brData(c.cv)}` };
  }

  // Certidão é uma data, ou o texto do impedimento, ou nada.
  // Certidão só existe depois que a consulta roda. Antes disso ela não é
  // "vazia" nem "vencida" — ela é DESCONHECIDA, e a tela precisa dizer isso.
  // O que veio da planilha foi descartado: eram datas soltas que ninguém
  // sabia se eram de emissão ou de validade, e ler errado apontava dezenas
  // de vencimentos falsos.
  function certidao(v) {
    if (!v) return { estado: 'vazio', texto: 'Não consultada' };
    if (ehData(v)) {
      const d = dias(v);
      if (d < 0) return { estado: 'vencida', texto: `Vencida em ${brData(v)}` };
      return { estado: 'valida', texto: `Válida até ${brData(v)}` };
    }
    return { estado: 'impedida', texto: String(v) };
  }

  // Situação fiscal vinda da consulta ao portal da Receita.
  // Só existe depois que o robô rodou. Sem consulta a tela diz que NÃO SABE —
  // nunca "em dia". Afirmar regularidade sem ter verificado é o erro que já
  // apontou dezenas de vencimentos falsos na primeira versão do painel.
  function fiscal(c) {
    const s = c.sf;
    if (!s) return { estado: 'vazio', texto: 'Não consultada', quando: null };
    if (s.resultado === 'sem-pendencia') {
      return { estado: 'limpa', texto: 'Sem pendência', quando: s.consultadoEm };
    }
    const partes = [];
    if (s.debitos) partes.push(`${s.debitos} débito${s.debitos > 1 ? 's' : ''}`);
    if (s.parcelasEmAtraso) partes.push(`${s.parcelasEmAtraso} parcela${s.parcelasEmAtraso > 1 ? 's' : ''} em atraso`);
    if (s.dividaAtiva) partes.push(`${s.dividaAtiva} na dívida ativa`);
    if (s.pgfn === 'com-pendencia' && !partes.length) partes.push('pendência na PGFN');
    return { estado: 'pendente', texto: partes.join(' · ') || 'Com pendência', quando: s.consultadoEm };
  }

  const seloFiscal = (c) => {
    const f = fiscal(c);
    if (f.estado === 'vazio') return '';
    const cls = f.estado === 'limpa' ? 'limpo' : 'nova';
    return `<div class="fiscal"><span class="selo ${cls}">${escapar(f.texto)}</span></div>`;
  };

  function estadoCliente(c) {
    const p = procuracaoECac(c);
    const cf = certificado(c);
    const cd = c.cd || [];
    const impedidas = cd.filter((v) => certidao(v).estado === 'impedida').length;
    const vencidas = cd.filter((v) => certidao(v).estado === 'vencida').length;

    if (p.estado === 'sem') return { chave: 'sem-procuracao', rotulo: 'Sem procuração' };
    if (p.estado === 'vencida' || cf.estado === 'vencido') return { chave: 'bloqueado', rotulo: 'Acesso bloqueado' };
    if (impedidas) return { chave: 'impedida', rotulo: `${impedidas} impedida${impedidas > 1 ? 's' : ''}` };
    if (p.estado === 'vence' || cf.estado === 'vence') return { chave: 'vence', rotulo: 'Vence em breve' };
    if (vencidas) return { chave: 'vencidas', rotulo: `${vencidas} vencida${vencidas > 1 ? 's' : ''}` };

    // Sem nenhuma certidão consultada não dá para dizer "em dia": seria
    // afirmar o que o sistema não sabe.
    const consultadas = cd.filter(Boolean).length;
    if (!consultadas) return { chave: 'sem-consulta', rotulo: 'Não consultado' };

    return { chave: 'ok', rotulo: 'Em dia' };
  }

  const COR = {
    'sem-procuracao': 'var(--nova)', bloqueado: 'var(--nova)', impedida: 'var(--falha)',
    vence: 'var(--falha)', vencidas: 'var(--linha)',
    'sem-consulta': 'var(--linha-2)', ok: 'var(--limpo)',
  };
  const CLASSE = {
    'sem-procuracao': 'nova', bloqueado: 'nova', impedida: 'falha',
    vence: 'falha', vencidas: 'conhecida',
    'sem-consulta': 'conhecida', ok: 'limpo',
  };

  /* ---------- Estado ---------- */

  let CLIENTES = [];
  let db = null;
  let vista = 'painel';
  let filtro = 'todos';
  let termo = '';
  let selecionado = null;

  const $ = (id) => document.getElementById(id);
  const conta = (fn) => CLIENTES.filter(fn).length;

  function calcular() {
    CLIENTES.forEach((c) => {
      c._p = procuracaoECac(c);
      c._cf = certificado(c);
      c._e = estadoCliente(c);
    });
    CLIENTES.sort((a, b) => (Number(a.id) || 1e9) - (Number(b.id) || 1e9));
  }

  /* ---------- Filtros ----------

     Cada contador da tela aponta para um filtro daqui. É isso que
     faz "18 sem procuração" virar a lista dos 18, em vez de um
     número que não leva a lugar nenhum. */

  const FILTROS = {
    todos: { rot: 'Todos', fn: () => true },
    acao: { rot: 'Exigem ação', fn: (c) => ['sem-procuracao', 'bloqueado', 'impedida', 'vence'].includes(c._e.chave) },
    'sem-procuracao': { rot: 'Sem procuração e-CAC', fn: (c) => c._e.chave === 'sem-procuracao' },
    certificado: { rot: 'Certificado com problema', fn: (c) => ['vencido', 'vence', 'sem'].includes(c._cf.estado) },
    certidoes: { rot: 'Certidão impedida', fn: (c) => (c.cd || []).some((v) => certidao(v).estado === 'impedida') },
    det: { rot: 'Sem DET', fn: (c) => !c.pg?.det },

    'proc-vencida': { rot: 'Procuração vencida', fn: (c) => c._p.estado === 'vencida' },
    'proc-vence': { rot: 'Procuração vence em 90 dias', fn: (c) => c._p.estado === 'vence' },
    'proc-sem-data': { rot: 'Procuração sem validade registrada', fn: (c) => c._p.estado === 'sem-data' },
    'cert-vencido': { rot: 'Certificado vencido', fn: (c) => c._cf.estado === 'vencido' },
    'cert-vence': { rot: 'Certificado vence em 90 dias', fn: (c) => c._cf.estado === 'vence' },
    'cert-sem': { rot: 'Sem certificado cadastrado', fn: (c) => c._cf.estado === 'sem' },
    'sem-responsavel': { rot: 'Sem responsável no Onvio', fn: (c) => !c.r },
    'ecac-escritorio': { rot: 'Procuração no e-CNPJ do escritório', fn: (c) => Boolean(c.pg?.ecacE) },
    'ecac-responsavel': { rot: 'Procuração no e-CPF do responsável', fn: (c) => Boolean(c.pg?.ecacR) },
    alcance: { rot: 'Alcançados pelo robô hoje', fn: (c) => c._e.chave !== 'sem-procuracao' },
  };

  // Um filtro por estado de cada certidão: clicar em "43 impedida" no
  // cartão do FGTS abre exatamente esses 43.
  CERTIDOES.forEach((nome, n) => {
    [['valida', 'com data válida'], ['impedida', 'impedida'], ['vencida', 'com data vencida'], ['vazio', 'em branco']].forEach(
      ([est, rot]) => {
        FILTROS[`cd-${n}-${est}`] = {
          rot: `${nome} ${rot}`,
          fn: (c) => certidao(c.cd?.[n]).estado === est,
        };
      }
    );
  });

  function passa(c) {
    if (termo) {
      const alvo = `${c.id ?? ''} ${c.n} ${c.j ?? ''} ${c.r ?? ''} ${c.ci ?? ''} ${c.rg ?? ''}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return (FILTROS[filtro] || FILTROS.todos).fn(c);
  }

  // Aplicar um filtro sempre leva para onde ele se lê: a lista de clientes.
  function aplicar(nome, ir = 'clientes') {
    filtro = FILTROS[nome] ? nome : 'todos';
    termo = '';
    $('busca').value = '';
    document.querySelectorAll('.acao[data-filtro]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.filtro === filtro))
    );
    if (ir && vista !== ir) irPara(ir);
    else desenhar();
    marcaFiltro();
  }

  // Filtro vindo de um contador não tem botão aceso na barra. Sem esta
  // marca o usuário vê a lista encolher e não sabe por quê.
  function marcaFiltro() {
    const alvo = $('marca-filtro');
    const naBarra = ['todos', 'acao', 'sem-procuracao', 'certificado', 'certidoes', 'det'];
    if (filtro === 'todos' || naBarra.includes(filtro)) {
      alvo.hidden = true;
      alvo.innerHTML = '';
      return;
    }
    alvo.hidden = false;
    alvo.innerHTML = `<span class="chip">${escapar(FILTROS[filtro].rot)}
      <button type="button" data-limpar aria-label="Limpar filtro">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button></span>`;
  }

  /* ---------- Banco ---------- */

  async function conectar() {
    db = await claude.use('db');
    if (!db) {
      $('estado-base').textContent = 'Cadastro indisponível';
      $('pulso').classList.add('frio');
      semBanco();
      return;
    }

    db.collection('clientes').onSnapshot(
      (snap) => {
        CLIENTES = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        calcular();
        if (selecionado && !CLIENTES.some((c) => c.id === selecionado)) selecionado = null;
        if (!selecionado && vista !== 'ficha') selecionado = CLIENTES[0]?.id ?? null;
        if (!selecionado && vista === 'ficha') irPara('clientes');
        $('estado-base').textContent = `${CLIENTES.length} clientes`;
        $('pulso').classList.remove('frio');
        desenhar();
      },
      (e) => {
        $('estado-base').textContent = 'Erro no cadastro';
        $('pulso').classList.add('frio');
        $('aviso-base').hidden = false;
        $('aviso-base').className = 'aviso-linha';
        $('aviso-base').textContent = `O cadastro parou de responder (${e.code}). Recarregue a página.`;
      }
    );
  }

  // Sem banco a página não inventa dado nem mostra cópia velha: ela diz
  // que não conseguiu abrir o cadastro. Tela que finge ter dado é pior
  // do que tela vazia.
  function semBanco() {
    document.querySelectorAll('.vista .coluna').forEach((col) => {
      col.innerHTML = `<div class="estado-vazio">
        <h3>Não foi possível abrir o cadastro</h3>
        <p>Esta cópia da página não recebeu acesso ao banco de dados. Abra o sistema pelo link original, entrando com a conta do escritório.</p>
      </div>`;
    });
  }

  async function gravar(id, dados) {
    if (!db) return { ok: false, msg: 'Sem conexão com o cadastro.' };
    try {
      await db.doc(`clientes/${id}`).set(dados);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: `Não gravou (${e.code}). Tente de novo.` };
    }
  }

  async function apagar(id) {
    if (!db) return { ok: false, msg: 'Sem conexão com o cadastro.' };
    try {
      await db.doc(`clientes/${id}`).delete();
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: `Não excluiu (${e.code}).` };
    }
  }

  /* ---------- Tabelas ---------- */

  function pontos(c) {
    return (c.cd || [])
      .map((v, n) => {
        const e = certidao(v);
        const cor = { valida: 'var(--limpo)', vencida: 'var(--linha)', impedida: 'var(--falha)', vazio: 'var(--linha-2)' }[e.estado];
        return `<span class="ponto" style="background:${cor}" title="${escapar(CERTIDOES[n] + ': ' + e.texto)}"></span>`;
      })
      .join('');
  }

  function celulasBase(c) {
    return `<td class="faixa" style="background:${COR[c._e.chave]}"></td>
      <td class="id">${escapar(c.id ?? '—')}</td>
      <td class="empresa">
        <div class="nome">${escapar(capitular(c.n))}</div>
        <div class="cnpj">${brCnpj(c.j) || 'sem CNPJ'}</div>
      </td>`;
  }

  // Nome de responsável e cidade são links de busca: clicar mostra a
  // carteira daquela pessoa ou daquela cidade.
  const elo = (v, busca) =>
    v ? `<button class="elo" type="button" data-buscar="${escapar(busca ?? v)}">${escapar(capitular(v))}</button>` : '<span class="nulo">—</span>';

  function desenharTabela() {
    const vis = CLIENTES.filter(passa);
    $('contagem-clientes').textContent = `${vis.length} de ${CLIENTES.length}`;
    $('linhas').innerHTML = vis.length
      ? vis
          .map(
            (c) => `<tr tabindex="0" data-id="${escapar(c.id)}" aria-selected="${c.id === selecionado}">
        ${celulasBase(c)}
        <td><span class="selo ${CLASSE[c._e.chave]}">${escapar(c._e.rotulo)}</span>${seloFiscal(c)}</td>
        <td><span class="pontos">${pontos(c)}</span></td>
        <td class="campo">${elo(c.r)}</td>
      </tr>`
          )
          .join('')
      : `<tr><td colspan="6" class="vazio">Nenhum cliente aqui.</td></tr>`;
  }

  function desenharClientes() {
    const vis = CLIENTES.filter(passa);
    $('cont-clientes-2').textContent = `${vis.length} de ${CLIENTES.length}`;
    $('linhas-clientes').innerHTML = vis.length
      ? vis
          .map(
            (c) => `<tr tabindex="0" data-id="${escapar(c.id)}" aria-selected="${c.id === selecionado}">
        ${celulasBase(c)}
        <td class="campo">${elo(c.ci)}</td>
        <td class="campo">${elo(c.rg)}</td>
        <td class="campo">${elo(c.r)}</td>
        <td><span class="selo ${{ ok: 'limpo', vence: 'falha', vencido: 'nova', sem: 'conhecida' }[c._cf.estado]}">${escapar(c._cf.texto)}</span></td>
      </tr>`
          )
          .join('')
      : `<tr><td colspan="7" class="vazio">Nenhum cliente aqui.</td></tr>`;
  }

  /* ---------- Ficha ---------- */

  const nulo = (t = 'não registrado') => `<span class="nulo">${t}</span>`;

  function valor(v) {
    if (v === null || v === undefined || v === '') return nulo();
    if (ehData(v)) return brData(v);
    return escapar(v);
  }

  function seloProc(v) {
    if (!v) return `<span class="selo conhecida">Não</span>`;
    if (!ehData(v)) return `<span class="selo falha">Sim · sem validade</span>`;
    const d = dias(v);
    if (d < 0) return `<span class="selo nova">Vencida em ${brData(v)}</span>`;
    if (d <= 90) return `<span class="selo falha">Vence em ${d} dias</span>`;
    return `<span class="selo limpo">Até ${brData(v)}</span>`;
  }

  // O acervo é do robô, e o robô ainda não rodou. Enquanto não houver
  // documento, esta seção diz isso — em vez de mostrar uma lista vazia que
  // se confunde com "não tem certidão".
  function documentosGuardados(c) {
    const acervo = c.doc || {};
    const guardados = DOCUMENTOS.filter(([k]) => acervo[k]);

    if (!guardados.length) {
      return `<p class="nota" style="margin:0">Nenhum documento arquivado ainda para este cliente.
        O acervo é alimentado pela coleta automática, que só roda depois de os seletores
        do portal serem calibrados (<code>npm run mapear</code>).</p>`;
    }

    const linhas = guardados
      .map(([k, rot]) => {
        const d = acervo[k];
        const idade = d.idade ?? null;
        const selo =
          d.mudou ? '<span class="selo nova">Mudou</span>'
          : idade === null ? ''
          : idade <= 7 ? '<span class="selo limpo">Atual</span>'
          : idade <= 30 ? `<span class="selo falha">${idade} dias</span>`
          : `<span class="selo nova">${idade} dias</span>`;
        // Com Drive, o documento é um link que abre o PDF de qualquer máquina.
        // Sem Drive, só dá para dizer onde ele está na máquina da coleta.
        const alvo = d.link
          ? `<a class="elo-doc" href="${escapar(d.link)}" target="_blank" rel="noopener">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
               Abrir PDF
             </a>`
          : d.pendente
            ? `<span class="selo falha">Só na máquina da coleta</span>`
            : `<span class="nulo" style="font-size:11px;font-family:var(--mono)">${escapar(d.onde || '')}</span>`;

        return `<dt>${escapar(d.rotulo || rot)}</dt>
          <dd>${brData(d.em)} ${selo}
            ${d.versoes > 1 ? `<span class="nulo"> · ${d.versoes} versões</span>` : ''}
            <div style="margin-top:3px">${alvo}</div>
          </dd>`;
      })
      .join('');

    const temLink = guardados.some(([k]) => acervo[k].link);
    return `<dl class="ficha">${linhas}</dl>
      <p class="nota">${
        temLink
          ? 'Os documentos ficam no Drive do escritório. Abrem de qualquer máquina, para quem tem acesso à pasta.'
          : 'Sem Drive configurado, o arquivo existe só na máquina que rodou a coleta.'
      }</p>`;
  }

  // A linha do tempo mostra MARCOS, não coletas: cada vez que o documento
  // mudou, e quantas conferências passaram sem mudar entre uma e outra.
  // "12 PDFs" é armazenamento; "mudou 3 vezes em 12 conferências" é informação.
  function linhaDoTempo(c) {
    const hist = c.hist || {};
    const tipos = Object.keys(hist).filter((k) => (hist[k] || []).length);
    if (!tipos.length) return '';

    const blocos = tipos
      .map((k) => {
        const marcos = hist[k];
        const rot = (DOCUMENTOS.find(([t]) => t === k) || [k, k])[1];
        const linhas = marcos
          .slice()
          .reverse()
          .map(
            (m) => `<li class="marco ${m.mudou ? 'mudou' : ''}">
              <span class="marco-data">${brData(String(m.em).slice(0, 10))}</span>
              <span class="marco-txt">
                ${m.mudou ? '<b>Mudou</b>' : 'Primeira coleta'}
                ${m.conferencias > 1 ? `<span class="nulo"> · conferido ${m.conferencias}×</span>` : ''}
              </span>
              ${m.link ? `<a class="elo-doc" href="${escapar(m.link)}" target="_blank" rel="noopener">Abrir</a>` : ''}
            </li>`
          )
          .join('');
        const mudancas = marcos.filter((m) => m.mudou).length;
        const conferencias = marcos.reduce((n, m) => n + m.conferencias, 0);
        return `<div class="trilha-doc">
          <p class="eyebrow">${escapar(rot)} — ${mudancas} mudança${mudancas === 1 ? '' : 's'} em ${conferencias} conferência${conferencias === 1 ? '' : 's'}</p>
          <ul class="marcos">${linhas}</ul>
        </div>`;
      })
      .join('');

    return `<section class="cartao">
      <div class="cartao-topo"><h2>Linha do tempo</h2><span class="dica">só o que mudou</span></div>
      <div class="cartao-corpo">${blocos}</div>
    </section>`;
  }

  function desenharFicha() {
    const alvo = $('ficha');
    const c = CLIENTES.find((x) => x.id === selecionado);

    if (!c) {
      alvo.innerHTML = `<div class="estado-vazio"><h3>Nenhum cliente aberto</h3>
        <p>Volte para a lista e clique num cliente.</p>
        <button class="botao" type="button" data-vista-ir="clientes">Ver clientes</button></div>`;
      return;
    }

    // Cada certidão é clicável: leva à lista de todos no mesmo estado.
    const cert = (c.cd || [null, null, null, null, null])
      .map((v, n) => {
        const e = certidao(v);
        const cls = { valida: 'limpo', vencida: 'nova', impedida: 'falha', vazio: 'conhecida' }[e.estado];
        return `<dt>${CERTIDOES[n]}</dt>
          <dd><button class="selo ${cls} clicavel" type="button" data-filtrar="cd-${n}-${e.estado}"
              title="Ver todos com ${escapar(CERTIDOES[n])} neste estado">${escapar(e.texto)}</button></dd>`;
      })
      .join('');

    // Situação fiscal: o que a consulta ao portal trouxe, com a data.
    // Sem consulta o bloco DIZ isso, em vez de sumir — sumir é pior, porque
    // ausência parece "está tudo bem".
    // (a variável não pode se chamar `f`: a ficha já usa `f` para a folha.)
    const sfic = fiscal(c);
    const blocoFiscal = `
        <section class="cartao">
          <div class="cartao-topo">
            <h2>Situação fiscal</h2>
            <span class="dica">${sfic.quando ? 'consultado em ' + brData(String(sfic.quando).slice(0, 10)) : 'nunca consultado'}</span>
          </div>
          <div class="cartao-corpo">
            <dl class="ficha">
              <dt>Resultado</dt>
              <dd><span class="selo ${sfic.estado === 'limpa' ? 'limpo' : sfic.estado === 'pendente' ? 'nova' : 'conhecida'}">${escapar(sfic.texto)}</span></dd>
              <dt>Parcelamento</dt>
              <dd>${c.sf ? (c.sf.emParcelamento ? '<span class="selo falha">Em parcelamento</span>' : 'Não') : nulo('não consultado')}</dd>
              <dt>Dívida ativa</dt>
              <dd>${c.sf ? (c.sf.dividaAtiva || 'Nenhuma') : nulo('não consultado')}</dd>
              <dt>Cadastro na Receita</dt>
              <dd>${c.sf?.situacaoCadastral ? escapar(c.sf.situacaoCadastral) : nulo('não consultado')}</dd>
            </dl>
          </div>
        </section>`;

    const proc = PROCURACOES.map(([k, rot]) => `<dt>${rot}</dt><dd>${seloProc(c.pg?.[k])}</dd>`).join('');
    const i = c.ins || {};
    const f = c.fo || {};

    alvo.innerHTML = `
      <div class="ficha-topo">
        <button class="voltar" type="button" data-vista-ir="clientes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Clientes
        </button>
        <span class="id-selo">#${escapar(c.id)}</span>
        <h1>${escapar(capitular(c.n))}</h1>
        <span class="acoes-ficha">
          <button class="botao vazado" type="button" data-copiar="ficha">Copiar ficha</button>
          <button class="botao vazado" type="button" data-excluir="${escapar(c.id)}">Excluir</button>
          <button class="botao" type="button" data-editar="${escapar(c.id)}">Editar</button>
        </span>
      </div>

      <div class="grade-ficha">
        <section class="cartao">
          <div class="cartao-topo"><h2>Identificação</h2><span class="dica">${escapar(c._e.rotulo)}</span></div>
          <div class="cartao-corpo">
            <dl class="ficha">
              <dt>CNPJ</dt><dd>${c.j ? `<button class="elo mono" type="button" data-copiar-texto="${brCnpj(c.j)}" title="Copiar CNPJ">${brCnpj(c.j)}</button>` : nulo()}</dd>
              <dt>Regime</dt><dd>${elo(c.rg)}</dd>
              <dt>Cidade</dt><dd>${elo(c.ci)}</dd>
              <dt>Responsável Onvio</dt><dd>${c.r ? elo(c.r) : `<button class="selo conhecida clicavel" type="button" data-filtrar="sem-responsavel">sem vínculo</button>`}</dd>
              <dt>Certificado digital</dt><dd><button class="selo ${{ ok: 'limpo', vence: 'falha', vencido: 'nova', sem: 'conhecida' }[c._cf.estado]} clicavel" type="button" data-filtrar="cert-${c._cf.estado}">${escapar(c._cf.texto)}</button></dd>
              <dt>Situação e-CAC</dt><dd>${escapar(c._p.texto)}</dd>
            </dl>
          </div>
        </section>

        <section class="cartao">
          <div class="cartao-topo"><h2>Inscrições e registros</h2></div>
          <div class="cartao-corpo">
            <dl class="ficha">
              <dt>CACEAL</dt><dd>${valor(i.ca)}</dd>
              <dt>Inscrição municipal</dt><dd>${valor(i.im)}</dd>
              <dt>NIRE</dt><dd>${valor(i.ni)}</dd>
              <dt>Arquivamento JUCEAL</dt><dd>${valor(i.aj)}</dd>
              <dt>Próximo arquivamento</dt><dd>${
                ehData(i.pa) && dias(i.pa) < 0 ? `<span class="selo nova">Vencido em ${brData(i.pa)}</span>` : valor(i.pa)
              }</dd>
            </dl>
          </div>
        </section>

        <section class="cartao">
          <div class="cartao-topo"><h2>Procurações</h2><span class="dica">8 serviços</span></div>
          <div class="cartao-corpo"><dl class="ficha">${proc}</dl></div>
        </section>

        <section class="cartao">
          <div class="cartao-topo"><h2>Folha</h2></div>
          <div class="cartao-corpo">
            <dl class="ficha">
              <dt>Responsável DP</dt><dd>${valor(capitular(f.rp))}</dd>
              <dt>Tem folha</dt><dd>${f.po ? 'Sim' : nulo('Não')}</dd>
              <dt>Colaboradores 2023</dt><dd>${f.c23 ?? nulo()}</dd>
              <dt>Colaboradores 2024</dt><dd>${f.c24 ?? nulo()}</dd>
              <dt>Pró-labore 2023</dt><dd>${f.p23 ?? nulo()}</dd>
              <dt>Pró-labore 2024</dt><dd>${f.p24 ?? nulo()}</dd>
            </dl>
          </div>
        </section>

${blocoFiscal}

        <section class="cartao">
          <div class="cartao-topo"><h2>Certidões</h2><span class="dica">clique para ver quem mais está assim</span></div>
          <div class="cartao-corpo"><dl class="ficha">${cert}</dl></div>
        </section>

        <section class="cartao">
          <div class="cartao-topo">
            <h2>Documentos guardados</h2>
            <span class="dica">acervo da coleta</span>
          </div>
          <div class="cartao-corpo">${documentosGuardados(c)}</div>
        </section>

        ${linhaDoTempo(c)}
      </div>`;
  }

  /* ---------- Formulário ---------- */

  const REGIMES = ['', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL', 'IMUNE/ISENTA', 'MEI', 'BAIXADA'];

  const CAMPOS_ID = [
    ['n', 'Razão social', 'text', 'largo'],
    ['j', 'CNPJ', 'text', ''],
    ['ci', 'Cidade', 'text', ''],
    ['rg', 'Regime', 'select', ''],
    ['r', 'Responsável Onvio', 'text', ''],
    ['cv', 'Certificado digital vence em', 'date', ''],
  ];
  const CAMPOS_INS = [
    ['i-ca', 'CACEAL', 'text'], ['i-im', 'Inscrição municipal', 'text'], ['i-ni', 'NIRE', 'text'],
    ['i-aj', 'Arquivamento JUCEAL', 'date'], ['i-pa', 'Próximo arquivamento', 'date'],
  ];
  const CAMPOS_FOLHA = [
    ['f-rp', 'Responsável DP', 'text'], ['f-c23', 'Colaboradores 2023', 'number'],
    ['f-c24', 'Colaboradores 2024', 'number'], ['f-p23', 'Pró-labore 2023', 'number'],
    ['f-p24', 'Pró-labore 2024', 'number'],
  ];

  function campo(nome, rot, tipo, val, extra = '') {
    const v = val === null || val === undefined ? '' : val;
    if (tipo === 'select') {
      return `<div class="campo-form ${extra}"><label for="f_${nome}">${rot}</label>
        <select id="f_${nome}" name="${nome}">
          ${REGIMES.map((r) => `<option value="${escapar(r)}"${r === v ? ' selected' : ''}>${r || '—'}</option>`).join('')}
        </select></div>`;
    }
    return `<div class="campo-form ${extra}"><label for="f_${nome}">${rot}</label>
      <input id="f_${nome}" name="${nome}" type="${tipo}" value="${escapar(v)}"></div>`;
  }

  // Procuração tem três estados, então tem dois campos: não tem; tem sem
  // validade registrada; tem até tal data.
  function campoProc(k, rot, v) {
    return `<div class="campo-form"><label>${rot}</label>
      <div class="par">
        <input type="checkbox" id="p_${k}" name="p-${k}"${v ? ' checked' : ''}>
        <label for="p_${k}">Possui</label>
        <input type="date" name="pd-${k}" value="${ehData(v) ? v : ''}" style="flex:1" aria-label="Validade de ${rot}">
      </div>
      <span class="ajuda">Marcado sem data = possui, validade não registrada.</span></div>`;
  }

  function abrirFormulario(id) {
    const c = id ? CLIENTES.find((x) => x.id === id) : null;
    const novo = !c;
    const i = c?.ins || {};
    const f = c?.fo || {};

    $('modal').innerHTML = `
      <div class="fundo-modal" data-fundo>
        <div class="modal" role="dialog" aria-modal="true" aria-label="${novo ? 'Novo cliente' : 'Editar cliente'}">
          <form id="form-cliente">
            <div class="modal-topo">
              <h2>${novo ? 'Novo cliente' : `Editar #${escapar(c.id)}`}</h2>
              <button class="fechar" type="button" data-fechar aria-label="Fechar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div class="modal-corpo">
              <div>
                <span class="eyebrow">Identificação</span>
                <div class="campos">
                  <div class="campo-form">
                    <label for="f_id">ID do sistema</label>
                    <input id="f_id" name="id" type="text" value="${escapar(c?.id ?? '')}"${novo ? '' : ' readonly'}>
                    <span class="ajuda">${novo ? 'Em branco = o sistema escolhe o próximo número.' : 'O ID não muda depois de criado.'}</span>
                  </div>
                  ${CAMPOS_ID.map(([k, rot, tipo, extra]) => campo(k, rot, tipo, c?.[k], extra)).join('')}
                </div>
              </div>

              <div>
                <span class="eyebrow">Inscrições e registros</span>
                <div class="campos">${CAMPOS_INS.map(([k, rot, tipo]) => campo(k, rot, tipo, i[k.slice(2)])).join('')}</div>
              </div>

              <div>
                <span class="eyebrow">Procurações</span>
                <div class="campos">${PROCURACOES.map(([k, rot]) => campoProc(k, rot, c?.pg?.[k])).join('')}</div>
              </div>

              <div>
                <span class="eyebrow">Folha</span>
                <div class="campos">
                  <div class="campo-form"><label>Tem folha</label>
                    <div class="par"><input type="checkbox" id="f_po" name="f-po"${f.po ? ' checked' : ''}><label for="f_po">Sim</label></div>
                  </div>
                  ${CAMPOS_FOLHA.map(([k, rot, tipo]) => campo(k, rot, tipo, f[k.slice(2)])).join('')}
                </div>
              </div>

              <div>
                <span class="eyebrow">Certidões</span>
                <div class="campos">
                  ${CERTIDOES.map(
                    (rot, n) => `<div class="campo-form"><label for="f_c${n}">${rot}</label>
                      <input id="f_c${n}" name="c-${n}" type="text" value="${escapar(c?.cd?.[n] ?? '')}">
                      <span class="ajuda">Normalmente preenchido pela consulta. Em branco = não consultada.</span></div>`
                  ).join('')}
                </div>
              </div>
            </div>

            <div class="modal-pe">
              <span class="msg" id="erro-form"></span>
              <span style="display:flex;gap:8px;margin-left:auto">
                <button class="botao vazado" type="button" data-fechar>Cancelar</button>
                <button class="botao" type="submit" id="salvar">${novo ? 'Criar cliente' : 'Salvar'}</button>
              </span>
            </div>
          </form>
        </div>
      </div>`;

    const form = $('form-cliente');
    form.querySelector('#f_n').focus();
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      salvar(form, c);
    });
  }

  const fecharModal = () => { $('modal').innerHTML = ''; };

  function proximoId() {
    const nums = CLIENTES.map((c) => Number(c.id)).filter(Number.isFinite);
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }

  async function salvar(form, antigo) {
    const d = new FormData(form);
    const txt = (k) => String(d.get(k) ?? '').trim();
    const num = (k) => (txt(k) === '' ? null : Number(txt(k)));
    const erro = $('erro-form');
    erro.textContent = '';

    const nome = txt('n');
    if (!nome) { erro.textContent = 'A razão social é obrigatória.'; form.querySelector('#f_n').focus(); return; }

    const id = txt('id') || proximoId();
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) { erro.textContent = 'O ID aceita só letras, números, ponto, traço e sublinhado.'; return; }
    if (!antigo && CLIENTES.some((c) => c.id === id)) { erro.textContent = `Já existe cliente com o ID ${id}.`; return; }

    const cnpj = digitos(txt('j'));
    if (cnpj && cnpj.length !== 14) { erro.textContent = 'O CNPJ precisa ter 14 dígitos, ou ficar em branco.'; return; }
    const rep = CLIENTES.find((c) => cnpj && digitos(c.j) === cnpj && c.id !== id);
    if (rep) { erro.textContent = `Este CNPJ já está no cliente #${rep.id}.`; return; }

    const pg = {};
    PROCURACOES.forEach(([k]) => {
      const tem = d.get('p-' + k) !== null;
      pg[k] = tem ? String(d.get('pd-' + k) ?? '').trim() || SEM_VALIDADE : null;
    });

    const dados = {
      n: nome,
      j: cnpj || null,
      ci: txt('ci') || null,
      rg: txt('rg') || null,
      r: txt('r') || null,
      cv: txt('cv') || null,
      pg,
      ins: { ca: txt('i-ca') || null, im: txt('i-im') || null, ni: txt('i-ni') || null, aj: txt('i-aj') || null, pa: txt('i-pa') || null },
      fo: { rp: txt('f-rp') || null, po: d.get('f-po') !== null, c23: num('f-c23'), c24: num('f-c24'), p23: num('f-p23'), p24: num('f-p24') },
      cd: CERTIDOES.map((_, n) => txt('c-' + n) || null),
    };

    const botao = $('salvar');
    botao.disabled = true;
    botao.textContent = 'Gravando…';

    const r = await gravar(id, dados);
    if (!r.ok) {
      erro.textContent = r.msg;
      botao.disabled = false;
      botao.textContent = antigo ? 'Salvar' : 'Criar cliente';
      return;
    }
    selecionado = id;
    fecharModal();
  }

  function confirmarExclusao(id) {
    const c = CLIENTES.find((x) => x.id === id);
    if (!c) return;
    $('modal').innerHTML = `
      <div class="fundo-modal" data-fundo>
        <div class="modal" role="dialog" aria-modal="true" style="width:min(440px,100%)">
          <div class="modal-topo">
            <h2>Excluir cliente</h2>
            <button class="fechar" type="button" data-fechar aria-label="Fechar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal-corpo">
            <p style="margin:0">Excluir <b>#${escapar(c.id)} ${escapar(capitular(c.n))}</b> do cadastro?</p>
            <p style="margin:0;color:var(--texto-2);font-size:12.5px">Some para todo o escritório e não tem como desfazer daqui.</p>
            <span class="msg" id="erro-excluir"></span>
          </div>
          <div class="modal-pe">
            <span style="display:flex;gap:8px;margin-left:auto">
              <button class="botao vazado" type="button" data-fechar>Cancelar</button>
              <button class="botao perigo" type="button" id="confirma-excluir">Excluir</button>
            </span>
          </div>
        </div>
      </div>`;

    $('confirma-excluir').addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      const r = await apagar(id);
      if (!r.ok) { $('erro-excluir').textContent = r.msg; ev.currentTarget.disabled = false; return; }
      if (selecionado === id) selecionado = null;
      fecharModal();
    });
  }

  /* ---------- Copiar ---------- */

  async function copiar(texto, botao) {
    const rot = botao.textContent;
    try {
      await navigator.clipboard.writeText(texto);
      botao.textContent = 'Copiado';
    } catch {
      botao.textContent = 'Não deu — copie na mão';
    }
    setTimeout(() => { botao.textContent = rot; }, 1600);
  }

  function fichaTexto(c) {
    const ou = (v) => (v === null || v === undefined || v === '' ? '—' : ehData(v) ? brData(v) : v);
    const i = c.ins || {}, f = c.fo || {};
    return [
      `#${c.id} ${capitular(c.n)}`,
      `CNPJ: ${c.j ? brCnpj(c.j) : '—'}`,
      `Regime: ${ou(c.rg)}`, `Cidade: ${ou(c.ci)}`,
      `Responsável Onvio: ${ou(c.r)}`, `Certificado digital: ${c._cf.texto}`,
      '', 'INSCRIÇÕES',
      `CACEAL: ${ou(i.ca)}`, `Inscrição municipal: ${ou(i.im)}`, `NIRE: ${ou(i.ni)}`,
      `Arquivamento JUCEAL: ${ou(i.aj)}`, `Próximo arquivamento: ${ou(i.pa)}`,
      '', 'PROCURAÇÕES',
      PROCURACOES.map(([k, rot]) => `${rot}: ${!c.pg?.[k] ? 'Não' : ou(c.pg[k])}`).join('\n'),
      '', 'FOLHA',
      `Responsável DP: ${ou(f.rp)}`, `Tem folha: ${f.po ? 'Sim' : 'Não'}`,
      `Colaboradores 2023/2024: ${ou(f.c23)} / ${ou(f.c24)}`,
      `Pró-labore 2023/2024: ${ou(f.p23)} / ${ou(f.p24)}`,
      '', 'CERTIDÕES',
      (c.cd || []).map((v, n) => `${CERTIDOES[n]}: ${certidao(v).texto}`).join('\n'),
    ].join('\n');
  }

  function tabelaTexto(lista) {
    const cab = ['ID', 'Cliente', 'CNPJ', 'Cidade', 'Regime', 'Responsável', 'Certificado', 'Situação'].concat(CERTIDOES);
    return [cab.join('\t')]
      .concat(
        lista.map((c) =>
          [c.id ?? '', capitular(c.n), c.j ? brCnpj(c.j) : '', capitular(c.ci) || '', capitular(c.rg) || '', capitular(c.r) || '', c._cf.texto, c._e.rotulo]
            .concat((c.cd || []).map((v) => certidao(v).texto))
            .join('\t')
        )
      )
      .join('\n');
  }

  /* ---------- Cartões ---------- */

  // Todo contador é um botão para a lista que ele conta.
  function contadores(itens) {
    return itens
      .map(
        ([n, rot, cls, f]) => `<button class="contador" type="button" data-filtrar="${f}">
          <span class="n n--${cls}">${n}</span><span class="rot">${rot}</span>
        </button>`
      )
      .join('');
  }

  function barra(rot, n, cls, f) {
    const total = CLIENTES.length || 1;
    return `<button class="medida" type="button" data-filtrar="${f}">
      <span class="trilha"><span class="preenche ${cls}" style="width:${Math.round((n / total) * 100)}%"></span></span>
      <span class="leg"><span>${rot}</span><b>${n}</b></span>
    </button>`;
  }

  // O cartão que justifica automatizar a coleta. Sem ele o sistema mostra
  // estado; com ele mostra movimento — e é movimento que exige ação.
  function desenharMudancas() {
    const alvo = $('mudancas');
    if (!alvo) return;

    // Cada cliente carrega as mudanças dele; aqui juntamos a carteira toda.
    const todas = [];
    CLIENTES.forEach((c) => {
      Object.entries(c.hist || {}).forEach(([tipo, marcos]) => {
        (marcos || []).forEach((m) => {
          if (m.mudou) todas.push({ c, tipo, ...m });
        });
      });
    });
    todas.sort((a, b) => String(b.em).localeCompare(String(a.em)));

    if (!todas.length) {
      alvo.innerHTML = `<p class="nota" style="margin:0">Nada mudou ainda — a coleta automática não rodou.
        Quando rodar, esta lista mostra o que virou pendência nova desde a conferência anterior,
        que é a pergunta que o escritório faz de manhã.</p>`;
      return;
    }

    alvo.innerHTML = `<ul class="mudancas">${todas
      .slice(0, 12)
      .map((m) => {
        const rot = (DOCUMENTOS.find(([t]) => t === m.tipo) || [m.tipo, m.tipo])[1];
        return `<li>
          <span class="quando">${brData(String(m.em).slice(0, 10))}</span>
          <button class="elo" type="button" data-abrir="${escapar(m.c.id)}">${escapar(capitular(m.c.n))}</button>
          <span class="nulo">${escapar(rot)}</span>
          ${m.link ? `<a class="elo-doc" href="${escapar(m.link)}" target="_blank" rel="noopener">Abrir</a>` : ''}
        </li>`;
      })
      .join('')}</ul>
      ${todas.length > 12 ? `<p class="nota">e mais ${todas.length - 12}.</p>` : ''}`;
  }

  function desenharPainel() {
    $('m-prioridade').innerHTML = contadores([
      [conta(FILTROS['sem-procuracao'].fn), 'Sem procuração e-CAC', 'alerta', 'sem-procuracao'],
      [conta(FILTROS['proc-vencida'].fn), 'Procuração vencida', 'alerta', 'proc-vencida'],
      [conta(FILTROS['proc-vence'].fn), 'Vence em 90 dias', 'aviso', 'proc-vence'],
      [conta(FILTROS['proc-sem-data'].fn), 'Sem validade registrada', 'zero', 'proc-sem-data'],
    ]);

    $('m-certificado').innerHTML = contadores([
      [conta(FILTROS['cert-vencido'].fn), 'Vencidos', 'alerta', 'cert-vencido'],
      [conta(FILTROS['cert-vence'].fn), 'Vencem em 90 dias', 'aviso', 'cert-vence'],
      [conta(FILTROS['cert-sem'].fn), 'Sem certificado', 'zero', 'cert-sem'],
      [conta(FILTROS['sem-responsavel'].fn), 'Sem responsável no Onvio', 'zero', 'sem-responsavel'],
    ]);

    $('m-alcance').innerHTML =
      barra('O robô alcança hoje', conta(FILTROS.alcance.fn), 'bom', 'alcance') +
      barra('Procuração no e-CNPJ do escritório', conta(FILTROS['ecac-escritorio'].fn), '', 'ecac-escritorio') +
      barra('Procuração no e-CPF do responsável', conta(FILTROS['ecac-responsavel'].fn), '', 'ecac-responsavel') +
      barra('Sem DET', conta(FILTROS.det.fn), 'alerta', 'det');

    document.querySelectorAll('.acao[data-filtro]').forEach((b) => {
      const alvo = b.querySelector('.qtd');
      if (alvo) alvo.textContent = conta(FILTROS[b.dataset.filtro].fn);
    });
  }

  function desenharCertidoes() {
    const vis = CLIENTES.filter(passa);
    const total = CLIENTES.length || 1;
    $('cont-certidoes').textContent = vis.length;

    $('resumo-certidoes').innerHTML = CERTIDOES.map((nome, n) => {
      const est = CLIENTES.map((c) => certidao(c.cd?.[n]).estado);
      const q = (e) => est.filter((x) => x === e).length;
      const consultadas = total - q('vazio');
      return `<section class="cartao">
        <div class="cartao-topo">
          <h2>${nome}</h2>
          <span class="dica">${consultadas ? `${consultadas} de ${total} consultadas` : 'nunca consultada'}</span>
        </div>
        <div class="cartao-corpo"><div class="contadores">${contadores([
          [q('valida'), 'Válida', 'bom', `cd-${n}-valida`],
          [q('impedida'), 'Impedida', 'alerta', `cd-${n}-impedida`],
          [q('vencida'), 'Vencida', 'aviso', `cd-${n}-vencida`],
          [q('vazio'), 'Não consultada', 'zero', `cd-${n}-vazio`],
        ])}</div></div>
      </section>`;
    }).join('');

    const cel = (v, n) => {
      const e = certidao(v);
      const cls = { valida: 'limpo', vencida: 'nova', impedida: 'falha', vazio: 'conhecida' }[e.estado];
      return `<td><span class="selo ${cls}">${escapar(e.texto)}</span></td>`;
    };

    $('linhas-certidoes').innerHTML = vis.length
      ? vis
          .map(
            (c) => `<tr tabindex="0" data-id="${escapar(c.id)}" aria-selected="${c.id === selecionado}">
        <td class="id">${escapar(c.id)}</td>
        <td class="empresa"><div class="nome">${escapar(capitular(c.n))}</div><div class="cnpj">${brCnpj(c.j) || 'sem CNPJ'}</div></td>
        ${(c.cd || [null, null, null, null, null]).map(cel).join('')}
      </tr>`
          )
          .join('')
      : `<tr><td colspan="7" class="vazio">Nenhum cliente aqui.</td></tr>`;
  }

  function desenharRelatorios() {
    const total = CLIENTES.length || 1;
    // A mesma cidade aparece com e sem UF; sem isto vira duas cidades.
    const semUf = (v) => v.replace(/\s*[-/]\s*[A-Z]{2}$/i, '').trim();
    const cidades = {}, regimes = {};
    CLIENTES.forEach((c) => {
      const ci = c.ci ? semUf(c.ci) : 'sem cidade';
      const rg = c.rg || 'sem regime';
      cidades[ci] = (cidades[ci] || 0) + 1;
      regimes[rg] = (regimes[rg] || 0) + 1;
    });
    const ord = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const linha = (rot, n) => `<button class="medida" type="button" data-buscar="${escapar(rot)}">
        <span class="trilha"><span class="preenche" style="width:${Math.round((n / total) * 100)}%"></span></span>
        <span class="leg"><span>${escapar(capitular(rot))}</span><b>${n} · ${Math.round((n / total) * 100)}%</b></span>
      </button>`;

    $('relatorios').innerHTML = `
      <section class="cartao">
        <div class="cartao-topo"><h2>Por regime</h2><span class="dica">${CLIENTES.length} clientes</span></div>
        <div class="cartao-corpo">${ord(regimes).map(([k, v]) => linha(k, v)).join('') || '<p class="nota">Sem dados.</p>'}</div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Por cidade</h2><span class="dica">8 maiores</span></div>
        <div class="cartao-corpo">${ord(cidades).map(([k, v]) => linha(k, v)).join('') || '<p class="nota">Sem dados.</p>'}</div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Listas de trabalho</h2><span class="dica">abre ou cola no Excel</span></div>
        <div class="cartao-corpo">
          <div class="listas">
            ${[
              ['sem-procuracao', 'Procuração a colher', 'alerta'],
              ['cert-vencido', 'Certificado a renovar', 'alerta'],
              ['det', 'DET a habilitar', 'aviso'],
              ['sem-responsavel', 'Sem responsável no Onvio', 'zero'],
            ]
              .map(
                ([f, rot, cor]) => `<div class="lista">
                  <button class="n n--${cor} elo-n" type="button" data-filtrar="${f}" title="Abrir esta lista">${conta(FILTROS[f].fn)}</button>
                  <button class="rot elo" type="button" data-filtrar="${f}">${rot}</button>
                  <button class="botao vazado" type="button" data-copiar="${f}">Copiar</button>
                </div>`
              )
              .join('')}
          </div>
          <p class="nota">O número abre a lista na tela. “Copiar” cola direto no Excel, uma coluna por campo.</p>
        </div>
      </section>`;
  }

  function desenharAjustes() {
    $('ajustes').innerHTML = `
      <section class="cartao">
        <div class="cartao-topo"><h2>Cadastro</h2><span class="dica">banco do sistema</span></div>
        <div class="cartao-corpo">
          <dl class="ficha">
            <dt>Clientes</dt><dd>${CLIENTES.length}</dd>
            <dt>Com CNPJ</dt><dd>${conta((c) => c.j)}</dd>
            <dt>Onde fica</dt><dd>banco do sistema, compartilhado</dd>
            <dt>Quem enxerga</dt><dd>quem abre esta página com conta do escritório</dd>
          </dl>
          <p class="nota">Alteração feita numa máquina aparece na hora nas outras. Não existe cópia local para ficar desatualizada.</p>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Procurações do escritório</h2><span class="dica">alcance</span></div>
        <div class="cartao-corpo">
          <dl class="ficha">
            <dt>e-CNPJ escritório</dt><dd>${conta(FILTROS['ecac-escritorio'].fn)} clientes</dd>
            <dt>e-CPF responsável</dt><dd>${conta(FILTROS['ecac-responsavel'].fn)} clientes</dd>
            <dt>Alcance do robô</dt><dd>${conta(FILTROS.alcance.fn)} de ${CLIENTES.length}</dd>
          </dl>
          <p class="nota">Os arquivos .pfx e as senhas ficam na máquina que roda a coleta, nunca nesta tela.</p>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Coleta automática</h2><span class="dica">não configurada</span></div>
        <div class="cartao-corpo">
          <dl class="ficha">
            <dt>Última coleta</dt><dd><span class="nulo">nunca</span></dd>
            <dt>Portal alvo</dt><dd>Minhas Dívidas e Pendências</dd>
            <dt>Seletores</dt><dd><span class="selo falha">a calibrar</span></dd>
          </dl>
          <p class="nota">Rode <code>npm run mapear</code> nos dois certificados: sem isso a coleta não acerta a tela nova da Receita.</p>
        </div>
      </section>`;
  }

  /* ---------- Navegação ---------- */

  const TELAS = {
    painel: () => { desenharPainel(); desenharMudancas(); desenharTabela(); },
    clientes: () => desenharClientes(),
    ficha: () => desenharFicha(),
    certidoes: () => desenharCertidoes(),
    guias: () => {},
    relatorios: () => desenharRelatorios(),
    ajustes: () => desenharAjustes(),
  };
  const COM_FILTRO = ['painel', 'clientes', 'certidoes'];

  const desenhar = () => TELAS[vista]();

  function irPara(nome) {
    if (!TELAS[nome]) return;
    vista = nome;
    document.querySelectorAll('.vista').forEach((v) =>
      v.dataset.vista === nome ? v.setAttribute('data-ativa', '') : v.removeAttribute('data-ativa')
    );
    document.querySelectorAll('.item[data-vista]').forEach((b) =>
      b.dataset.vista === nome ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')
    );
    const usa = COM_FILTRO.includes(nome);
    document.querySelector('.acoes').style.visibility = usa ? '' : 'hidden';
    document.querySelector('.busca').style.visibility = usa ? '' : 'hidden';
    desenhar();
  }

  /* ---------- Eventos ---------- */

  document.querySelectorAll('.item[data-vista]').forEach((b) =>
    b.addEventListener('click', () => irPara(b.dataset.vista))
  );

  document.querySelectorAll('.acao[data-filtro]').forEach((btn) =>
    btn.addEventListener('click', () => aplicar(btn.dataset.filtro, null))
  );

  $('busca').addEventListener('input', (ev) => {
    termo = ev.target.value.trim().toLowerCase();
    desenhar();
  });

  document.addEventListener('click', (ev) => {
    const t = ev.target;

    if (t.closest('[data-novo]')) return abrirFormulario(null);
    const ed = t.closest('[data-editar]');
    if (ed) return abrirFormulario(ed.dataset.editar);
    const ex = t.closest('[data-excluir]');
    if (ex) return confirmarExclusao(ex.dataset.excluir);
    if (t.closest('[data-fechar]') || t.hasAttribute('data-fundo')) return fecharModal();
    if (t.closest('[data-limpar]')) return aplicar('todos', null);

    // Contador, barra, selo: tudo leva à lista que ele representa.
    const fl = t.closest('[data-filtrar]');
    if (fl) return aplicar(fl.dataset.filtrar);

    // Nome de responsável, cidade, regime: busca por ele.
    const bs = t.closest('[data-buscar]');
    if (bs) {
      filtro = 'todos';
      termo = bs.dataset.buscar.toLowerCase();
      $('busca').value = bs.dataset.buscar;
      document.querySelectorAll('.acao[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filtro === 'todos')));
      marcaFiltro();
      if (vista !== 'clientes') irPara('clientes');
      else desenhar();
      return;
    }

    const ct = t.closest('[data-copiar-texto]');
    if (ct) return copiar(ct.dataset.copiarTexto, ct);

    const cp = t.closest('[data-copiar]');
    if (cp) {
      const k = cp.dataset.copiar;
      const c = CLIENTES.find((x) => x.id === selecionado);
      const texto = k === 'ficha' ? (c ? fichaTexto(c) : '') : tabelaTexto(CLIENTES.filter(FILTROS[k].fn));
      if (texto) copiar(texto, cp);
      return;
    }

    const ir = t.closest('[data-vista-ir]');
    if (ir) return irPara(ir.dataset.vistaIr);

    const ab = t.closest('[data-abrir]');
    if (ab) { selecionado = ab.dataset.abrir; return irPara('ficha'); }

    // Clicar num cliente, em qualquer tabela, salta para a ficha dele.
    const tr = t.closest('tr[data-id]');
    if (tr) {
      selecionado = tr.dataset.id;
      return irPara('ficha');
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $('modal').firstElementChild) return fecharModal();
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const tr = ev.target.closest?.('tr[data-id]');
    if (!tr) return;
    ev.preventDefault();
    selecionado = tr.dataset.id;
    irPara('ficha');
  });

  conectar();
})();
</script>
