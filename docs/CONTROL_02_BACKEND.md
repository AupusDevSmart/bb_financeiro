# Aupus Control - Documentação Backend (Laravel)

> **Prompt para equipe Backend** - Implementação da API para lançamento de faturas no Aupus Control.

---

## 1. Contexto

O backend Laravel deve expor endpoints que o frontend consome para enviar lançamentos ao **Aupus Control** (sistema financeiro externo). O backend é responsável por:

1. Receber requisição do frontend
2. Buscar/validar dados da fatura
3. Determinar status automático
4. Chamar API externa do Control
5. Atualizar banco de dados local
6. Retornar resultado ao frontend

---

## 2. Configuração

### 2.1 Variáveis de Ambiente (.env)

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

### 2.2 Config Laravel

```php
// config/services.php

return [
    // ... outras configs ...

    'control' => [
        'api_url' => env('CONTROL_API_URL'),
        'api_key' => env('CONTROL_API_KEY'),
        'conta_bancaria' => env('CONTROL_CONTA_BANCARIA', 'Banco do Brasil'),
        'timeout' => 30,
    ],
];
```

---

## 3. Endpoint Principal

### 3.1 Rota

```php
// routes/api.php

Route::post('/pagamentos-concessionaria/lancar-control/{faturaId}', 
    [ControlLancamentoController::class, 'lancarFaturaControl']);
```

### 3.2 Request

```http
POST /api/pagamentos-concessionaria/lancar-control/{faturaId}
Content-Type: application/json

{
    "nome_cliente": "Lucas Gabriel"  // opcional
}
```

### 3.3 Response - Sucesso

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

### 3.4 Response - Já Lançado

```json
{
    "error": "Já lançado no Aupus Control",
    "message": "ID: 01JNMEWG39CRAZN20SFK684A13",
    "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13"
}
```

### 3.5 Response - Erro

```json
{
    "error": "Erro ao enviar para Aupus Control",
    "message": "Lançamento duplicado",
    "detalhes": { ... }
}
```

---

## 4. Controller

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
     * Lança fatura EQTL no Aupus Control
     */
    public function lancarFaturaControl(Request $request, string $faturaId): JsonResponse
    {
        // 1. Buscar fatura
        $fatura = FaturaAssociado::findOrFail($faturaId);

        // 2. Buscar ou criar pagamento
        $pagamento = PagamentoConcessionaria::firstOrCreate(
            [
                'uc' => $fatura->uc,
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

        // 6. Buscar dados do cliente
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

        // 8. Tratar erro
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

        // 9. Sucesso
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
     * Determina o status a ser enviado ao Control
     */
    protected function determinarStatusControl(
        PagamentoConcessionaria $pagamento, 
        FaturaAssociado $fatura
    ): string {
        // 1. Boleto de energia já pago → PAGO
        $boleto = BoletoEnergia::where('uc', $pagamento->uc)
            ->where('mes_referencia', $pagamento->mes_referencia)
            ->first();

        if ($boleto && $boleto->status === 'Pago') {
            return 'PAGO';
        }

        // 2. Pagamento BB já pago → PAGO
        if ($pagamento->status === 'pago') {
            return 'PAGO';
        }

        // 3. Compensação real → APROVADO
        $categoria = $fatura->dados_leitura['categoria'] ?? '';
        if (str_contains($categoria, 'Compensação') && 
            !str_contains($categoria, 'Sem Compensação')) {
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
            // SELECT nome_cliente, gerador FROM unidades_consumidoras ...
            return ['nome' => null, 'is_ug' => false];
        } catch (\Exception $e) {
            return ['nome' => null, 'is_ug' => false];
        }
    }
}
```

---

## 5. Service

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
     * Envia lançamento de fatura EQTL para o Aupus Control
     */
    public function enviarFaturaEQTL(array $dados): array
    {
        // Limpar código de barras
        $codigoBarras = preg_replace('/[\s-]/', '', $dados['codigo_barras']);
        
        // Extrair competência
        [$mesStr, $anoStr] = explode('/', $dados['mes_referencia']);
        $competenciaMes = (int) $mesStr;
        $competenciaAno = (int) $anoStr;

        // Montar descrição
        $mesAbrev = self::MESES_ABREV[$competenciaMes] ?? $mesStr;
        $mesExtenso = self::MESES_EXTENSO[$competenciaMes] ?? $mesStr;
        $nomeCliente = $dados['nome_cliente'] ?? 'Cliente';
        $uc = $dados['uc'];
        $isUg = $dados['is_ug'] ?? false;

        $tipo = $isUg ? 'Usineiro' : 'Associado';
        $tipoUc = $isUg ? 'UG' : 'UC';

        // Montar payload
        $payload = [
            'tipoOperacao' => 'fatura_equatorial',
            'valor' => (float) $dados['valor'],
            'dataVencimento' => $dados['data_vencimento'],
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

        // Idempotency key
        $idempotencyKey = "{$uc}-{$dados['mes_referencia']}";

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
}
```

---

## 6. API Externa do Aupus Control

### 6.1 Autenticação

```http
X-API-Key: {CONTROL_API_KEY}
```

### 6.2 Idempotência

```http
idempotency-key: {uc}-{mes_referencia}
```

Exemplo: `idempotency-key: 49166370-01/2026`

### 6.3 Payload para Fatura EQTL

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

### 6.4 Status Disponíveis

| Status | Descrição | Quando Usar |
|--------|-----------|-------------|
| `PENDENTE` | Aguardando aprovação | Padrão |
| `APROVADO` | Aprovado para pagamento | Compensação real |
| `PAGO` | Pagamento confirmado | Já pago |

### 6.5 Response da API Control

```json
{
    "id": "01JNMEWG39CRAZN20SFK684A13",
    "tipoOperacao": "fatura_equatorial",
    "valor": 150.50,
    "status": "PENDENTE",
    "createdAt": "2026-01-15T10:30:00Z"
}
```

---

## 7. Regras de Negócio

### 7.1 Determinação Automática de Status

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

### 7.2 Validações

| Validação | HTTP Status | Mensagem |
|-----------|-------------|----------|
| Já lançado | 400 | "Já lançado no Aupus Control" |
| Sem código de barras | 400 | "Sem código de barras" |
| Erro na API | 400 | Mensagem da API |
| Fatura não encontrada | 404 | "Fatura não encontrada" |

---

## 8. Migration

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
            $table->string('status_control', 20)->nullable();
            $table->string('control_lancamento_id', 50)->nullable();
            $table->timestamp('data_lancamento_control')->nullable();
            $table->json('resposta_control')->nullable();
            $table->text('erro_control')->nullable();
            
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

## 9. Checklist de Implementação

### Configuração
- [ ] Adicionar variáveis no `.env`
- [ ] Criar config em `config/services.php`

### Service
- [ ] Criar `AupusControlService`
- [ ] Implementar `enviarFaturaEQTL`
- [ ] Implementar `enviarLancamento` (método interno)

### Controller
- [ ] Criar `ControlLancamentoController`
- [ ] Implementar `lancarFaturaControl`
- [ ] Implementar `determinarStatusControl`
- [ ] Implementar `buscarDadosCliente`

### Database
- [ ] Criar migration para campos do Control
- [ ] Executar migration

### Rotas
- [ ] Adicionar rota em `routes/api.php`

### Testes
- [ ] Testar lançamento com sucesso
- [ ] Testar já lançado (idempotência)
- [ ] Testar sem código de barras
- [ ] Testar erro da API externa
