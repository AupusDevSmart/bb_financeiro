# Controle de Faturas e Boletos

**Componente**: `src/components/ControleEnergia.js`
**Endpoints principais**: `GET /api/dados-boleto-energia`, `GET /api/controle/sem-compensacao`, `GET /api/controle/ucs-nao-baixadas`

## O que é

Página com 4 abas para gestão operacional de boletos e faturas: Boletos de Energia, Sem Compensação, UCs Não Baixadas e Pendentes. Todas as abas compartilham o mesmo filtro de mês de referência.

Os meses disponíveis vêm de `GET /api/meses-disponiveis-boletos` (meses distintos da tabela `boletos_energia`).

---

## Aba 1: Boletos de Energia

**Endpoint**: `GET /api/dados-boleto-energia?mes_referencia=XX/YYYY&status=...&uc=...`

Lista todos os boletos registrados na tabela `boletos_energia` para o mês selecionado. É a visão principal de cobrança.

### Filtros disponíveis

- **Status**: Todos, Pendente, Boleto gerado, Pago, Cancelado, Vencido
- **UC**: busca parcial por número da UC
- **Compensação**: Todos, Compensou tudo, Não compensou tudo

### Dados exibidos

| Coluna | Origem | O que é |
|--------|--------|---------|
| UC | `boletos_energia.uc` | Número da unidade consumidora do associado |
| Cliente | `boletos_energia.nome_completo` | Nome do pagador (vem do CRM no momento da criação do boleto) |
| Valor | `boletos_energia.valor_boleto` | Valor em R$ do boleto gerado. Para faturas com compensação, é o valor Aupus (tarifa consórcio sobre a energia compensada). Para compensação simulada, é recalculado pelo sistema |
| Vencimento | `boletos_energia.data_vencimento` | Data de vencimento do boleto no Banco do Brasil |
| Status | `boletos_energia.status` | Estado atual do boleto |
| Energia Comp. | `boletos_energia.energia_compensado` | kWh de energia que foi compensada pela concessionária (créditos das usinas) |
| Energia Não Comp. | `boletos_energia.energia_nao_compensado` | kWh de energia consumida que não teve compensação (cobrada diretamente pela concessionária) |

### Status dos Boletos

| Status | Significado |
|--------|-------------|
| Pendente | Boleto calculado pelo sistema mas ainda não registrado no Banco do Brasil |
| Boleto gerado | Registrado com sucesso no BB, pronto para pagamento |
| Pago | Cliente pagou o boleto (atualizado via consulta automática ao BB) |
| Cancelado | Boleto foi cancelado manualmente ou por reprocessamento |
| Vencido | Boleto passou da data de vencimento sem pagamento |
| Erro | Falha ao tentar registrar o boleto no BB |

### Enriquecimento com CRM

Após buscar os boletos do banco local (`aupus_staging`), o endpoint consulta o CRM (`aupus_prod`) para atualizar os campos de contato:

- **DB**: `aupus_prod` (92.113.38.164)
- **Tabelas**: `unidades_consumidoras` + `controle_clube`
- **Colunas**: `whatsapp_faturamento` (prioridade), `cc.whatsapp` (fallback) para telefone; `email_faturamento_1` (prioridade), `cc.email` (fallback) para email

Isso garante que os dados de contato do boleto estejam sempre atualizados com o CRM, mesmo que tenham mudado desde a geração original.

### Tabela `boletos_energia` (banco `aupus_staging`)

Colunas principais:

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `uc` | VARCHAR(20) | Número da UC (chave junto com mes_referencia) |
| `mes_referencia` | VARCHAR(10) | Mês no formato "MM/YYYY" |
| `valor_boleto` | NUMERIC(10,2) | Valor final do boleto em R$ |
| `status` | VARCHAR(20) | Status do boleto (Pendente, Boleto gerado, Pago, etc.) |
| `energia_compensado` | NUMERIC(10,2) | kWh compensados (pode ser corrigido pelo sistema) |
| `energia_nao_compensado` | NUMERIC(10,2) | kWh não compensados |
| `energia_total` | NUMERIC(10,2) | Total de energia (compensado + não compensado) |
| `compensacao_completa_aplicada` | BOOLEAN | `true` se o sistema simulou compensação manualmente |
| `nome_completo` | VARCHAR(255) | Nome do pagador |
| `documento` | VARCHAR(20) | CPF ou CNPJ |
| `data_vencimento` | VARCHAR(10) | Data de vencimento do boleto |
| `numero_boleto` | VARCHAR(50) | Número do boleto no BB (preenchido após registro) |
| `dados_completos` | JSONB | Resposta completa da API do Banco do Brasil |
| `data_geracao_boleto` | TIMESTAMP | Data/hora do registro no BB |
| `data_envio_whatsapp` | TIMESTAMP | Data/hora do envio por WhatsApp |
| `data_envio_email` | TIMESTAMP | Data/hora do envio por email |
| `valor_abatimento` | NUMERIC | Desconto manual aplicado |
| `motivo_abatimento` | TEXT | Justificativa do desconto |

---

## Aba 2: Sem Compensação

**Endpoint**: `GET /api/controle/sem-compensacao?mes_referencia=XX/YYYY`

