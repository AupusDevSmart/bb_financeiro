# NOVA FUNCIONALIDADE: GERAÇÃO AUTOMÁTICA DE BOLETOS DE ENERGIA

## RESUMO

Foi implementada uma nova aba **"Gerar Boleto Energia"** que:

1. **Recebe dados** do Sistema_Faturas via POST HTTP
2. **Exibe tabela** com filtros (status, UC, data)
3. **Gera boletos automaticamente** com um clique
4. **Atualiza PDF** incluindo dados de energia no topo

---

## O QUE FOI CRIADO

### 1. Backend (server.js)

**3 novas rotas:**

```javascript
POST   /api/dados-boleto-energia      // Receber dados
GET    /api/dados-boleto-energia      // Listar com filtros
PATCH  /api/dados-boleto-energia/:uc/:mes  // Atualizar status
```

**Armazenamento:** Array em memória (`boletosEnergia`)

**Características:**
- Não permite duplicatas (mesma UC + mês)
- Status inicial: "Pendente"
- Atualiza para "Boleto gerado" após criação

### 2. Frontend (GerarBoletoEnergia.js)

**Componente React com:**

- Tabela responsiva com 11 colunas
- Filtros: Status, UC, Data Início/Fim
- Botão "Gerar Boleto" para cada linha pendente
- Atualização automática após geração
- Contador de pendentes/gerados

### 3. Gerador de PDF (pdfGenerator.js)

**Nova seção no topo do PDF:**

- Informações da UC e Mês de Referência
- Tabela com dados de energia:
  - Energia não compensada, compensada e total
  - Valores de energia e bandeira compensados
  - Tarifa mínima da concessionária
  - Valor com desconto AUPUS
  - Valor final do boleto (destacado)

### 4. Integração (App.js)

**Nova aba:**
- Ícone: ⚡ (raio)
- Texto: "Gerar Boleto Energia"
- Rota: `activeTab === 'energia'`

---

## DADOS NECESSÁRIOS

### Campos Obrigatórios

```json
{
  "uc": "10037114075",
  "mes_referencia": "OUT/2025",

  "dataVencimento": "25/11/2025",
  "valorBoleto": 1182.48,
  "descricao": "Fatura de Energia - Outubro/2025",

  "tipoPessoa": "CPF",
  "documento": "12345678901",
  "nomeCompleto": "JOAO DA SILVA",

  "endereco": "Rua Exemplo, 123",
  "bairro": "Centro",
  "cep": "74000000",
  "cidade": "Goiania",
  "uf": "GO",

  "energiaNaoCompensado": 229.10,
  "energiaCompensado": 221.40,
  "energiaTotal": 450.50,
  "valorEnergiaCompensada": 189.17,
  "valorBandeiraCompensada": 8.44,
  "tarifaMinimaConcessionaria": 45.50,
  "valorComDescontoAupus": 1120.00
}
```

### Campos Opcionais

```json
{
  "email": "joao@email.com",
  "telefone": "(62) 99999-9999"
}
```

---

## COMO USAR

### 1. Iniciar o Sistema

```bash
cd c:\Users\arthu\Dropbox\AUPUS SMART\05. SITE\API_BB_REACT
npm start
```

Isso inicia:
- Backend em `http://localhost:3001`
- Frontend em `http://localhost:3002`

### 2. Enviar Dados (via Sistema_Faturas)

```python
import requests

dados = {
    "uc": "10037114075",
    "mes_referencia": "OUT/2025",
    # ... todos os campos obrigatórios
}

response = requests.post(
    "http://localhost:3001/api/dados-boleto-energia",
    json=dados
)

print(response.json())
```

### 3. Visualizar na Interface

1. Abra: `http://localhost:3002`
2. Clique na aba: **"Gerar Boleto Energia"**
3. Veja os dados na tabela

### 4. Gerar Boleto

1. Clique no botão **"Gerar Boleto"** na linha desejada
2. Aguarde o processamento
3. Status mudará para **"Boleto gerado"**
4. Número do boleto será exibido

---

## FILTROS DISPONÍVEIS

- **Status:** Todos | Pendente | Boleto gerado | Erro
- **UC:** Digite o número da UC (busca parcial)
- **Data Início:** Filtro por data de recebimento
- **Data Fim:** Filtro por data de recebimento

---

## ESTRUTURA DO PDF

```
┌─────────────────────────────────────┐
│ CABEÇALHO                           │
│ Logo AUPUS | "BOLETO BANCÁRIO"      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ INFORMAÇÕES DA FATURA DE ENERGIA    │ ← NOVO!
├─────────────────────────────────────┤
│ UC: 10037114075                     │
│ Mês Referência: OUT/2025            │
├─────────────────────────────────────┤
│ ENERGIA NÃO COMP. | COMP. | TOTAL   │
│ 229.10 kWh | 221.40 kWh | 450.50 kWh│
├─────────────────────────────────────┤
│ VALOR ENERGIA | BANDEIRA | TARIFA   │
│ R$ 189,17 | R$ 8,44 | R$ 45,50      │
├─────────────────────────────────────┤
│ DESCONTO AUPUS | VALOR BOLETO        │
│ R$ 1.120,00 | R$ 1.182,48 ←destacado│
└─────────────────────────────────────┘

[Espaço em branco ajustado]

┌─────────────────────────────────────┐
│ DADOS DO PAGADOR                    │
│ DADOS DO BOLETO                     │
│ LINHA DIGITÁVEL                     │
│ CÓDIGO DE BARRAS | QR CODE PIX      │
└─────────────────────────────────────┘
```

