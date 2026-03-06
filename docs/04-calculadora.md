# Calculadora AUPUS

**Serviço**: `aupus-microservicos-faturas/servicos/calculadora/`
**Arquivo principal**: `Calculadora_AUPUS.py`
**API**: `api.py` (FastAPI, porta 8002)
**Endpoint**: `POST /api/v1/calculos/aupus`

## O que é

Microserviço Python que recebe os dados extraídos de uma fatura de energia (PDF já lido) e calcula os valores financeiros da Aupus: quanto o associado economiza, quanto paga de boleto, e como a energia compensada é distribuída. É chamada pelo orquestrador **apenas** para clientes CLA com categoria "Grupo B - compensação".

A calculadora NÃO lê PDFs, NÃO acessa a tabela de faturas e NÃO gera boletos. Ela recebe dados, calcula, e devolve. O orquestrador é quem orquestra o pipeline completo.

---

## Pipeline Completo (contexto)

```
PDF no S3 → Leitor PDF (8001) → Orquestrador (8000) → Calculadora (8002) → API-BB
                                        ↑
                                  CRM (aupus_prod)
```

1. **Leitor PDF** extrai campos da fatura → `dados_leitura`
2. **Orquestrador** busca dados do cliente no CRM (`buscar_cliente_planilha`)
3. **Calculadora** recebe `dados_leitura` + configuração do cliente → retorna `dados_calculados`
4. **Orquestrador** envia payload para `POST /api/dados-boleto-energia` no API-BB
5. API-BB insere/atualiza em `boletos_energia`

**Condições para chamar a calculadora**:
- `sigla == 'CLA'` (cliente do Club Aupus)
- `categoria == 'Grupo B - compensação'` (classificação vinda do leitor PDF)

Se qualquer condição falhar, `dados_calculados` fica `None` e o fluxo segue sem cálculos.

---

## Dados de Entrada

### Do Leitor PDF (`dados_fatura`)

| Campo | Tipo | O que é |
|-------|------|---------|
| `consumo_comp` | float | kWh de energia compensada (créditos das UGs aplicados pela concessionária) |
| `consumo_n_comp` | float | kWh de energia não compensada (cobrada direto pela concessionária) |
| `energia_injetada` | float | kWh total injetado pelas UGs nesta UC |
| `consumo_comp_p` / `_fp` / `_hi` | float | Consumo compensado por período tarifário (ponta/fora-ponta/horário intermediário) |
| `tarifa_consumo_n_comp` | float | R$/kWh da tarifa de energia não compensada |
| `tarifa_consumo_n_comp_fp` / `_p` / `_hi` | float | Tarifas por período |
| `tarifa_comp` | float | R$/kWh da tarifa de compensação (SCEE) |
| `tarifa_adc_bandeira_amarela` | float | R$/kWh adicional de bandeira amarela |
| `tarifa_adc_bandeira_vermelha` | float | R$/kWh adicional de bandeira vermelha |
| `valor_concessionaria` | float | R$ total cobrado pela concessionária na fatura |
| `valor_bandeira` | float | R$ de adicional de bandeira na fatura |
| `valor_juros` | float | R$ de juros na fatura |
| `valor_multa` | float | R$ de multa na fatura |
| `valor_consumo_pis_cofins` | float | R$ de PIS/COFINS sobre consumo (usado em tag `nome_diferente`) |
| `iluminacao_publica` | float | R$ de contribuição de iluminação pública |
| `aliquota_pis` | float | Alíquota PIS (decimal, ex: 0.0065) |
| `aliquota_cofins` | float | Alíquota COFINS (decimal, ex: 0.03) |
| `aliquota_icms` | float | Alíquota ICMS (decimal, ex: 0.25) |
| `grupo` | string | Grupo tarifário (ex: "B") |
| `modalidade_tarifaria` | string | Modalidade (ex: "Convencional") |
| `tipo_fornecimento` | string | Trifásico, Monofásico ou Bifásico |
| `_ugs_injecao_lista` | array | Lista de UGs que injetaram energia nesta UC |

### Da Configuração do Cliente (CRM via orquestrador)

