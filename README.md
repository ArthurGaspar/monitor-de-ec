# Monitor da Economia Corporativa

**A economia brasileira vista pelos balanços das companhias abertas.** Toda companhia aberta entrega à CVM um ITR por
trimestre e uma DFP por ano. Somados, esses formulários mostram quais setores vendem mais, quem lucra, quem está
endividado e como isso muda de um trimestre para o outro. Um ETL em Python baixa esses dados abertos e as taxas do
Tesouro Direto, corrige o que precisa ser corrigido e publica um painel estático. Um LLM escreve o boletim do trimestre a
partir dos números calculados, e cada número do texto é conferido contra a ficha de fatos que ele recebeu.

Python · pandas · DuckDB · httpx · Claude API ou Ollama · Vite + TypeScript · ECharts · GitHub Pages

## O caminho dos dados

```text
dados.cvm.gov.br  DFP + ITR 2019→hoje (zips)  ─┐
                  cadastro de companhias       ├─► extract ─► cvm.read_zip ─► quality.fix_scale ─► quarters ─► metrics ─┬─► DuckDB (.data/monitor.duckdb)
Tesouro Transparente  preços e taxas diárias  ─┘   (GET condicional,   (DRE, BPA, BPP     (escala trocada)  (4º tri =   (mesmas  │
                                                     cache local)       consolidados)                       DFP − 9M)   empresas)└─► web/public/data/*.json ─► painel
                                                                                                                                              │
                                                              ficha de fatos do trimestre ─► Claude ou Ollama ─► conferência de números e termos ─► boletins.json
```

| Etapa | Arquivo | O que faz |
|---|---|---|
| Extração | `etl/extract.py` | Baixa DFP e ITR de cada ano, o cadastro e o CSV do Tesouro. Usa GET condicional (ETag / Last-Modified), então só o zip do ano corrente costuma ser baixado de novo. |
| Leitura | `etl/cvm.py` | Lê DRE, balanço ativo e passivo consolidados, só o exercício corrente e só a versão mais nova de cada formulário. Normaliza a escala para R$ mil. |
| Qualidade | `etl/quality.py` | Corrige formulários com escala trocada (valores mil vezes fora) e acha holdings que repetem os números da controlada. |
| Trimestres | `etl/quarters.py` | Transforma períodos publicados em trimestres isolados. O 4º trimestre é a DFP anual menos o acumulado de nove meses. |
| Indicadores | `etl/metrics.py` | Setores, crescimento mesmas-empresas, margem, dívida líquida / EBIT de 12 meses, indicadores por empresa. |
| Tesouro | `etl/tesouro.py` | Taxa de 5 anos interpolada para prefixado e IPCA+, inflação implícita e a curva do dia. |
| Carga e publicação | `etl/pipeline.py` | Grava tudo no DuckDB e publica o JSON do painel (cerca de 220 KB). |
| Boletim | `etl/bulletin.py` | Monta a ficha de fatos, pede o texto ao LLM e confere números e termos. |

## Decisões que mudam o resultado

- **Crescimento só entre as mesmas empresas.** A soma dos setores muda com IPOs e cancelamentos de registro. Por isso
  todo crescimento compara apenas quem publicou nos dois trimestres comparados. Os totais em R$ somam todas as empresas
  que publicaram no trimestre.
- **Lucro achado pelo rótulo, não pelo código.** Nas empresas comuns, o lucro do período fica na conta 3.11. Bancos e
  seguradoras usam outros planos, e o lucro deles aparece em 3.09, 3.11 ou 3.13. O leitor procura o rótulo
  ("Lucro … Consolidado do Período").
- **Bancos fora de receita e dívida.** No plano dos bancos, 3.01 é "receitas de intermediação financeira" e não existe
  "empréstimos e financiamentos" no mesmo sentido. O setor financeiro entra só no lucro.
- **Escala trocada.** Algumas empresas pequenas marcam o formulário como "UNIDADE" e continuam lançando em milhares.
  O ativo desses formulários fica mil vezes menor que o das DFP da própria empresa, e o ETL desfaz isso antes de calcular
  o 4º trimestre. Sem essa correção, DFP menos ITR em escalas diferentes daria um número sem sentido. Na última execução,
  93 formulários foram corrigidos.
- **Holdings duplicadas.** A Suzano Holding consolida a Suzano, e a Metalúrgica Gerdau consolida a Gerdau: as duas de
  cada par publicam a mesma receita e o mesmo EBIT. Pares assim são detectados automaticamente, e a holding sai da conta.
  Itaúsa e Bradespar ficam de fora por lista, porque o resultado delas é quase todo equivalência patrimonial do Itaú e da
  Vale.
- **Trimestre parcial.** O prazo do ITR é de 45 dias. Enquanto o último trimestre tem menos empresas que o anterior, o
  painel o mostra como parcial, e os destaques, a tabela de empresas e o boletim usam o último trimestre completo.

