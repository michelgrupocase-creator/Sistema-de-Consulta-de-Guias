# Radar Fiscal CASE

Sistema de acompanhamento fiscal da carteira do **Grupo Case** (escritÃ³rio
contÃ¡bil, Arapiraca/AL). Cadastro dos clientes, controle de procuraÃ§Ãµes e
certificados, acervo de documentos, e um robÃ´ que consulta o e-CAC.

Este arquivo carrega as **decisÃµes e as restriÃ§Ãµes** do projeto. Ele existe
porque o cÃ³digo sozinho nÃ£o conta por que ele Ã© assim, e as escolhas abaixo
foram caras de chegar.

---

## As trÃªs restriÃ§Ãµes que moldam tudo

**1. Sem custo por consulta.** DecisÃ£o explÃ­cita do dono do projeto, mantida
depois de eu levantar a objeÃ§Ã£o. A alternativa oficial (API SITFIS do
Integra Contador, do SERPRO) Ã© tarifada por requisiÃ§Ã£o e foi descartada. Por
isso o caminho Ã© automaÃ§Ã£o de navegador â€” que quebra quando o portal muda e
opera fora dos termos de uso. **NÃ£o reabra essa discussÃ£o sem motivo novo.**

**2. Sigilo fiscal.** Certificados, senhas, carteira de clientes e relatÃ³rios
de situaÃ§Ã£o fiscal de terceiros sÃ£o dados sob sigilo. EstÃ£o todos no
`.gitignore` e **nenhum CNPJ real pode entrar no repositÃ³rio**. Confira antes
de cada commit.

**3. Home office.** A equipe trabalha de casa e do escritÃ³rio. Por isso o
cadastro vive num banco compartilhado, nÃ£o num arquivo local.

---

## As peÃ§as

```
planilha â”€â”€npm run planilhaâ”€â”€> semente â”€â”€(carga Ãºnica)â”€â”€> BANCO â”€â”€> painel (CRUD)
                                                            â†‘
portal da Receita â”€â”€npm startâ”€â”€> robÃ´ â”€â”€> ACERVO â”€â”€> Google Drive â”€â”€â”˜
```

| Onde | O que Ã© |
|---|---|
| `automacao/src/ecac.js`, `index.js` | O robÃ´: login por certificado, troca de perfil, download |
| `automacao/src/seletores.js` | **Ponto Ãºnico de manutenÃ§Ã£o** dos seletores do portal |
| `automacao/src/mapear.js` | Descobre os seletores reais contra a tela do portal |
| `automacao/src/acervo.js` | Onde os documentos ficam guardados, com histÃ³rico |
| `automacao/src/drive.js` | Espelha o acervo no Google Drive |
| `automacao/src/planilha.js` | LÃª a planilha de controle (sÃ³ foi usada uma vez, como semente) |
| `painel/base.html`, `painel/app.js` | O sistema: 6 telas + ficha, publicado como Artifact |
| `automacao/src/painel.js` | Monta o HTML do painel a partir das duas fontes acima |

O painel publicado guarda os clientes num **banco de artifact** (capacidade
`db`), compartilhado entre todas as mÃ¡quinas. O HTML **nÃ£o leva dado
embutido** â€” ele lÃª do banco.

`index.html.html`, na raiz, Ã© um sistema de relatÃ³rios de guias que o dono do
projeto subiu antes deste trabalho comeÃ§ar. **NÃ£o faz parte do que estÃ¡ sendo
construÃ­do aqui** e ninguÃ©m mexeu nele â€” mas Ã© a origem do nome do
repositÃ³rio, e um dia a tela de Guias pode reaproveitÃ¡-lo.

---

## DecisÃµes que nÃ£o devem ser desfeitas sem conversa

