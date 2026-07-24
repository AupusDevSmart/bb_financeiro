# Pagamento de Faturas - Documentação Backend (Laravel)

> **Guia para implementação do Backend** - Especificação completa dos endpoints e serviços para o módulo de pagamento de faturas.

---

## 📋 Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Endpoints da API](#3-endpoints-da-api)
4. [Models e Migrations](#4-models-e-migrations)
5. [Services](#5-services)
6. [Controllers](#6-controllers)
7. [Regras de Negócio](#7-regras-de-negócio)
8. [Integração com BB](#8-integração-com-bb)
9. [Integração com WhatsApp/Email](#9-integração-com-whatsappemail)
10. [Exemplos de Request/Response](#10-exemplos-de-requestresponse)

---

## 1. Visão Geral

### 1.1 Objetivo

O backend deve fornecer APIs para:
1. **Listar faturas** de concessionárias por mês
2. **Lançar pagamentos** via API do Banco do Brasil
3. **Cancelar pagamentos** pendentes
4. **Sincronizar status** com o BB
5. **Enviar faturas** via WhatsApp e Email

### 1.2 Fluxo Geral

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Laravel    │────▶│   API BB     │
│   (React)    │     │   Backend    │     │   Pagamentos │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  ChatCenter  │
                     │  (WhatsApp)  │
                     └──────────────┘
```

---

## 2. Arquitetura

### 2.1 Estrutura de Arquivos

```
app/
├── Http/
│   └── Controllers/
│       └── Admin/
│           └── PagamentoConcessionariaController.php
├── Models/
│   ├── PagamentoConcessionaria.php
│   └── FaturaAssociado.php
├── Services/
│   ├── BB/
│   │   ├── BBAuthService.php
│   │   └── BBPagamentoService.php
│   ├── WhatsAppChatCenterService.php
│   └── EmailService.php
└── Resources/
    └── PagamentoConcessionariaResource.php

config/
├── bb.php
└── services.php

database/
└── migrations/
    └── xxxx_create_pagamentos_concessionaria_table.php
```

### 2.2 Dependências

```json
{
    "require": {
        "guzzlehttp/guzzle": "^7.0",
        "laravel/sanctum": "^3.0"
    }
}
```

---

## 3. Endpoints da API

### 3.1 Resumo dos Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/meses-disponiveis-boletos` | Lista meses com faturas |
| GET | `/api/pagamentos-concessionaria` | Lista faturas do mês |
| GET | `/api/pagamentos-concessionaria/resumo/{mes}` | Resumo estatístico |
| GET | `/api/pagamentos-concessionaria/ugs/{mes}` | Lista UGs do mês |
| POST | `/api/pagamentos-concessionaria/lancar/{faturaId}` | Lançar pagamento BB |
| POST | `/api/pagamentos-concessionaria/{id}/cancelar-bb` | Cancelar no BB |
| POST | `/api/pagamentos-concessionaria/sincronizar-status` | Sincronizar status |
| POST | `/api/pagamentos-concessionaria/enviar-fatura-whatsapp` | Enviar WhatsApp |
| POST | `/api/pagamentos-concessionaria/enviar-fatura-email` | Enviar Email |
| PATCH | `/api/pagamentos-concessionaria/{id}/codigo-barras` | Atualizar código |
| DELETE | `/api/pagamentos-concessionaria/{id}` | Excluir pagamento |
| GET | `/api/pagamentos-concessionaria/exportar/{mes}` | Exportar Excel |
| POST | `/api/pagamentos-concessionaria/forcar-config` | Forçar configuração |
| POST | `/api/pagamentos-concessionaria/reverter-config` | Reverter config |

### 3.2 Detalhamento dos Endpoints

#### GET /api/meses-disponiveis-boletos

**Descrição:** Retorna lista de meses que possuem faturas disponíveis.

**Response:**
```json
{
    "meses": ["01/2026", "02/2026", "03/2026"]
}
```

---

#### GET /api/pagamentos-concessionaria

**Descrição:** Lista faturas do mês com dados de pagamento.

**Query Parameters:**
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| mes_referencia | string | Sim | Mês no formato MM/YYYY |
| status | string | Não | Filtrar por status |

**Response:**
```json
{
    "pagamentos": [
        {
            "fatura_id": "01JNMEWG39CRAZN20SFK684A13",
            "pagamento_id": 123,
            "uc": "49166370",
            "mes_referencia": "01/2026",
            "nome_cliente": "Lucas Gabriel",
            "valor_fatura": 150.50,
            "data_vencimento_fatura": "06/02/2026",
            "codigo_barras": "23793381286000000000300000004001843400000100",
            "pix_copia_cola": "00020126580014br.gov.bcb.pix...",
            "status": "pendente",
            "status_control": null,
            "control_lancamento_id": null,
            "tem_boleto_energia": true,
            "is_ug": false,
            "nome_diferente": false,
            "tipo_forcado": null,
            "data_envio_whatsapp": null,
            "data_envio_email": null,
            "whatsapp": "11999998888",
            "email": "cliente@email.com",
            "numero_requisicao": null,
            "id_pagamento_bb": null
        }
    ]
}
```

---

#### GET /api/pagamentos-concessionaria/resumo/{mes}

**Descrição:** Retorna resumo estatístico do mês.

**Response:**
```json
{
    "quantidade_total": 15,
    "total_geral": 2500.00,
    "por_status": [
        { "status": "pendente", "quantidade": 5 },
        { "status": "lancado", "quantidade": 3 },
        { "status": "pago", "quantidade": 7 }
    ]
}
```

---

#### POST /api/pagamentos-concessionaria/lancar/{faturaId}

**Descrição:** Lança pagamento na API do Banco do Brasil.

**Request Body:**
```json
{
    "data_pagamento": "2026-03-15",
    "nome_cliente": "Lucas Gabriel"
}
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Pagamento enviado para o Banco do Brasil com sucesso",
    "pagamento": {
        "id": 123,
        "uc": "49166370",
        "valor": 150.50,
        "tipo": "BOLETO",
        "data_pagamento": "2026-03-15",
        "numero_requisicao": 1234567,
        "id_pagamento_bb": "ABC123XYZ",
        "estado_requisicao": "CONSISTENTE",
        "status": "lancado"
    },
    "resposta_bb": {
        "numeroRequisicao": 1234567,
        "estadoRequisicao": "CONSISTENTE",
        "lancamentos": [...]
    }
}
```

**Response (Erro - Data Passada):**
```json
{
    "error": "Data de pagamento já passou",
    "message": "A data 2026-01-15 já passou. Informe uma nova data de pagamento.",
    "dataPassada": true,
    "dataOriginal": "2026-01-15"
}
```

---

#### POST /api/pagamentos-concessionaria/{id}/cancelar-bb

**Descrição:** Cancela pagamento pendente no BB.

**Request Body:**
```json
{
    "forcar": false
}
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Pagamento cancelado com sucesso"
}
```

**Response (Já Processado):**
```json
{
    "error": "Não foi possível cancelar",
    "message": "Pagamento já foi processado pelo banco",
    "jaProcessado": true,
    "podeForcar": true
}
```

---

#### POST /api/pagamentos-concessionaria/sincronizar-status

**Descrição:** Sincroniza status dos pagamentos lançados com a API do BB.

**Response:**
```json
{
    "success": true,
    "sincronizados": 3,
    "detalhes": [
        {
            "id": 123,
            "uc": "49166370",
            "status_anterior": "lancado",
            "status_novo": "pago"
        }
    ]
}
```

---

#### POST /api/pagamentos-concessionaria/enviar-fatura-whatsapp

**Descrição:** Envia fatura original da concessionária via WhatsApp.

**Request Body:**
```json
{
    "fatura_id": "01JNMEWG39CRAZN20SFK684A13",
    "uc": "49166370",
    "mes_referencia": "01/2026",
    "telefone": "11999998888",
    "forcar_reenvio": false,
    "mensagem_customizada": "Olá! Segue sua fatura..."
}
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Fatura enviada via WhatsApp com sucesso"
}
```

**Response (Já Enviado):**
```json
{
    "error": "Fatura já foi enviada",
    "message": "Esta fatura já foi enviada em 15/03/2026 10:30",
    "ja_enviado": true
}
```

---

#### POST /api/pagamentos-concessionaria/enviar-fatura-email

**Descrição:** Envia fatura original da concessionária via Email.

**Request Body:**
```json
{
    "fatura_id": "01JNMEWG39CRAZN20SFK684A13",
    "uc": "49166370",
    "mes_referencia": "01/2026",
    "email": "cliente@email.com",
    "email_secundario": "outro@email.com",
    "forcar_reenvio": false,
    "assunto_customizado": "Fatura EQTL - UC 49166370",
    "mensagem_customizada": "Prezado cliente..."
}
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Fatura enviada via Email com sucesso"
}
```

---

## 4. Models e Migrations

### 4.1 Migration

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pagamentos_concessionaria', function (Blueprint $table) {
            $table->id();
            
            // Relacionamentos
            $table->string('fatura_id')->nullable()->index();
            $table->foreignId('cliente_id')->nullable()->constrained('clientes');
            
            // Identificação
            $table->string('uc', 20);
            $table->string('mes_referencia', 10);
            
            // Valores
            $table->decimal('valor_fatura', 12, 2);
            $table->decimal('valor_pago', 12, 2)->nullable();
            
            // Datas
            $table->date('data_vencimento_fatura')->nullable();
            $table->date('data_pagamento')->nullable();
            $table->timestamp('data_lancamento')->nullable();
            $table->timestamp('data_confirmacao')->nullable();
            
            // Dados do Boleto
            $table->string('codigo_barras', 60)->nullable();
            $table->text('pix_copia_cola')->nullable();
            $table->string('tipo_pagamento', 10)->default('BOLETO');
            
            // Dados do Banco do Brasil
            $table->integer('numero_requisicao')->nullable();
            $table->string('id_pagamento_bb', 50)->nullable();
            $table->string('estado_requisicao', 30)->nullable();
            $table->json('resposta_api_bb')->nullable();
            
            // Status e Controle
            $table->string('status', 20)->default('pendente');
            $table->text('mensagem_erro')->nullable();
            $table->integer('tentativas')->default(0);
            
            // Aupus Control
            $table->string('status_control', 20)->nullable();
            $table->string('control_lancamento_id', 50)->nullable();
            
            // Configuração forçada
            $table->string('tipo_forcado', 10)->nullable(); // 'lote' ou 'enviar'
            $table->string('status_original', 20)->nullable();
            
            // Envio de fatura
            $table->timestamp('data_envio_whatsapp')->nullable();
            $table->timestamp('data_envio_email')->nullable();
            
            // Auditoria
            $table->timestamps();
            
            // Constraints
            $table->unique(['uc', 'mes_referencia']);
            $table->index('status');
            $table->index('mes_referencia');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pagamentos_concessionaria');
    }
};
```

### 4.2 Model

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PagamentoConcessionaria extends Model
{
    protected $table = 'pagamentos_concessionaria';

    protected $fillable = [
        'fatura_id',
        'cliente_id',
        'uc',
        'mes_referencia',
        'valor_fatura',
        'valor_pago',
        'data_vencimento_fatura',
        'data_pagamento',
        'data_lancamento',
        'data_confirmacao',
        'codigo_barras',
        'pix_copia_cola',
        'tipo_pagamento',
        'numero_requisicao',
        'id_pagamento_bb',
        'estado_requisicao',
        'resposta_api_bb',
        'status',
        'mensagem_erro',
        'tentativas',
        'status_control',
        'control_lancamento_id',
        'tipo_forcado',
        'status_original',
        'data_envio_whatsapp',
        'data_envio_email',
    ];

    protected $casts = [
        'valor_fatura' => 'decimal:2',
        'valor_pago' => 'decimal:2',
        'data_vencimento_fatura' => 'date',
        'data_pagamento' => 'date',
        'data_lancamento' => 'datetime',
        'data_confirmacao' => 'datetime',
        'data_envio_whatsapp' => 'datetime',
        'data_envio_email' => 'datetime',
        'resposta_api_bb' => 'array',
    ];

    // Relacionamentos
    public function cliente(): BelongsTo
    {
        return $this->belongsTo(Cliente::class);
    }

    public function fatura(): BelongsTo
    {
        return $this->belongsTo(FaturaAssociado::class, 'fatura_id', 'id');
    }

    // Scopes
    public function scopePendentes($query)
    {
        return $query->where('status', 'pendente');
    }

    public function scopeLancados($query)
    {
        return $query->where('status', 'lancado');
    }

    public function scopePagos($query)
    {
        return $query->where('status', 'pago');
    }

    public function scopeDoMes($query, string $mesReferencia)
    {
        return $query->where('mes_referencia', $mesReferencia);
    }

    // Helpers
    public function podeSerLancado(): bool
    {
        return in_array($this->status, ['pendente', 'erro']);
    }

    public function podeSercancelado(): bool
    {
        return in_array($this->status, ['lancado', 'aguardando_aprovacao', 'pendente_bb', 'consistente', 'processando']);
    }

    public function ehFinal(): bool
    {
        return in_array($this->status, ['pago', 'cancelado']);
    }

    // Determinar tipo efetivo (lote ou enviar)
    public function getTipoEfetivo(): string
    {
        if ($this->tipo_forcado) {
            return $this->tipo_forcado;
        }
        
        // Lógica baseada nos dados da fatura
        // Implementar conforme regras de negócio
        return 'lote';
    }
}
```

---

## 5. Services

### 5.1 PagamentoConcessionariaService

```php
<?php

namespace App\Services;

use App\Models\PagamentoConcessionaria;
use App\Models\FaturaAssociado;
use App\Services\BB\BBPagamentoService;
use Illuminate\Support\Collection;
use Carbon\Carbon;

class PagamentoConcessionariaService
{
    public function __construct(
        protected BBPagamentoService $bbService
    ) {}

    /**
     * Lista faturas do mês com dados de pagamento
     */
    public function listarPorMes(string $mesReferencia, ?string $status = null): Collection
    {
        // Buscar faturas do mês
        $query = FaturaAssociado::where('mes_referencia', $mesReferencia)
            ->with(['cliente', 'pagamento']);

        $faturas = $query->get();

        // Mapear para formato esperado pelo frontend
        return $faturas->map(function ($fatura) {
            $pagamento = $fatura->pagamento;
            
            return [
                'fatura_id' => $fatura->id,
                'pagamento_id' => $pagamento?->id,
                'uc' => $fatura->numero_uc ?? $fatura->uc,
                'mes_referencia' => $fatura->mes_referencia,
                'nome_cliente' => $fatura->cliente?->nome ?? $fatura->nome_fatura,
                'valor_fatura' => $fatura->valor_fatura,
                'data_vencimento_fatura' => $fatura->data_vencimento?->format('d/m/Y'),
                'codigo_barras' => $pagamento?->codigo_barras ?? $fatura->codigo_barras,
                'pix_copia_cola' => $pagamento?->pix_copia_cola ?? $fatura->pix_copia_cola,
                'status' => $pagamento?->status ?? 'pendente',
                'status_control' => $pagamento?->status_control,
                'control_lancamento_id' => $pagamento?->control_lancamento_id,
                'tem_boleto_energia' => $this->temBoletoEnergia($fatura),
                'is_ug' => $this->ehUG($fatura),
                'nome_diferente' => $this->temNomeDiferente($fatura),
                'tipo_forcado' => $pagamento?->tipo_forcado,
                'data_envio_whatsapp' => $pagamento?->data_envio_whatsapp,
                'data_envio_email' => $pagamento?->data_envio_email,
                'whatsapp' => $fatura->cliente?->whatsapp,
                'email' => $fatura->cliente?->email,
                'numero_requisicao' => $pagamento?->numero_requisicao,
                'id_pagamento_bb' => $pagamento?->id_pagamento_bb,
            ];
        });
    }

    /**
     * Retorna resumo estatístico do mês
     */
    public function resumoMes(string $mesReferencia): array
    {
        $pagamentos = PagamentoConcessionaria::doMes($mesReferencia)->get();

        $porStatus = $pagamentos->groupBy('status')->map(function ($grupo, $status) {
            return [
                'status' => $status,
                'quantidade' => $grupo->count(),
            ];
        })->values();

        return [
            'quantidade_total' => $pagamentos->count(),
            'total_geral' => $pagamentos->sum('valor_fatura'),
            'por_status' => $porStatus,
        ];
    }

    /**
     * Lança pagamento na API do BB
     */
    public function lancarPagamento(string $faturaId, ?string $dataPagamento = null): array
    {
        // Buscar fatura
        $fatura = FaturaAssociado::findOrFail($faturaId);

        // Buscar ou criar pagamento
        $pagamento = PagamentoConcessionaria::firstOrNew([
            'uc' => $fatura->numero_uc ?? $fatura->uc,
            'mes_referencia' => $fatura->mes_referencia,
        ]);

        if (!$pagamento->exists) {
            $pagamento->fill([
                'fatura_id' => $fatura->id,
                'valor_fatura' => $fatura->valor_fatura,
                'data_vencimento_fatura' => $fatura->data_vencimento,
                'codigo_barras' => $fatura->codigo_barras,
                'pix_copia_cola' => $fatura->pix_copia_cola,
                'status' => 'pendente',
            ]);
            $pagamento->save();
        }

        // Validar código de barras
        if (empty($pagamento->codigo_barras)) {
            throw new \Exception('Código de barras é obrigatório');
        }

        // Validar status
        if (!$pagamento->podeSerLancado()) {
            throw new \Exception("Pagamento com status '{$pagamento->status}' não pode ser lançado");
        }

        // Definir data de pagamento
        $dataPag = $dataPagamento ?? $pagamento->data_vencimento_fatura?->format('Y-m-d') ?? now()->format('Y-m-d');

        // Validar se data não é passada
        if (Carbon::parse($dataPag)->lt(Carbon::today())) {
            return [
                'success' => false,
                'error' => 'Data de pagamento já passou',
                'message' => "A data {$dataPag} já passou. Informe uma nova data de pagamento.",
                'dataPassada' => true,
                'dataOriginal' => $dataPag,
            ];
        }

        $pagamento->data_pagamento = $dataPag;
        $pagamento->save();

        // CNPJ da concessionária
        $cnpjConcessionaria = config('bb.concessionarias.EQTL_GO', '01543032000104');

        // Chamar API do BB
        $resultado = $this->bbService->efetuarPagamento($pagamento, $cnpjConcessionaria);

        if (!$resultado['sucesso']) {
            $pagamento->update([
                'status' => $resultado['rejeitado'] ?? false ? 'rejeitado' : 'erro',
                'mensagem_erro' => $resultado['erro'],
            ]);

            return [
                'success' => false,
                'error' => 'Erro ao enviar pagamento',
                'message' => $resultado['erro'],
                'detalhes' => $resultado['dados'],
            ];
        }

        // Atualizar pagamento com dados do BB
        $dadosBB = $resultado['dados'];
        $lancamento = $dadosBB['lancamentos'][0] ?? [];

        $pagamento->update([
            'status' => 'lancado',
            'tipo_pagamento' => 'BOLETO',
            'numero_requisicao' => $dadosBB['numeroRequisicao'] ?? null,
            'id_pagamento_bb' => $lancamento['codigoIdentificadorPagamento'] ?? null,
            'estado_requisicao' => $dadosBB['estadoRequisicao'] ?? null,
            'resposta_api_bb' => $dadosBB,
            'data_lancamento' => now(),
            'mensagem_erro' => null,
        ]);

        return [
            'success' => true,
            'message' => 'Pagamento enviado para o Banco do Brasil com sucesso',
            'pagamento' => [
                'id' => $pagamento->id,
                'uc' => $pagamento->uc,
                'valor' => $pagamento->valor_fatura,
                'tipo' => 'BOLETO',
                'data_pagamento' => $pagamento->data_pagamento,
                'numero_requisicao' => $dadosBB['numeroRequisicao'] ?? null,
                'id_pagamento_bb' => $lancamento['codigoIdentificadorPagamento'] ?? null,
                'estado_requisicao' => $dadosBB['estadoRequisicao'] ?? null,
                'status' => 'lancado',
            ],
            'resposta_bb' => $dadosBB,
        ];
    }

    /**
     * Sincroniza status dos pagamentos com o BB
     */
    public function sincronizarStatus(): array
    {
        $pagamentos = PagamentoConcessionaria::lancados()
            ->whereNotNull('id_pagamento_bb')
            ->get();

        $sincronizados = [];

        foreach ($pagamentos as $pagamento) {
            try {
                $resultado = $this->bbService->consultarPagamento($pagamento->id_pagamento_bb);

                if (!$resultado['sucesso']) {
                    continue;
                }

                $estadoBB = $resultado['dados']['estadoPagamento'] ?? '';
                $novoStatus = $this->mapearEstadoBB($estadoBB);

                if ($novoStatus && $novoStatus !== $pagamento->status) {
                    $statusAnterior = $pagamento->status;

                    $pagamento->update([
                        'status' => $novoStatus,
                        'estado_requisicao' => $estadoBB,
                        'data_confirmacao' => $novoStatus === 'pago' ? now() : null,
                    ]);

                    $sincronizados[] = [
                        'id' => $pagamento->id,
                        'uc' => $pagamento->uc,
                        'status_anterior' => $statusAnterior,
                        'status_novo' => $novoStatus,
                    ];
                }
            } catch (\Exception $e) {
                // Log e continuar
            }
        }

        return [
            'success' => true,
            'sincronizados' => count($sincronizados),
            'detalhes' => $sincronizados,
        ];
    }

    /**
     * Mapeia estado do BB para status interno
     */
    protected function mapearEstadoBB(string $estadoBB): ?string
    {
        return match ($estadoBB) {
            'PROCESSADA', 'LIQUIDADO', 'EFETIVADO' => 'pago',
            'REJEITADA', 'DEVOLVIDO' => 'erro',
            'CANCELADA' => 'cancelado',
            'AGUARDANDO_APROVACAO' => 'aguardando_aprovacao',
            'PROCESSANDO' => 'processando_pagamento',
            default => null,
        };
    }

    // Métodos auxiliares
    protected function temBoletoEnergia(FaturaAssociado $fatura): bool
    {
        // Implementar lógica específica
        return true;
    }

    protected function ehUG(FaturaAssociado $fatura): bool
    {
        // Implementar lógica específica
        return false;
    }

    protected function temNomeDiferente(FaturaAssociado $fatura): bool
    {
        // Comparar nome na fatura com nome do titular
        return false;
    }
}
```

---

## 6. Controllers

### 6.1 PagamentoConcessionariaController

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\PagamentoConcessionariaService;
use App\Services\WhatsAppChatCenterService;
use App\Services\EmailService;
use App\Models\PagamentoConcessionaria;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class PagamentoConcessionariaController extends Controller
{
    public function __construct(
        protected PagamentoConcessionariaService $service,
        protected WhatsAppChatCenterService $whatsappService,
        protected EmailService $emailService
    ) {}

    /**
     * GET /api/meses-disponiveis-boletos
     */
    public function mesesDisponiveis(): JsonResponse
    {
        $meses = PagamentoConcessionaria::select('mes_referencia')
            ->distinct()
            ->orderByDesc('mes_referencia')
            ->pluck('mes_referencia');

        return response()->json(['meses' => $meses]);
    }

    /**
     * GET /api/pagamentos-concessionaria
     */
    public function index(Request $request): JsonResponse
    {
        $mesReferencia = $request->query('mes_referencia');
        $status = $request->query('status');

        if (!$mesReferencia) {
            return response()->json(['error' => 'mes_referencia é obrigatório'], 400);
        }

        $pagamentos = $this->service->listarPorMes($mesReferencia, $status);

        return response()->json(['pagamentos' => $pagamentos]);
    }

    /**
     * GET /api/pagamentos-concessionaria/resumo/{mes}
     */
    public function resumo(string $mes): JsonResponse
    {
        $resumo = $this->service->resumoMes($mes);
        return response()->json($resumo);
    }

    /**
     * POST /api/pagamentos-concessionaria/lancar/{faturaId}
     */
    public function lancar(Request $request, string $faturaId): JsonResponse
    {
        $request->validate([
            'data_pagamento' => 'nullable|date|after_or_equal:today',
        ]);

        try {
            $resultado = $this->service->lancarPagamento(
                $faturaId,
                $request->input('data_pagamento')
            );

            if (!$resultado['success']) {
                $statusCode = isset($resultado['dataPassada']) ? 400 : 500;
                return response()->json($resultado, $statusCode);
            }

            return response()->json($resultado);

        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/pagamentos-concessionaria/{id}/cancelar-bb
     */
    public function cancelarBB(Request $request, int $id): JsonResponse
    {
        $pagamento = PagamentoConcessionaria::findOrFail($id);
        $forcar = $request->boolean('forcar', false);

        if (!$pagamento->podeSercancelado()) {
            return response()->json([
                'error' => 'Pagamento não pode ser cancelado',
                'message' => "Status atual: {$pagamento->status}",
            ], 400);
        }

        try {
            $resultado = app(\App\Services\BB\BBPagamentoService::class)
                ->cancelarPagamento($pagamento->id_pagamento_bb);

            if (!$resultado['sucesso']) {
                if ($resultado['ja_processado'] ?? false) {
                    if ($forcar) {
                        $pagamento->update(['status' => 'cancelado']);
                        return response()->json([
                            'success' => true,
                            'message' => 'Pagamento cancelado localmente (forçado)',
                            'forcado' => true,
                        ]);
                    }

                    return response()->json([
                        'error' => 'Não foi possível cancelar',
                        'message' => 'Pagamento já foi processado pelo banco',
                        'jaProcessado' => true,
                        'podeForcar' => true,
                    ], 400);
                }

                return response()->json([
                    'error' => 'Erro ao cancelar',
                    'message' => $resultado['erro'],
                ], 400);
            }

            $pagamento->update(['status' => 'cancelado']);

            return response()->json([
                'success' => true,
                'message' => 'Pagamento cancelado com sucesso',
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/pagamentos-concessionaria/sincronizar-status
     */
    public function sincronizarStatus(): JsonResponse
    {
        $resultado = $this->service->sincronizarStatus();
        return response()->json($resultado);
    }

    /**
     * POST /api/pagamentos-concessionaria/enviar-fatura-whatsapp
     */
    public function enviarWhatsApp(Request $request): JsonResponse
    {
        $request->validate([
            'fatura_id' => 'required|string',
            'uc' => 'required|string',
            'mes_referencia' => 'required|string',
            'telefone' => 'required|string',
            'mensagem_customizada' => 'nullable|string',
            'forcar_reenvio' => 'nullable|boolean',
        ]);

        $pagamento = PagamentoConcessionaria::where('uc', $request->uc)
            ->where('mes_referencia', $request->mes_referencia)
            ->first();

        // Verificar se já foi enviado
        if ($pagamento?->data_envio_whatsapp && !$request->boolean('forcar_reenvio')) {
            return response()->json([
                'error' => 'Fatura já foi enviada',
                'message' => 'Esta fatura já foi enviada em ' . $pagamento->data_envio_whatsapp->format('d/m/Y H:i'),
                'ja_enviado' => true,
            ], 409);
        }

        try {
            // Gerar link de download
            $linkDownload = $this->gerarLinkDownload($request->uc, $request->mes_referencia);

            // Preparar mensagem
            $mensagem = $request->mensagem_customizada ?? $this->gerarMensagemPadrao($pagamento);
            
            // Substituir [LINK]
            if (str_contains($mensagem, '[LINK]')) {
                $mensagem = str_replace('[LINK]', $linkDownload, $mensagem);
            } else {
                $mensagem .= "\n\n📄 *Baixar Fatura:*\n{$linkDownload}";
            }

            // Enviar via ChatCenter
            $resultado = $this->whatsappService->enviarMensagem($request->telefone, $mensagem);

            // Atualizar data de envio
            if ($pagamento) {
                $pagamento->update(['data_envio_whatsapp' => now()]);
            }

            return response()->json([
                'success' => true,
                'message' => 'Fatura enviada via WhatsApp com sucesso',
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Erro ao enviar WhatsApp',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/pagamentos-concessionaria/enviar-fatura-email
     */
    public function enviarEmail(Request $request): JsonResponse
    {
        $request->validate([
            'fatura_id' => 'required|string',
            'uc' => 'required|string',
            'mes_referencia' => 'required|string',
            'email' => 'required|email',
            'email_secundario' => 'nullable|email',
            'assunto_customizado' => 'nullable|string',
            'mensagem_customizada' => 'nullable|string',
            'forcar_reenvio' => 'nullable|boolean',
        ]);

        $pagamento = PagamentoConcessionaria::where('uc', $request->uc)
            ->where('mes_referencia', $request->mes_referencia)
            ->first();

        // Verificar se já foi enviado
        if ($pagamento?->data_envio_email && !$request->boolean('forcar_reenvio')) {
            return response()->json([
                'error' => 'Fatura já foi enviada',
                'message' => 'Esta fatura já foi enviada em ' . $pagamento->data_envio_email->format('d/m/Y H:i'),
                'ja_enviado' => true,
            ], 409);
        }

        try {
            // Buscar caminho do PDF
            $caminhoPdf = $this->buscarCaminhoPdf($request->uc, $request->mes_referencia);

            // Preparar destinatários
            $destinatarios = [$request->email];
            if ($request->email_secundario) {
                $destinatarios[] = $request->email_secundario;
            }

            // Enviar email
            $this->emailService->enviarFatura(
                $destinatarios,
                $request->assunto_customizado ?? "Fatura EQTL - UC {$request->uc} - {$request->mes_referencia}",
                $request->mensagem_customizada ?? $this->gerarMensagemEmailPadrao($pagamento),
                $caminhoPdf
            );

            // Atualizar data de envio
            if ($pagamento) {
                $pagamento->update(['data_envio_email' => now()]);
            }

            return response()->json([
                'success' => true,
                'message' => 'Fatura enviada via Email com sucesso',
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Erro ao enviar Email',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * PATCH /api/pagamentos-concessionaria/{id}/codigo-barras
     */
    public function atualizarCodigoBarras(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'codigo_barras' => 'nullable|string|max:60',
            'pix_copia_cola' => 'nullable|string',
        ]);

        $pagamento = PagamentoConcessionaria::findOrFail($id);

        $pagamento->update([
            'codigo_barras' => $request->codigo_barras,
            'pix_copia_cola' => $request->pix_copia_cola,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Código atualizado com sucesso',
        ]);
    }

    /**
     * DELETE /api/pagamentos-concessionaria/{id}
     */
    public function destroy(int $id): JsonResponse
    {
        $pagamento = PagamentoConcessionaria::findOrFail($id);

        if ($pagamento->status !== 'pendente') {
            return response()->json([
                'error' => 'Apenas pagamentos pendentes podem ser excluídos',
            ], 400);
        }

        $pagamento->delete();

        return response()->json([
            'success' => true,
            'message' => 'Pagamento excluído',
        ]);
    }

    // Métodos auxiliares
    protected function gerarLinkDownload(string $uc, string $mesReferencia): string
    {
        $mesFormatado = str_replace('/', '-', $mesReferencia);
        return config('app.url') . "/api/faturas/download/{$uc}/{$mesFormatado}";
    }

    protected function gerarMensagemPadrao(?PagamentoConcessionaria $pagamento): string
    {
        $mesRef = $pagamento?->mes_referencia ?? '-';
        return "Olá! Segue sua fatura de energia EQTL referente ao mês {$mesRef}.\n\n[LINK]\n\nQualquer dúvida, estamos à disposição!\n\n*AUPUS Energia*";
    }

    protected function gerarMensagemEmailPadrao(?PagamentoConcessionaria $pagamento): string
    {
        return "Prezado(a) Cliente,\n\nSegue em anexo sua fatura de energia EQTL.\n\nAtenciosamente,\nAUPUS Energia";
    }

    protected function buscarCaminhoPdf(string $uc, string $mesReferencia): string
    {
        // Implementar busca do caminho do PDF
        $basePath = config('app.dados_path', '/var/www/aupus-microservicos-faturas/dados');
        return "{$basePath}/{$uc}/{$mesReferencia}/fatura.pdf";
    }
}
```

---

## 7. Regras de Negócio

### 7.1 Regras de Status

| Status | Descrição | Pode Lançar | Pode Cancelar |
|--------|-----------|-------------|---------------|
| pendente | Aguardando lançamento | ✅ | ❌ |
| lancado | Enviado para BB | ❌ | ✅ |
| aguardando_aprovacao | Aguardando aprovação no BB | ❌ | ✅ |
| processando_pagamento | BB processando | ❌ | ✅ |
| pago | Débito confirmado | ❌ | ❌ |
| erro | Erro no lançamento | ✅ | ❌ |
| rejeitado | Rejeitado pelo BB | ❌ | ❌ |
| cancelado | Cancelado | ❌ | ❌ |

### 7.2 Regras de Separação (Lote vs Enviar)

| Condição | Tipo |
|----------|------|
| tipo_forcado definido | Usar tipo_forcado |
| Não tem boleto energia E não é UG | enviar |
| Nome na fatura diferente do titular | enviar |
| Demais casos | lote |

### 7.3 Regras de Envio

| Regra | Descrição |
|-------|-----------|
| Verificar envio anterior | Se já enviou, retornar 409 |
| forcar_reenvio | Permite reenviar mesmo se já enviou |
| Substituir [LINK] | Substituir placeholder pelo link real |
| Registrar data | Atualizar data_envio_whatsapp/email |

---

## 8. Integração com BB

Ver documentação completa em: `INTEGRACAO_BB_PAGAMENTOS_LARAVEL.md`

### Resumo:
- Autenticação OAuth2 com mTLS (certificado A1)
- Endpoint: `POST /lotes-boletos`
- Conversão de linha digitável para código de barras
- Cache de token (50 minutos)

---

## 9. Integração com WhatsApp/Email

Ver documentação completa em: `WHATSAPP_CHATCENTER_LARAVEL.md`

### Resumo WhatsApp:
- API ChatCenter/Multiweb
- Endpoint: `POST https://api.multiweb.plus/send/chat/`
- Payload: `{ key, numero, texto }`

### Resumo Email:
- Laravel Mail com SMTP
- Anexar PDF da fatura
- Template HTML

---

## 10. Exemplos de Request/Response

### 10.1 Listar Faturas

**Request:**
```http
GET /api/pagamentos-concessionaria?mes_referencia=01/2026&status=pendente
Authorization: Bearer {token}
```

**Response:**
```json
{
    "pagamentos": [
        {
            "fatura_id": "01JNMEWG39CRAZN20SFK684A13",
            "uc": "49166370",
            "nome_cliente": "Lucas Gabriel",
            "valor_fatura": 150.50,
            "status": "pendente",
            "codigo_barras": "23793381286000000000300000004001843400000100"
        }
    ]
}
```

### 10.2 Lançar Pagamento

**Request:**
```http
POST /api/pagamentos-concessionaria/lancar/01JNMEWG39CRAZN20SFK684A13
Authorization: Bearer {token}
Content-Type: application/json

{
    "data_pagamento": "2026-03-15"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Pagamento enviado para o Banco do Brasil com sucesso",
    "pagamento": {
        "id": 123,
        "uc": "49166370",
        "numero_requisicao": 1234567,
        "status": "lancado"
    }
}
```

### 10.3 Enviar WhatsApp

**Request:**
```http
POST /api/pagamentos-concessionaria/enviar-fatura-whatsapp
Authorization: Bearer {token}
Content-Type: application/json

{
    "fatura_id": "01JNMEWG39CRAZN20SFK684A13",
    "uc": "49166370",
    "mes_referencia": "01/2026",
    "telefone": "11999998888",
    "mensagem_customizada": "Olá! Segue sua fatura. [LINK]"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Fatura enviada via WhatsApp com sucesso"
}
```

---

## 11. Rotas

```php
// routes/api.php

use App\Http\Controllers\Admin\PagamentoConcessionariaController;

Route::middleware(['auth:sanctum'])->group(function () {
    
    // Meses disponíveis
    Route::get('/meses-disponiveis-boletos', [PagamentoConcessionariaController::class, 'mesesDisponiveis']);
    
    // Pagamentos
    Route::get('/pagamentos-concessionaria', [PagamentoConcessionariaController::class, 'index']);
    Route::get('/pagamentos-concessionaria/resumo/{mes}', [PagamentoConcessionariaController::class, 'resumo']);
    Route::get('/pagamentos-concessionaria/ugs/{mes}', [PagamentoConcessionariaController::class, 'ugs']);
    
    // Lançamento BB
    Route::post('/pagamentos-concessionaria/lancar/{faturaId}', [PagamentoConcessionariaController::class, 'lancar']);
    Route::post('/pagamentos-concessionaria/{id}/cancelar-bb', [PagamentoConcessionariaController::class, 'cancelarBB']);
    Route::post('/pagamentos-concessionaria/sincronizar-status', [PagamentoConcessionariaController::class, 'sincronizarStatus']);
    
    // Envio de fatura
    Route::post('/pagamentos-concessionaria/enviar-fatura-whatsapp', [PagamentoConcessionariaController::class, 'enviarWhatsApp']);
    Route::post('/pagamentos-concessionaria/enviar-fatura-email', [PagamentoConcessionariaController::class, 'enviarEmail']);
    
    // CRUD
    Route::patch('/pagamentos-concessionaria/{id}/codigo-barras', [PagamentoConcessionariaController::class, 'atualizarCodigoBarras']);
    Route::delete('/pagamentos-concessionaria/{id}', [PagamentoConcessionariaController::class, 'destroy']);
    
    // Exportação
    Route::get('/pagamentos-concessionaria/exportar/{mes}', [PagamentoConcessionariaController::class, 'exportar']);
    
    // Configuração forçada
    Route::post('/pagamentos-concessionaria/forcar-config', [PagamentoConcessionariaController::class, 'forcarConfig']);
    Route::post('/pagamentos-concessionaria/reverter-config', [PagamentoConcessionariaController::class, 'reverterConfig']);
});
```

---

## 12. Checklist de Implementação

### Models e Migrations
- [ ] Criar migration `pagamentos_concessionaria`
- [ ] Criar model `PagamentoConcessionaria`
- [ ] Executar migration

### Services
- [ ] Criar `PagamentoConcessionariaService`
- [ ] Integrar com `BBPagamentoService`
- [ ] Integrar com `WhatsAppChatCenterService`
- [ ] Integrar com `EmailService`

### Controller
- [ ] Criar `PagamentoConcessionariaController`
- [ ] Implementar todos os endpoints
- [ ] Adicionar validações

### Rotas
- [ ] Adicionar rotas em `routes/api.php`
- [ ] Configurar middleware de autenticação

### Testes
- [ ] Testar listagem de faturas
- [ ] Testar lançamento individual
- [ ] Testar lançamento em lote
- [ ] Testar cancelamento
- [ ] Testar sincronização
- [ ] Testar envio WhatsApp
- [ ] Testar envio Email
