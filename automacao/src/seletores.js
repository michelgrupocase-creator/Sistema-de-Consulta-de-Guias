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
  pendencias: [
    'https://servicos.receita.fazenda.gov.br/servicos/minhasdividasependencias/',
    'https://servicos.receita.fazenda.gov.br/servicos/',
    'https://cav.receita.fazenda.gov.br/ecac/Aplicacao.aspx?id=10007&origem=menu',
  ],
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
  abrirTrocaPerfil: [
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

  botaoGerarRelatorio: [
    'papel=button|Consultar',
    'papel=button|Emitir',
    'papel=button|Gerar',
    'texto=Diagnóstico Fiscal na Receita Federal',
    'css=input[type="submit"]',
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

  // Sinal de que o PDF ficou pronto.
  linkPdfPronto: [
    'papel=link|Visualizar em PDF',
    'texto=Visualizar em PDF',
    'texto=Imprimir',
    'texto=Salvar em PDF',
    'css=a[href$=".pdf"]',
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