**As certidÃµes comeÃ§am zeradas.** As datas vinham da planilha e ninguÃ©m sabia
se eram de emissÃ£o ou de validade. Lidas como validade, apontavam FGTS 0% ok
e 96 trabalhistas vencidas â€” dezenas de vencimentos falsos numa tela usada
para decidir. Foram descartadas. A certidÃ£o passa a existir quando a consulta
a busca; atÃ© lÃ¡ Ã© **"NÃ£o consultada"**.

**Cliente sem certidÃ£o consultada nÃ£o Ã© "Em dia", Ã© "NÃ£o consultado".** SÃ£o
coisas diferentes, e a primeira afirma o que ninguÃ©m verificou.

**O ID da aba GERAL tem precedÃªncia absoluta** sobre casamento por nome, em
`planilha.js`. Sem isso, duas empresas de nome parecido viram uma sÃ³ â€” foi
assim que 112 clientes viraram 108 na primeira versÃ£o.

**A troca de perfil confere o CNPJ na tela antes de baixar.** Uma troca que
falha em silÃªncio gravaria o relatÃ³rio de uma empresa com o nome de outra â€”
erro que sÃ³ aparece semanas depois.

**Um certificado por sessÃ£o.** NÃ£o dÃ¡ para trocar o certificado de uma conexÃ£o
TLS jÃ¡ aberta. A carteira Ã© agrupada por certificado e cada grupo abre a sua
sessÃ£o; certificado ruim derruba sÃ³ o grupo dele.

**Acervo: nada Ã© sobrescrito, idÃªntico nÃ£o vira cÃ³pia.** Documento fiscal Ã©
prova. E comparar o SHA-256 com o Ãºltimo guardado Ã© o que transforma o
histÃ³rico em *mudanÃ§a* em vez de repetiÃ§Ã£o â€” a base do "o que mudou desde a
semana passada", que Ã© o valor real do projeto.

**Drive: grava local primeiro, sobe depois.** Internet caindo no meio nÃ£o
pode perder documento; a subida entra numa fila que a prÃ³xima execuÃ§Ã£o
esvazia.

**Nenhum botÃ£o que nÃ£o faz nada.** O painel jÃ¡ teve "HistÃ³rico", "Consultar
agora" e "PerÃ­odo" mortos, e isso fez o sistema inteiro parecer maquete.
Se nÃ£o funciona, nÃ£o entra â€” ou entra dizendo que nÃ£o existe, como a tela
de Guias.

---

## O estado real, hoje

**05/09/2026 â€” o portal foi mapeado contra a tela real, logado.** O que se
descobriu derruba parte do que estava escrito aqui:

- **A URL estava errada, nÃ£o o serviÃ§o.** O endereÃ§o certo Ã©
  `https://servicos.receitafederal.gov.br/servico/pendencias/`. As trÃªs URLs
  que estavam no cÃ³digo davam 403, redirecionavam de volta, ou caÃ­am em
  serviÃ§o errado (`id=10007` Ã© "ObrigaÃ§Ã£o AcessÃ³ria", nÃ£o situaÃ§Ã£o fiscal).
- **No menu do e-CAC o link ainda se chama "Consulta PendÃªncias - SituaÃ§Ã£o
  Fiscal"** â€” o nome antigo. SÃ³ a tela de destino Ã© que Ã© a nova.
- **SÃ£o dois portais com sessÃµes separadas.** Estar logado no e-CAC
  (`cav.receita.fazenda.gov.br`) nÃ£o vale em `servicos.receitafederal.gov.br`:
  ele devolve "Entrar com GovBR". Como o SSO do gov.br Ã© o mesmo, o clique
  resolve sozinho â€” mas o robÃ´ precisa dar esse clique.
- **A troca de perfil mudou de lugar.** No portal novo nÃ£o Ã© o `#btnPerfil` do
  e-CAC: Ã© o painel **"Representar"**, dentro do menu do avatar.
- **O download chama "Baixar RelatÃ³rio"** e Ã© um `<button>`, nÃ£o um
  `<a href=".pdf">`. O botÃ£o "Atualizar" refaz a anÃ¡lise.
