# Pagamento em Lote - Documentação do Sistema Atual (Backend)

Documentação descritiva do funcionamento atual do módulo de **Pagamento de Boletos em Lote** via API do Banco do Brasil. Este documento descreve **como o sistema funciona hoje** para servir de referência na migração para o novo sistema.

---

## 1. Contexto do Negócio

### 1.1 Objetivo

O sistema gerencia o pagamento de faturas de **concessionárias de energia** para múltiplas unidades consumidoras (UCs). O pagamento é realizado através da **API de Pagamentos em Lote do Banco do Brasil**, que permite agendar débitos automáticos na conta corrente da empresa.

### 1.2 Entidades Envolvidas

| Entidade | Descrição |
|----------|-----------|
| **Unidade Consumidora (UC)** | Identificador único do ponto de consumo na concessionária |
| **Fatura** | Documento de cobrança emitido pela concessionária |
| **Pagamento** | Registro do pagamento de uma fatura específica |
| **Concessionária** | Empresa fornecedora de energia (ex: EQTL, CEMIG, CPFL) |
| **Cliente** | Pessoa física ou jurídica responsável pela UC |

### 1.3 Fluxo Macro

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│   Fatura    │───▶│  Pagamento   │───▶│   API BB    │───▶│    Débito    │
│  Importada  │    │   Criado     │    │   Enviado   │    │  Processado  │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
```

---

## 2. Regras de Negócio

### 2.1 Regras de Criação de Pagamento

| ID | Regra | Validação |
|----|-------|-----------|
| RN01 | Um pagamento só pode ser criado se existir uma fatura associada | `fatura_id` obrigatório |
| RN02 | Não pode existir mais de um pagamento para a mesma UC + mês de referência | Constraint UNIQUE |
| RN03 | O valor do pagamento deve ser maior que zero | `valor > 0` |
| RN04 | O código de barras deve ter 44 ou 47 dígitos numéricos | Regex validation |
| RN05 | Se já existe pagamento para UC/mês, reutilizar o registro existente | Upsert logic |

### 2.2 Regras de Lançamento (Envio ao BB)

| ID | Regra | Validação |
|----|-------|-----------|
| RN06 | Pagamento só pode ser lançado se status = `pendente` ou `erro` | Status check |
| RN07 | Data de pagamento não pode ser data passada | `data >= hoje` |
| RN08 | Código de barras é obrigatório para lançamento | Not null |
| RN09 | PIX não é suportado para lançamento automático | Tipo = BOLETO only |
| RN10 | Documento do beneficiário (CNPJ da concessionária) é obrigatório | Not null |
| RN11 | Descrição do pagamento limitada a 40 caracteres | Truncate |

### 2.3 Regras de Status

| ID | Regra | Descrição |
|----|-------|-----------|
| RN12 | Status `pendente` → `lancado` quando API BB aceita | Transição automática |
| RN13 | Status `pendente` → `erro` quando API BB rejeita | Transição automática |
| RN14 | Status `lancado` → `pago` quando BB confirma débito | Via sincronização |
| RN15 | Status `lancado` → `cancelado` quando cancelamento é aceito | Via endpoint cancelar |
| RN16 | Pagamento com status `pago` não pode ser alterado | Imutável |
| RN17 | Pagamento com status `cancelado` não pode ser relançado | Imutável |

### 2.4 Regras de Cancelamento

| ID | Regra | Descrição |
|----|-------|-----------|
| RN18 | Só pode cancelar pagamentos com status `lancado` | Status check |
| RN19 | Cancelamento só é possível antes do débito ser processado | Validação BB |
| RN20 | Se BB retorna "já processado", marcar como `pago` | Atualização automática |

### 2.5 Regras de Sincronização

| ID | Regra | Descrição |
|----|-------|-----------|
| RN21 | Sincronização consulta apenas pagamentos com status `lancado` | Filtro de query |
| RN22 | Se BB retorna estado `PROCESSADA` ou `LIQUIDADO`, marcar como `pago` | Mapeamento de estados |
| RN23 | Se BB retorna estado `REJEITADA`, marcar como `erro` | Mapeamento de estados |

---

## 3. Modelo de Dados

### 3.1 Tabela `pagamentos_concessionaria`

```sql
CREATE TABLE pagamentos_concessionaria (
    id SERIAL PRIMARY KEY,
    
    -- Relacionamentos
    fatura_id INTEGER NOT NULL REFERENCES faturas(id),
    cliente_id INTEGER REFERENCES clientes(id),
    concessionaria_id INTEGER REFERENCES concessionarias(id),
    
    -- Identificação
    uc VARCHAR(20) NOT NULL,
    mes_referencia VARCHAR(10) NOT NULL,
    
    -- Valores
    valor_fatura DECIMAL(12,2) NOT NULL,
    valor_pago DECIMAL(12,2),
    
    -- Datas
    data_vencimento DATE,
    data_pagamento DATE,
    data_lancamento TIMESTAMP,
    data_confirmacao TIMESTAMP,
    
    -- Dados do Boleto
    codigo_barras VARCHAR(50),
    pix_copia_cola TEXT,
    tipo_pagamento VARCHAR(10) DEFAULT 'BOLETO',
    
    -- Dados do Banco do Brasil
    numero_requisicao INTEGER,
    id_pagamento_bb VARCHAR(50),
    estado_requisicao VARCHAR(30),
    resposta_api_bb JSONB,
    
    -- Status e Controle
    status VARCHAR(20) DEFAULT 'pendente',
    mensagem_erro TEXT,
    tentativas INTEGER DEFAULT 0,
    
    -- Auditoria
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT uk_pagamento_uc_mes UNIQUE (uc, mes_referencia),
    CONSTRAINT chk_valor_positivo CHECK (valor_fatura > 0),
    CONSTRAINT chk_status CHECK (status IN ('pendente', 'lancado', 'pago', 'erro', 'rejeitado', 'cancelado'))
);

