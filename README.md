# Painel de fluxo de caixa

Painel web estático que lê uma planilha de fluxo de caixa e publica um dashboard
de contas a pagar, fluxo de 13 semanas e diagnóstico financeiro.

**Os dados são criptografados** (AES-256-GCM, chave derivada da senha por
PBKDF2-SHA256 com 310.000 iterações). O `dados.js` publicado não é legível sem a
senha, o que permite hospedar em GitHub Pages sem expor os números.

> A força real da proteção depende **inteiramente do tamanho da senha**: o arquivo
> cifrado é acessível publicamente, então uma senha curta pode ser descoberta por
> tentativa e erro offline. Para proteção efetiva, use uma frase longa.

## O que o painel mostra

| Seção | Para quê |
|---|---|
| Indicadores | Total a pagar no período, saldo em conta, maior dia, nº de lançamentos |
| Alertas | Cobertura de caixa, contas negativas, pendências |
| **Fluxo de 13 semanas** | Horizonte de tesouraria: entradas, saídas, saldo projetado por semana |
| Pagamentos por data | Colunas empilhadas por empresa |
| Desembolso acumulado | Consumo de caixa ao longo do período |
| Composição | Total por empresa e por natureza do gasto |
| Agenda | O que pagar em cada data, agrupado por empresa |
| Tabela | Detalhe ordenável, com exportação para CSV |
| Diagnóstico | Leitura financeira, independente dos filtros |

Filtros: intervalo de datas, períodos rápidos, bloco do grupo, empresa, natureza e
busca. Nos chips de faceta: **clique** mostra/oculta, **duplo-clique** isola.
Tema claro/escuro, e funciona no celular.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura e estilos |
| `app.js` | Filtros, gráficos (SVG), agenda, tabela e diagnóstico |
| `build.py` | Lê as fontes, classifica, projeta e cifra |
| `dados.js` | Saída cifrada — **gerada, não editar à mão** |
| `logo.png` / `logo-dark.png` | Logomarca para fundo claro e escuro |
| `*-modelo.csv` / `*-modelo.json` | Modelos de entrada, com dados fictícios |

Sem dependências em tempo de execução: nenhuma CDN, nenhuma requisição externa.

## Gerando o painel

```bash
pip install openpyxl cryptography
python build.py "caminho/para/planilha.xlsx" SUA_SENHA
```

O build regrava `dados.js` e carimba o `index.html` com um `?v=<hash>` novo — é o
que faz o navegador de quem já visitou pegar a versão nova em vez do cache. Por isso
**os dois arquivos vão no commit**:

```bash
git add dados.js index.html && git commit -m "Atualiza fluxo de caixa" && git push
```

O GitHub Pages republica em cerca de um minuto. Quem estiver com a página aberta pode
precisar de **Ctrl+F5**.

O build imprime uma conferência: o total dos lançamentos precisa bater com a soma dos
subtotais da planilha. Se não bater, a estrutura mudou e a extração precisa de ajuste.

### Trocando a senha

Rode o `build.py` com a senha nova e faça push de `dados.js` e `index.html`.

## Arquivos de entrada

Os arquivos com dado real **não ficam nesta pasta**. Eles moram no repositório privado
do projeto, e o build os encontra sozinho, nesta ordem:

1. a variável de ambiente `ARTFLEX_CONFIG`
2. o repositório privado clonado ao lado, em `config/`
3. esta pasta — só como alternativa, para quem preferir copiar

Manter cópia dos dois lados criava divergência silenciosa: editar uma e a outra ficar
velha sem ninguém notar. **Há um só original, e ele fica no repositório privado.**

Os `*-modelo.*` versionados aqui mostram o formato, com dados fictícios.

### `recebimentos.csv` — o que entra

```
data;empresa;valor
2026-09-05;Empresa A;120000,00
```

Colunas opcionais: `descricao`, `sacado`, `banco`, `documento`. O leitor é tolerante:
separador `;`, `,` ou tabulação detectado sozinho; datas em `dd/mm/aaaa` ou ISO;
valores como `1.234,56`, `R$ 1.234,56` ou `1234.56`; nomes de coluna em variantes
comuns (`vencimento` serve como `data`, `cliente` como `sacado`). Linhas inválidas são
ignoradas com aviso.

Sem esse arquivo, o fluxo de 13 semanas roda só com saídas — e o painel diz isso
explicitamente, para o saldo projetado não ser lido como previsão.

### `recebiveis/` — carteira de cobrança dos bancos

Solte aqui os `.xls` exportados da consulta de títulos do banco. O leitor espera as
colunas `Nome do Pagador`, `CPF/CNPJ do Pagador`, `Vencimento`, `Nosso Número`,
`Seu Número`, `Situação` e `Valor` — o layout padrão do Banco do Brasil.

**A separação vem do nome do arquivo.** Se contiver *descontad*, os títulos são
tratados como já antecipados; qualquer outro nome é carteira simples. O banco sai da
primeira palavra, e a empresa dona vem do mapa `carteiras` do `grupo.json`.

