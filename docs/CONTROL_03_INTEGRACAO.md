# Aupus Control - Integração Frontend ↔ Backend

> **Documentação de Integração** - Como Frontend e Backend trabalham juntos para enviar lançamentos ao Aupus Control.

---

## 1. Visão Geral do Fluxo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FLUXO COMPLETO DE INTEGRAÇÃO                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐           │
│  │ FRONTEND │────▶│ BACKEND  │────▶│   API    │────▶│  AUPUS   │           │
│  │ (React)  │     │ (Laravel)│     │ CONTROL  │     │ CONTROL  │           │
│  └──────────┘     └──────────┘     └──────────┘     └──────────┘           │
│       │                │                │                │                  │
│       │ POST           │ Valida         │ POST           │ Registra         │
│       │ lancar-control │ + Monta        │ /lancamentos   │ Lançamento       │
│       │                │ Payload        │                │                  │
│       │                │                │                │                  │
│       │◀───────────────│◀───────────────│◀───────────────│                  │
│       │ { success,     │ { id: "..." }  │ Response       │                  │
│       │   control_id } │                │                │                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Contrato da API

### 2.1 Endpoint

```
POST /api/pagamentos-concessionaria/lancar-control/{faturaId}
```

### 2.2 Request (Frontend → Backend)

```typescript
// URL
const url = `${API_URL}/api/pagamentos-concessionaria/lancar-control/${fatura_id}`;

// Headers
const headers = {
  'Content-Type': 'application/json'
};

// Body
interface LancarControlRequest {
  nome_cliente?: string | null;
}

// Exemplo
{
  "nome_cliente": "Lucas Gabriel"
}
```

### 2.3 Response (Backend → Frontend)

#### Sucesso (HTTP 200)

```typescript
interface LancarControlResponseSucesso {
  success: true;
  message: string;
  control_lancamento_id: string;
  pagamento: {
    id: number;
    uc: string;
    valor: number;
    status_control: 'lancado';
    control_lancamento_id: string;
  };
}

// Exemplo
{
  "success": true,
  "message": "Lançamento enviado para Aupus Control com sucesso",
  "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13",
  "pagamento": {
    "id": 123,
    "uc": "49166370",
    "valor": 150.50,
    "status_control": "lancado",
    "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13"
  }
}
```

#### Já Lançado (HTTP 400)

```typescript
interface LancarControlResponseJaLancado {
  error: string;
  message: string;
  control_lancamento_id: string;
}

// Exemplo
{
  "error": "Já lançado no Aupus Control",
  "message": "ID: 01JNMEWG39CRAZN20SFK684A13",
  "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13"
}
```

#### Erro de Validação (HTTP 400)

```typescript
interface LancarControlResponseErro {
  error: string;
  message: string;
  detalhes?: any;
}

// Exemplo - Sem código de barras
{
  "error": "Sem código de barras",
  "message": "Informe o código de barras para lançar no Control"
}

// Exemplo - Erro da API Control
{
  "error": "Erro ao enviar para Aupus Control",
  "message": "Lançamento duplicado",
  "detalhes": { ... }
}
```

#### Não Encontrado (HTTP 404)

```typescript
{
  "error": "Fatura não encontrada"
}
```

---

## 3. Fluxo Detalhado

### 3.1 Lançamento Individual

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       FLUXO: LANÇAMENTO INDIVIDUAL                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FRONTEND                          BACKEND                    API CONTROL   │
│  ────────                          ───────                    ───────────   │
│                                                                             │
│  1. Usuário clica ⬆️                                                        │
│     │                                                                       │
│  2. Validar localmente:                                                     │
│     - codigo_barras existe?                                                 │
│     - status_control !== 'lancado'?                                         │
│     │                                                                       │
│  3. Abrir modal de confirmação                                              │
│     │                                                                       │
│  4. Usuário confirma                                                        │
│     │                                                                       │
│  5. POST /lancar-control/{id} ─────▶ 6. Buscar fatura                       │
│     { nome_cliente }                    │                                   │
│                                      7. Buscar/criar pagamento              │
│                                         │                                   │
│                                      8. Verificar já lançado                │
│                                         │                                   │
│                                      9. Validar código barras               │
│                                         │                                   │
│                                     10. Determinar status                   │
│                                         │                                   │
│                                     11. Buscar dados CRM                    │
│                                         │                                   │
│                                     12. Montar payload ─────▶ 13. POST      │
│                                         │                         /lancamentos
│                                         │                         │         │
│                                     14. Atualizar DB ◀──────── Response     │
│                                         │                                   │
│  15. Receber response ◀─────────── 16. Retornar JSON                        │
│     │                                                                       │
│  17. Exibir sucesso/erro                                                    │
│     │                                                                       │
│  18. Recarregar lista                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Lançamento em Lote

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FLUXO: LANÇAMENTO EM LOTE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FRONTEND                                                                   │
│  ────────                                                                   │
│                                                                             │
│  1. Usuário seleciona checkboxes                                            │
│     │                                                                       │
│  2. Clica "Lançar Control (N)"                                              │
│     │                                                                       │
│  3. Filtrar elegíveis:                                                      │
│     - status_control !== 'lancado'                                          │
│     - codigo_barras existe                                                  │
│     │                                                                       │
│  4. Abrir modal com lista                                                   │
│     │                                                                       │
│  5. Usuário confirma                                                        │
│     │                                                                       │
│  6. LOOP para cada item:                                                    │
│     │                                                                       │
│     ├─▶ 6.1 Atualizar progresso (atual/total)                               │
│     │                                                                       │
│     ├─▶ 6.2 POST /lancar-control/{id}                                       │
│     │        │                                                              │
│     │        ▼                                                              │
│     │   [BACKEND processa - mesmo fluxo individual]                         │
│     │        │                                                              │
│     │        ▼                                                              │
│     ├─▶ 6.3 Registrar resultado (sucesso/erro)                              │
│     │                                                                       │
│     ├─▶ 6.4 Aguardar 500ms (throttle)                                       │
│     │                                                                       │
│     └─▶ 6.5 Próximo item                                                    │
│                                                                             │
│  7. Exibir resumo (sucessos/erros)                                          │
│     │                                                                       │
│  8. Recarregar lista                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Mapeamento de Dados