Lista faturas que foram processadas mas NÃO tiveram compensação de energia. São faturas em que a concessionária não aplicou créditos das usinas.

### Origem dos dados

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `faturas_baixadas`
- **Condições**:
  - `status = 'processado'`
  - Categoria não contém "Compensação" OU `valor_energia_compensada = 0`
  - **Exclui** faturas que já têm boleto ativo em `boletos_energia` (para não duplicar com a aba de Boletos)

### Dados exibidos

| Coluna | Origem | O que é |
|--------|--------|---------|
| UC | `faturas_baixadas.uc` | Número da UC |
| Cliente | `faturas_baixadas.dados_leitura->>'nome_cliente'` | Nome lido da fatura PDF |
| Categoria | `faturas_baixadas.dados_leitura->>'categoria'` | Classificação da fatura (ex: "Sem Compensação", "Faturamento Mínimo") |
| Valor Fatura | `faturas_baixadas.dados_leitura->>'valor_total'` | Valor total da fatura da concessionária em R$ |
| Motivo | Calculado pela query | Por que não compensou: "Categoria sem compensação" ou "Valor compensado = 0" |
| Data Leitura | `faturas_baixadas.created_at` | Quando a fatura foi processada pelo sistema |

### Significado

Essas faturas indicam que a concessionária não creditou energia das usinas naquele mês. Pode ser um problema de autorização, atraso no cadastro da UC ou simplesmente que a UC não recebeu injeção. Precisam de atenção manual.

---

## Aba 3: UCs Não Baixadas

**Endpoint**: `GET /api/controle/ucs-nao-baixadas?mes_referencia=XX/YYYY`

Lista UCs ativas no CRM que ainda não tiveram a fatura baixada pelo sistema para o mês selecionado.

### Origem dos dados

1. **CRM** (`aupus_prod`): busca todas as UCs ativas
   - `controle_clube` JOIN `unidades_consumidoras` JOIN `propostas`
   - Condição: `cc.deleted_at IS NULL`, `uc.numero_unidade IS NOT NULL`

2. **Microserviços** (`aupus_faturas`): busca quais UCs já têm fatura
   - `faturas_baixadas` filtrado por `mes_referencia`

3. **Diferença**: UCs do CRM que NÃO estão em `faturas_baixadas` = Não Baixadas

### Dados exibidos

| Coluna | Origem | O que é |
|--------|--------|---------|
| UC | `unidades_consumidoras.numero_unidade` (CRM) | Número da UC sem fatura |
| Cliente | `controle_clube.nome_cliente` ou `propostas.nome_cliente` (CRM) | Nome do associado |
| CPF/CNPJ | `controle_clube.cpf_cnpj` (CRM) | Documento do associado |
| Sigla | Fixo "CLA" | Indica que é do Club Aupus |
| Última Tentativa | `log_buscador_eqtl.data_tentativa` (`aupus_faturas`) | Quando o buscador automático tentou baixar pela última vez. "Nunca" se não há registro |

### Significado

Essas UCs precisam ter suas faturas inseridas manualmente (via upload na aba Pendentes) ou aguardar o buscador automático (buscador-eqtl) baixar. É o principal indicador de completude do mês.

---

## Aba 4: Pendentes (Upload + Processamento)

Funcionalidade de upload manual de PDFs de faturas e envio para processamento.

### Upload de Faturas

- Arraste PDFs ou clique para selecionar (máx. 50 por vez)
- **Endpoint de upload**: `POST /api/sistema-faturas/upload-fatura` (envia cada PDF individualmente)
- Apenas arquivos `.pdf` são aceitos

### Arquivos Pendentes de Processamento

- **Endpoint**: `GET /api/sistema-faturas/arquivos-pendentes`
- Lista arquivos PDF que foram enviados mas ainda não processados
- Permite selecionar múltiplos e enviar para processamento
- **Endpoint de processamento**: `POST /api/sistema-faturas/processar-pendentes` (envia lista de nomes de arquivo)

### Dados exibidos

| Coluna | Origem | O que é |
|--------|--------|---------|
| Nome | Nome do arquivo PDF | Nome original do arquivo enviado |
| Tamanho | Tamanho do arquivo | Em KB ou MB |
| Data Upload | Metadado do arquivo | Quando foi enviado ao sistema |

---

## Resumo dos bancos

| Dado | Banco | Tabela | Coluna chave |
|------|-------|--------|-------------|
| Boletos de Energia | aupus_staging (local) | boletos_energia | uc, mes_referencia, status, valor_boleto |
| Contato atualizado | aupus_prod (remoto) | unidades_consumidoras + controle_clube | whatsapp_faturamento, email_faturamento_1 |
| Faturas sem compensação | aupus_faturas (local) | faturas_baixadas | dados_leitura->categoria, dados_leitura->valor_energia_compensada |
| UCs ativas (CRM) | aupus_prod (remoto) | controle_clube + unidades_consumidoras + propostas | numero_unidade, nome_cliente |
| Faturas baixadas | aupus_faturas (local) | faturas_baixadas | uc, mes_referencia |
| Log do buscador | aupus_faturas (local) | log_buscador_eqtl | uc, data_tentativa |