- **`css=input[type="submit"]` foi removido** de `botaoGerarRelatorio`: casava
  com a caixa de busca da home e dava falso positivo em toda tela.

**Cookie de sessÃ£o.** O e-CAC derruba o login quando o navegador fecha. Por
isso o mapeamento usa perfil persistente em `.perfil-navegador/` e os scripts
de diagnÃ³stico nÃ£o fecham a janela no fim.

### O CAPTCHA na troca de perfil â€” o achado que muda o projeto

**05/09/2026.** O fluxo inteiro foi percorrido e funciona: entrar no e-CAC,
abrir o portal novo, preencher CNPJ, escolher o perfil "Procurador" e clicar
em "Representar". AÃ­ a Receita responde com um **CAPTCHA visual do hCaptcha**
("Clique na figura que nÃ£o Ã© igual Ã s outras").

O painel "Representar" tem dois campos e o botÃ£o sÃ³ habilita com os dois:

1. `#input-representar-cpfcnpj` â€” "Digite o CPF ou CNPJ", aplica mÃ¡scara.
2. Um `ng-select` do Angular, `br-select[name="perfil-select"]`. O placeholder
   mora numa `div.ng-placeholder`, **nÃ£o** no atributo `placeholder` â€” seletor
   por placeholder nÃ£o casa. As opÃ§Ãµes sÃ³ existem no DOM depois de abrir, em
   `.ng-dropdown-panel .ng-option`, e sÃ£o fixas: **Procurador**, **Representante
   no CNPJ**, **Agente PÃºblico**. Para procuraÃ§Ã£o eletrÃ´nica Ã© *Procurador*.
   O id do input interno Ã© aleatÃ³rio a cada carga (`#id3f8bbc...`): nunca use id.

**ConsequÃªncia estratÃ©gica.** Um CAPTCHA por troca de perfil significa um
CAPTCHA por empresa. A carteira tem ~112 clientes. **A execuÃ§Ã£o desassistida
de madrugada â€” a premissa do projeto â€” nÃ£o sobrevive a isso.**

**NÃ£o se resolve quebrando o CAPTCHA.** Contornar controle antifraude de Ã³rgÃ£o
pÃºblico nÃ£o Ã© opÃ§Ã£o, e o projeto jÃ¡ opera fora dos termos de uso do portal;
somar isso seria trocar um risco tolerÃ¡vel por um indefensÃ¡vel.

**O CAPTCHA NÃƒO Ã© sempre.** Na primeira troca para um CNPJ ele apareceu; nas
seguintes, para o mesmo CNPJ, nÃ£o. Ele parece ser por risco, e uma
representaÃ§Ã£o jÃ¡ usada entra em "RepresentaÃ§Ãµes Recentes" no painel. Isso muda
a conta: o custo humano por rodada Ã© menor do que 1 CAPTCHA por empresa, mas
ainda nÃ£o se sabe qual Ã©.

**Ainda nÃ£o se sabe** se o login **por certificado A1** dispensa o CAPTCHA de
vez. Todo o trabalho atÃ© aqui foi com conta gov.br nÃ­vel Ouro, sem certificado.

### O fluxo completo funcionou â€” 06/09/2026

Coleta ponta a ponta, com `npm run coletar`: login â†’ portal novo â†’ CNPJ â†’
perfil "Procurador" â†’ troca confirmada â†’ PDF baixado â†’ guardado no acervo com
SHA-256. Testado com <CNPJ de teste> :
PDF de 32 KB, Ã­ntegro.

TrÃªs armadilhas que custaram caro e nÃ£o podem ser reintroduzidas:

1. **Conferir o CNPJ no `body` inteiro dÃ¡ falso positivo SEMPRE**, porque o
   painel lateral contÃ©m o CNPJ que o prÃ³prio robÃ´ digitou. A conferÃªncia tem
   que recortar `area-representacao`, `header`, `aside`, `nav` e `footer` e
   olhar sÃ³ o conteÃºdo â€” senÃ£o o robÃ´ grava o relatÃ³rio da empresa errada.