| Campo | Tipo | O que é |
|-------|------|---------|
| `desconto_fatura` | float | Desconto Aupus sobre energia compensada (0-1, ex: 0.20 = 20%) |
| `desconto_bandeira` | float | Desconto Aupus sobre bandeira compensada (0-1) |
| `vencimento_consorcio` | string | Dia do vencimento do boleto (ex: "20") |
| `modo_calculo` | int | 0 = com impostos, 1 = sem impostos |
| `compensacao_completa` | bool | Se deve forçar compensação simulada |
| `cobrar_multa` | bool | Se NÃO subtrai juros/multa do valor final (Coluna T da planilha) |

---

## Etapas do Cálculo

### Etapa 1: Filtragem de UGs Autorizadas

- **Fonte**: `Ler_UGs_Autorizadas.py` consulta `aupus_prod` → `unidades_consumidoras WHERE gerador = true`
- **Cache**: 5 minutos de TTL para evitar consultas repetidas
- **Lógica**: compara cada UG de `_ugs_injecao_lista` com as UGs cadastradas no CRM

| Resultado | O que acontece |
|-----------|----------------|
| UG cadastrada com `gerador = true` | Energia contabilizada como `_consumo_comp_aupus` (cobrável) |
| UG não cadastrada | Energia vai para `_energia_descartada_ugs` (descartada) e UG vai para `_ugs_nao_autorizadas` |

Após filtragem, o campo `_consumo_comp_aupus` contém apenas a energia de UGs autorizadas, que é o valor usado para calcular o boleto Aupus.

### Etapa 2: Verificação de Compensação

A calculadora analisa se a fatura já veio com compensação da concessionária:

| Cenário | Condição | Ação |
|---------|----------|------|
| **Tem compensação** | `consumo_comp > 0` E `energia_injetada > 0` | Vai para Etapa 3 (ajuste) |
| **Sem compensação** | `consumo_comp == 0` E `energia_injetada == 0` | Vai para Etapa 4 (compensação simulada) |
| **Consumo zero** | `consumo_total == 0` | Sem cálculo (fatura vazia) |

### Etapa 3: Ajuste de Compensação Existente

Se a fatura já tem compensação mas `consumo_n_comp` não está no mínimo da tarifa:

- **Tarifa mínima por tipo de fornecimento**:
  - Monofásico: 30 kWh
  - Bifásico: 50 kWh
  - Trifásico: 100 kWh

- **Condições para ajustar**: flag `compensacao_completa = true` no CRM, `consumo_n_comp > tarifa_minima`, `consumo_total > tarifa_minima`
- **Ação**: reduz `consumo_n_comp` até a tarifa mínima, aumenta `consumo_comp` com a diferença
- **Recalcula** `valor_concessionaria` subtraindo o valor da energia movida
- **Flag**: `compensacao_completa_aplicada = true`, `tipo_compensacao = "corrigida"`

### Etapa 4: Compensação Simulada (criar do zero)

Quando a fatura veio **sem nenhuma compensação** e o cliente tem flag `compensacao_completa = true`:

1. `consumo_n_comp = tarifa_minima` (30, 50 ou 100 kWh conforme tipo)
2. `consumo_comp = consumo_total - tarifa_minima`
3. Recalcula `valor_concessionaria`:
   - `energia_movida = consumo_comp_novo`
   - `tarifa_total = tarifa_energia + tarifa_bandeira` (se duas bandeiras no mês, divide cada por 2)
   - `valor_concessionaria_novo = valor_antigo - (energia_movida × tarifa_total)`
4. **Flag**: `compensacao_completa_aplicada = true`, `tipo_compensacao = "simulada"`

### Etapa 5: Cálculo Financeiro Aupus