CREATE INDEX idx_pagamentos_status ON pagamentos_concessionaria(status);
CREATE INDEX idx_pagamentos_mes ON pagamentos_concessionaria(mes_referencia);
CREATE INDEX idx_pagamentos_fatura ON pagamentos_concessionaria(fatura_id);
```

### 3.2 Enum de Status

```php
enum StatusPagamento: string
{
    case PENDENTE = 'pendente';
    case LANCADO = 'lancado';
    case PAGO = 'pago';
    case ERRO = 'erro';
    case REJEITADO = 'rejeitado';
    case CANCELADO = 'cancelado';
    
    public function podeSerLancado(): bool
    {
        return in_array($this, [self::PENDENTE, self::ERRO]);
    }
    
    public function podeSercancelado(): bool
    {
        return $this === self::LANCADO;
    }
    
    public function ehFinal(): bool
    {
        return in_array($this, [self::PAGO, self::CANCELADO]);
    }
}
```

---

## 4. Integração com API do Banco do Brasil

### 4.1 Configuração

```php
// config/bb.php
return [
    'pagamentos' => [
        'app_key' => env('BB_PAG_APP_KEY'),
        'client_id' => env('BB_PAG_CLIENT_ID'),
        'client_secret' => env('BB_PAG_CLIENT_SECRET'),
        'contrato' => env('BB_PAG_CONTRATO'),
        'agencia' => env('BB_AGENCIA'),
        'conta' => env('BB_CONTA'),
        'conta_digito' => env('BB_CONTA_DIGITO'),
        'certificado_path' => env('BB_CERTIFICADO_PATH'),
        'homologacao' => env('BB_HOMOLOGACAO', false),
    ],
    
    'urls' => [
        'api' => env('BB_HOMOLOGACAO', false) 
            ? 'https://api.hm.bb.com.br/pagamentos-lote/v1'
            : 'https://api-ip.bb.com.br/pagamentos-lote/v1',
        'oauth' => env('BB_HOMOLOGACAO', false)
            ? 'https://oauth.hm.bb.com.br/oauth/token'
            : 'https://oauth.bb.com.br/oauth/token',
    ],
];
```

### 4.2 Autenticação OAuth2

**Fluxo:** Client Credentials com mTLS (certificado digital)

```php
class BBAuthService
{
    private ?string $accessToken = null;
    private ?Carbon $expiresAt = null;

