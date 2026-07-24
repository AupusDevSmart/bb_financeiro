# Integração Aupus Control - Documentação Backend (Laravel)

> **Guia para implementação do Backend** - Lançamento de faturas no sistema Aupus Control.

---

## 📋 Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Configuração](#3-configuração)
4. [API do Aupus Control](#4-api-do-aupus-control)
5. [Service de Integração](#5-service-de-integração)
6. [Controller](#6-controller)
7. [Endpoints](#7-endpoints)
8. [Regras de Negócio](#8-regras-de-negócio)
9. [Exemplos de Request/Response](#9-exemplos-de-requestresponse)

---

## 1. Visão Geral

### 1.1 O que é o Aupus Control?

O **Aupus Control** é o sistema financeiro interno que gerencia lançamentos de contas a pagar/receber. A integração permite registrar automaticamente as faturas de concessionárias no fluxo financeiro.

### 1.2 Relação BB vs Control

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SISTEMAS INDEPENDENTES                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                    ┌─────────────┐                 │
│  │   API BB    │                    │ API Control │                 │
│  │ (Pagamento) │                    │ (Registro)  │                 │
│  └──────┬──────┘                    └──────┬──────┘                 │
│         │                                  │                        │
│         │ Débito real                      │ Lançamento             │
│         │ na conta                         │ financeiro             │
│         │                                  │                        │
│         ▼                                  ▼                        │
│  ┌─────────────┐                    ┌─────────────┐                 │
│  │ Banco do    │                    │ Fluxo de    │                 │
│  │ Brasil      │                    │ Caixa       │                 │
│  └─────────────┘                    └─────────────┘                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

⚠️ **IMPORTANTE:** Os lançamentos são **INDEPENDENTES**:
- Lançar no BB **NÃO** lança automaticamente no Control
- Lançar no Control **NÃO** efetua pagamento no BB

### 1.3 Tipos de Lançamento

| Tipo | tipoOperacao | Descrição |
|------|--------------|-----------|
| **Fatura EQTL** | `fatura_equatorial` | Conta de energia da concessionária (SAÍDA) |
| **Boleto Energia** | `boleto_de_contribuicao` | Boleto gerado para o cliente (ENTRADA) |

---

## 2. Arquitetura

### 2.1 Estrutura de Arquivos

```
app/
├── Http/
│   └── Controllers/
│       └── Admin/
│           └── ControlLancamentoController.php
├── Services/
│   └── AupusControlService.php
└── Enums/
    └── ControlStatus.php

config/
└── services.php  (adicionar seção 'control')
```

### 2.2 Fluxo de Dados

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Laravel    │────▶│ API Control  │
│   (React)    │     │   Backend    │     │ (Externa)    │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │ POST lancar-control│                    │
       │───────────────────▶│                    │
       │                    │ POST /lancamentos  │
       │                    │───────────────────▶│
       │                    │                    │
       │                    │◀───────────────────│
       │                    │    { id: "..." }   │
       │◀───────────────────│                    │
       │  { success: true } │                    │
```

---

## 3. Configuração

### 3.1 Variáveis de Ambiente (.env)

```bash
# =====================================================
# AUPUS CONTROL - API Externa
# =====================================================

# URL da API de Lançamentos
CONTROL_API_URL=https://api.aupuscontrol.com.br/api/lancamentos

# Chave de API (autenticação)
CONTROL_API_KEY=sua_api_key_aqui

# Nome da conta bancária padrão (opcional)
CONTROL_CONTA_BANCARIA=Banco do Brasil
```

### 3.2 Config Laravel (config/services.php)

```php
<?php

return [
    // ... outras configurações ...

    /*
    |--------------------------------------------------------------------------
    | Aupus Control
    |--------------------------------------------------------------------------
    */
    'control' => [
        'api_url' => env('CONTROL_API_URL'),
        'api_key' => env('CONTROL_API_KEY'),
        'conta_bancaria' => env('CONTROL_CONTA_BANCARIA', 'Banco do Brasil'),
        'timeout' => 30, // segundos
    ],
];
```

---

## 4. API do Aupus Control

### 4.1 Autenticação

A API usa autenticação via **API Key** no header:

```http
X-API-Key: sua_api_key_aqui
```

### 4.2 Idempotência

Para evitar lançamentos duplicados, use o header:

```http
idempotency-key: {uc}-{mes_referencia}
```

Exemplo: `idempotency-key: 49166370-01/2026`

### 4.3 Endpoints da API Control

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/lancamentos` | Criar lançamento |
| PATCH | `/lancamentos/{id}/cancelar` | Cancelar lançamento |
| PATCH | `/lancamentos/{id}/pagar` | Registrar pagamento |
| PATCH | `/lancamentos/{id}/estornar-pagamento` | Estornar pagamento |

### 4.4 Payload - Criar Lançamento

```json
{
    "tipoOperacao": "fatura_equatorial",
    "valor": 150.50,
    "dataVencimento": "2026-02-06",
    "competenciaMes": 1,
    "competenciaAno": 2026,
    "numeroDocumento": "23793381286000000000300000004001843400000100",
    "codigoBarras": "23793381286000000000300000004001843400000100",
    "descricao": "Fatura EQTL - Associado - jan/2026 - Lucas Gabriel - UC 49166370",
    "observacoes": "Referente ao mês de janeiro/2026 - UC 49166370",
    "status": "PENDENTE"
}
```

### 4.5 Status Disponíveis

| Status | Descrição | Uso |
|--------|-----------|-----|
| `PENDENTE` | Aguardando aprovação | Padrão |
| `APROVADO` | Aprovado para pagamento | Compensação real |
| `PAGO` | Pagamento confirmado | Já pago |

---

## 5. Service de Integração

### 5.1 AupusControlService

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AupusControlService
{
    protected string $apiUrl;
    protected string $apiKey;
    protected int $timeout;

    protected const MESES_EXTENSO = [
        '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
        'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
    ];

    protected const MESES_ABREV = [
        '', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
        'jul', 'ago', 'set', 'out', 'nov', 'dez'
    ];

    public function __construct()
    {
        $this->apiUrl = config('services.control.api_url');
        $this->apiKey = config('services.control.api_key');
        $this->timeout = config('services.control.timeout', 30);

        if (empty($this->apiUrl) || empty($this->apiKey)) {
            throw new \Exception('CONTROL_API_URL e CONTROL_API_KEY devem estar configurados');
        }
    }

    /**
     * Envia lançamento de fatura EQTL (SAÍDA) para o Aupus Control
     */
    public function enviarFaturaEQTL(array $dados): array
    {
        $codigoBarras = preg_replace('/[\s-]/', '', $dados['codigo_barras']);
        $mesRef = $dados['mes_referencia']; // "MM/YYYY"
        [$mesStr, $anoStr] = explode('/', $mesRef);
        $competenciaMes = (int) $mesStr;
        $competenciaAno = (int) $anoStr;

        $mesAbrev = self::MESES_ABREV[$competenciaMes] ?? $mesStr;
        $mesExtenso = self::MESES_EXTENSO[$competenciaMes] ?? $mesStr;
        $nomeCliente = $dados['nome_cliente'] ?? 'Cliente';
        $uc = $dados['uc'];
        $isUg = $dados['is_ug'] ?? false;

        $tipo = $isUg ? 'Usineiro' : 'Associado';
        $tipoUc = $isUg ? 'UG' : 'UC';

        $payload = [
            'tipoOperacao' => 'fatura_equatorial',
            'valor' => (float) $dados['valor'],
            'dataVencimento' => $dados['data_vencimento'], // YYYY-MM-DD
            'competenciaMes' => $competenciaMes,
            'competenciaAno' => $competenciaAno,
            'numeroDocumento' => substr($codigoBarras, 0, 50),
            'codigoBarras' => $codigoBarras,
            'descricao' => "Fatura EQTL - {$tipo} - {$mesAbrev}/{$competenciaAno} - {$nomeCliente} - {$tipoUc} {$uc}",
            'observacoes' => "Referente ao mês de {$mesExtenso}/{$competenciaAno} - UC {$uc}",
        ];

        if (!empty($dados['status'])) {
            $payload['status'] = $dados['status'];
        }

        $idempotencyKey = "{$uc}-{$mesRef}";

        return $this->enviarLancamento($payload, $idempotencyKey);
    }

    /**
     * Envia lançamento de boleto de energia (ENTRADA) para o Aupus Control
     */
    public function enviarBoletoEnergia(array $dados): array
    {
        $mesRef = $dados['mes_referencia']; // "MM/YYYY"
        [$mesStr, $anoStr] = explode('/', $mesRef);
        $competenciaMes = (int) $mesStr;
        $competenciaAno = (int) $anoStr;

        $mesAbrev = self::MESES_ABREV[$competenciaMes] ?? $mesStr;
        $mesExtenso = self::MESES_EXTENSO[$competenciaMes] ?? $mesStr;
        $nomeCliente = $dados['nome_cliente'] ?? 'Cliente';
        $uc = $dados['uc'];

        // Converter data DD/MM/YYYY para YYYY-MM-DD
        $dataVencimento = $dados['data_vencimento'];
        if (str_contains($dataVencimento, '/')) {
            $partes = explode('/', $dataVencimento);
            if (count($partes) === 3) {
                $ano = strlen($partes[2]) === 2 ? '20' . $partes[2] : $partes[2];
                $dataVencimento = "{$ano}-{$partes[1]}-{$partes[0]}";
            }
        }

        $payload = [
            'tipoOperacao' => 'boleto_de_contribuicao',
            'valor' => (float) $dados['valor'],
            'dataVencimento' => $dataVencimento,
            'competenciaMes' => $competenciaMes,
            'competenciaAno' => $competenciaAno,
            'descricao' => "Boleto AUPUS - Associado - {$mesAbrev}/{$competenciaAno} - {$nomeCliente} - UC {$uc}",
            'observacoes' => "Referente ao mês de {$mesExtenso}/{$competenciaAno} - UC {$uc}",
        ];

        if (!empty($dados['numero_boleto'])) {
            $payload['numeroDocumento'] = substr($dados['numero_boleto'], 0, 50);
        }

        if (!empty($dados['status'])) {
            $payload['status'] = $dados['status'];
        }

        $idempotencyKey = "boleto-{$uc}-{$mesRef}";

        return $this->enviarLancamento($payload, $idempotencyKey);
    }

    /**
     * Envia lançamento genérico para a API
     */
    protected function enviarLancamento(array $payload, string $idempotencyKey): array
    {
        try {
            Log::info("[CONTROL] Enviando lançamento", [
                'idempotency_key' => $idempotencyKey,
                'tipo' => $payload['tipoOperacao'],
                'valor' => $payload['valor'],
            ]);

            $response = Http::timeout($this->timeout)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-API-Key' => $this->apiKey,
                    'idempotency-key' => $idempotencyKey,
                ])
                ->post($this->apiUrl, $payload);

            $data = $response->json();

            if ($response->successful() && !empty($data['id'])) {
                Log::info("[CONTROL] Lançamento criado", ['id' => $data['id']]);
                return [
                    'sucesso' => true,
                    'dados' => $data,
                    'erro' => null,
                ];
            }

            $mensagemErro = is_array($data['message'] ?? null)
                ? implode(', ', $data['message'])
                : ($data['message'] ?? json_encode($data));

            Log::error("[CONTROL] Erro ao criar lançamento", [
                'erro' => $mensagemErro,
                'response' => $data,
            ]);

            return [
                'sucesso' => false,
                'dados' => $data,
                'erro' => $mensagemErro,
            ];

        } catch (\Exception $e) {
            Log::error("[CONTROL] Erro de conexão", ['erro' => $e->getMessage()]);
            return [
                'sucesso' => false,
                'dados' => null,
                'erro' => "Erro de conexão: {$e->getMessage()}",
            ];
        }
    }

    /**
     * Cancela um lançamento no Aupus Control
     */
    public function cancelarLancamento(string $controlId, ?string $motivo = null): array
    {
        try {
            Log::info("[CONTROL] Cancelando lançamento", ['id' => $controlId]);

            $response = Http::timeout($this->timeout)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-API-Key' => $this->apiKey,
                ])
                ->patch("{$this->apiUrl}/{$controlId}/cancelar", [
                    'motivo' => $motivo ?? 'Cancelado via sistema',
                ]);

            $data = $response->json();

            if ($response->successful()) {
                Log::info("[CONTROL] Lançamento cancelado", ['id' => $controlId]);
                return ['sucesso' => true, 'dados' => $data, 'erro' => null];
            }

            $mensagemErro = is_array($data['message'] ?? null)
                ? implode(', ', $data['message'])
                : ($data['message'] ?? 'Erro ao cancelar');

            return ['sucesso' => false, 'dados' => $data, 'erro' => $mensagemErro];

        } catch (\Exception $e) {
            return ['sucesso' => false, 'dados' => null, 'erro' => $e->getMessage()];
        }
    }

    /**
     * Registra pagamento de um lançamento (APROVADO → PAGO)
     */
    public function registrarPagamento(string $controlId, array $dados): array
    {
        try {
            Log::info("[CONTROL] Registrando pagamento", ['id' => $controlId]);

            $payload = [
                'dataPagamento' => $dados['data_pagamento'],
                'valorPago' => (float) $dados['valor_pago'],
            ];

            if (!empty($dados['conta_bancaria'])) {
                $payload['contaBancariaNome'] = $dados['conta_bancaria'];
            }

            if (!empty($dados['forma_pagamento'])) {
                $payload['formaPagamento'] = $dados['forma_pagamento'];
            }

            $response = Http::timeout($this->timeout)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-API-Key' => $this->apiKey,
                ])
                ->patch("{$this->apiUrl}/{$controlId}/pagar", $payload);

            $data = $response->json();

            if ($response->successful()) {
                Log::info("[CONTROL] Pagamento registrado", ['id' => $controlId]);
                return ['sucesso' => true, 'dados' => $data, 'erro' => null];
            }

            $mensagemErro = is_array($data['message'] ?? null)
                ? implode(', ', $data['message'])
                : ($data['message'] ?? 'Erro ao registrar pagamento');

            return ['sucesso' => false, 'dados' => $data, 'erro' => $mensagemErro];

        } catch (\Exception $e) {
            return ['sucesso' => false, 'dados' => null, 'erro' => $e->getMessage()];
        }
    }

    /**
     * Estorna pagamento de um lançamento (PAGO → APROVADO)
     */
    public function estornarPagamento(string $controlId, ?string $motivo = null): array
    {
        try {
            Log::info("[CONTROL] Estornando pagamento", ['id' => $controlId]);

            $response = Http::timeout($this->timeout)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'X-API-Key' => $this->apiKey,
                ])
                ->patch("{$this->apiUrl}/{$controlId}/estornar-pagamento", [
                    'motivo' => $motivo ?? 'Estornado via sistema',
                ]);

            $data = $response->json();

            if ($response->successful()) {
                Log::info("[CONTROL] Pagamento estornado", ['id' => $controlId]);
                return ['sucesso' => true, 'dados' => $data, 'erro' => null];
            }

            $mensagemErro = is_array($data['message'] ?? null)
                ? implode(', ', $data['message'])
                : ($data['message'] ?? 'Erro ao estornar');

            return ['sucesso' => false, 'dados' => $data, 'erro' => $mensagemErro];

        } catch (\Exception $e) {
            return ['sucesso' => false, 'dados' => null, 'erro' => $e->getMessage()];
        }
    }
}
```

---

## 6. Controller

### 6.1 ControlLancamentoController

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\PagamentoConcessionaria;
use App\Models\BoletoEnergia;
use App\Models\FaturaAssociado;
use App\Services\AupusControlService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ControlLancamentoController extends Controller
{
    public function __construct(
        protected AupusControlService $controlService
    ) {}

    /**
     * POST /api/pagamentos-concessionaria/lancar-control/{faturaId}
     * Lança fatura EQTL no Aupus Control
     */
    public function lancarFaturaControl(Request $request, string $faturaId): JsonResponse
    {
        // 1. Buscar fatura
        $fatura = FaturaAssociado::findOrFail($faturaId);

        // 2. Buscar ou criar pagamento
        $pagamento = PagamentoConcessionaria::firstOrCreate(
            [
                'uc' => $fatura->numero_uc ?? $fatura->uc,
                'mes_referencia' => $fatura->mes_referencia,
            ],
            [
                'fatura_id' => $fatura->id,
                'valor_fatura' => $fatura->valor_fatura,
                'data_vencimento_fatura' => $fatura->data_vencimento,
                'codigo_barras' => $fatura->codigo_barras,
                'status' => 'pendente',
            ]
        );

        // 3. Verificar se já foi lançado
        if ($pagamento->status_control === 'lancado') {
            return response()->json([
                'error' => 'Já lançado no Aupus Control',
                'message' => "ID: {$pagamento->control_lancamento_id}",
                'control_lancamento_id' => $pagamento->control_lancamento_id,
            ], 400);
        }

        // 4. Validar código de barras
        $codigoBarras = $pagamento->codigo_barras ?? $fatura->codigo_barras;
        if (empty($codigoBarras)) {
            return response()->json([
                'error' => 'Sem código de barras',
                'message' => 'Informe o código de barras para lançar no Control',
            ], 400);
        }

        // 5. Determinar status automático
        $statusControl = $this->determinarStatusControl($pagamento, $fatura);

        // 6. Buscar dados do cliente (nome, tipo)
        $dadosCliente = $this->buscarDadosCliente($pagamento->uc);

        // 7. Enviar para Aupus Control
        $resultado = $this->controlService->enviarFaturaEQTL([
            'codigo_barras' => $codigoBarras,
            'data_vencimento' => $pagamento->data_vencimento_fatura?->format('Y-m-d'),
            'valor' => $pagamento->valor_fatura,
            'mes_referencia' => $pagamento->mes_referencia,
            'nome_cliente' => $dadosCliente['nome'] ?? $request->input('nome_cliente'),
            'uc' => $pagamento->uc,
            'is_ug' => $dadosCliente['is_ug'] ?? false,
            'status' => $statusControl,
        ]);

        if (!$resultado['sucesso']) {
            $pagamento->update([
                'status_control' => 'erro',
                'erro_control' => $resultado['erro'],
                'resposta_control' => $resultado['dados'],
            ]);

            return response()->json([
                'error' => 'Erro ao enviar para Aupus Control',
                'message' => $resultado['erro'],
                'detalhes' => $resultado['dados'],
            ], 400);
        }

        // 8. Sucesso - atualizar pagamento
        $controlId = $resultado['dados']['id'];
        $pagamento->update([
            'status_control' => 'lancado',
            'control_lancamento_id' => $controlId,
            'data_lancamento_control' => now(),
            'resposta_control' => $resultado['dados'],
            'erro_control' => null,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Lançamento enviado para Aupus Control com sucesso',
            'control_lancamento_id' => $controlId,
            'pagamento' => [
                'id' => $pagamento->id,
                'uc' => $pagamento->uc,
                'valor' => $pagamento->valor_fatura,
                'status_control' => 'lancado',
                'control_lancamento_id' => $controlId,
            ],
        ]);
    }

    /**
     * POST /api/boletos-energia/lancar-control/{boletoId}
     * Lança boleto de energia (ENTRADA) no Aupus Control
     */
    public function lancarBoletoControl(Request $request, int $boletoId): JsonResponse
    {
        // 1. Buscar boleto
        $boleto = BoletoEnergia::findOrFail($boletoId);

        // 2. Verificar se já foi lançado
        if ($boleto->status_control === 'lancado') {
            return response()->json([
                'error' => 'Já lançado no Aupus Control',
                'message' => "ID: {$boleto->control_lancamento_id}",
                'control_lancamento_id' => $boleto->control_lancamento_id,
            ], 400);
        }

        // 3. Determinar status
        $statusControl = $boleto->status === 'Pago' ? 'PAGO' : 'PENDENTE';

        // 4. Buscar nome do cliente
        $dadosCliente = $this->buscarDadosCliente($boleto->uc);

        // 5. Enviar para Aupus Control
        $resultado = $this->controlService->enviarBoletoEnergia([
            'numero_boleto' => $boleto->numero_boleto,
            'data_vencimento' => $boleto->data_vencimento,
            'valor' => $boleto->valor_boleto,
            'mes_referencia' => $boleto->mes_referencia,
            'nome_cliente' => $dadosCliente['nome'],
            'uc' => $boleto->uc,
            'status' => $statusControl,
        ]);

        if (!$resultado['sucesso']) {
            $boleto->update([
                'status_control' => 'erro',
                'erro_control' => $resultado['erro'],
                'resposta_control' => $resultado['dados'],
            ]);

            return response()->json([
                'error' => 'Erro ao enviar para Aupus Control',
                'message' => $resultado['erro'],
                'detalhes' => $resultado['dados'],
            ], 400);
        }

        // 6. Sucesso
        $controlId = $resultado['dados']['id'];
        $boleto->update([
            'status_control' => 'lancado',
            'control_lancamento_id' => $controlId,
            'data_lancamento_control' => now(),
            'resposta_control' => $resultado['dados'],
            'erro_control' => null,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Boleto lançado no Aupus Control com sucesso',
            'control_lancamento_id' => $controlId,
        ]);
    }

    /**
     * Determina o status a ser enviado ao Control
     */
    protected function determinarStatusControl(PagamentoConcessionaria $pagamento, FaturaAssociado $fatura): string
    {
        // 1. Se boleto de energia já pago → PAGO
        $boleto = BoletoEnergia::where('uc', $pagamento->uc)
            ->where('mes_referencia', $pagamento->mes_referencia)
            ->first();

        if ($boleto && $boleto->status === 'Pago') {
            return 'PAGO';
        }

        // 2. Se pagamento BB já pago → PAGO
        if ($pagamento->status === 'pago') {
            return 'PAGO';
        }

        // 3. Se tem compensação real → APROVADO
        $categoria = $fatura->dados_leitura['categoria'] ?? '';
        if (str_contains($categoria, 'Compensação') && !str_contains($categoria, 'Sem Compensação')) {
            return 'APROVADO';
        }

        // 4. Demais casos → PENDENTE
        return 'PENDENTE';
    }

    /**
     * Busca dados do cliente no CRM
     */
    protected function buscarDadosCliente(string $uc): array
    {
        try {
            // Implementar busca no CRM
            // Retornar: ['nome' => '...', 'is_ug' => false]
            return ['nome' => null, 'is_ug' => false];
        } catch (\Exception $e) {
            return ['nome' => null, 'is_ug' => false];
        }
    }
}
```

