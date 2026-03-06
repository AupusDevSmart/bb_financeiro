# Painel de UGs (Usinas Geradoras)

**Componente**: `src/components/PainelUGs.js`
**Endpoints principais**: `GET /api/ugs/resumo/:mes` e `GET /api/ugs/lista/:mes`

## O que é

Página dedicada ao acompanhamento das usinas geradoras (UGs) do consórcio Aupus. Mostra a energia total injetada pelas usinas, quanto dessa energia é cobrada (de UGs autorizadas) e quanto é descartada (de UGs não autorizadas). Também exibe o status de download das faturas das próprias UGs.

As UGs são unidades com `gerador = true` na tabela `unidades_consumidoras` do CRM. Elas NÃO aparecem no Controle Mensal (que é só de UCs consumidoras) — têm esta página própria.

Os meses disponíveis vêm de `GET /api/meses-disponiveis-boletos`, mesmo endpoint usado pelo Dashboard.

---

## Seção 1: Cards de Resumo (Endpoint `/api/ugs/resumo/:mes`)

### UGs Cadastradas

- **DB**: `aupus_prod` (92.113.38.164)
- **Tabela**: `unidades_consumidoras`
- **Condições**: `gerador = true` e `deleted_at IS NULL`

Total de usinas geradoras ativas cadastradas no CRM. Atualmente são 12 usinas.

### Total Injetado (kWh)

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `faturas_baixadas`
- **Coluna**: `dados_leitura->'_ugs_injecao_lista'` (JSONB array)
- **Campo**: `energia_injetada_ug` (de cada item do array)
- **Condições**: `status = 'processado'`, `is_duplicata = false`, campo `_ugs_injecao_lista` não nulo

Soma de toda a energia que as usinas injetaram nas UCs dos associados naquele mês. O dado vem da leitura da fatura de cada UC — dentro do campo JSONB `dados_leitura`, o array `_ugs_injecao_lista` contém uma entrada por usina geradora que injetou energia naquela UC, com o campo `energia_injetada_ug` em kWh. Também soma energia de UGs que aparecem em `_ugs_nao_autorizadas`.

### Total Cobrado (kWh)

- **Cálculo**: soma de `energia_injetada_ug` apenas de UGs **autorizadas** (cadastradas no CRM com `gerador = true`)
- **Lógica**: para cada injeção em `_ugs_injecao_lista`, verifica se a `uc_geradora` existe na tabela `unidades_consumidoras` com `gerador = true`. Se sim, a energia é contabilizada como "cobrada".

Energia que a Aupus pode efetivamente cobrar dos associados, porque foi injetada por usinas que fazem parte do consórcio.

### Descartado (kWh)

- **Cálculo**: soma de `energia_injetada_ug` de UGs **não autorizadas** (não cadastradas no CRM ou `gerador ≠ true`)
- **Fontes**: `_ugs_injecao_lista` (itens com UG não cadastrada) + `_ugs_nao_autorizadas` (lista explícita do microserviço)

Energia injetada por usinas que não são da Aupus. Não pode ser cobrada. Aparece em vermelho quando > 0.

### Barra de Percentual

- **Cálculo frontend**: `(cobrado / injetado) * 100` para percentual autorizado; `(descartado / injetado) * 100` para percentual não autorizado.

---

## Seção 2: UGs Não Autorizadas (Alertas)

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `faturas_baixadas`
- **Colunas**: `dados_leitura->'_ugs_injecao_lista'` e `dados_leitura->'_ugs_nao_autorizadas'`

Seção condicional que só aparece quando existem injeções de UGs não cadastradas. Mostra uma tabela com:

| Coluna | Origem |
|--------|--------|
| UC Geradora | `uc_geradora` do array `_ugs_injecao_lista` ou `_ugs_nao_autorizadas` |
| UC Destino | `uc` da fatura em `faturas_baixadas` (a UC consumidora que recebeu a injeção) |
| Cliente | Cruzamento com `controle_clube` + `propostas` no CRM, ou `nome_cliente` da fatura |
| Energia Descartada | `energia_injetada_ug` da UG não autorizada |

