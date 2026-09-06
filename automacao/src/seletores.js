/**
 * PONTO ÚNICO DE MANUTENÇÃO.
 *
 * Quando o gov.br ou o e-CAC mudarem o layout, o robô quebra AQUI e em mais
 * lugar nenhum. Cada campo abaixo é uma LISTA de candidatos: o robô tenta um
 * por um, na ordem, e usa o primeiro que estiver visível na tela. Isso deixa o
 * robô sobreviver a mudanças pequenas sem alterar código.
 *
 * Formatos aceitos em cada candidato:
 *   'css=#id'                       -> seletor CSS
 *   'texto=Alterar perfil'          -> elemento que contém esse texto
 *   'papel=button|Continuar'        -> por papel de acessibilidade + nome
 *   'label=CNPJ'                    -> campo de formulário por rótulo
 *
 * Como descobrir um seletor novo: rode com `headless: false`, abra o DevTools
 * (F12) na página que travou, clique com o botão direito no elemento >
 * "Copiar" > "Copiar seletor", e cole aqui como 'css=...'.
 */

export const URLS = {
  // Porta de entrada do e-CAC.
  ecac: 'https://cav.receita.fazenda.gov.br/autenticacao/login',

  // Login gov.br por certificado digital.
  loginCertificado: 'https://sso.acesso.gov.br/login',

  // Origens que pedem o certificado do cliente no handshake TLS.
  // Se o login por certificado falhar sem nem abrir a janela de seleção,
  // o host correto provavelmente está faltando nesta lista.
  origensCertificado: [
    'https://certificado.sso.acesso.gov.br',
    'https://sso.acesso.gov.br',
    'https://cav.receita.fazenda.gov.br',
  ],

  // ATENÇÃO — MUDANÇA DE 09/03/2026:
  // A Receita aposentou a "Consulta Situação Fiscal" do e-CAC e pôs no lugar
  // o "Minhas Dívidas e Pendências", no Portal de Serviços, com layout novo
  // (design system gov.br). As URLs abaixo são tentadas EM ORDEM: primeiro o
  // serviço novo, depois o antigo, que pode ou não ainda responder.
  //
  // Rode `npm run mapear` para descobrir o endereço real na sua conta e
  // corrigir esta lista — não adianta adivinhar.
  // CONFIRMADO EM 05/09/2026 por mapeamento contra o portal real (logado).
  // O servico NAO virou "Minhas Dividas e Pendencias": no menu do e-CAC ele
  // continua se chamando "Consulta Pendencias - Situacao Fiscal". O que mudou
  // foi o DOMINIO - saiu de receita.fazenda.gov.br para receitafederal.gov.br.
  // As URLs antigas davam 403 ou caiam em servico errado (id=10007 e
  // "Obrigacao Acessoria", nao situacao fiscal).
  // Tela da consulta, com a rota interna do aplicativo. E AQUI que se informa
  // o CNPJ da empresa - a representacao acontece DENTRO desta tela, nao antes.
  pendencias: [
    'https://servicos.receitafederal.gov.br/servico/pendencias/#/analise-pendencias',
    'https://servicos.receitafederal.gov.br/servico/pendencias/',
  ],

  // ENTRADA CORRETA DO PORTAL - corrigido em 06/09/2026.
  // O login deve devolver o usuario em /servico (a home do portal), NAO na
  // tela de pendencias. Entrar direto na consulta faz a Receita rodar uma
  // analise no CPF de quem logou, antes de qualquer representacao: gasta
  // consulta a toa e suja o historico com um diagnostico que ninguem pediu.
  //
  // A ordem certa e a mesma que a pessoa faz na mao:
  //   1. logar no portal      -> /servico
  //   2. trocar a procuracao  -> painel "Representar"
  //   3. so entao abrir a consulta de pendencias
  // ATENCAO: /servico NAO EXISTE - devolve "Pagina nao encontrada" (visto em
  // 06/09/2026). A home do portal e a RAIZ do dominio. O redirectUrl do link
  // de login aponta para /servico e cai no 404: serve para autenticar, mas
  // depois e preciso ir para a raiz.
  portalLogin: 'https://servicos.receitafederal.gov.br/login/?redirectUrl=https://servicos.receitafederal.gov.br/servico',
  portalHome: 'https://servicos.receitafederal.gov.br/',

  // Texto do 404 do portal, para o robo perceber que caiu nele e se corrigir
  // em vez de seguir achando que esta na home.
  marcaPaginaInexistente: 'Página não encontrada',
};