---

## 7. Endpoints

### 7.1 Rotas

```php
// routes/api.php

use App\Http\Controllers\Admin\ControlLancamentoController;

Route::middleware(['auth:sanctum'])->group(function () {
    
    // Lançamento no Aupus Control
    Route::post('/pagamentos-concessionaria/lancar-control/{faturaId}', 
        [ControlLancamentoController::class, 'lancarFaturaControl']);
    
    Route::post('/boletos-energia/lancar-control/{boletoId}', 
        [ControlLancamentoController::class, 'lancarBoletoControl']);
});
```

### 7.2 Resumo dos Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/pagamentos-concessionaria/lancar-control/{faturaId}` | Lançar fatura EQTL |
| POST | `/api/boletos-energia/lancar-control/{boletoId}` | Lançar boleto energia |

---

## 8. Regras de Negócio

### 8.1 Determinação Automática de Status

```
┌─────────────────────────────────────────────────────────────────────┐
│                    REGRAS DE STATUS AUTOMÁTICO                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Boleto de energia já pago?                                      │
│     └─▶ SIM → Status: PAGO                                          │
│                                                                     │
│  2. Pagamento BB já pago?                                           │
│     └─▶ SIM → Status: PAGO                                          │
│                                                                     │
│  3. Fatura com compensação real?                                    │
│     (categoria contém "Compensação" sem "Sem Compensação")          │
│     └─▶ SIM → Status: APROVADO                                      │
│                                                                     │
│  4. Demais casos                                                    │
│     └─▶ Status: PENDENTE                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 Idempotência

O sistema usa **idempotency-key** para evitar duplicatas:

| Tipo | Formato | Exemplo |
|------|---------|---------|
| Fatura EQTL | `{uc}-{mes_referencia}` | `49166370-01/2026` |
| Boleto Energia | `boleto-{uc}-{mes_referencia}` | `boleto-49166370-01/2026` |

### 8.3 Validações

| Validação | Resposta |
|-----------|----------|
| Já lançado no Control | 400 - "Já lançado no Aupus Control" |
| Sem código de barras | 400 - "Sem código de barras" |
| Erro na API Control | 400 - Mensagem de erro da API |

---

## 9. Exemplos de Request/Response

### 9.1 Lançar Fatura EQTL

**Request:**
```http
POST /api/pagamentos-concessionaria/lancar-control/01JNMEWG39CRAZN20SFK684A13
Authorization: Bearer {token}
Content-Type: application/json