    public function getToken(): string
    {
        if ($this->accessToken && $this->expiresAt && now()->lt($this->expiresAt)) {
            return $this->accessToken;
        }

        $response = Http::withOptions($this->getCurlOptions())
            ->asForm()
            ->withBasicAuth(
                config('bb.pagamentos.client_id'),
                config('bb.pagamentos.client_secret')
            )
            ->post(config('bb.urls.oauth'), [
                'grant_type' => 'client_credentials',
                'scope' => 'pagamentos-lote.boletos-requisicao pagamentos-lote.boletos-info pagamentos-lote.cancelar-requisicao'
            ]);

        if (!$response->successful()) {
            throw new BBAuthException('Falha na autenticação OAuth: ' . $response->body());
        }

        $data = $response->json();
        $this->accessToken = $data['access_token'];
        $this->expiresAt = now()->addSeconds($data['expires_in'] - 60);

        return $this->accessToken;
    }

    private function getCurlOptions(): array
    {
        $certPath = config('bb.pagamentos.certificado_path');
        $certDir = dirname($certPath);

        return [
            'curl' => [
                CURLOPT_SSLCERT => $certDir . '/cert.pem',
                CURLOPT_SSLKEY => $certDir . '/key.pem',
                CURLOPT_SSL_VERIFYPEER => true,
            ]
        ];
    }
}
```

### 4.3 Serviço de Pagamento

```php
class BBPagamentoService
{
    public function __construct(
        private BBAuthService $auth
    ) {}

    /**
     * Efetua pagamento de boleto via API BB
     * 
     * @throws BBPagamentoException
     */
    public function efetuarPagamento(PagamentoConcessionaria $pagamento, Concessionaria $concessionaria): array
    {
        // Validações (RN06, RN07, RN08, RN09, RN10)
        $this->validarPagamento($pagamento);

        $codigoBarras = $this->converterLinhaDigitavel($pagamento->codigo_barras);
        
        $payload = [
            'numeroRequisicao' => $this->gerarNumeroRequisicao(),
            'codigoContrato' => (int) config('bb.pagamentos.contrato'),
            'numeroAgenciaDebito' => (int) config('bb.pagamentos.agencia'),
            'numeroContaCorrenteDebito' => (int) config('bb.pagamentos.conta'),
            'digitoVerificadorContaCorrenteDebito' => config('bb.pagamentos.conta_digito'),
            'lancamentos' => [[
                'numeroCodigoBarras' => $codigoBarras,
                'dataPagamento' => $this->formatarData($pagamento->data_pagamento),
                'valorPagamento' => (float) $pagamento->valor_fatura,
                'descricaoPagamento' => $this->formatarDescricao($pagamento), // RN11
                'valorNominal' => (float) $pagamento->valor_fatura,
                'codigoTipoBeneficiario' => $this->getTipoBeneficiario($concessionaria->documento),
                'documentoBeneficiario' => (int) preg_replace('/\D/', '', $concessionaria->documento)
            ]]
        ];

        $url = config('bb.urls.api') . '/lotes-boletos?gw-dev-app-key=' . config('bb.pagamentos.app_key');

        $response = Http::withToken($this->auth->getToken())
            ->withOptions($this->getCurlOptions())
            ->post($url, $payload);

        return $this->processarResposta($response, $pagamento);
    }

    private function validarPagamento(PagamentoConcessionaria $pagamento): void
    {
        // RN06: Status deve permitir lançamento
        if (!StatusPagamento::from($pagamento->status)->podeSerLancado()) {
            throw new BBPagamentoException("Pagamento com status '{$pagamento->status}' não pode ser lançado");
        }

        // RN07: Data não pode ser passada
        if ($pagamento->data_pagamento && Carbon::parse($pagamento->data_pagamento)->isPast()) {
            throw new BBPagamentoException('Data de pagamento não pode ser data passada');
        }

        // RN08: Código de barras obrigatório
        if (empty($pagamento->codigo_barras)) {
            throw new BBPagamentoException('Código de barras é obrigatório');
        }

        // RN09: Apenas BOLETO suportado
        if ($pagamento->tipo_pagamento !== 'BOLETO') {
            throw new BBPagamentoException('Apenas pagamento via BOLETO é suportado');
        }
    }