export const SELETORES = {
  // --- Login -------------------------------------------------------------
  botaoEntrarCertificado: [
    'papel=button|Seu certificado digital',
    'texto=Seu certificado digital',
    'texto=Certificado digital',
    'css=#login-certificate',
  ],

  // Qualquer um destes visível = já estamos autenticados no e-CAC.
  marcadorLogado: [
    'texto=Alterar perfil de acesso',
    'texto=Alterar perfil',
    'css=#perfil-acesso',
    'texto=Sair com segurança',
  ],

  // --- Troca de perfil (procurador) --------------------------------------
  // #btnPerfil confirmado no DOM em 05/09/2026 - id estavel, tentado primeiro.
  abrirTrocaPerfil: [
    'css=#btnPerfil',
    'texto=Alterar perfil de acesso',
    'texto=Alterar perfil',
    'css=#perfil-acesso',
  ],

  opcaoProcurador: [
    'papel=radio|Procurador de Pessoa Jurídica',
    'texto=Procurador de Pessoa Jurídica',
    'texto=Procurador',
    'css=input[value="PJ_PROCURADOR"]',
  ],

  campoCnpjPerfil: [
    'label=CNPJ',
    'css=input[name*="cnpj" i]',
    'css=input[id*="cnpj" i]',
  ],

  confirmarTrocaPerfil: [
    'papel=button|Alterar',
    'papel=button|Confirmar',
    'texto=Alterar perfil',
    'css=input[type="submit"]',
  ],

  // Onde o e-CAC mostra qual empresa está ativa. Usado para CONFERIR que a
  // troca funcionou antes de baixar qualquer coisa — sem isso o robô corre o
  // risco de salvar o relatório da empresa errada.
  perfilAtivo: [
    'css=#perfil-atual',
    'css=.perfil-ativo',
    'texto=Perfil atual',
    'texto=Você está atuando como',
  ],

  // --- Relatório de situação fiscal --------------------------------------
  menuCertidoes: [
    'texto=Dívidas e Pendências',
    'texto=Regularização',
    'texto=Certidões e Situação Fiscal',
    'texto=Certidões e Situação',
  ],

  linkConsultaPendencias: [
    'texto=Minhas Dívidas e Pendências',
    'texto=Dívidas e Pendências',
    'texto=Minhas Dívidas',
    'texto=Consulta Pendências - Situação Fiscal',
    'texto=Consulta Pendências',
    'texto=Situação Fiscal',
  ],

  // 'css=input[type="submit"]' foi REMOVIDO em 05/09/2026: ele casava com a
  // caixa de busca da home do e-CAC, dando falso positivo em toda tela. Um
  // seletor que acha o botao errado e pior que um que nao acha nada.
  //
  // CONFIRMADO 05/09/2026 na tela real: o botao que refaz a analise chama
  // "Atualizar". Nao existe "Consultar"/"Emitir"/"Gerar" nesta tela.
  botaoGerarRelatorio: [
    'papel=button|Atualizar',
    'papel=button|Consultar',
    'papel=button|Emitir',
    'papel=button|Gerar',
  ],

  // O relatório é ASSÍNCRONO: a Receita monta o PDF em segundo plano.
  // Estes são os sinais de "ainda processando" — enquanto um deles estiver
  // visível, o robô espera em vez de desistir.
  sinalProcessando: [
    'texto=Aguarde',
    'texto=em processamento',
    'texto=Processando',
    'texto=Sua solicitação está sendo processada',
  ],

  // CONFIRMADO 05/09/2026: no portal novo o download chama "Baixar Relatorio"
  // e e um <button>, nao um <a href=".pdf">. Os candidatos antigos ficam no
  // fim como rede de seguranca para o e-CAC classico.
  linkPdfPronto: [
    'papel=button|Baixar Relatório',
    'texto=Baixar Relatório',
    'papel=link|Visualizar em PDF',
    'texto=Visualizar em PDF',
    'css=a[href$=".pdf"]',
  ],

  // ---- PORTAL NOVO (servicos.receitafederal.gov.br) ---------------------
  // Descoberto em 05/09/2026. Este portal tem SESSAO PROPRIA: estar logado no
  // e-CAC nao basta, ele devolve "Entrar com GovBR". Como o SSO e o mesmo, o
  // clique resolve sozinho, sem pedir credencial de novo.
  botaoEntrarGovBr: [
    'css=input[value*="GovBR" i]',
    'papel=button|Entrar com GovBR',
    'texto=Entrar com GovBR',
  ],

  // Ja autenticado no portal novo: o avatar do usuario no topo.
  marcadorLogadoPortal: [
    'css=#avatar-dropdown-trigger',
    'papel=button|Sair',
  ],

  // A troca de perfil no portal novo NAO e o #btnPerfil do e-CAC: e o painel
  // "Representar", dentro do menu do avatar.
  abrirRepresentar: [
    'papel=button|Representar',
    'texto=Representar',
  ],

  campoRepresentar: [
    'label=Digite um perfil de representação',
    'css=input[placeholder*="representa" i]',
    'texto=Digite um perfil de representação',
  ],

  // Marcadores de que a analise carregou de verdade.
  marcadorAnalise: [
    'texto=Resultado da Análise',
    'texto=Detalhamento da Análise',
    'texto=Análise realizada',
  ],

  // Mensagens que significam "não adianta esperar, essa empresa não vai dar
  // certo agora" — o robô pula e segue para a próxima em vez de travar.
  erroSemProcuracao: [
    'texto=não possui procuração',
    'texto=sem autorização',
    'texto=não autorizado',
    'texto=Procuração inválida',
  ],
};
