<script>
  /* Base real, gerada de CONTROLE_CORRETO_5.xlsx por src/planilha.js.
     Nada aqui é número digitado à mão: todos os cartões são calculados
     a partir desta lista, então a tela nunca discorda da base. */
  const CLIENTES = __DADOS__;

  const HOJE = new Date('2026-09-04T00:00:00');
  const DIA = 86400000;

  const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const dias = (v) => (ehData(v) ? Math.round((new Date(v + 'T00:00:00') - HOJE) / DIA) : null);

  function brData(v) {
    if (!ehData(v)) return v ?? '—';
    const [a, m, d] = v.split('-');
    return `${d}/${m}/${a}`;
  }

  function brCnpj(j) {
    if (!j || j.length !== 14) return j || '—';
    return `${j.slice(0,2)}.${j.slice(2,5)}.${j.slice(5,8)}/${j.slice(8,12)}-${j.slice(12)}`;
  }

  /* ---------- Regras de estado ----------
     O sistema existe para separar o que exige ação hoje do que só precisa
     ser observado. Procuração é o que decide se conseguimos consultar o
     cliente; por isso ela manda no estado. */
  const CERTIDOES = ['Federal', 'FGTS', 'Prefeitura', 'Trabalhista', 'Estadual'];

  function procuracaoECac(c) {
    // Retorna a melhor situação entre os dois certificados.
    const cands = [
      { via: 'escritório', v: c.pe },
      { via: 'responsável', v: c.pr },
    ].filter((x) => x.v);

    if (!cands.length) return { estado: 'sem', texto: 'Sem procuração e-CAC' };

    const comData = cands.filter((x) => ehData(x.v));
    if (!comData.length) return { estado: 'sem-data', texto: 'Procuração sem validade registrada', via: cands[0].via };

    const melhor = comData.sort((a, b) => new Date(b.v) - new Date(a.v))[0];
    const d = dias(melhor.v);
    if (d < 0) return { estado: 'vencida', texto: `Procuração vencida em ${brData(melhor.v)}`, via: melhor.via, validade: melhor.v };
    if (d <= 90) return { estado: 'vence', texto: `Procuração vence em ${d} dias`, via: melhor.via, validade: melhor.v };
    return { estado: 'ok', texto: `Procuração até ${brData(melhor.v)}`, via: melhor.via, validade: melhor.v };
  }

  function certificado(c) {
    if (!c.cv) return { estado: 'sem', texto: 'Sem certificado cadastrado' };
    const d = dias(c.cv);
    if (d < 0) return { estado: 'vencido', texto: `Vencido em ${brData(c.cv)}`, dias: d };
    if (d <= 90) return { estado: 'vence', texto: `Vence em ${d} dias`, dias: d };
    return { estado: 'ok', texto: `Válido até ${brData(c.cv)}`, dias: d };
  }

  /** Uma certidão é: válida (data futura), vencida (data passada) ou impedida (texto). */
  function certidao(v) {
    if (v === null || v === undefined) return { estado: 'vazio', texto: 'Não informado' };
    if (ehData(v)) {
      const d = dias(v);
      return d < 0
        ? { estado: 'vencida', texto: `Vencida em ${brData(v)}`, dias: d }
        : { estado: 'valida', texto: `Válida até ${brData(v)}`, dias: d };
    }
    return { estado: 'impedida', texto: String(v) };
  }

  /** Estado geral do cliente = o pior entre procuração, certificado e certidões. */
  function estadoCliente(c) {
    const p = procuracaoECac(c);
    const cf = certificado(c);
    const impedidas = c.cd.filter((v) => certidao(v).estado === 'impedida').length;
    const vencidas = c.cd.filter((v) => certidao(v).estado === 'vencida').length;

    if (p.estado === 'sem') return { chave: 'sem-procuracao', rotulo: 'Sem procuração', glifo: '■' };
    if (p.estado === 'vencida' || cf.estado === 'vencido') return { chave: 'bloqueio', rotulo: 'Acesso bloqueado', glifo: '■' };
    if (p.estado === 'vence' || cf.estado === 'vence') return { chave: 'vencendo', rotulo: 'Vence em breve', glifo: '◆' };
    if (impedidas > 0) return { chave: 'impedida', rotulo: `${impedidas} impedida${impedidas > 1 ? 's' : ''}`, glifo: '◆' };
    if (vencidas > 0) return { chave: 'vencida', rotulo: `${vencidas} vencida${vencidas > 1 ? 's' : ''}`, glifo: '▬' };
    return { chave: 'ok', rotulo: 'Em dia', glifo: '●' };
  }

  const COR = {
    ok: 'var(--limpo)', vencida: 'var(--linha)', impedida: 'var(--falha)',
    vencendo: 'var(--falha)', bloqueio: 'var(--nova)', 'sem-procuracao': 'var(--nova)',
  };
  const CLASSE = {
    ok: 'limpo', vencida: 'conhecida', impedida: 'falha',
    vencendo: 'falha', bloqueio: 'nova', 'sem-procuracao': 'nova',
  };

  // Pré-calcula tudo uma vez.
  CLIENTES.forEach((c) => {
    c._p = procuracaoECac(c);
    c._cf = certificado(c);
    c._e = estadoCliente(c);
  });

  /* ---------- Filtros ---------- */
  let filtro = 'todos';
  let termo = '';
  let selecionado = CLIENTES[0]?.id ?? null;

  const FILTROS = {
    todos: () => true,
    acao: (c) => ['sem-procuracao', 'bloqueio', 'vencendo'].includes(c._e.chave),
    'sem-procuracao': (c) => c._e.chave === 'sem-procuracao',
    certificado: (c) => c._cf.estado === 'vencido' || c._cf.estado === 'vence',
    certidoes: (c) => c.cd.some((v) => certidao(v).estado === 'impedida'),
    det: (c) => !c.det,
  };

  function passa(c) {
    if (termo) {
      const alvo = `${c.id ?? ''} ${c.n} ${c.j ?? ''} ${c.r ?? ''} ${c.ci ?? ''}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return (FILTROS[filtro] ?? FILTROS.todos)(c);
  }

  /* ---------- Tabela ---------- */
  const tbody = document.getElementById('linhas');
  const detalhe = document.getElementById('detalhe');

  function pontosCertidoes(c) {
    return c.cd
      .map((v, i) => {
        const e = certidao(v).estado;
        const cor = { valida: 'var(--limpo)', vencida: 'var(--linha)', impedida: 'var(--falha)', vazio: 'var(--papel-3)' }[e];
        return `<span class="ponto" style="background:${cor}" title="${CERTIDOES[i]}: ${certidao(v).texto}"></span>`;
      })
      .join('');
  }

  function desenharTabela() {
    const visiveis = CLIENTES.filter(passa);
    document.getElementById('contagem-clientes').textContent = `${visiveis.length} de ${CLIENTES.length}`;

    tbody.innerHTML = visiveis
      .map(
        (c) => `<tr tabindex="0" role="button" data-id="${c.id}" aria-selected="${c.id === selecionado}">
        <td class="faixa" style="background:${COR[c._e.chave]}"></td>
        <td class="id">${c.id ?? '—'}</td>
        <td class="empresa"><div class="nome">${c.n}</div><div class="cnpj">${brCnpj(c.j)}</div></td>
        <td><span class="selo ${CLASSE[c._e.chave]}"><span class="glifo" aria-hidden="true">${c._e.glifo}</span>${c._e.rotulo}</span></td>
        <td class="pontos">${pontosCertidoes(c)}</td>
        <td class="quando">${c.r ?? '—'}</td>
      </tr>`
      )
      .join('');

    if (!visiveis.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="vazio">Nenhum cliente neste filtro ou nesta busca.</td></tr>';
    }
  }

  /* ---------- Detalhe ---------- */
  function desenharDetalhe() {
    const c = CLIENTES.find((x) => x.id === selecionado);
    const destinos = [detalhe, detalhe2].filter(Boolean);
    if (!c) { destinos.forEach((d) => (d.innerHTML = '')); return; }

    const linhasCert = c.cd
      .map((v, i) => {
        const e = certidao(v);
        const cls = { valida: 'limpo', vencida: 'nova', impedida: 'falha', vazio: 'conhecida' }[e.estado];
        return `<li class="pendencia ${e.estado === 'valida' ? 'resolvida' : e.estado === 'impedida' ? 'nova' : ''}">
          <div class="cabeca"><span class="tipo">${CERTIDOES[i]}</span>
            <span class="selo ${cls}">${e.estado === 'valida' ? 'Válida' : e.estado === 'impedida' ? 'Impedida' : e.estado === 'vencida' ? 'Vencida' : '—'}</span></div>
          <div class="meta">${e.texto}</div>
        </li>`;
      })
      .join('');

    const proc = [
      ['e-CAC · escritório', c.pe],
      ['e-CAC · responsável', c.pr],
      ['FGTS Digital', c.fgd ? 'Sim' : null],
      ['DET', c.det ? 'Sim' : null],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v ? (ehData(v) ? brData(v) : v) : '<span style="color:var(--nova-ink)">Não</span>'}</dd>`)
      .join('');

    const html = `
      <div class="cartao-topo" style="display:block">
        <h2 style="text-transform:none;letter-spacing:0;font-size:14.5px;margin-bottom:6px">
          <span class="id-selo">#${c.id}</span> ${c.n}
        </h2>
        <dl class="ficha">
          <dt>CNPJ</dt><dd>${brCnpj(c.j)}</dd>
          <dt>Regime</dt><dd>${c.rg ?? '—'}</dd>
          <dt>Cidade</dt><dd>${c.ci ?? '—'}</dd>
          <dt>Responsável</dt><dd>${c.r ?? '<span style="color:var(--falha-ink)">sem vínculo Onvio</span>'}</dd>
          <dt>Certificado</dt><dd>${c._cf.texto}</dd>
          ${c.fo !== null ? `<dt>Folha</dt><dd>${c.fo} colaborador(es)</dd>` : ''}
        </dl>
      </div>
      <div class="cartao-corpo" style="padding-bottom:6px">
        <p class="sub-rot" style="margin-top:0">Procurações</p>
        <dl class="ficha">${proc}</dl>
      </div>
      <p class="sub-rot" style="padding:0 12px">Certidões</p>
      <ul class="pendencias">${linhasCert}</ul>
      <div class="cartao-pe">
        <span class="origem">Origem: planilha de controle</span>
        <span style="display:flex;gap:8px;">
          <button class="botao vazado" type="button">Histórico</button>
          <button class="botao" type="button">Consultar agora</button>
        </span>
      </div>`;

    destinos.forEach((d) => (d.innerHTML = html));
  }

  function selecionar(tr) {
    selecionado = tr.dataset.id;
    if (vista === 'clientes') desenharClientes(); else desenharTabela();
    desenharDetalhe();
  }

  ['linhas', 'linhas-clientes'].forEach((id) => {
    const alvo = document.getElementById(id);
    if (!alvo) return;
    alvo.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (tr) selecionar(tr);
    });
    alvo.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      ev.preventDefault();
      selecionar(tr);
    });
  });

  /* ---------- Cartões calculados ---------- */
  function conta(fn) { return CLIENTES.filter(fn).length; }

  function preencher() {
    const total = CLIENTES.length;
    const semProc = conta((c) => c._e.chave === 'sem-procuracao');
    const procVencida = conta((c) => c._p.estado === 'vencida');
    const procVence = conta((c) => c._p.estado === 'vence');
    const semData = conta((c) => c._p.estado === 'sem-data');
    const certVencido = conta((c) => c._cf.estado === 'vencido');
    const certVence = conta((c) => c._cf.estado === 'vence');
    const semCert = conta((c) => c._cf.estado === 'sem');
    const semResp = conta((c) => !c.r);
    const semDet = conta((c) => !c.det);
    const alcance = total - semProc;

    const põe = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    põe('m-total', total);
    põe('m-alcance', alcance);
    põe('m-sem-proc', semProc);
    põe('m-sem-proc-2', semProc);
    põe('m-sem-proc-3', semProc);
    põe('m-proc-vencida', procVencida);
    põe('m-proc-vence', procVence);
    põe('m-proc-sem-data', semData);
    põe('m-cert-vencido', certVencido);
    põe('m-cert-vence', certVence);
    põe('m-cert-sem', semCert);
    põe('m-sem-resp', semResp);
    põe('m-sem-det', semDet);
    põe('m-com-det', total - semDet);

    // Rosca: quantos o robô consegue consultar hoje.
    const pct = Math.round((alcance / total) * 100);
    põe('m-rosca-n', alcance);
    põe('m-rosca-base', `de ${total}`);
    põe('m-rosca-pct', pct + '%');
    const arco = document.getElementById('arco');
    const circ = 2 * Math.PI * 48;
    arco.setAttribute('stroke-dasharray', `${(circ * pct) / 100} ${circ}`);

    // Cobertura de cada certificado sobre a base.
    const barra = (rot, n, base, classe) => `<div class="medida">
        <div class="trilha"><div class="preenche ${classe}" style="width:${Math.round((n / base) * 100)}%"></div></div>
        <div class="leg"><span>${rot}</span><b>${n} de ${base}</b></div>
      </div>`;

    const temE = (c) => Boolean(c.pe);
    const temR = (c) => Boolean(c.pr);
    const vencidaEm = (v) => ehData(v) && dias(v) < 0;

    document.getElementById('cert-escritorio').innerHTML =
      barra('Com procuração', conta(temE), total, 'bom') +
      barra('Validade registrada', conta((c) => ehData(c.pe)), total, '') +
      barra('Vencida', conta((c) => vencidaEm(c.pe)), total, 'alerta');

    document.getElementById('cert-responsavel').innerHTML =
      barra('Com procuração', conta(temR), total, 'bom') +
      barra('Validade registrada', conta((c) => ehData(c.pr)), total, '') +
      barra('Vencida', conta((c) => vencidaEm(c.pr)), total, 'alerta');

    // Certidões por tipo.
    const alvo = document.getElementById('certidoes-tipos');
    alvo.innerHTML = CERTIDOES.map((nome, i) => {
      const est = CLIENTES.map((c) => certidao(c.cd[i]).estado);
      const val = est.filter((e) => e === 'valida').length;
      const imp = est.filter((e) => e === 'impedida').length;
      const venc = est.filter((e) => e === 'vencida').length;
      const p = Math.round((val / total) * 100);
      return `<div class="medida">
        <div class="trilha"><div class="preenche bom" style="width:${p}%"></div></div>
        <div class="leg"><span>${nome}</span><b>${val} válidas · ${venc} venc. · ${imp} imped.</b></div>
      </div>`;
    }).join('');

    // Carga por responsável.
    const carga = {};
    CLIENTES.forEach((c) => { const k = c.r || 'sem vínculo'; carga[k] = (carga[k] || 0) + 1; });
    const ordenado = Object.entries(carga).sort((a, b) => b[1] - a[1]).slice(0, 9);
    const maior = ordenado[0]?.[1] || 1;
    document.getElementById('responsaveis').innerHTML = ordenado
      .map(([k, v]) => `<div class="medida">
        <div class="trilha"><div class="preenche${k === 'sem vínculo' ? ' alerta' : ''}" style="width:${Math.round((v / maior) * 100)}%"></div></div>
        <div class="leg"><span>${k}</span><b>${v}</b></div>
      </div>`)
      .join('');

    // Contagens nos filtros do topo.
    const cont = (f) => CLIENTES.filter(FILTROS[f]).length;
    document.querySelectorAll('.acao[data-filtro]').forEach((b) => {
      const alvo = b.querySelector('.qtd');
      if (alvo) alvo.textContent = cont(b.dataset.filtro);
    });
  }


  /* ---------- Tela de Clientes (tabela larga + detalhe) ---------- */
  const tbody2 = document.getElementById('linhas-clientes');
  const detalhe2 = document.getElementById('detalhe-2');

  function desenharClientes() {
    const visiveis = CLIENTES.filter(passa);
    const cont = document.getElementById('cont-clientes-2');
    if (cont) cont.textContent = `${visiveis.length} de ${CLIENTES.length}`;

    tbody2.innerHTML = visiveis.length
      ? visiveis
          .map(
            (c) => `<tr tabindex="0" role="button" data-id="${c.id}" aria-selected="${c.id === selecionado}">
        <td class="faixa" style="background:${COR[c._e.chave]}"></td>
        <td class="id">${c.id ?? '—'}</td>
        <td class="empresa"><div class="nome">${c.n}</div><div class="cnpj">${brCnpj(c.j)}</div></td>
        <td class="quando">${c.ci ?? '—'}</td>
        <td class="quando">${c.rg ?? '—'}</td>
        <td class="quando">${c.r ?? '—'}</td>
        <td><span class="selo ${{ ok: 'limpo', vence: 'falha', vencido: 'nova', sem: 'conhecida' }[c._cf.estado]}">${c._cf.texto}</span></td>
      </tr>`
          )
          .join('')
      : '<tr><td colspan="7" class="vazio">Nenhum cliente neste filtro ou nesta busca.</td></tr>';
  }

  /* ---------- Tela de Certidões ---------- */
  function desenharCertidoes() {
    const visiveis = CLIENTES.filter(passa);
    const cont = document.getElementById('cont-certidoes');
    if (cont) cont.textContent = visiveis.length;

    const resumo = document.getElementById('resumo-certidoes');
    if (resumo) {
      resumo.innerHTML = CERTIDOES.map((nome, i) => {
        const est = CLIENTES.map((c) => certidao(c.cd[i]).estado);
        const val = est.filter((e) => e === 'valida').length;
        const imp = est.filter((e) => e === 'impedida').length;
        const venc = est.filter((e) => e === 'vencida').length;
        const nada = est.filter((e) => e === 'vazio').length;
        return `<section class="cartao">
          <div class="cartao-topo"><h2>${nome}</h2><span class="dica">${Math.round((val / CLIENTES.length) * 100)}% ok</span></div>
          <div class="cartao-corpo">
            <div class="contadores">
              <div class="contador"><span class="n n--bom">${val}</span><span class="rot">Com data válida</span></div>
              <div class="contador"><span class="n n--alerta">${imp}</span><span class="rot">Impedida</span></div>
              <div class="contador"><span class="n n--aviso">${venc}</span><span class="rot">Data vencida</span></div>
              <div class="contador"><span class="n n--zero">${nada}</span><span class="rot">Em branco</span></div>
            </div>
          </div>
        </section>`;
      }).join('');
    }

    const cel = (v) => {
      const e = certidao(v);
      const cls = { valida: 'limpo', vencida: 'nova', impedida: 'falha', vazio: 'conhecida' }[e.estado];
      return `<td><span class="selo ${cls}">${e.texto}</span></td>`;
    };

    document.getElementById('linhas-certidoes').innerHTML = visiveis.length
      ? visiveis
          .map(
            (c) => `<tr>
        <td class="id">${c.id ?? '—'}</td>
        <td class="empresa"><div class="nome">${c.n}</div><div class="cnpj">${brCnpj(c.j)}</div></td>
        ${c.cd.map(cel).join('')}
      </tr>`
          )
          .join('')
      : '<tr><td colspan="7" class="vazio">Nenhum cliente neste filtro ou nesta busca.</td></tr>';
  }

  /* ---------- Tela de Relatórios ---------- */
  function desenharRelatorios() {
    const alvo = document.getElementById('relatorios');
    if (!alvo) return;
    const total = CLIENTES.length;
    const linha = (rot, n) => `<div class="medida">
        <div class="trilha"><div class="preenche" style="width:${Math.round((n / total) * 100)}%"></div></div>
        <div class="leg"><span>${rot}</span><b>${n} · ${Math.round((n / total) * 100)}%</b></div>
      </div>`;

    const cidades = {};
    const regimes = {};
    CLIENTES.forEach((c) => {
      const ci = c.ci || 'sem cidade';
      const rg = c.rg || 'sem regime';
      cidades[ci] = (cidades[ci] || 0) + 1;
      regimes[rg] = (regimes[rg] || 0) + 1;
    });
    const ord = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8);

    alvo.innerHTML = `
      <section class="cartao">
        <div class="cartao-topo"><h2>Por regime</h2><span class="dica">${total} clientes</span></div>
        <div class="cartao-corpo">${ord(regimes).map(([k, v]) => linha(k, v)).join('')}</div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Por cidade</h2><span class="dica">8 maiores</span></div>
        <div class="cartao-corpo">${ord(cidades).map(([k, v]) => linha(k, v)).join('')}</div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>O que exportar</h2><span class="dica">ainda manual</span></div>
        <div class="cartao-corpo">
          <p class="sub-rot" style="margin-top:0">Listas que a equipe pede toda semana</p>
          <div class="contadores">
            <div class="contador"><span class="n n--alerta">${CLIENTES.filter((c) => c._e.chave === 'sem-procuracao').length}</span><span class="rot">Procuração a colher</span></div>
            <div class="contador"><span class="n n--alerta">${CLIENTES.filter((c) => c._cf.estado === 'vencido').length}</span><span class="rot">Certificado a renovar</span></div>
            <div class="contador"><span class="n n--aviso">${CLIENTES.filter((c) => !c.det).length}</span><span class="rot">DET a habilitar</span></div>
            <div class="contador"><span class="n n--zero">${CLIENTES.filter((c) => !c.r).length}</span><span class="rot">Sem responsável</span></div>
          </div>
          <p class="nota">A exportação em planilha ainda não está ligada. Os números acima já saem da base real e conferem com o painel.</p>
        </div>
      </section>`;
  }

  /* ---------- Tela de Ajustes ---------- */
  function desenharAjustes() {
    const alvo = document.getElementById('ajustes');
    if (!alvo) return;
    const comId = CLIENTES.filter((c) => c.id !== null && c.id !== undefined).length;
    const comCnpj = CLIENTES.filter((c) => c.j).length;
    alvo.innerHTML = `
      <section class="cartao">
        <div class="cartao-topo"><h2>Base carregada</h2><span class="dica">GERAL</span></div>
        <div class="cartao-corpo">
          <dl class="ficha">
            <dt>Origem</dt><dd>CONTROLE_CORRETO_5.xlsx</dd>
            <dt>Aba de referência</dt><dd>GERAL</dd>
            <dt>Clientes na tela</dt><dd>${CLIENTES.length}</dd>
            <dt>Com ID</dt><dd>${comId}</dd>
            <dt>Com CNPJ</dt><dd>${comCnpj}</dd>
          </dl>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Certificados do escritório</h2><span class="dica">procuração</span></div>
        <div class="cartao-corpo">
          <dl class="ficha">
            <dt>e-CNPJ escritório</dt><dd>${CLIENTES.filter((c) => c.pe).length} procurações</dd>
            <dt>e-CPF responsável</dt><dd>${CLIENTES.filter((c) => c.pr).length} procurações</dd>
            <dt>Alcance do robô</dt><dd>${CLIENTES.length - CLIENTES.filter((c) => c._e.chave === 'sem-procuracao').length} de ${CLIENTES.length}</dd>
          </dl>
          <p class="nota">Os arquivos .pfx e as senhas ficam na máquina que roda a coleta, nunca nesta tela.</p>
        </div>
      </section>
      <section class="cartao">
        <div class="cartao-topo"><h2>Coleta automática</h2><span class="dica">não configurada</span></div>
        <div class="cartao-corpo">
          <dl class="ficha">
            <dt>Última coleta</dt><dd><span style="color:var(--nova-ink)">nunca</span></dd>
            <dt>Portal alvo</dt><dd>Minhas Dívidas e Pendências</dd>
            <dt>Seletores</dt><dd><span style="color:var(--falha-ink)">a calibrar</span></dd>
          </dl>
          <p class="nota">Rode <code>npm run mapear</code> nos dois certificados e mande o mapa.txt: sem isso a coleta não tem como acertar a tela nova da Receita.</p>
        </div>
      </section>`;
  }

  /* ---------- Navegação entre telas ---------- */
  const TELAS = {
    painel: () => { preencher(); desenharTabela(); desenharDetalhe(); },
    clientes: () => { desenharClientes(); desenharDetalhe(); },
    certidoes: () => desenharCertidoes(),
    guias: () => {},
    relatorios: () => desenharRelatorios(),
    ajustes: () => desenharAjustes(),
  };
  // Telas que a busca e os filtros do topo afetam.
  const COM_FILTRO = ['painel', 'clientes', 'certidoes'];
  let vista = 'painel';

  function irPara(nome) {
    if (!TELAS[nome]) return;
    vista = nome;
    document.querySelectorAll('.vista').forEach((v) => {
      if (v.dataset.vista === nome) v.setAttribute('data-ativa', '');
      else v.removeAttribute('data-ativa');
    });
    document.querySelectorAll('.item[data-vista]').forEach((b) => {
      if (b.dataset.vista === nome) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const topo = document.querySelector('.acoes');
    const busca = document.querySelector('.busca');
    const usa = COM_FILTRO.includes(nome);
    if (topo) topo.style.visibility = usa ? '' : 'hidden';
    if (busca) busca.style.visibility = usa ? '' : 'hidden';
    TELAS[nome]();
    const ativa = document.querySelector('.vista[data-ativa]');
    if (ativa) ativa.scrollTop = 0;
  }

  document.querySelectorAll('.item[data-vista]').forEach((b) => {
    b.addEventListener('click', () => irPara(b.dataset.vista));
  });

  function redesenhar() {
    if (COM_FILTRO.includes(vista)) TELAS[vista]();
  }

  document.querySelectorAll('.acao[data-filtro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filtro = btn.dataset.filtro;
      document.querySelectorAll('.acao[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      redesenhar();
    });
  });

  document.getElementById('busca').addEventListener('input', (ev) => {
    termo = ev.target.value.trim().toLowerCase();
    redesenhar();
  });

  preencher();
  desenharTabela();
  desenharDetalhe();
</script>