    private function processarResposta(Response $response, PagamentoConcessionaria $pagamento): array
    {
        $dados = $response->json();

        if (!$response->successful()) {
            $erro = $dados['erros'][0]['mensagem'] ?? $response->body();
            
            // RN13: Atualizar status para erro
            $pagamento->update([
                'status' => StatusPagamento::ERRO->value,
                'mensagem_erro' => $erro,
                'tentativas' => $pagamento->tentativas + 1,
            ]);

            return ['sucesso' => false, 'erro' => $erro, 'dados' => $dados];
        }

        $lancamento = $dados['lancamentos'][0] ?? [];
        $aceito = ($lancamento['indicadorAceite'] ?? '') === 'S';

        if (!$aceito && !empty($lancamento['erros'])) {
            $erro = implode(', ', $lancamento['erros']);
            
            // RN13: Lançamento rejeitado
            $pagamento->update([
                'status' => StatusPagamento::REJEITADO->value,
                'mensagem_erro' => $erro,
                'resposta_api_bb' => $dados,
            ]);

            return ['sucesso' => false, 'erro' => $erro, 'dados' => $dados];
        }

        // RN12: Sucesso - atualizar para lancado
        $pagamento->update([
            'status' => StatusPagamento::LANCADO->value,
            'numero_requisicao' => $dados['numeroRequisicao'],
            'id_pagamento_bb' => $lancamento['codigoIdentificadorPagamento'] ?? null,
            'estado_requisicao' => $dados['estadoRequisicao'],
            'resposta_api_bb' => $dados,
            'data_lancamento' => now(),
            'mensagem_erro' => null,
        ]);

        return ['sucesso' => true, 'dados' => $dados];
    }

    /**
     * Converte linha digitável (47 dígitos) para código de barras (44 dígitos)
     */
    private function converterLinhaDigitavel(string $linha): string
    {
        $linha = preg_replace('/\D/', '', $linha);

        if (strlen($linha) === 44) {
            return $linha;
        }

        if (strlen($linha) !== 47) {
            throw new BBPagamentoException("Código de barras inválido. Esperado 44 ou 47 dígitos, recebido " . strlen($linha));
        }

        // Estrutura do boleto bancário (47 dígitos):
        // Posição 1-3: Código do banco
        // Posição 4: Código da moeda
        // Posição 5-9: 5 primeiros dígitos do campo livre
        // Posição 10: DV do campo 1
        // Posição 11-20: 10 dígitos do campo livre
        // Posição 21: DV do campo 2
        // Posição 22-31: 10 últimos dígitos do campo livre
        // Posição 32: DV do campo 3
        // Posição 33: DV geral
        // Posição 34-37: Fator de vencimento
        // Posição 38-47: Valor

        $banco = substr($linha, 0, 3);
        $moeda = substr($linha, 3, 1);
        $dvGeral = substr($linha, 32, 1);
        $fatorVenc = substr($linha, 33, 4);
        $valor = substr($linha, 37, 10);
        $campoLivre = substr($linha, 4, 5) . substr($linha, 10, 10) . substr($linha, 21, 10);

        return $banco . $moeda . $dvGeral . $fatorVenc . $valor . $campoLivre;
    }

    private function formatarData(?string $data): int
    {
        $d = $data ? Carbon::parse($data) : now();
        return (int) $d->format('dmY');
    }

    private function formatarDescricao(PagamentoConcessionaria $pagamento): string
    {
        // RN11: Máximo 40 caracteres
        return substr("UC {$pagamento->uc} - {$pagamento->mes_referencia}", 0, 40);
    }

    private function getTipoBeneficiario(string $documento): int
    {
        $doc = preg_replace('/\D/', '', $documento);
        return strlen($doc) === 11 ? 1 : 2; // 1=CPF, 2=CNPJ
    }