2. **O painel lateral nÃ£o fecha com Escape.** O botÃ£o chama "Fechar Menu".
   Enquanto ele estÃ¡ aberto, um fundo escurece a pÃ¡gina e engole todo clique.
3. **A anÃ¡lise da nova empresa Ã© assÃ­ncrona.** Depois da troca a tela fica em
   "Carregando"; clicar em "Baixar RelatÃ³rio" nesse momento estoura timeout.
   Espere `Resultado da AnÃ¡lise` aparecer sem `Carregando`.

**Isto Ã© o "motivo novo"** que a regra do topo deste arquivo exigia para
reabrir a discussÃ£o da API oficial (SITFIS / Integra Contador). Custo por
consulta contra ~112 CAPTCHAs por rodada Ã© uma conta que agora precisa ser
feita, nÃ£o uma preferÃªncia.

O que fazer, numa mÃ¡quina com o certificado A1:

```bash
cd automacao
npm install && npx playwright install chromium
cp config.example.json config.json     # ajuste pfxPath
export ECAC_CERT_ESCRITORIO='...'      # senha; NUNCA em arquivo
npm run mapear -- --cnpj <CNPJ com procuraÃ§Ã£o e-CAC vÃ¡lida>
```

O navegador abre visÃ­vel. No fim, `relatorios/_debug/mapa.txt` diz, seletor
por seletor, o que casou e o que nÃ£o casou, e lista os links que existem de
verdade no portal. Corrija `seletores.js` com isso e rode de novo, atÃ© passar.

Se o login por certificado nÃ£o for encontrado, ele dÃ¡ 90 segundos para entrar
na mÃ£o e continua de onde vocÃª parar.

### O que tambÃ©m nÃ£o foi verificado

- **O Drive nunca subiu um arquivo de verdade** â€” sÃ³ foi testado contra um
  Drive simulado (caminho feliz, queda de rede, reenvio da fila, sem Drive).

---

## Comandos

```bash
npm run mapear      # calibrar os seletores contra o portal real
npm start           # coletar a carteira inteira
npm start -- --cnpj 12345678000190   # uma empresa sÃ³
npm run planilha    # planilha de controle -> dados/clientes.json
npm run painel      # monta painel/radar-fiscal.html
npm run documentos  # o que estÃ¡ guardado no acervo
npm run drive-autorizar   # autoriza o Google Drive (uma vez)
```

---

## Regras de trabalho

- **Senha nunca em arquivo.** VariÃ¡vel de ambiente ou prompt oculto. Isso vale
  para a senha do certificado e para o refresh token do Drive.
- **NÃ£o peÃ§a senha no chat.** Ela ficaria no histÃ³rico da conversa.
- **`headless: false` atÃ© funcionar ponta a ponta.** VocÃª precisa ver onde trava.
- **Quando um seletor quebrar**, conserte em `seletores.js` acrescentando um
  candidato Ã  lista. Cada campo Ã© uma lista tentada em ordem, entÃ£o acrescentar
  nunca quebra o que jÃ¡ funcionava.
- **Antes de commitar**, confira que nenhum CNPJ real entrou no diff.

## Idioma

CÃ³digo, comentÃ¡rios, mensagens de commit e conversa em **portuguÃªs do
Brasil**. O usuÃ¡rio Ã© brasileiro e o domÃ­nio Ã© fiscal brasileiro.

## Estilo de resposta esperado

O dono do projeto pediu explicitamente parceria crÃ­tica, nÃ£o concordÃ¢ncia:
questione as ideias dele, aponte falhas e riscos escondidos, diferencie fato
de interpretaÃ§Ã£o, e diga com clareza quando ele estiver errado. Quando nÃ£o
souber, diga que nÃ£o sabe em vez de inventar.