## O boletim escrito por LLM

O modelo recebe apenas uma ficha de fatos já calculada, com os números formatados como devem aparecer no texto. Ele não
tem acesso à base. A instrução manda escrever só com esses números. Depois que o texto volta, duas conferências rodam:

- **Números:** todo número do texto que não está na ficha vai para `nao_verificados` e aparece marcado no painel.
- **Termos:** expressões que contradizem os dados, como "receita bruta" (os dados são de receita líquida) ou "inflação
  do IPCA" (a taxa do IPCA+ é juro real), vão para `termos_errados`.

O provedor é escolhido sozinho: Claude (`claude-opus-5`, com fallback de recusa no servidor) quando há credencial da
Anthropic, senão `qwen2.5:7b` no Ollama local. O boletim publicado agora foi escrito pelo qwen2.5:7b, e as conferências
marcaram nele um número calculado pelo modelo ("0,3 ponto percentual") e uma confusão entre juro real e inflação. Um
modelo de 7B escreve de forma fluente, mas erra o sentido dos indicadores. É para isso que as conferências existem.

## Resultados da última execução

Dados até o 3º trimestre de 2026, ainda parcial, com 461 empresas no painel. No 2º trimestre de 2026, o último completo:

| Indicador | 2º tri 2026 | Um ano antes |
|---|---|---|
| Receita líquida, não financeiras | R$ 1.163 bi (+10,9% nas mesmas empresas) | R$ 1.062 bi |
| Lucro líquido, não financeiras | R$ 90,2 bi | R$ 77,3 bi |
| Margem líquida, não financeiras | 7,8% | 7,3% |
| Dívida líquida / EBIT 12 meses | 3,1x | 3,2x |
| Lucro dos bancos e seguradoras | R$ 38,7 bi | R$ 33,9 bi |

São somas nominais, sem correção pela inflação, e a coluna "um ano antes" soma quem publicou naquele trimestre (o
crescimento entre parênteses compara só as mesmas empresas). A Petrobras sozinha teve R$ 169,5 bi de receita e
R$ 52,5 bi de lucro no 2º trimestre de 2026: cerca de um sétimo da receita e mais da metade do lucro das não financeiras. Um setor de quatro empresas, como Papel e celulose,
oscila com o resultado de uma delas.

## Limites

- Holdings que consolidam controladas também listadas, mas com números diferentes (por exemplo, Cosan e Rumo), ainda
  contam em dobro. Só os pares idênticos são removidos.
- Empresas com exercício fora do ano civil, com trimestres terminando em abril ou julho, ficam fora, para os trimestres
  de todos os setores se alinharem.
- O 4º trimestre depende da DFP e do ITR de setembro da mesma empresa. Se um dos dois falta, o trimestre fica vazio.
- A taxa do Tesouro é a de compra das 9h (a de venda, quando o título não está à venda), interpolada em 5 anos misturando
  títulos com e sem cupom. Serve como indicador do custo do dinheiro, não como curva de mercado.

## Rodar localmente

Requer Python 3.11+ com [uv](https://docs.astral.sh/uv/) e Node 22+.

```sh
uv sync
uv run python -m etl run              # baixa cerca de 330 MB na primeira vez; depois, só o que mudou
uv run python -m etl run --offline    # reprocessa com o que já está em .data/raw (uns 20 s)
uv run pytest -q
```

O boletim pode usar Claude ou o Ollama local:

```sh
uv run python -m etl bulletin                     # Claude se houver ANTHROPIC_API_KEY ou `ant auth login`, senão Ollama
uv run python -m etl bulletin --provider ollama   # qwen2.5:7b: uns 5 min e ~5,5 GB de RAM num CPU sem GPU
uv run python -m etl bulletin --quarters 4        # os últimos quatro trimestres completos
```

O painel:

```sh
cd web
npm ci
npm run dev      # ou npm run build para gerar web/dist
```

O DuckDB em `.data/monitor.duckdb` tem as tabelas `fatos`, `empresas`, `painel`, `setores`, `tesouro_titulos` e
`tesouro_5a`, para consultas que o painel não mostra:

```sh
uv run python -c "import duckdb; duckdb.connect('.data/monitor.duckdb').sql('select setor, round(avg(margem), 3) as margem_media from setores group by 1 order by 2 desc').show()"
```

O JSON em `web/public/data` fica versionado. O CI (`.github/workflows/pages.yml`) roda os testes e publica o painel no
GitHub Pages sem baixar a CVM e sem chamar LLM. Para atualizar os dados, rode o ETL localmente e faça commit do JSON.

## Fontes

- CVM, Portal de Dados Abertos: [DFP](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp),
  [ITR](https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr), [cadastro](https://dados.cvm.gov.br/dataset/cia_aberta-cad).
- Tesouro Nacional, Tesouro Transparente: [preços e taxas dos títulos do Tesouro Direto](https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto).