    private function gerarNumeroRequisicao(): int
    {
        // 7 dígitos únicos baseado em timestamp
        return (int) (substr((string) now()->timestamp, -6) . rand(0, 9));
    }
}
```

---

## 5. Endpoints da API

### 5.1 Lançar Pagamento Individual

```
POST /api/pagamentos-concessionaria/{fatura_id}/lancar
```

**Request Body (opcional):**
```json
{
    "codigo_barras": "23793381286000000000300000004001843400000100",
    "data_pagamento": "2025-03-15"
}
```

**Response 200:**
```json
{
    "success": true,
    "message": "Pagamento enviado com sucesso",
    "pagamento": {
        "id": 123,
        "uc": "12345678",
        "mes_referencia": "01/2025",
        "valor": 150.50,
        "status": "lancado",
        "numero_requisicao": 1234567,
        "id_pagamento_bb": "ABC123XYZ",
        "data_pagamento": "2025-03-15"
    }
}
```

**Response 400 (Data passada):**
```json
{
    "error": "Data de pagamento já passou",
    "data_passada": true,
    "data_original": "2025-03-01"
}
```

**Response 400 (Erro API BB):**
```json
{
    "error": "Erro ao enviar pagamento",
    "message": "Código de barras inválido",
    "detalhes": { ... }
}
```

### 5.2 Cancelar Pagamento

```
POST /api/pagamentos-concessionaria/{id}/cancelar
```

**Response 200:**
```json
{
    "success": true,
    "message": "Pagamento cancelado com sucesso"
}
```

**Response 400 (Já processado):**
```json
{
    "error": "Não foi possível cancelar",
    "message": "Pagamento já foi processado pelo banco",
    "ja_processado": true
}
```

### 5.3 Sincronizar Status

```
POST /api/pagamentos-concessionaria/sincronizar-status
```

**Response 200:**
```json
{
    "success": true,
    "sincronizados": 5,
    "detalhes": [
        { "id": 1, "status_anterior": "lancado", "status_novo": "pago" },
        { "id": 2, "status_anterior": "lancado", "status_novo": "pago" }
    ]
}
```

### 5.4 Consultar Pagamento

```
GET /api/pagamentos-concessionaria/{id}
```

**Response 200:**
```json
{
    "id": 123,
    "fatura_id": 456,
    "uc": "12345678",
    "mes_referencia": "01/2025",
    "valor_fatura": 150.50,
    "data_vencimento": "2025-01-15",
    "data_pagamento": "2025-01-15",
    "codigo_barras": "23793381286000000000300000004001843400000100",
    "status": "lancado",
    "numero_requisicao": 1234567,
    "id_pagamento_bb": "ABC123XYZ",
    "estado_requisicao": "CONSISTENTE",
    "data_lancamento": "2025-01-10T14:30:00Z",
    "cliente": {
        "id": 789,
        "nome": "João Silva"
    },
    "concessionaria": {
        "id": 1,
        "nome": "Concessionária XYZ",
        "documento": "01543032000104"
    }
}
```

---

## 6. Controllers

### 6.1 PagamentoConcessionariaController

```php
class PagamentoConcessionariaController extends Controller
{
    public function __construct(
        private BBPagamentoService $bbService,
        private PagamentoConcessionariaService $pagamentoService
    ) {}

    /**
     * Lançar pagamento na API do BB
     * 
     * Regras aplicadas: RN01-RN13
     */
    public function lancar(Request $request, int $faturaId): JsonResponse
    {
        $request->validate([
            'codigo_barras' => 'nullable|string|regex:/^\d{44,47}$/',
            'data_pagamento' => 'nullable|date|after_or_equal:today',
        ]);

        try {
            // RN01, RN02, RN05: Buscar ou criar pagamento
            $pagamento = $this->pagamentoService->obterOuCriarPagamento($faturaId, $request->all());
            
            // RN10: Obter concessionária
            $concessionaria = $pagamento->fatura->concessionaria;
            if (!$concessionaria || !$concessionaria->documento) {
                return response()->json([
                    'error' => 'Concessionária não configurada',
                    'message' => 'É necessário configurar o CNPJ da concessionária'
                ], 400);
            }

            // Executar pagamento (RN06-RN13)
            $resultado = $this->bbService->efetuarPagamento($pagamento, $concessionaria);

            if (!$resultado['sucesso']) {
                return response()->json([
                    'error' => 'Erro ao enviar pagamento',
                    'message' => $resultado['erro'],
                    'detalhes' => $resultado['dados'] ?? null
                ], 400);
            }

            $pagamento->refresh();

            return response()->json([
                'success' => true,
                'message' => 'Pagamento enviado com sucesso',
                'pagamento' => new PagamentoResource($pagamento)
            ]);

        } catch (BBPagamentoException $e) {
            return response()->json([
                'error' => $e->getMessage()
            ], 400);
        }
    }

