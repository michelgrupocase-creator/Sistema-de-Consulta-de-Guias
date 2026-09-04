# Robô de Relatório de Pendências (e-CAC)

> **Leia antes de tudo — mudança de 09/03/2026.**
> A Receita aposentou a *Consulta Situação Fiscal* do e-CAC e pôs no lugar o
> **Minhas Dívidas e Pendências**, no Portal de Serviços, com layout refeito no
> padrão gov.br. Os seletores deste projeto foram escritos sem acesso ao portal
> e **precisam ser calibrados contra a tela nova**. Comece por `npm run mapear`
> (abaixo) — ele descobre o caminho real na sua conta em vez de adivinhar.

Automatiza no navegador o que hoje é feito na mão: entra no e-CAC com o
certificado do procurador **uma única vez**, e então percorre a lista de
empresas trocando de perfil e baixando o **Relatório de Situação Fiscal
(pendências)** de cada CNPJ em PDF.

Roda **na sua máquina**, sem custo por consulta.

---

## Antes de começar: leia isto

Três coisas que decidem se isso vai funcionar para você:

1. **Só funciona com certificado A1** (arquivo `.pfx` / `.p12`). Certificado
   **A3** (token USB ou cartão) pede PIN a cada operação e **não roda
   desassistido** — não há contorno honesto para isso.
2. **Cada empresa precisa de procuração eletrônica válida** no e-CAC para o
   CPF/CNPJ do procurador, incluindo o serviço de situação fiscal. Sem
   procuração, nem robô nem API funcionam. Esse costuma ser o gargalo real do
   projeto, não o código.
   Na prática a carteira vem dividida: parte das procurações foi outorgada ao
   **e-CNPJ do escritório** e parte ao **e-CPF do responsável**. O robô lida com
   isso nativamente — veja "Dois (ou mais) certificados" abaixo.
3. **Isto é automação de navegador, não API oficial.** Quebra quando a Receita
   muda o layout, e opera fora dos termos de uso do portal. Quando quebrar, o
   conserto está concentrado em um único arquivo: `src/seletores.js`.

---

## Instalação

```bash
cd automacao
npm install
npx playwright install chromium
```

## Configuração

```bash
cp config.example.json config.json
cp empresas.example.json empresas.json
mkdir -p cert          # coloque aqui os seus arquivos .pfx
```

### Dois (ou mais) certificados

Declare cada certificado com um apelido em `config.json`:

```json
"certificados": {
  "escritorio":  { "pfxPath": "./cert/ecnpj-escritorio.pfx",  "senhaEnv": "ECAC_CERT_ESCRITORIO" },
  "responsavel": { "pfxPath": "./cert/ecpf-responsavel.pfx", "senhaEnv": "ECAC_CERT_RESPONSAVEL" }
},
"certificadoPadrao": "escritorio"
```

E diga, por empresa, sob qual procuração ela está:

```json
[
  { "cnpj": "12.345.678/0001-90", "apelido": "Padaria do Zé",  "certificado": "escritorio" },
  { "cnpj": "98.765.432/0001-10", "apelido": "Posto Canaã",    "certificado": "responsavel" },
  { "cnpj": "11.222.333/0001-44", "apelido": "Usa o padrão" }
]
```

O robô **agrupa a carteira por certificado e abre uma sessão para cada um** —
não dá para trocar o certificado de uma conexão já aberta. Se um certificado
falhar (arquivo errado, senha errada, vencido), só o grupo dele é marcado como
falha; os outros rodam normalmente. O `_execucao.json` registra qual certificado
atendeu cada empresa.

O CNPJ pode ir com ou sem pontuação — o robô normaliza.

A **senha do certificado nunca vai para arquivo**. Ou você exporta a variável
de ambiente, ou o robô pergunta na hora (digitação oculta):

```bash
export ECAC_CERT_ESCRITORIO='senha-1'      # Linux/macOS
export ECAC_CERT_RESPONSAVEL='senha-2'
setx ECAC_CERT_ESCRITORIO "senha-1"        # Windows (reabra o terminal)
```

Todas as senhas são pedidas **antes** de abrir qualquer navegador: numa execução
agendada de madrugada, travar pedindo senha na terceira hora é o pior desfecho.

## Uso

```bash
npm start                       # todas as empresas de empresas.json
npm start -- --cnpj 12345678000190   # só uma empresa (ideal para testar)
```

Saída:

```
relatorios/
  2026-09-04/
    12345678000190_Padaria-do-Ze.pdf
    _execucao.json          <- o que deu certo, o que falhou e por quê
  _debug/
    2026-09-04T...png       <- print da tela no momento de cada falha
    2026-09-04T...html
```

### Opções do `config.json`

