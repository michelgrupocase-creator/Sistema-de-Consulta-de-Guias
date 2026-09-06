# Radar Fiscal CASE

Sistema de acompanhamento fiscal da carteira do **Grupo Case** (escritório
contábil, Arapiraca/AL). Cadastro dos clientes, controle de procurações e
certificados, acervo de documentos, e um robô que consulta o e-CAC.

Este arquivo carrega as **decisões e as restrições** do projeto. Ele existe
porque o código sozinho não conta por que ele é assim, e as escolhas abaixo
foram caras de chegar.

---

## As três restrições que moldam tudo

**1. Sem custo por consulta.** Decisão explícita do dono do projeto, mantida
depois de eu levantar a objeção. A alternativa oficial (API SITFIS do
Integra Contador, do SERPRO) é tarifada por requisição e foi descartada. Por
isso o caminho é automação de navegador — que quebra quando o portal muda e
opera fora dos termos de uso. **Não reabra essa discussão sem motivo novo.**

**2. Sigilo fiscal.** Certificados, senhas, carteira de clientes e relatórios
de situação fiscal de terceiros são dados sob sigilo. Estão todos no
`.gitignore` e **nenhum CNPJ real pode entrar no repositório**. Confira antes
de cada commit.

**3. Home office.** A equipe trabalha de casa e do escritório. Por isso o
cadastro vive num banco compartilhado, não num arquivo local.

---

## As peças

```
planilha ──npm run planilha──> semente ──(carga única)──> BANCO ──> painel (CRUD)
                                                            ↑
portal da Receita ──npm start──> robô ──> ACERVO ──> Google Drive ──┘
```

| Onde | O que é |
|---|---|
| `automacao/src/ecac.js`, `index.js` | O robô: login por certificado, troca de perfil, download |
| `automacao/src/seletores.js` | **Ponto único de manutenção** dos seletores do portal |
| `automacao/src/mapear.js` | Descobre os seletores reais contra a tela do portal |
| `automacao/src/acervo.js` | Onde os documentos ficam guardados, com histórico |
| `automacao/src/drive.js` | Espelha o acervo no Google Drive |
| `automacao/src/planilha.js` | Lê a planilha de controle (só foi usada uma vez, como semente) |
| `painel/base.html`, `painel/app.js` | O sistema: 6 telas + ficha, publicado como Artifact |
| `automacao/src/painel.js` | Monta o HTML do painel a partir das duas fontes acima |

O painel publicado guarda os clientes num **banco de artifact** (capacidade
`db`), compartilhado entre todas as máquinas. O HTML **não leva dado
embutido** — ele lê do banco.

`index.html.html`, na raiz, é um sistema de relatórios de guias que o dono do
projeto subiu antes deste trabalho começar. **Não faz parte do que está sendo
construído aqui** e ninguém mexeu nele — mas é a origem do nome do
repositório, e um dia a tela de Guias pode reaproveitá-lo.

---

## Decisões que não devem ser desfeitas sem conversa

**As certidões começam zeradas.** As datas vinham da planilha e ninguém sabia
se eram de emissão ou de validade. Lidas como validade, apontavam FGTS 0% ok
e 96 trabalhistas vencidas — dezenas de vencimentos falsos numa tela usada
para decidir. Foram descartadas. A certidão passa a existir quando a consulta
a busca; até lá é **"Não consultada"**.

**Cliente sem certidão consultada não é "Em dia", é "Não consultado".** São
coisas diferentes, e a primeira afirma o que ninguém verificou.

**O ID da aba GERAL tem precedência absoluta** sobre casamento por nome, em
`planilha.js`. Sem isso, duas empresas de nome parecido viram uma só — foi
assim que 112 clientes viraram 108 na primeira versão.

**A troca de perfil confere o CNPJ na tela antes de baixar.** Uma troca que
falha em silêncio gravaria o relatório de uma empresa com o nome de outra —
erro que só aparece semanas depois.

**Um certificado por sessão.** Não dá para trocar o certificado de uma conexão
TLS já aberta. A carteira é agrupada por certificado e cada grupo abre a sua
sessão; certificado ruim derruba só o grupo dele.

**Acervo: nada é sobrescrito, idêntico não vira cópia.** Documento fiscal é
prova. E comparar o SHA-256 com o último guardado é o que transforma o
histórico em *mudança* em vez de repetição — a base do "o que mudou desde a
semana passada", que é o valor real do projeto.

**Drive: grava local primeiro, sobe depois.** Internet caindo no meio não
pode perder documento; a subida entra numa fila que a próxima execução
esvazia.

**Nenhum botão que não faz nada.** O painel já teve "Histórico", "Consultar
agora" e "Período" mortos, e isso fez o sistema inteiro parecer maquete.
Se não funciona, não entra — ou entra dizendo que não existe, como a tela
de Guias.

---

## O estado real, hoje

**O robô nunca rodou contra o portal.** Os seletores em `seletores.js` são
**hipóteses**: foram escritos sem acesso ao e-CAC, e a Receita trocou a
"Consulta Situação Fiscal" pelo **"Minhas Dívidas e Pendências"** em
09/03/2026, com layout novo no padrão gov.br.

**Este é o gargalo do projeto.** Tudo que falta depende dele.

O que fazer, numa máquina com o certificado A1:

```bash
cd automacao
npm install && npx playwright install chromium
cp config.example.json config.json     # ajuste pfxPath
export ECAC_CERT_ESCRITORIO='...'      # senha; NUNCA em arquivo
npm run mapear -- --cnpj <CNPJ com procuração e-CAC válida>
```

O navegador abre visível. No fim, `relatorios/_debug/mapa.txt` diz, seletor
por seletor, o que casou e o que não casou, e lista os links que existem de
verdade no portal. Corrija `seletores.js` com isso e rode de novo, até passar.

Se o login por certificado não for encontrado, ele dá 90 segundos para entrar
na mão e continua de onde você parar.

### O que também não foi verificado

- **O Drive nunca subiu um arquivo de verdade** — só foi testado contra um
  Drive simulado (caminho feliz, queda de rede, reenvio da fila, sem Drive).

---

## Comandos

```bash
npm run mapear      # calibrar os seletores contra o portal real
npm start           # coletar a carteira inteira
npm start -- --cnpj 12345678000190   # uma empresa só
npm run planilha    # planilha de controle -> dados/clientes.json
npm run painel      # monta painel/radar-fiscal.html
npm run documentos  # o que está guardado no acervo
npm run drive-autorizar   # autoriza o Google Drive (uma vez)
```

---

## Regras de trabalho

- **Senha nunca em arquivo.** Variável de ambiente ou prompt oculto. Isso vale
  para a senha do certificado e para o refresh token do Drive.
- **Não peça senha no chat.** Ela ficaria no histórico da conversa.
- **`headless: false` até funcionar ponta a ponta.** Você precisa ver onde trava.
- **Quando um seletor quebrar**, conserte em `seletores.js` acrescentando um
  candidato à lista. Cada campo é uma lista tentada em ordem, então acrescentar
  nunca quebra o que já funcionava.
- **Antes de commitar**, confira que nenhum CNPJ real entrou no diff.

## Idioma

Código, comentários, mensagens de commit e conversa em **português do
Brasil**. O usuário é brasileiro e o domínio é fiscal brasileiro.

## Estilo de resposta esperado

O dono do projeto pediu explicitamente parceria crítica, não concordância:
questione as ideias dele, aponte falhas e riscos escondidos, diferencie fato
de interpretação, e diga com clareza quando ele estiver errado. Quando não
souber, diga que não sabe em vez de inventar.