### 4.1 Frontend → Backend

| Campo Frontend | Campo Request | Descrição |
|----------------|---------------|-----------|
| `fatura_id` | URL param `{faturaId}` | ID da fatura |
| `nome_cliente` | Body `nome_cliente` | Nome do cliente (opcional) |

### 4.2 Backend → API Control

| Campo Backend | Campo API Control | Descrição |
|---------------|-------------------|-----------|
| `codigo_barras` | `codigoBarras`, `numeroDocumento` | Código de barras limpo |
| `data_vencimento_fatura` | `dataVencimento` | Formato YYYY-MM-DD |
| `valor_fatura` | `valor` | Valor numérico |
| `mes_referencia` | `competenciaMes`, `competenciaAno` | Extraído de "MM/YYYY" |
| `uc` | Usado na `descricao` | Número da UC |
| `nome_cliente` | Usado na `descricao` | Nome do cliente |
| `is_ug` | Usado na `descricao` | Tipo: Associado/Usineiro |
| (calculado) | `status` | PENDENTE/APROVADO/PAGO |

### 4.3 API Control → Backend → Frontend

| Campo API Control | Campo Backend | Campo Frontend |
|-------------------|---------------|----------------|
| `id` | `control_lancamento_id` | `control_lancamento_id` |
| - | `status_control = 'lancado'` | `status_control` |
| (response) | `resposta_control` | - |

---

## 5. Tratamento de Erros

### 5.1 Erros no Frontend

```typescript
// Validação local (antes de chamar API)
if (!pagamento.codigo_barras) {
  setErro('Código de barras não encontrado.');
  return;
}

// Erro de rede
try {
  const response = await fetch(...);
  // ...
} catch (err) {
  setErro('Erro ao lançar no Control: ' + err.message);
}

// Erro retornado pela API
if (!response.ok) {
  const data = await response.json();
  setErro(data.error || data.message || 'Erro ao lançar no Control');
}
```

### 5.2 Erros no Backend

```php
// Já lançado
if ($pagamento->status_control === 'lancado') {
    return response()->json([
        'error' => 'Já lançado no Aupus Control',
        'message' => "ID: {$pagamento->control_lancamento_id}",
        'control_lancamento_id' => $pagamento->control_lancamento_id,
    ], 400);
}

// Sem código de barras
if (empty($codigoBarras)) {
    return response()->json([
        'error' => 'Sem código de barras',
        'message' => 'Informe o código de barras para lançar no Control',
    ], 400);
}

// Erro da API Control
if (!$resultado['sucesso']) {
    $pagamento->update([
        'status_control' => 'erro',
        'erro_control' => $resultado['erro'],
    ]);

    return response()->json([
        'error' => 'Erro ao enviar para Aupus Control',
        'message' => $resultado['erro'],
        'detalhes' => $resultado['dados'],
    ], 400);
}
```

---

## 6. Estados de Sincronização

### 6.1 Tabela de Estados

| status_control | Significado | Ação Frontend |
|----------------|-------------|---------------|
| `null` | Não lançado | Botão habilitado |
| `'lancado'` | Lançado com sucesso | Botão desabilitado, badge verde |
| `'erro'` | Falha no lançamento | Botão habilitado, badge vermelho |

### 6.2 Fluxo de Estados

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   null   │────▶│ lancado  │     │   erro   │
│ (inicial)│     │ (sucesso)│     │ (falha)  │
└──────────┘     └──────────┘     └──────────┘
     │                                  │
     │                                  │
     └──────────────────────────────────┘
              Pode tentar novamente