| Campo | Para que serve |
|---|---|
| `certificados` | mapa apelido → `{ pfxPath, senhaEnv }` |
| `certificadoPadrao` | usado por empresa que não declara `certificado` |
| `saida` | pasta onde os PDFs são gravados |
| `headless` | `false` mostra o navegador; `true` roda invisível |
| `navegadorPath` | opcional: usar um Chromium já instalado na máquina |
| `esperaEntreEmpresasMs` | intervalo entre empresas (não baixe para 0) |
| `tentativasPorEmpresa` | quantas vezes reprocessar antes de desistir |
| `timeoutRelatorioMs` | quanto esperar a Receita montar o PDF |

### Passo obrigatório antes da primeira coleta: `npm run mapear`

```bash
npm run mapear -- --cnpj 12345678000190
npm run mapear -- --certificado responsavel --cnpj 98765432000110
```

Abre o navegador, percorre as telas **sem baixar nada**, fotografa cada etapa e
testa todos os candidatos de `src/seletores.js` contra a tela real. No fim
escreve `relatorios/_debug/mapa.txt` dizendo, seletor por seletor, o que casou e
o que não casou — e listando os links que existem de verdade no seu portal
(é assim que se acha o endereço novo de "Minhas Dívidas e Pendências").

Se o login por certificado não for encontrado, ele te dá 90 segundos para entrar
na mão e continua a partir de onde você parar.

Mande `mapa.txt` e os PNGs de `relatorios/_debug/` para o ajuste dos seletores.
Com esse relatório, a calibragem sai em uma rodada em vez de três.

### Primeira execução: deixe visível

Em `config.json`, mantenha `"headless": false` até funcionar ponta a ponta.
Você precisa ver onde trava. Só depois mude para `true` e agende.

### O painel

```bash
npm run planilha     # planilha de controle -> automacao/dados/clientes.json
npm run painel       # base -> painel/radar-fiscal.html
```

Gera **um arquivo HTML só**, sem servidor e sem internet: abre com dois cliques
em qualquer máquina do escritório, inclusive de casa. São seis telas — Painel,
Clientes, Certidões, Guias, Relatórios e Ajustes — alimentadas apenas pela aba
**GERAL** da planilha, que é quem define quem é cliente hoje.

O arquivo gerado **não vai para o repositório**: leva CNPJ e situação fiscal de
112 clientes embutidos. Quem precisar dele roda `npm run painel` na própria
máquina, a partir da planilha.

> **Ressalva que está impressa na tela de Certidões.** A planilha guarda uma
> data por certidão e não diz se é a data de **emissão** ou a de **validade**.
> O painel lê como validade, e por isso quase tudo aparece vencido. Se forem
> datas de emissão, a leitura correta é outra (uma CND federal vale 180 dias da
> emissão) e boa parte do vermelho vira verde. É um ajuste de uma linha em
> `certidao()` — mas ninguém deve decidir nada por essa tela antes de saber
> qual das duas é.

---

## Quando quebrar (e vai quebrar)

O robô não morre em silêncio. Quando não encontra um elemento, ele:

1. salva **print + HTML** da tela em `relatorios/_debug/`;
2. diz **qual seletor** falhou, pelo nome usado em `src/seletores.js`;
3. **pula a empresa** e continua as demais, em vez de derrubar a execução.

Para consertar: abra `src/seletores.js`, ache o campo citado no erro e
acrescente um candidato novo à lista. Cada campo é uma lista tentada em ordem,
então **adicionar não quebra o que já funcionava**.

Formatos aceitos:

| Formato | Exemplo | Quando usar |
|---|---|---|
| `css=` | `css=#btnConsultar` | seletor copiado do DevTools |
| `texto=` | `texto=Consultar` | texto visível na tela |
| `papel=` | `papel=button\|Emitir` | botão/link por nome acessível |
| `label=` | `label=CNPJ` | campo de formulário pelo rótulo |

---

## O que ainda não faz (e onde está o valor de verdade)

Hoje isto **baixa PDFs**. Baixar PDF não é produto: você trocou o trabalho
manual de baixar pelo trabalho manual de ler 200 arquivos.

O próximo passo — e o que realmente justifica o projeto — é **extrair as
pendências do PDF, guardar no banco e comparar com a execução anterior**, para
o sistema avisar apenas o que mudou:

> "Padaria do Zé ganhou uma pendência de DCTFWeb 08/2026 que não existia na
> semana passada."

Isso é vigilância fiscal, e é o que se vende. O resto é armazenamento.

---

## Segurança

O `.gitignore` desta pasta bloqueia `config.json`, `empresas.json`, `cert/`,
`*.pfx` e `relatorios/`. **Não remova essas linhas.** Certificado, senha e
relatórios de pendências de terceiros são dados sob sigilo fiscal — commitar
qualquer um deles é incidente, não deslize.