```
BB boletos carteira 25.08.2026.xls      -> simples
BB boletos descontado 25.08.2026.xls    -> descontada
```

Por que a distinção importa: **título descontado já virou dinheiro.** Ele não é
entrada futura — é risco de recompra, porque se o sacado não pagar, a empresa devolve.
Só a carteira simples entra no fluxo de 13 semanas. Somar os dois contaria o mesmo
dinheiro duas vezes.

O painel agrupa a concentração de clientes pela **raiz do CNPJ**: matriz e filial do
mesmo grupo são o mesmo risco de crédito.

#### Quando o título vem sem CNPJ

Nem toda fonte traz o documento, e as que trazem o nome escrevem cada uma de um jeito.
O build tenta cinco caminhos, nesta ordem. **Todos exigem igualdade exata depois de
normalizar** — nenhum é por semelhança:

| # | Caminho |
|---|---|
| 1 | **Apelido confirmado** — alguém já respondeu quem é, em `apelidos.csv` |
| 2 | Outro título, mesmo nome, que veio com CNPJ |
| 3 | Cadastro do ERP, nome idêntico |
| 4 | Cadastro do ERP, tolerando **acento perdido** na exportação |
| 5 | Cadastro do ERP, tolerando **nome truncado** pelo banco |

O caminho 4 existe porque alguns bancos exportam trocando a letra acentuada por
espaço: `MÓVEIS` chega como `M VEIS`, `COLCHÕES` como `COLCH ES`. Tirar o acento não
resolve — a letra sumiu, não virou outra. A chave apaga a letra acentuada dos dois
lados, então os dois viram a mesma coisa.

O caminho 5 existe porque o nome vem cortado em ~40 caracteres. Exige que o nome da
fonte seja o **começo literal** do nome do cadastro, com no mínimo 12 caracteres, e
que todos os cadastros com aquele prefixo tenham a **mesma raiz**.

Casamento por semelhança foi testado e **reprovado**: apontou pares com 100% de
confiança que eram empresas diferentes. Errar o casamento não gera erro nenhum — só
deixa o número errado para sempre. Ficar sem identificar é melhor.

### `apelidos.csv` — a resposta que não se pergunta duas vezes

```
nome_na_fonte;documento;nome_no_cadastro;confirmado_em;obs
FULANO D SOUZA MOVEIS;11222333000181;FULANO DE SOUZA MOVEIS;2026-01-15;banco abrevia
```

Quando um nome não casa com o cadastro e a dúvida vira pergunta, a resposta vira linha
aqui — e o build nunca mais pergunta. É o **primeiro** caminho tentado: se uma pessoa
disse quem é, não há o que deduzir.

Serve também para o cliente que não está no ERP: basta informar o documento à mão.

### `dividas.csv` — empréstimos e antecipações

```
operacao;empresa;banco;produto;tipo;saldo;taxa_am;capital_mes;dia;fim;obs
```

`tipo` define o comportamento:

- **`sac`** — amortiza capital fixo por mês; juros sobre o saldo decrescente
- **`rotativo`** — só juros sobre o saldo, sem amortização (conta garantida)
- **`fixa`** — parcela constante, informada em `capital_mes`
- **`antecipacao`** — duplicata cedida com coobrigação. Não gera parcela (quem paga é
  o sacado), mas o saldo entra no quadro como **risco de recompra**. Campos extras:
  `face`, `liquido`, `recompra`, `taxa_capa`

As parcelas projetadas entram no fluxo de 13 semanas, mas ficam **fora** da lista de
pagamentos da planilha — não podem contaminar a conferência dos subtotais.

## Configuração no `build.py`

- `EMPRESAS` — nomes soltos da planilha viram entidades com nome de exibição, bloco e
  regime tributário
- `CONTAS` — de quem é cada conta bancária, para o saldo de abertura respeitar o filtro
- `categoria()` — classificação por natureza, inferida do texto da descrição. Serve
  para leitura gerencial, **não para contabilidade**
- `EXCLUIR` — retira lançamentos do painel sem alterar a planilha. O total retirado é
  sempre declarado no rodapé e no diagnóstico: **um corte de caixa invisível seria pior
  do que não cortar**

## Confidencialidade

Repositório público para permitir GitHub Pages gratuito. A proteção real está na
criptografia do `dados.js`. Portanto:

- **Nunca** faça commit da planilha, dos CSVs de entrada ou de documentos com números,
  estrutura societária ou análise fiscal. O `.gitignore` cobre os padrões conhecidos —
  confira antes de adicionar arquivo novo.
- **Nunca** escreva valores reais, nomes de contrapartes ou instituições dentro do
  código: tudo deve vir dos arquivos de entrada, que são cifrados no `dados.js`.
- **Nunca** escreva a senha em arquivo, commit, issue ou junto com o link.
- Ao trocar a senha, lembre que **o histórico do git guarda as versões antigas** e elas
  continuam abríveis com as senhas antigas. Trocar a senha protege a versão nova, não
  apaga a exposição da anterior.