    /**
     * Cancelar pagamento pendente no BB
     * 
     * Regras aplicadas: RN18-RN20
     */
    public function cancelar(int $id): JsonResponse
    {
        $pagamento = PagamentoConcessionaria::findOrFail($id);

        // RN18: Validar status
        if (!StatusPagamento::from($pagamento->status)->podeSercancelado()) {
            return response()->json([
                'error' => 'Pagamento não pode ser cancelado',
                'message' => "Status atual: {$pagamento->status}"
            ], 400);
        }

        try {
            $resultado = $this->bbService->cancelarPagamento($pagamento);

            if (!$resultado['sucesso']) {
                // RN20: Se já processado, marcar como pago
                if ($resultado['ja_processado'] ?? false) {
                    $pagamento->update([
                        'status' => StatusPagamento::PAGO->value,
                        'data_confirmacao' => now()
                    ]);

                    return response()->json([
                        'error' => 'Não foi possível cancelar',
                        'message' => 'Pagamento já foi processado pelo banco',
                        'ja_processado' => true
                    ], 400);
                }

                return response()->json([
                    'error' => 'Erro ao cancelar',
                    'message' => $resultado['erro']
                ], 400);
            }

            // RN15: Atualizar status
            $pagamento->update(['status' => StatusPagamento::CANCELADO->value]);

            return response()->json([
                'success' => true,
                'message' => 'Pagamento cancelado com sucesso'
            ]);

        } catch (BBPagamentoException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Sincronizar status com API do BB
     * 
     * Regras aplicadas: RN21-RN23
     */
    public function sincronizarStatus(): JsonResponse
    {
        // RN21: Apenas pagamentos lançados
        $pagamentos = PagamentoConcessionaria::where('status', StatusPagamento::LANCADO->value)
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
                        'data_confirmacao' => $novoStatus === StatusPagamento::PAGO->value ? now() : null
                    ]);

                    $sincronizados[] = [
                        'id' => $pagamento->id,
                        'status_anterior' => $statusAnterior,
                        'status_novo' => $novoStatus
                    ];
                }
            } catch (\Exception $e) {
                Log::warning("Erro ao sincronizar pagamento {$pagamento->id}: {$e->getMessage()}");
            }
        }

        return response()->json([
            'success' => true,
            'sincronizados' => count($sincronizados),
            'detalhes' => $sincronizados
        ]);
    }

    /**
     * Mapear estado do BB para status interno
     * 
     * RN22, RN23
     */
    private function mapearEstadoBB(string $estadoBB): ?string
    {
        return match ($estadoBB) {
            'PROCESSADA', 'LIQUIDADO', 'EFETIVADO' => StatusPagamento::PAGO->value,
            'REJEITADA', 'DEVOLVIDO' => StatusPagamento::ERRO->value,
            'CANCELADA' => StatusPagamento::CANCELADO->value,
            default => null
        };
    }
}
```

---

## 7. Services

### 7.1 PagamentoConcessionariaService

```php
class PagamentoConcessionariaService
{
    /**
     * Obtém pagamento existente ou cria novo
     * 
     * Regras: RN01, RN02, RN05
     */
    public function obterOuCriarPagamento(int $faturaId, array $dados = []): PagamentoConcessionaria
    {
        // RN01: Buscar fatura
        $fatura = Fatura::with('concessionaria')->findOrFail($faturaId);

        // RN02, RN05: Buscar ou criar pagamento
        $pagamento = PagamentoConcessionaria::firstOrNew([
            'uc' => $fatura->uc,
            'mes_referencia' => $fatura->mes_referencia
        ]);

        if (!$pagamento->exists) {
            $pagamento->fill([
                'fatura_id' => $fatura->id,
                'cliente_id' => $fatura->cliente_id,
                'concessionaria_id' => $fatura->concessionaria_id,
                'valor_fatura' => $fatura->valor,
                'data_vencimento' => $fatura->data_vencimento,
                'codigo_barras' => $fatura->codigo_barras,
                'status' => StatusPagamento::PENDENTE->value,
            ]);
        }

        // Atualizar com dados do request se fornecidos
        if (!empty($dados['codigo_barras'])) {
            $pagamento->codigo_barras = $dados['codigo_barras'];
        }
        if (!empty($dados['data_pagamento'])) {
            $pagamento->data_pagamento = $dados['data_pagamento'];
        } else {
            $pagamento->data_pagamento = $pagamento->data_pagamento ?? $pagamento->data_vencimento;
        }

        // RN09: Definir tipo como BOLETO
        $pagamento->tipo_pagamento = 'BOLETO';

        $pagamento->save();

        return $pagamento;
    }
}
```

---

## 8. Tratamento de Erros

### 8.1 Exceções Customizadas

```php
class BBAuthException extends Exception {}
class BBPagamentoException extends Exception {}
class BBCancelamentoException extends Exception {}
```

### 8.2 Códigos de Erro da API BB

| Código | Descrição | Ação Recomendada |
|--------|-----------|------------------|
| `INVALID_BARCODE` | Código de barras inválido | Verificar formato (44/47 dígitos) |
| `INSUFFICIENT_BALANCE` | Saldo insuficiente | Verificar saldo da conta |
| `INVALID_DATE` | Data inválida | Data deve ser >= hoje |
| `DUPLICATE_REQUEST` | Requisição duplicada | Pagamento já existe |
| `CONTRACT_NOT_FOUND` | Contrato não encontrado | Verificar configuração |
| `BENEFICIARY_NOT_FOUND` | Beneficiário não encontrado | Verificar CNPJ da concessionária |

---

## 9. Segurança

### 9.1 Certificado Digital

- Armazenar em `/etc/ssl/private/` com permissões restritas (600)
- Converter PFX para PEM: `openssl pkcs12 -in cert.pfx -out cert.pem -clcerts -nokeys`
- Extrair chave: `openssl pkcs12 -in cert.pfx -out key.pem -nocerts -nodes`
- **NUNCA** versionar certificados no Git

### 9.2 Variáveis de Ambiente

```env
BB_PAG_APP_KEY=sua_app_key
BB_PAG_CLIENT_ID=seu_client_id
BB_PAG_CLIENT_SECRET=seu_client_secret
BB_PAG_CONTRATO=123456
BB_AGENCIA=1234
BB_CONTA=12345
BB_CONTA_DIGITO=X
BB_CERTIFICADO_PATH=/etc/ssl/private/bb/cert.pfx
BB_HOMOLOGACAO=false
```

### 9.3 Logs

- **NÃO** logar tokens, senhas ou certificados
- Logar apenas IDs de pagamento e status
- Usar níveis apropriados (info, warning, error)

---

## 10. Testes

### 10.1 Testes Unitários

```php
class BBPagamentoServiceTest extends TestCase
{
    public function test_converte_linha_digitavel_47_para_44_digitos()
    {
        $service = new BBPagamentoService(new BBAuthService());
        
        $linha47 = '23793.38128 60000.000003 00000.000400 1 84340000010000';
        $esperado44 = '23791843400000100003812860000000000000000400';
        
        $resultado = $this->invokeMethod($service, 'converterLinhaDigitavel', [$linha47]);
        
        $this->assertEquals($esperado44, $resultado);
    }