```
1. valor_comp = consumo_comp_aupus × tarifa_comp
   (Valor bruto da compensação: energia autorizada × tarifa SCEE)

2. Se tag "nome_diferente" e valor_consumo_pis_cofins > 0:
   proporção = consumo_comp_aupus / consumo_comp_original
   valor_pis_cofins_deduzido = valor_consumo_pis_cofins × proporção
   valor_comp -= valor_pis_cofins_deduzido

3. Bandeiras:
   valor_band_comp = consumo_comp_aupus × tarifa_bandeira_amarela
                   + consumo_comp_aupus × tarifa_bandeira_vermelha
   (Se duas bandeiras no mesmo mês: cada uma aplica a metade)

4. Descontos Aupus:
   valor_com_desconto = valor_comp × (1 - desconto_fatura)
   valor_bandeira_com_desconto = valor_band_comp × (1 - desconto_bandeira)

5. Valor Aupus (total com desconto):
   valor_aupus = valor_com_desconto + valor_bandeira_com_desconto

6. Valor do Boleto (consórcio):
   Se cobrar_multa = false:
     valor_consorcio = valor_aupus + valor_concessionaria - valor_juros - valor_multa
   Se cobrar_multa = true:
     valor_consorcio = valor_aupus + valor_concessionaria

7. Economia:
   valor_s_desconto = valor_comp + valor_band_comp  (sem desconto Aupus)
   valor_economia = valor_s_desconto - valor_aupus
```

---

## Dados de Saída (`dados_calculados`)

### Estrutura da resposta da API

```json
{
  "sucesso": true,
  "valores_originais": { ... },
  "descontos_aplicados": { ... },
  "valores_calculados": { ... },
  "filtragem_ugs": { ... },
  "flags": { ... },
  "deducao_pis_cofins": { ... }
}
```

### valores_originais

| Campo | O que é |
|-------|---------|
| `consumo_compensado` | kWh compensados originais (antes de ajustes) |
| `consumo_nao_compensado` | kWh não compensados originais |
| `tarifa_compensacao` | R$/kWh da tarifa SCEE |
| `valor_concessionaria` | R$ original da concessionária |
| `valor_bandeiras` | R$ original das bandeiras |

### descontos_aplicados

| Campo | O que é |
|-------|---------|
| `desconto_fatura_percentual` | % de desconto sobre energia compensada (ex: 20%) |
| `desconto_fatura_valor` | R$ economizado pelo desconto na fatura |
| `desconto_bandeira_percentual` | % de desconto sobre bandeira compensada |
| `desconto_bandeira_valor` | R$ economizado pelo desconto na bandeira |

### valores_calculados

| Campo | Usado em | O que é |
|-------|----------|---------|
| `valor_comp_bruto` | `boletos_energia.valor_energia_compensada` | R$ bruto da compensação (antes do desconto Aupus) |
| `valor_com_desconto` | `boletos_energia.valor_com_desconto` | R$ da compensação com desconto Aupus |
| `valor_bandeira_bruto` | `boletos_energia.valor_bandeira_compensada` | R$ bruto das bandeiras compensadas |
| `valor_bandeira_com_desconto` | `boletos_energia.valor_bandeira_com_desconto` | R$ das bandeiras com desconto Aupus |
| `valor_aupus` | `boletos_energia.valor_com_desconto_aupus` | R$ total Aupus (compensação + bandeira com descontos) |
| `valor_consorcio` | `boletos_energia.valor_boleto` | R$ final do boleto (Aupus + concessionária - juros/multa) |
| `valor_economia` | `boletos_energia.valor_economia` | R$ que o cliente economiza comparado a pagar sem desconto |
| `valor_s_desconto` | `boletos_energia.valor_s_desconto` | R$ que seria sem o desconto Aupus (para comparação) |
| `valor_iluminacao` | — | R$ de iluminação pública (informativo) |

### filtragem_ugs

| Campo | Usado em | O que é |
|-------|----------|---------|
| `ugs_autorizadas` | Decisão de envio ao API-BB | Quantidade de UGs do consórcio que injetaram nesta UC |
| `ugs_descartadas` | Painel UGs (alertas) | Quantidade de UGs fora do consórcio |
| `energia_descartada_kwh` | Painel UGs (descartado) | kWh descartados de UGs não autorizadas |

### flags

| Campo | Usado em | O que é |
|-------|----------|---------|
| `compensacao_completa_aplicada` | `boletos_energia.compensacao_completa_aplicada`, Dashboard (Comp. Simulada) | `true` se a calculadora criou ou ajustou compensação |
| `tipo_compensacao_aplicada` | — | `"simulada"` (criou do zero) ou `"corrigida"` (ajustou existente) ou `null` |
| `cobrar_multa` | Cálculo de valor_consorcio | Se juros/multa foram subtraídos do boleto |
| `juros_descontados` | — | R$ de juros subtraídos |
| `multa_descontada` | — | R$ de multa subtraída |