---

## Seção 3: Detalhamento por Usina Geradora (Accordion)

- **Fonte**: mesmo endpoint `/api/ugs/resumo/:mes`, campo `ugs_detalhado`

Para cada UG (agrupada por `uc_geradora`), exibe um accordion com header mostrando nome da UG, número UC, quantidade de UCs atendidas e total injetado. Ao expandir, mostra tabela com todos os destinatários:

| Coluna | Origem | O que é |
|--------|--------|---------|
| UC Destino | `uc` de `faturas_baixadas` | Número da UC consumidora que recebeu energia desta UG |
| Cliente | `controle_clube` + `propostas` (CRM) | Nome do associado dono da UC |
| Injetado | `energia_injetada_ug` de `_ugs_injecao_lista` | kWh injetados por esta UG nesta UC |
| Cobrado | = Injetado se autorizada, 0 se não | kWh que a Aupus cobra do associado |
| Descartado | = Injetado se não autorizada, 0 se sim | kWh não cobráveis |
| Status | Verifica se UG está no CRM | "OK" (autorizada) ou "Não Autorizada" |

Linha de totais ao final de cada UG soma Injetado, Cobrado e Descartado.

---

## Seção 4: Faturas das Usinas Geradoras (Endpoint `/api/ugs/lista/:mes`)

Lista das 12 UGs com o status de download da fatura delas próprias (não confundir com injeções nas UCs).

### Dados exibidos

| Coluna | Origem | O que é |
|--------|--------|---------|
| Número UC | `unidades_consumidoras.numero_unidade` (CRM) | Número da UC da usina geradora |
| Nome da UG | `unidades_consumidoras.nome_usina` (CRM) | Nome da usina (ex: "UFV Cachoeira") |
| Status | Cruzamento CRM + `faturas_baixadas` | Status do download da fatura da UG |
| Ação | `faturas_baixadas.caminho_storage` | Botão de download do PDF (se baixada) |

### Status de Fatura da UG

| Status | Condição | Significado |
|--------|----------|-------------|
| Baixada | Tem registro em `faturas_baixadas` com `categoria` preenchida OU `status = 'processado'` | Fatura da UG foi baixada e processada |
| Pendente | Tem registro em `faturas_baixadas` mas sem `categoria` e `status ≠ 'processado'` e `status ≠ 'erro'` | Fatura existe mas não foi processada ainda |
| Com Erro | `status IN ('erro', 'erro_processamento')` em `faturas_baixadas` | Falha no processamento da fatura |
| Não Baixada | Sem registro em `faturas_baixadas` para o mês | Fatura da UG ainda não foi obtida |

### Estatísticas (badges no header)

- **Baixadas**: `ugsLista.filter(status === 'Baixada').length`
- **Não Baixadas**: `ugsLista.filter(status === 'Nao Baixada').length`

---

## Exportar Excel

- **Endpoint**: `GET /api/ugs/exportar/:mes`
- Gera planilha Excel (.xlsx) com todas as informações da página: resumo de energia, detalhamento por UG e status de faturas.

---

## Resumo dos bancos

| Dado | Banco | Tabela | Coluna chave |
|------|-------|--------|-------------|
| UGs Cadastradas | aupus_prod (remoto) | unidades_consumidoras | gerador = true |
| Nomes de Clientes | aupus_prod (remoto) | controle_clube + propostas | nome_cliente |
| Injeção de Energia | aupus_faturas (local) | faturas_baixadas | dados_leitura->_ugs_injecao_lista |
| UGs Não Autorizadas | aupus_faturas (local) | faturas_baixadas | dados_leitura->_ugs_nao_autorizadas |
| Status Fatura UG | aupus_faturas (local) | faturas_baixadas | uc, status, dados_leitura->categoria |
| PDF da UG | aupus_faturas (local) | faturas_baixadas | caminho_storage |