---

## CARACTERÍSTICAS TÉCNICAS

### Validações

- ✅ Não permite UC + mês duplicados (atualiza existente)
- ✅ Campos obrigatórios: UC e mes_referencia
- ✅ Formatação automática de CPF/CNPJ
- ✅ Remoção de acentos antes de enviar ao BB
- ✅ Validação de valores numéricos

### Armazenamento

- **Tipo:** Em memória (array JavaScript)
- **Persistência:** Perdido ao reiniciar servidor
- **Vantagem:** Rápido e sem necessidade de banco
- **Desvantagem:** Não persiste entre reinicializações

### Status do Boleto

- **Pendente:** Dados recebidos, boleto não gerado
- **Boleto gerado:** Boleto criado com sucesso no BB
- **Erro:** Falha na geração (não implementado ainda)

### Automação

- Token OAuth renovado automaticamente
- Cache de token (50 minutos)
- Cálculo automático de juros e multa
- Geração automática de QR Code PIX

---

## PRÓXIMOS PASSOS (SISTEMA_FATURAS)

1. **Instalar biblioteca:**
   ```bash
   pip install requests
   ```

2. **Adicionar função de envio** (ver `INTEGRACAO_API_BOLETOS.md`)

3. **Chamar após processar fatura CLA:**
   ```python
   if sigla == "CLA":
       enviar_para_api_boletos(dados_fatura, dados_planilha)
   ```

4. **Testar integração:**
   ```python
   testar_conexao_api()
   testar_envio_dados()
   ```

---

## ARQUIVOS CRIADOS/MODIFICADOS

### Criados

1. `src/components/GerarBoletoEnergia.js` - Componente React
2. `Sistema_Faturas/INTEGRACAO_API_BOLETOS.md` - Guia completo
3. `NOVA_FUNCIONALIDADE_ENERGIA.md` - Este arquivo

### Modificados

1. `server/server.js` - 3 novas rotas + array de armazenamento
2. `server/pdfGenerator.js` - Seção de dados de energia
3. `src/components/App.js` - Nova aba

---

## TESTANDO

### Teste 1: Enviar dados manualmente

Use o Postman ou curl:

```bash
curl -X POST http://localhost:3001/api/dados-boleto-energia \
  -H "Content-Type: application/json" \
  -d '{
    "uc": "10037114075",
    "mes_referencia": "OUT/2025",
    "dataVencimento": "25/11/2025",
    "valorBoleto": 1182.48,
    "descricao": "Teste",
    "tipoPessoa": "CNPJ",
    "documento": "61028500000126",
    "nomeCompleto": "TESTE LTDA",
    "endereco": "Rua Teste",
    "bairro": "Centro",
    "cep": "74000000",
    "cidade": "Goiania",
    "uf": "GO",
    "energiaNaoCompensado": 229.10,
    "energiaCompensado": 221.40,
    "energiaTotal": 450.50,
    "valorEnergiaCompensada": 189.17,
    "valorBandeiraCompensada": 8.44,
    "tarifaMinimaConcessionaria": 45.50,
    "valorComDescontoAupus": 1120.00
  }'
```

### Teste 2: Verificar na interface

1. Abra: `http://localhost:3002`
2. Clique: **"Gerar Boleto Energia"**
3. Veja o registro na tabela

### Teste 3: Gerar boleto

1. Clique: **"Gerar Boleto"**
2. Aguarde processamento
3. Veja status atualizado

---

## TROUBLESHOOTING

### Erro: "Não foi possível conectar à API"

**Solução:** Verifique se o servidor está rodando
```bash
cd API_BB_REACT
npm start
```

### Erro: "UC e mês já existem"

**Comportamento esperado:** A API atualiza o registro existente

### Tabela vazia

**Causa:** Nenhum dado foi enviado ainda

**Solução:** Envie dados via POST ou aguarde Sistema_Faturas

### Botão "Gerar Boleto" não funciona

**Verifique:**
1. Console do navegador (F12)
2. Token OAuth válido
3. Credenciais do BB corretas

---

## CONTATO E SUPORTE

Para dúvidas ou problemas:

1. Verifique os logs do servidor (console)
2. Verifique o console do navegador (F12)
3. Consulte: `INTEGRACAO_API_BOLETOS.md`

---

**Data de Implementação:** 27/10/2025
**Versão:** 1.0
**Status:** ✅ Implementado e Funcional