    public function test_rejeita_pagamento_com_status_pago()
    {
        $pagamento = PagamentoConcessionaria::factory()->create(['status' => 'pago']);
        
        $this->expectException(BBPagamentoException::class);
        
        $service = new BBPagamentoService(new BBAuthService());
        $service->efetuarPagamento($pagamento, Concessionaria::factory()->create());
    }

    public function test_rejeita_data_passada()
    {
        $pagamento = PagamentoConcessionaria::factory()->create([
            'status' => 'pendente',
            'data_pagamento' => now()->subDay()
        ]);
        
        $this->expectException(BBPagamentoException::class);
        
        $service = new BBPagamentoService(new BBAuthService());
        $service->efetuarPagamento($pagamento, Concessionaria::factory()->create());
    }
}
```

---

## 11. Checklist de Implementação

- [ ] Criar migration `pagamentos_concessionaria`
- [ ] Criar Model `PagamentoConcessionaria` com enum `StatusPagamento`
- [ ] Criar `config/bb.php` com configurações
- [ ] Implementar `BBAuthService` (OAuth + mTLS)
- [ ] Implementar `BBPagamentoService` (lançar, cancelar, consultar)
- [ ] Implementar `PagamentoConcessionariaService`
- [ ] Criar `PagamentoConcessionariaController`
- [ ] Criar rotas da API
- [ ] Criar `PagamentoResource` para serialização
- [ ] Implementar testes unitários
- [ ] Configurar variáveis de ambiente
- [ ] Instalar certificado digital no servidor