```

---

## 7. Exemplo Completo de Código

### 7.1 Frontend - Chamada da API

```javascript
const lancarNoControl = async (faturaId, nomeCliente) => {
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
  
  const response = await fetch(
    `${API_URL}/api/pagamentos-concessionaria/lancar-control/${faturaId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome_cliente: nomeCliente || null })
    }
  );

  const data = await response.json();

  if (response.ok) {
    return {
      sucesso: true,
      controlId: data.control_lancamento_id,
      mensagem: data.message
    };
  } else {
    return {
      sucesso: false,
      erro: data.error || data.message,
      detalhes: data.detalhes
    };
  }
};
```

### 7.2 Backend - Processamento

```php
public function lancarFaturaControl(Request $request, string $faturaId): JsonResponse
{
    // 1. Buscar fatura
    $fatura = FaturaAssociado::findOrFail($faturaId);

    // 2. Buscar ou criar pagamento
    $pagamento = PagamentoConcessionaria::firstOrCreate(
        ['uc' => $fatura->uc, 'mes_referencia' => $fatura->mes_referencia],
        ['fatura_id' => $fatura->id, 'valor_fatura' => $fatura->valor_fatura, ...]
    );

    // 3. Validações
    if ($pagamento->status_control === 'lancado') {
        return response()->json(['error' => 'Já lançado...'], 400);
    }

    // 4. Determinar status e enviar
    $statusControl = $this->determinarStatusControl($pagamento, $fatura);
    $resultado = $this->controlService->enviarFaturaEQTL([...]);

    // 5. Atualizar e retornar
    if ($resultado['sucesso']) {
        $pagamento->update(['status_control' => 'lancado', ...]);
        return response()->json(['success' => true, ...]);
    } else {
        $pagamento->update(['status_control' => 'erro', ...]);
        return response()->json(['error' => '...'], 400);
    }
}
```

---

## 8. Checklist de Integração

### Frontend
- [ ] Endpoint correto: `POST /api/pagamentos-concessionaria/lancar-control/{faturaId}`
- [ ] Body com `nome_cliente` (opcional)
- [ ] Tratar response `success: true` → atualizar UI
- [ ] Tratar response com `error` → exibir mensagem
- [ ] Tratar erro de rede → exibir mensagem genérica
- [ ] Recarregar lista após sucesso

### Backend
- [ ] Rota configurada em `routes/api.php`
- [ ] Controller recebe `faturaId` da URL
- [ ] Controller recebe `nome_cliente` do body
- [ ] Retornar `control_lancamento_id` no sucesso
- [ ] Retornar `error` e `message` nos erros
- [ ] Atualizar `status_control` no banco

### Testes de Integração
- [ ] Lançamento com sucesso → status_control = 'lancado'
- [ ] Lançamento duplicado → erro "Já lançado"
- [ ] Sem código de barras → erro "Sem código de barras"
- [ ] Erro da API Control → status_control = 'erro'
- [ ] Lançamento em lote → todos processados

---

## 9. Diagrama de Sequência

```
┌────────┐          ┌────────┐          ┌─────────┐          ┌─────────┐
│Frontend│          │Backend │          │   DB    │          │ Control │
└───┬────┘          └───┬────┘          └────┬────┘          └────┬────┘
    │                   │                    │                    │
    │ POST /lancar-control/{id}              │                    │
    │ { nome_cliente }  │                    │                    │
    │──────────────────▶│                    │                    │
    │                   │                    │                    │
    │                   │ SELECT fatura      │                    │
    │                   │───────────────────▶│                    │
    │                   │◀───────────────────│                    │
    │                   │                    │                    │
    │                   │ SELECT/INSERT pag  │                    │
    │                   │───────────────────▶│                    │
    │                   │◀───────────────────│                    │
    │                   │                    │                    │
    │                   │ POST /lancamentos  │                    │
    │                   │ { payload }        │                    │
    │                   │───────────────────────────────────────▶│
    │                   │                    │                    │
    │                   │◀───────────────────────────────────────│
    │                   │ { id: "..." }      │                    │
    │                   │                    │                    │
    │                   │ UPDATE pagamento   │                    │
    │                   │───────────────────▶│                    │
    │                   │◀───────────────────│                    │
    │                   │                    │                    │
    │◀──────────────────│                    │                    │
    │ { success: true,  │                    │                    │
    │   control_id }    │                    │                    │
    │                   │                    │                    │
```

---

## 10. Resumo

| Aspecto | Frontend | Backend |
|---------|----------|---------|
| **Responsabilidade** | UI, validação local, exibição | Lógica, integração, persistência |
| **Endpoint** | Consome | Expõe |
| **Validações** | codigo_barras, status_control | Todas + regras de negócio |
| **Status** | Exibe badge | Determina automaticamente |
| **Erros** | Exibe mensagem | Retorna JSON estruturado |