{
    "nome_cliente": "Lucas Gabriel"
}
```

**Response (Sucesso):**
```json
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

**Response (Já Lançado):**
```json
{
    "error": "Já lançado no Aupus Control",
    "message": "ID: 01JNMEWG39CRAZN20SFK684A13",
    "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13"
}
```

### 9.2 Lançar Boleto Energia

**Request:**
```http
POST /api/boletos-energia/lancar-control/456
Authorization: Bearer {token}
Content-Type: application/json
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Boleto lançado no Aupus Control com sucesso",
    "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A14"
}
```

---

## 10. Migration - Campos Adicionais

Se ainda não existirem, adicionar campos na tabela `pagamentos_concessionaria`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pagamentos_concessionaria', function (Blueprint $table) {
            // Campos do Aupus Control
            $table->string('status_control', 20)->nullable()->after('status');
            $table->string('control_lancamento_id', 50)->nullable();
            $table->timestamp('data_lancamento_control')->nullable();
            $table->json('resposta_control')->nullable();
            $table->text('erro_control')->nullable();
            
            // Índice
            $table->index('status_control');
        });
    }

    public function down(): void
    {
        Schema::table('pagamentos_concessionaria', function (Blueprint $table) {
            $table->dropColumn([
                'status_control',
                'control_lancamento_id',
                'data_lancamento_control',
                'resposta_control',
                'erro_control',
            ]);
        });
    }
};
```

---

## 11. Checklist de Implementação

### Configuração
- [ ] Adicionar variáveis no `.env`
- [ ] Criar config em `config/services.php`

### Service
- [ ] Criar `AupusControlService`
- [ ] Implementar `enviarFaturaEQTL`
- [ ] Implementar `enviarBoletoEnergia`
- [ ] Implementar `cancelarLancamento`
- [ ] Implementar `registrarPagamento`
- [ ] Implementar `estornarPagamento`

### Controller
- [ ] Criar `ControlLancamentoController`
- [ ] Implementar `lancarFaturaControl`
- [ ] Implementar `lancarBoletoControl`

### Database
- [ ] Criar migration para campos do Control
- [ ] Executar migration

### Rotas
- [ ] Adicionar rotas em `routes/api.php`

### Testes
- [ ] Testar lançamento de fatura
- [ ] Testar lançamento de boleto
- [ ] Testar idempotência (não duplicar)
- [ ] Testar tratamento de erros