### deducao_pis_cofins

| Campo | O que é |
|-------|---------|
| `aplicada` | Se houve dedução de PIS/COFINS |
| `valor_deduzido` | R$ deduzido do valor da compensação |
| `tem_tag_nome_diferente` | Se a fatura tem tag `nome_diferente` (titular diferente do cadastro) |

---

## Como os dados chegam ao boleto

O orquestrador monta o payload e envia para `POST /api/dados-boleto-energia`:

| Campo no payload | Origem | Coluna em boletos_energia |
|-----------------|--------|---------------------------|
| `valorBoleto` | `dados_calculados.valor_consorcio` | `valor_boleto` |
| `energiaCompensado` | `dados_leitura.consumo_comp` (ajustado) | `energia_compensado` |
| `energiaNaoCompensado` | `dados_leitura.consumo_n_comp` (ajustado) | `energia_nao_compensado` |
| `energiaTotal` | `dados_leitura.consumo` | `energia_total` |
| `valorEnergiaCompensada` | `dados_calculados.valor_comp_bruto` | `valor_energia_compensada` |
| `valorBandeiraCompensada` | `dados_calculados.valor_bandeira_bruto` | `valor_bandeira_compensada` |
| `tarifaMinimaConcessionaria` | `dados_leitura.valor_concessionaria` | `tarifa_minima_concessionaria` |
| `valorComDescontoAupus` | `dados_calculados.valor_aupus` | `valor_com_desconto_aupus` |
| `valor_economia` | `dados_calculados.valor_economia` | `valor_economia` |
| `valor_com_desconto` | `dados_calculados.valor_com_desconto` | `valor_com_desconto` |
| `valor_bandeira_com_desconto` | `dados_calculados.valor_bandeira_com_desconto` | `valor_bandeira_com_desconto` |
| `valor_s_desconto` | `dados_calculados.valor_s_desconto` | `valor_s_desconto` |
| `nomeCompleto` | CRM (`nome_faturamento` ou `nome`) | `nome_completo` |
| `documento` | CRM (`cpf_cnpj_faturamento` ou `cpf_cnpj`) | `documento` |
| `tipoPessoa` | Inferido do documento (11 dígitos=CPF, 14=CNPJ) | `tipo_pessoa` |
| `endereco`, `bairro`, `cep`, `cidade`, `uf` | CRM (dados da UC) | Respectivos campos |

---

## Casos Especiais

### Duas bandeiras no mesmo mês

Quando `tarifa_adc_bandeira_amarela > 0` E `tarifa_adc_bandeira_vermelha > 0` simultaneamente, cada bandeira aplica-se a metade do período. O cálculo de cada uma é dividido por 2.

### Tag `nome_diferente`

Quando o titular da fatura é diferente do cadastro no CRM. Nesse caso, deduz-se PIS/COFINS proporcional ao consumo compensado das UGs autorizadas antes de calcular o valor Aupus.

### UGs não autorizadas

Se nenhuma UG autorizada injetou energia na UC, o orquestrador NÃO envia para API-BB (não gera boleto). A fatura segue para `pagamentos_concessionaria` ao invés de `boletos_energia`.

### Compensação simulada com consumo baixo

Se o consumo total é menor ou igual à tarifa mínima (30/50/100 kWh), não há compensação a simular — toda a energia é consumo mínimo obrigatório.

---

## Resumo dos bancos

| Dado | Banco | Tabela | Uso |
|------|-------|--------|-----|
| UGs autorizadas | aupus_prod (remoto) | unidades_consumidoras | Filtrar quais UGs são do consórcio (cache 5min) |
| Dados do cliente | aupus_prod (remoto) | controle_clube + propostas | Descontos, vencimento, flags (via orquestrador) |
| Dados da fatura | aupus_faturas (local) | faturas_baixadas | dados_leitura JSONB (via leitor PDF) |
| Resultado final | aupus_staging (local) | boletos_energia | Destino dos dados calculados (via API-BB) |
