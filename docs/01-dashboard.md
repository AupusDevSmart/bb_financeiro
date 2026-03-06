# Dashboard de Faturas

**Componente**: `src/components/DashboardFaturas.js`
**Endpoint principal**: `GET /api/dashboard/resumo/:mes`

## O que é

Página inicial do sistema. Mostra um resumo mensal com cards de métricas sobre faturas, compensação, boletos e valores financeiros. O usuário seleciona o mês por um dropdown (com setas para navegar) e todos os dados atualizam.

Os meses disponíveis vêm de `GET /api/meses-disponiveis-boletos`, que lista os meses distintos da tabela `boletos_energia` (DB `aupus_faturas`, localhost).

## Dados exibidos e suas origens

### UCs Ativas

- **DB**: `aupus_prod` (92.113.38.164)
- **Tabelas**: `controle_clube` JOIN `unidades_consumidoras`
- **Condições**: `cc.deleted_at IS NULL`, `uc.deleted_at IS NULL`, `uc.gerador = false`

Número total de unidades consumidoras de associados ativas, excluindo as usinas geradoras.

### Recebidas / Não Recebidas

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `faturas_baixadas`
- **Coluna**: `uc`, filtrado por `mes_referencia` e `is_duplicata = false`
- **Lógica**: Compara a lista de UCs ativas (CRM) com as UCs que têm registro em `faturas_baixadas`. A diferença = Não Recebidas.

Recebidas: quantas UCs já tiveram a fatura do mês baixada pelo sistema. Não Recebidas: UCs que ainda não têm fatura naquele mês.

### Pendentes

Faturas que não foram baixadas aindacompletamente.

### Com Erro

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `faturas_baixadas`
- **Coluna**: `status`
- **Condições**: `status IN ('erro', 'erro_processamento')`

Faturas que falharam durante o processamento automático e precisam de atenção manual.

### Compensado

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `faturas_baixadas`
- **Coluna**: `dados_leitura->>'categoria'`
- **Condições**: categoria contém "Compensação" mas NÃO contém "Sem Compensação"

Faturas em que a concessionária aplicou créditos de energia das usinas geradoras, reduzindo o valor a pagar.

### Comp. Simulada

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `boletos_energia`
- **Coluna**: `compensacao_completa_aplicada`
- **Condições**: `compensacao_completa_aplicada = true`

Faturas que originalmente vieram sem compensação da concessionária, mas o sistema calculou e aplicou a compensação manualmente para gerar o boleto com desconto.

### Sem Compensação

- **DB**: `aupus_faturas` (localhost)
- **Tabelas**: `faturas_baixadas` e `boletos_energia`
- **Lógica**: (faturas com categoria "Sem Compensação" em `faturas_baixadas`) menos (as que receberam compensação simulada em `boletos_energia`)

Faturas em que a concessionária não aplicou créditos de energia e o sistema também não simulou. Precisam de envio do PDF original para compensação manual.

### Geradas

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `boletos_energia`
- **Coluna**: `status`
- **Condições**: `status IN ('Boleto gerado', 'Pago')`

Quantidade de boletos que foram registrados com sucesso no Banco do Brasil naquele mês.

### Enviadas

- **DB**: `aupus_faturas` (localhost)
- **Tabelas**: `boletos_energia` + `controle_envios`
- **Lógica**: boleto tem registro correspondente em `controle_envios` com `status = 'enviado'`, cruzando por UC e mês

Boletos que já foram enviados ao cliente por WhatsApp ou email. No caso da plataforma, provavelmente não terão envios, pois os usuarios entrarão na plataforma para fazer o download.

### Pagas

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `boletos_energia`
- **Coluna**: `status`
- **Condições**: `status = 'Pago'`

Boletos que o cliente já pagou. O status é atualizado automaticamente via consulta ao Banco do Brasil.

### Total Boletos (R$)

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `boletos_energia`
- **Coluna**: `valor_boleto`
- **Condições**: `status IN ('Boleto gerado', 'Pago')`

Soma em reais de todos os boletos gerados no mês, incluindo os já pagos.

### Valor Recebido (R$)

- **DB**: `aupus_faturas` (localhost)
- **Tabela**: `boletos_energia`
- **Coluna**: `valor_boleto`
- **Condições**: `status = 'Pago'`

Soma em reais apenas dos boletos que já foram pagos no mês.

### Taxa Conversão (%)

- **Cálculo**: `(pagas / geradas) * 100` (calculado no frontend)

Percentual de boletos pagos em relação ao total de boletos gerados. Indica a eficiência de cobrança do mês.

## Itens de Atenção

Seção condicional que aparece quando há situações que precisam de ação. Cada alerta mostra tipo (erro/aviso/info), mensagem e quantidade:

- **Não Recebidas > 0**: "UCs sem fatura no mês" (erro)
- **Com Erro > 0**: "Faturas com erro de processamento" (erro)
- **Pendentes > 0**: "Faturas pendentes (não lidas)" (aviso)
- **Sem Compensação > 0**: "Faturas sem compensação (enviar PDF original)" (info)

## Resumo dos bancos

| Dado | Banco | Tabela | Coluna chave |
|------|-------|--------|-------------|
| UCs Ativas | aupus_prod (remoto) | controle_clube + unidades_consumidoras | gerador = false |
| Recebidas / Não Recebidas | aupus_faturas (local) | faturas_baixadas | uc, mes_referencia |
| Pendentes | aupus_faturas (local) | faturas_baixadas | caminho_storage, dados_leitura->categoria |
| Com Erro | aupus_faturas (local) | faturas_baixadas | status |
| Compensado | aupus_faturas (local) | faturas_baixadas | dados_leitura->categoria |
| Comp. Simulada | aupus_faturas (local) | boletos_energia | compensacao_completa_aplicada |
| Sem Compensação | aupus_faturas (local) | faturas_baixadas - boletos_energia | categoria - compensacao_completa_aplicada |
| Geradas / Pagas | aupus_faturas (local) | boletos_energia | status |
| Enviadas | aupus_faturas (local) | boletos_energia + controle_envios | controle_envios.status = 'enviado' |
| Valores (R$) | aupus_faturas (local) | boletos_energia | valor_boleto |
