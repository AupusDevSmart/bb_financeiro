# Integração Banco do Brasil - API Pagamentos em Lote - Laravel

> **Documentação Técnica Completa** - Guia de implementação da integração com a API de Pagamentos em Lote do Banco do Brasil para Laravel.

---

## 📋 Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura da Integração](#2-arquitetura-da-integração)
3. [Configuração Inicial](#3-configuração-inicial)
4. [Certificado Digital (mTLS)](#4-certificado-digital-mtls)
5. [Autenticação OAuth2](#5-autenticação-oauth2)
6. [Implementação no Laravel](#6-implementação-no-laravel)
7. [Endpoints da API BB](#7-endpoints-da-api-bb)
8. [Modelo de Dados](#8-modelo-de-dados)
9. [Regras de Negócio](#9-regras-de-negócio)
10. [Testes e Validação](#10-testes-e-validação)
11. [Troubleshooting](#11-troubleshooting)
12. [Checklist de Implementação](#12-checklist-de-implementação)

---

## 1. Visão Geral

### 1.1 O que é a API de Pagamentos em Lote?

A **API de Pagamentos em Lote do Banco do Brasil** permite realizar pagamentos de boletos bancários de forma automatizada, debitando diretamente da conta corrente da empresa. É usada para pagar faturas de concessionárias (energia, água, etc.).

### 1.2 Fluxo de Pagamento

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│   Laravel   │────▶│   API BB     │────▶│   Banco     │────▶│  Pagamento   │
│  (Backend)  │     │  Pagamentos  │     │  Processa   │     │  Efetuado    │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
       │                                                            │
       │                    ┌────────────────┐                      │
       └───────────────────▶│  Sincronizar   │◀─────────────────────┘
                            │    Status      │
                            └────────────────┘
```

### 1.3 Ciclo de Vida do Pagamento

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ PENDENTE │────▶│ LANÇADO  │────▶│   PAGO   │     │CANCELADO │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                                  ▲
     │                │                                  │
     │                └──────────────────────────────────┘
     │                         (cancelar antes do débito)
     │
     └───────────────▶ ERRO/REJEITADO
```

### 1.4 Baseado no Sistema Atual

Esta documentação é baseada na implementação atual em Node.js:
- `server/pagamentosLoteBB.js` - Módulo de integração com API BB
- `server/server.js` - Endpoints de pagamento

---

## 2. Arquitetura da Integração

### 2.1 Componentes

| Componente | Descrição |
|------------|-----------|
| **BBAuthService** | Autenticação OAuth2 com mTLS |
| **BBPagamentoService** | Operações de pagamento (lançar, cancelar, consultar) |
| **PagamentoConcessionariaService** | Lógica de negócio dos pagamentos |
| **PagamentoConcessionariaController** | Endpoints da API |

### 2.2 Fluxo de Autenticação

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Laravel    │────▶│  OAuth BB       │────▶│   API BB     │
│  (Backend)   │     │  (com mTLS)     │     │  Pagamentos  │
└──────────────┘     └─────────────────┘     └──────────────┘
       │                     │
       │   Certificado A1    │
       │   (cert.pem +       │
       │    key.pem)         │
       └─────────────────────┘
```

---

## 3. Configuração Inicial

### 3.1 Variáveis de Ambiente (.env)

```env
# ========================================
# BANCO DO BRASIL - API PAGAMENTOS EM LOTE
# ========================================

# Credenciais da API (obtidas no Portal BB Developers)
BB_PAG_APP_KEY=sua_app_key_aqui
BB_PAG_CLIENT_ID=seu_client_id_aqui
BB_PAG_CLIENT_SECRET=seu_client_secret_aqui

# Dados da Conta Corrente (para débito)
BB_AGENCIA=4148
BB_CONTA=25651
BB_CONTA_DIGITO=X

# Contrato de Pagamento (obtido no Portal BB)
BB_PAG_CONTRATO=123456

# Certificado Digital A1 (caminho no servidor)
BB_PAG_CERTIFICADO_PATH=/etc/ssl/private/aupus-bb/certificado.pfx

# Ambiente (true = homologação, false = produção)
BB_HOMOLOGACAO=false
```

### 3.2 Arquivo de Configuração (config/bb.php)

```php
<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Credenciais da API de Pagamentos em Lote
    |--------------------------------------------------------------------------
    */
    'pagamentos' => [
        'app_key' => env('BB_PAG_APP_KEY'),
        'client_id' => env('BB_PAG_CLIENT_ID'),
        'client_secret' => env('BB_PAG_CLIENT_SECRET'),
        'contrato' => env('BB_PAG_CONTRATO'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Dados da Conta Corrente
    |--------------------------------------------------------------------------
    */
    'conta' => [
        'agencia' => env('BB_AGENCIA'),
        'conta' => env('BB_CONTA'),
        'digito' => env('BB_CONTA_DIGITO'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Certificado Digital
    |--------------------------------------------------------------------------
    */
    'certificado' => [
        'path' => env('BB_PAG_CERTIFICADO_PATH'),
        // Arquivos PEM extraídos do PFX (não precisam de senha)
        'cert_pem' => env('BB_PAG_CERTIFICADO_PATH') 
            ? dirname(env('BB_PAG_CERTIFICADO_PATH')) . '/cert.pem' 
            : null,
        'key_pem' => env('BB_PAG_CERTIFICADO_PATH') 
            ? dirname(env('BB_PAG_CERTIFICADO_PATH')) . '/key.pem' 
            : null,
    ],

    /*
    |--------------------------------------------------------------------------
    | URLs da API
    |--------------------------------------------------------------------------
    */
    'urls' => [
        'api' => env('BB_HOMOLOGACAO', false) 
            ? 'https://api.hm.bb.com.br/pagamentos-lote/v1'
            : 'https://api-ip.bb.com.br/pagamentos-lote/v1',
        'oauth' => env('BB_HOMOLOGACAO', false)
            ? 'https://oauth.hm.bb.com.br/oauth/token'
            : 'https://oauth.bb.com.br/oauth/token',
    ],

    /*
    |--------------------------------------------------------------------------
    | Configurações Gerais
    |--------------------------------------------------------------------------
    */
    'homologacao' => env('BB_HOMOLOGACAO', false),
    'timeout' => 30, // segundos

    /*
    |--------------------------------------------------------------------------
    | CNPJ das Concessionárias (beneficiários)
    |--------------------------------------------------------------------------
    */
    'concessionarias' => [
        'EQTL_GO' => '01543032000104', // Equatorial Energia Goiás
        'CEMIG' => '06981180000116',   // CEMIG
        'CPFL' => '04172213000151',    // CPFL Paulista
    ],
];
```

---

## 4. Certificado Digital (mTLS)

### 4.1 O que é mTLS?

A API de Pagamentos do BB usa **mTLS (Mutual TLS)**, que exige autenticação mútua:
- O servidor BB verifica o certificado do cliente (sua empresa)
- O cliente verifica o certificado do servidor BB

### 4.2 Preparar Certificado A1

O certificado A1 vem em formato `.pfx` (PKCS#12). Você precisa extrair os arquivos PEM:

```bash
# 1. Criar diretório seguro
sudo mkdir -p /etc/ssl/private/aupus-bb
sudo chmod 700 /etc/ssl/private/aupus-bb

# 2. Copiar certificado PFX
sudo cp certificado.pfx /etc/ssl/private/aupus-bb/

# 3. Extrair certificado (cert.pem)
openssl pkcs12 -in /etc/ssl/private/aupus-bb/certificado.pfx \
    -out /etc/ssl/private/aupus-bb/cert.pem \
    -clcerts -nokeys

# 4. Extrair chave privada (key.pem)
openssl pkcs12 -in /etc/ssl/private/aupus-bb/certificado.pfx \
    -out /etc/ssl/private/aupus-bb/key.pem \
    -nocerts -nodes

# 5. Ajustar permissões
sudo chmod 600 /etc/ssl/private/aupus-bb/*.pem
sudo chown www-data:www-data /etc/ssl/private/aupus-bb/*.pem
```

### 4.3 Verificar Certificado

```bash
# Verificar se o certificado está válido
openssl x509 -in /etc/ssl/private/aupus-bb/cert.pem -text -noout

# Verificar se a chave corresponde ao certificado
openssl x509 -noout -modulus -in /etc/ssl/private/aupus-bb/cert.pem | openssl md5
openssl rsa -noout -modulus -in /etc/ssl/private/aupus-bb/key.pem | openssl md5
# Os dois MD5 devem ser iguais
```

---

## 5. Autenticação OAuth2

### 5.1 Fluxo Client Credentials

```
┌──────────────┐                    ┌──────────────┐
│   Laravel    │                    │   OAuth BB   │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │  POST /oauth/token                │
       │  + Basic Auth (client_id:secret)  │
       │  + Certificado mTLS               │
       │  + grant_type=client_credentials  │
       │  + scope=pagamentos-lote.*        │
       │──────────────────────────────────▶│
       │                                   │
       │  { access_token, expires_in }     │
       │◀──────────────────────────────────│
       │                                   │
```

### 5.2 Scopes Necessários

| Scope | Descrição |
|-------|-----------|
| `pagamentos-lote.boletos-requisicao` | Criar/enviar pagamentos |
| `pagamentos-lote.boletos-info` | Consultar status |
| `pagamentos-lote.cancelar-requisicao` | Cancelar pagamentos |

---

## 6. Implementação no Laravel

### 6.1 Service de Autenticação - BBAuthService

Crie `app/Services/BB/BBAuthService.php`:

```php
<?php

namespace App\Services\BB;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class BBAuthService
{
    protected string $clientId;
    protected string $clientSecret;
    protected string $oauthUrl;
    protected string $certPath;
    protected string $keyPath;

    public function __construct()
    {
        $this->clientId = config('bb.pagamentos.client_id');
        $this->clientSecret = config('bb.pagamentos.client_secret');
        $this->oauthUrl = config('bb.urls.oauth');
        $this->certPath = config('bb.certificado.cert_pem');
        $this->keyPath = config('bb.certificado.key_pem');

        $this->validarConfiguracao();
    }

    /**
     * Obtém token de acesso OAuth2
     * Usa cache para evitar requisições desnecessárias
     */
    public function getToken(): string
    {
        // Verificar cache
        $cacheKey = 'bb_pagamentos_token';
        
        if (Cache::has($cacheKey)) {
            Log::debug('🔐 [BB Auth] Usando token em cache');
            return Cache::get($cacheKey);
        }

        Log::info('🔐 [BB Auth] Obtendo novo token OAuth...');

        // Montar Basic Auth
        $basicAuth = base64_encode("{$this->clientId}:{$this->clientSecret}");

        // Scopes necessários para pagamentos
        $scope = 'pagamentos-lote.boletos-requisicao pagamentos-lote.boletos-info pagamentos-lote.cancelar-requisicao';

        try {
            $response = Http::withOptions($this->getCurlOptions())
                ->withHeaders([
                    'Authorization' => "Basic {$basicAuth}",
                    'Content-Type' => 'application/x-www-form-urlencoded',
                ])
                ->asForm()
                ->post($this->oauthUrl, [
                    'grant_type' => 'client_credentials',
                    'scope' => $scope,
                ]);

            if (!$response->successful()) {
                $erro = $response->json('error_description') ?? $response->body();
                Log::error('❌ [BB Auth] Falha na autenticação', [
                    'status' => $response->status(),
                    'erro' => $erro,
                ]);
                throw new \Exception("Falha na autenticação OAuth BB: {$erro}");
            }

            $data = $response->json();
            $token = $data['access_token'];
            $expiresIn = $data['expires_in'] ?? 3600;

            // Armazenar em cache (com margem de 60 segundos)
            Cache::put($cacheKey, $token, now()->addSeconds($expiresIn - 60));

            Log::info('✅ [BB Auth] Token obtido com sucesso', [
                'expires_in' => $expiresIn,
            ]);

            return $token;

        } catch (\Exception $e) {
            Log::error('❌ [BB Auth] Exceção na autenticação', [
                'erro' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Invalida o token em cache (forçar renovação)
     */
    public function invalidarToken(): void
    {
        Cache::forget('bb_pagamentos_token');
        Log::info('🔐 [BB Auth] Token invalidado');
    }

    /**
     * Retorna opções CURL para mTLS
     */
    public function getCurlOptions(): array
    {
        return [
            'curl' => [
                CURLOPT_SSLCERT => $this->certPath,
                CURLOPT_SSLKEY => $this->keyPath,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ],
        ];
    }

    /**
     * Valida se as configurações estão corretas
     */
    protected function validarConfiguracao(): void
    {
        if (empty($this->clientId) || empty($this->clientSecret)) {
            throw new \Exception('BB_PAG_CLIENT_ID e BB_PAG_CLIENT_SECRET são obrigatórios');
        }

        if (!file_exists($this->certPath)) {
            throw new \Exception("Certificado não encontrado: {$this->certPath}");
        }

        if (!file_exists($this->keyPath)) {
            throw new \Exception("Chave privada não encontrada: {$this->keyPath}");
        }
    }
}
```

### 6.2 Service de Pagamento - BBPagamentoService

Crie `app/Services/BB/BBPagamentoService.php`:

```php
<?php

namespace App\Services\BB;

use App\Models\PagamentoConcessionaria;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class BBPagamentoService
{
    protected BBAuthService $authService;
    protected string $apiUrl;
    protected string $appKey;
    protected int $agencia;
    protected int $conta;
    protected string $digitoConta;
    protected int $contrato;

    public function __construct(BBAuthService $authService)
    {
        $this->authService = $authService;
        $this->apiUrl = config('bb.urls.api');
        $this->appKey = config('bb.pagamentos.app_key');
        $this->agencia = (int) config('bb.conta.agencia');
        $this->conta = (int) config('bb.conta.conta');
        $this->digitoConta = config('bb.conta.digito');
        $this->contrato = (int) config('bb.pagamentos.contrato');
    }

    /**
     * Efetua pagamento de boleto via API BB
     *
     * @param PagamentoConcessionaria $pagamento
     * @param string $documentoBeneficiario CNPJ da concessionária
     * @return array ['sucesso' => bool, 'dados' => array, 'erro' => string|null]
     */
    public function efetuarPagamento(
        PagamentoConcessionaria $pagamento, 
        string $documentoBeneficiario
    ): array {
        Log::info('💰 [BB Pagamento] Iniciando pagamento', [
            'pagamento_id' => $pagamento->id,
            'uc' => $pagamento->uc,
            'valor' => $pagamento->valor_fatura,
        ]);

        // Validações
        $this->validarPagamento($pagamento);

        // Converter linha digitável para código de barras
        $codigoBarras = $this->linhaDigitavelParaCodigoBarras($pagamento->codigo_barras);

        // Determinar tipo de documento do beneficiário
        $docLimpo = preg_replace('/\D/', '', $documentoBeneficiario);
        $tipoDoc = strlen($docLimpo) === 11 ? 1 : 2; // 1=CPF, 2=CNPJ

        // Obter token
        $token = $this->authService->getToken();

        // Montar payload
        $payload = [
            'numeroRequisicao' => $this->gerarNumeroRequisicao(),
            'codigoContrato' => $this->contrato,
            'numeroAgenciaDebito' => $this->agencia,
            'numeroContaCorrenteDebito' => $this->conta,
            'digitoVerificadorContaCorrenteDebito' => $this->digitoConta,
            'lancamentos' => [[
                'numeroCodigoBarras' => $codigoBarras,
                'dataPagamento' => $this->formatarData($pagamento->data_pagamento),
                'valorPagamento' => (float) $pagamento->valor_fatura,
                'descricaoPagamento' => substr("UC {$pagamento->uc} - {$pagamento->mes_referencia}", 0, 40),
                'valorNominal' => (float) $pagamento->valor_fatura,
                'codigoTipoBeneficiario' => $tipoDoc,
                'documentoBeneficiario' => (int) $docLimpo,
            ]],
        ];

        Log::debug('💰 [BB Pagamento] Payload', ['payload' => $payload]);

        // Fazer requisição
        $url = "{$this->apiUrl}/lotes-boletos?gw-dev-app-key={$this->appKey}";

        try {
            $response = Http::withOptions($this->authService->getCurlOptions())
                ->withToken($token)
                ->timeout(config('bb.timeout', 30))
                ->post($url, $payload);

            $dados = $response->json();

            Log::debug('💰 [BB Pagamento] Resposta', [
                'status' => $response->status(),
                'dados' => $dados,
            ]);

            if (!$response->successful()) {
                $erro = $dados['erros'][0]['mensagem'] ?? $response->body();
                Log::error('❌ [BB Pagamento] Erro na API', [
                    'erro' => $erro,
                    'pagamento_id' => $pagamento->id,
                ]);

                return [
                    'sucesso' => false,
                    'erro' => $erro,
                    'dados' => $dados,
                ];
            }

            // Verificar se o lançamento foi aceito
            $lancamento = $dados['lancamentos'][0] ?? [];
            $indicadorAceite = $lancamento['indicadorAceite'] ?? 'N';
            $errosLancamento = $lancamento['erros'] ?? [];

            if ($indicadorAceite !== 'S' && !empty($errosLancamento)) {
                $erro = implode(', ', $errosLancamento);
                Log::error('❌ [BB Pagamento] Lançamento rejeitado', [
                    'erro' => $erro,
                    'pagamento_id' => $pagamento->id,
                ]);

                return [
                    'sucesso' => false,
                    'erro' => $erro,
                    'dados' => $dados,
                    'rejeitado' => true,
                ];
            }

            Log::info('✅ [BB Pagamento] Pagamento enviado com sucesso', [
                'pagamento_id' => $pagamento->id,
                'numero_requisicao' => $dados['numeroRequisicao'] ?? null,
            ]);

            return [
                'sucesso' => true,
                'dados' => $dados,
                'erro' => null,
            ];

        } catch (\Exception $e) {
            Log::error('❌ [BB Pagamento] Exceção', [
                'erro' => $e->getMessage(),
                'pagamento_id' => $pagamento->id,
            ]);

            return [
                'sucesso' => false,
                'erro' => $e->getMessage(),
                'dados' => null,
            ];
        }
    }

    /**
     * Cancela um pagamento pendente
     *
     * @param string $codigoPagamento ID do pagamento no BB (id_pagamento_bb)
     * @return array
     */
    public function cancelarPagamento(string $codigoPagamento): array
    {
        Log::info('🚫 [BB Pagamento] Cancelando pagamento', [
            'codigo_pagamento' => $codigoPagamento,
        ]);

        $token = $this->authService->getToken();

        $payload = [
            'agenciaDebito' => $this->agencia,
            'contaCorrenteDebito' => $this->conta,
            'digitoVerificadorContaCorrente' => $this->digitoConta,
            'numeroContratoPagamento' => $this->contrato,
            'listaPagamentos' => [
                ['codigoPagamento' => $codigoPagamento],
            ],
        ];

        $url = "{$this->apiUrl}/cancelar-pagamentos?gw-dev-app-key={$this->appKey}";

        try {
            $response = Http::withOptions($this->authService->getCurlOptions())
                ->withToken($token)
                ->timeout(config('bb.timeout', 30))
                ->post($url, $payload);

            $dados = $response->json();

            // Verificar se foi cancelado
            $pagamentoCancelado = $dados['pagamentos'][0] ?? [];
            $indicadorCancelamento = $pagamentoCancelado['indicadorCancelamento'] ?? 'N';

            if ($indicadorCancelamento === 'S') {
                Log::info('✅ [BB Pagamento] Cancelamento bem-sucedido', [
                    'codigo_pagamento' => $codigoPagamento,
                ]);

                return [
                    'sucesso' => true,
                    'dados' => $dados,
                    'erro' => null,
                ];
            }

            // Verificar se já foi processado
            $estadoBB = $pagamentoCancelado['estadoPagamento'] ?? '';
            $jaProcessado = in_array($estadoBB, ['BLOQUEADO', 'PROCESSADO', 'LIQUIDADO']);

            $erro = $pagamentoCancelado['mensagemRetorno'] 
                ?? $pagamentoCancelado['estadoCancelamento'] 
                ?? 'Pagamento não foi cancelado';

            Log::warning('⚠️ [BB Pagamento] Cancelamento não efetuado', [
                'codigo_pagamento' => $codigoPagamento,
                'estado' => $estadoBB,
                'erro' => $erro,
            ]);

            return [
                'sucesso' => false,
                'erro' => $erro,
                'dados' => $dados,
                'ja_processado' => $jaProcessado,
                'estado_bb' => $estadoBB,
            ];

        } catch (\Exception $e) {
            Log::error('❌ [BB Pagamento] Erro ao cancelar', [
                'erro' => $e->getMessage(),
                'codigo_pagamento' => $codigoPagamento,
            ]);

            return [
                'sucesso' => false,
                'erro' => $e->getMessage(),
                'dados' => null,
            ];
        }
    }

    /**
     * Consulta status de um lote de pagamentos
     *
     * @param int $idLote ID do lote retornado na criação
     * @return array
     */
    public function consultarLote(int $idLote): array
    {
        Log::info('🔍 [BB Pagamento] Consultando lote', ['id_lote' => $idLote]);

        $token = $this->authService->getToken();

        $url = "{$this->apiUrl}/lotes-boletos/{$idLote}/solicitacao?gw-dev-app-key={$this->appKey}";
        $url .= "&numeroAgenciaDebito={$this->agencia}";
        $url .= "&numeroContaCorrenteDebito={$this->conta}";
        $url .= "&digitoVerificadorContaCorrenteDebito={$this->digitoConta}";

        try {
            $response = Http::withOptions($this->authService->getCurlOptions())
                ->withToken($token)
                ->timeout(config('bb.timeout', 30))
                ->get($url);

            $dados = $response->json();

            return [
                'sucesso' => $response->successful(),
                'dados' => $dados,
                'erro' => $response->successful() ? null : ($dados['erros'][0]['mensagem'] ?? 'Erro desconhecido'),
            ];

        } catch (\Exception $e) {
            return [
                'sucesso' => false,
                'erro' => $e->getMessage(),
                'dados' => null,
            ];
        }
    }

    /**
     * Consulta um pagamento específico
     *
     * @param string $idPagamento ID do pagamento no BB
     * @return array
     */
    public function consultarPagamento(string $idPagamento): array
    {
        Log::info('🔍 [BB Pagamento] Consultando pagamento', ['id_pagamento' => $idPagamento]);

        $token = $this->authService->getToken();

        $url = "{$this->apiUrl}/boletos/{$idPagamento}?gw-dev-app-key={$this->appKey}";

        try {
            $response = Http::withOptions($this->authService->getCurlOptions())
                ->withToken($token)
                ->timeout(config('bb.timeout', 30))
                ->get($url);

            $dados = $response->json();

            return [
                'sucesso' => $response->successful(),
                'dados' => $dados,
                'erro' => $response->successful() ? null : ($dados['erros'][0]['mensagem'] ?? 'Erro desconhecido'),
            ];

        } catch (\Exception $e) {
            return [
                'sucesso' => false,
                'erro' => $e->getMessage(),
                'dados' => null,
            ];
        }
    }

    // ========================================
    // MÉTODOS AUXILIARES
    // ========================================

    /**
     * Valida dados do pagamento antes de enviar
     */
    protected function validarPagamento(PagamentoConcessionaria $pagamento): void
    {
        if (empty($pagamento->codigo_barras)) {
            throw new \Exception('Código de barras é obrigatório');
        }

        if (!$pagamento->valor_fatura || $pagamento->valor_fatura <= 0) {
            throw new \Exception('Valor do pagamento deve ser maior que zero');
        }

        // Validar se data não é passada
        if ($pagamento->data_pagamento) {
            $dataPag = Carbon::parse($pagamento->data_pagamento)->startOfDay();
            $hoje = Carbon::today();

            if ($dataPag->lt($hoje)) {
                throw new \Exception("Data de pagamento já passou: {$pagamento->data_pagamento}");
            }
        }

        // Validar status
        if (!in_array($pagamento->status, ['pendente', 'erro'])) {
            throw new \Exception("Pagamento com status '{$pagamento->status}' não pode ser lançado");
        }
    }

    /**
     * Converte linha digitável (47 dígitos) para código de barras (44 dígitos)
     */
    public function linhaDigitavelParaCodigoBarras(string $linhaDigitavel): string
    {
        // Remover caracteres não numéricos
        $linha = preg_replace('/\D/', '', $linhaDigitavel);

        // Se já tem 44 dígitos, é código de barras
        if (strlen($linha) === 44) {
            return $linha;
        }

        // Se tem 47 dígitos, é linha digitável de boleto bancário
        if (strlen($linha) === 47) {
            $banco = substr($linha, 0, 3);
            $moeda = substr($linha, 3, 1);
            $dvGeral = substr($linha, 32, 1);
            $fatorVenc = substr($linha, 33, 4);
            $valor = substr($linha, 37, 10);

            // Campo livre (25 dígitos)
            $campoLivre = substr($linha, 4, 5) 
                . substr($linha, 10, 10) 
                . substr($linha, 21, 10);

            return $banco . $moeda . $dvGeral . $fatorVenc . $valor . $campoLivre;
        }

        // Se tem 48 dígitos, é código de barras de concessionária
        if (strlen($linha) === 48) {
            $campo1 = substr($linha, 0, 11);
            $campo2 = substr($linha, 12, 11);
            $campo3 = substr($linha, 24, 11);
            $campo4 = substr($linha, 36, 11);

            return $campo1 . $campo2 . $campo3 . $campo4;
        }

        throw new \Exception("Formato de código de barras inválido. Esperado 44, 47 ou 48 dígitos, recebido " . strlen($linha));
    }

    /**
     * Formata data para o formato da API BB (DDMMAAAA como inteiro)
     */
    protected function formatarData(?string $data): int
    {
        $d = $data ? Carbon::parse($data) : Carbon::today();
        return (int) $d->format('dmY');
    }

    /**
     * Gera número único de requisição (7 dígitos)
     */
    protected function gerarNumeroRequisicao(): int
    {
        // Últimos 6 dígitos do timestamp + 1 aleatório
        $timestamp = (string) now()->timestamp;
        return (int) (substr($timestamp, -6) . rand(0, 9));
    }
}
```

### 6.3 Controller - PagamentoConcessionariaController

Crie `app/Http/Controllers/Admin/PagamentoConcessionariaController.php`:

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\PagamentoConcessionaria;
use App\Models\FaturaAssociado;
use App\Services\BB\BBPagamentoService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class PagamentoConcessionariaController extends Controller
{
    public function __construct(
        protected BBPagamentoService $bbService
    ) {}

    /**
     * Lançar pagamento na API do BB
     * 
     * POST /api/admin/pagamentos-concessionaria/{faturaId}/lancar
     */
    public function lancar(Request $request, string $faturaId): JsonResponse
    {
        $request->validate([
            'codigo_barras' => 'nullable|string',
            'data_pagamento' => 'nullable|date|after_or_equal:today',
        ]);

        try {
            // 1. Buscar fatura
            $fatura = FaturaAssociado::findOrFail($faturaId);

            // 2. Buscar ou criar pagamento
            $pagamento = PagamentoConcessionaria::firstOrNew([
                'uc' => $fatura->numero_uc ?? $fatura->uc,
                'mes_referencia' => $fatura->mes_referencia,
            ]);

            if (!$pagamento->exists) {
                $pagamento->fill([
                    'fatura_id' => $fatura->id,
                    'valor_fatura' => $fatura->valor_fatura,
                    'data_vencimento_fatura' => $fatura->data_vencimento,
                    'codigo_barras' => $request->codigo_barras ?? $fatura->codigo_barras,
                    'status' => 'pendente',
                ]);
                $pagamento->save();
            }

            // 3. Atualizar dados se fornecidos
            if ($request->codigo_barras) {
                $pagamento->codigo_barras = $request->codigo_barras;
            }
            if ($request->data_pagamento) {
                $pagamento->data_pagamento = $request->data_pagamento;
            } else {
                $pagamento->data_pagamento = $pagamento->data_pagamento 
                    ?? $pagamento->data_vencimento_fatura 
                    ?? now()->format('Y-m-d');
            }
            $pagamento->save();

            // 4. Validar se tem código de barras
            if (empty($pagamento->codigo_barras)) {
                return response()->json([
                    'error' => 'Código de barras é obrigatório',
                    'message' => 'Informe o código de barras para lançar o pagamento',
                ], 400);
            }

            // 5. Validar status
            if (!in_array($pagamento->status, ['pendente', 'erro'])) {
                return response()->json([
                    'error' => 'Pagamento não pode ser lançado',
                    'message' => "Status atual: {$pagamento->status}",
                ], 400);
            }

            // 6. Obter CNPJ da concessionária
            $cnpjConcessionaria = config('bb.concessionarias.EQTL_GO', '01543032000104');

            // 7. Chamar API do BB
            $resultado = $this->bbService->efetuarPagamento($pagamento, $cnpjConcessionaria);

            if (!$resultado['sucesso']) {
                // Atualizar status para erro
                $pagamento->update([
                    'status' => $resultado['rejeitado'] ?? false ? 'rejeitado' : 'erro',
                    'mensagem_erro' => $resultado['erro'],
                ]);

                return response()->json([
                    'error' => 'Erro ao enviar pagamento',
                    'message' => $resultado['erro'],
                    'detalhes' => $resultado['dados'],
                ], 400);
            }

            // 8. Atualizar pagamento com dados do BB
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

            Log::info('✅ Pagamento lançado com sucesso', [
                'pagamento_id' => $pagamento->id,
                'numero_requisicao' => $dadosBB['numeroRequisicao'] ?? null,
            ]);

            return response()->json([
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
            ]);

        } catch (\Exception $e) {
            Log::error('❌ Erro ao lançar pagamento', [
                'fatura_id' => $faturaId,
                'erro' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Cancelar pagamento pendente
     * 
     * POST /api/admin/pagamentos-concessionaria/{id}/cancelar
     */
    public function cancelar(int $id): JsonResponse
    {
        $pagamento = PagamentoConcessionaria::findOrFail($id);

        // Validar status
        if ($pagamento->status !== 'lancado') {
            return response()->json([
                'error' => 'Pagamento não pode ser cancelado',
                'message' => "Apenas pagamentos com status 'lancado' podem ser cancelados. Status atual: {$pagamento->status}",
            ], 400);
        }

        // Validar se tem ID do BB
        if (empty($pagamento->id_pagamento_bb)) {
            return response()->json([
                'error' => 'ID do pagamento no BB não encontrado',
            ], 400);
        }

        try {
            $resultado = $this->bbService->cancelarPagamento($pagamento->id_pagamento_bb);

            if (!$resultado['sucesso']) {
                // Se já foi processado, marcar como pago
                if ($resultado['ja_processado'] ?? false) {
                    $pagamento->update([
                        'status' => 'pago',
                        'data_confirmacao' => now(),
                    ]);

                    return response()->json([
                        'error' => 'Não foi possível cancelar',
                        'message' => 'Pagamento já foi processado pelo banco',
                        'ja_processado' => true,
                    ], 400);
                }

                return response()->json([
                    'error' => 'Erro ao cancelar',
                    'message' => $resultado['erro'],
                ], 400);
            }

            // Atualizar status
            $pagamento->update(['status' => 'cancelado']);

            return response()->json([
                'success' => true,
                'message' => 'Pagamento cancelado com sucesso',
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Sincronizar status dos pagamentos com o BB
     * 
     * POST /api/admin/pagamentos-concessionaria/sincronizar-status
     */
    public function sincronizarStatus(): JsonResponse
    {
        // Buscar pagamentos lançados
        $pagamentos = PagamentoConcessionaria::where('status', 'lancado')
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
                Log::warning("Erro ao sincronizar pagamento {$pagamento->id}: {$e->getMessage()}");
            }
        }

        return response()->json([
            'success' => true,
            'sincronizados' => count($sincronizados),
            'detalhes' => $sincronizados,
        ]);
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
            default => null,
        };
    }
}
```

### 6.4 Rotas

Adicione em `routes/api.php`:

```php
<?php

use App\Http\Controllers\Admin\PagamentoConcessionariaController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    
    // Pagamentos de Concessionária
    Route::prefix('pagamentos-concessionaria')->group(function () {
        
        // Lançar pagamento na API do BB
        Route::post('/{faturaId}/lancar', [
            PagamentoConcessionariaController::class, 
            'lancar'
        ])->name('admin.pagamentos.lancar');

        // Cancelar pagamento
        Route::post('/{id}/cancelar', [
            PagamentoConcessionariaController::class, 
            'cancelar'
        ])->name('admin.pagamentos.cancelar');

        // Sincronizar status com BB
        Route::post('/sincronizar-status', [
            PagamentoConcessionariaController::class, 
            'sincronizarStatus'
        ])->name('admin.pagamentos.sincronizar');

    });

});
```

---

## 7. Endpoints da API BB

### 7.1 Resumo dos Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/lotes-boletos` | Criar lote de pagamentos |
| GET | `/lotes-boletos/{id}/solicitacao` | Consultar lote |
| GET | `/boletos/{id}` | Consultar pagamento específico |
| POST | `/cancelar-pagamentos` | Cancelar pagamentos |
| POST | `/liberar-pagamentos` | Liberar pagamentos (se necessário) |

### 7.2 Payload de Criação de Pagamento

```json
{
    "numeroRequisicao": 1234567,
    "codigoContrato": 123456,
    "numeroAgenciaDebito": 4148,
    "numeroContaCorrenteDebito": 25651,
    "digitoVerificadorContaCorrenteDebito": "X",
    "lancamentos": [{
        "numeroCodigoBarras": "23793381286000000000300000004001843400000100",
        "dataPagamento": 15032026,
        "valorPagamento": 150.50,
        "descricaoPagamento": "UC 12345678 - 03/2026",
        "valorNominal": 150.50,
        "codigoTipoBeneficiario": 2,
        "documentoBeneficiario": 1543032000104
    }]
}
```

### 7.3 Resposta de Sucesso

```json
{
    "numeroRequisicao": 1234567,
    "estadoRequisicao": "CONSISTENTE",
    "quantidadeLancamentosValidos": 1,
    "quantidadeLancamentosInvalidos": 0,
    "lancamentos": [{
        "codigoIdentificadorPagamento": "ABC123XYZ",
        "indicadorAceite": "S",
        "erros": []
    }]
}
```

---

## 8. Modelo de Dados

### 8.1 Migration - pagamentos_concessionaria

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
            $table->string('fatura_id')->nullable();
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
            $table->string('codigo_barras', 50)->nullable();
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
            
            // Auditoria
            $table->timestamps();
            
            // Constraints
            $table->unique(['uc', 'mes_referencia']);
            $table->index('status');
            $table->index('mes_referencia');
            $table->index('fatura_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pagamentos_concessionaria');
    }
};
```

### 8.2 Model - PagamentoConcessionaria

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
    ];

    protected $casts = [
        'valor_fatura' => 'decimal:2',
        'valor_pago' => 'decimal:2',
        'data_vencimento_fatura' => 'date',
        'data_pagamento' => 'date',
        'data_lancamento' => 'datetime',
        'data_confirmacao' => 'datetime',
        'resposta_api_bb' => 'array',
    ];

    // Relacionamentos
    public function cliente(): BelongsTo
    {
        return $this->belongsTo(Cliente::class);
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

    // Helpers
    public function podeSerLancado(): bool
    {
        return in_array($this->status, ['pendente', 'erro']);
    }

    public function podeSercancelado(): bool
    {
        return $this->status === 'lancado';
    }

    public function ehFinal(): bool
    {
        return in_array($this->status, ['pago', 'cancelado']);
    }
}
```

---

## 9. Regras de Negócio

### 9.1 Regras de Lançamento

| ID | Regra | Validação |
|----|-------|-----------|
| RN01 | Código de barras é obrigatório | Not null |
| RN02 | Valor deve ser maior que zero | `valor > 0` |
| RN03 | Data de pagamento não pode ser passada | `data >= hoje` |
| RN04 | Status deve ser `pendente` ou `erro` | Status check |
| RN05 | Código de barras deve ter 44, 47 ou 48 dígitos | Regex |
| RN06 | Documento do beneficiário é obrigatório | Not null |

### 9.2 Regras de Status

| Transição | Condição |
|-----------|----------|
| `pendente` → `lancado` | API BB aceita |
| `pendente` → `erro` | API BB rejeita |
| `lancado` → `pago` | BB confirma débito |
| `lancado` → `cancelado` | Cancelamento aceito |
| `lancado` → `pago` | Tentativa de cancelar já processado |

### 9.3 Mapeamento de Estados BB

| Estado BB | Status Interno |
|-----------|----------------|
| `PROCESSADA` | `pago` |
| `LIQUIDADO` | `pago` |
| `EFETIVADO` | `pago` |
| `REJEITADA` | `erro` |
| `DEVOLVIDO` | `erro` |
| `CANCELADA` | `cancelado` |

---

## 10. Testes e Validação

### 10.1 Teste via Tinker

```bash
php artisan tinker
```

```php
// Teste 1: Verificar configuração
config('bb.pagamentos');
config('bb.urls');

// Teste 2: Testar autenticação
$auth = app(\App\Services\BB\BBAuthService::class);
$token = $auth->getToken();
echo "Token: " . substr($token, 0, 50) . "...";

// Teste 3: Testar conversão de código de barras
$service = app(\App\Services\BB\BBPagamentoService::class);
$codigo = $service->linhaDigitavelParaCodigoBarras('23793.38128 60000.000003 00000.000400 1 84340000010000');
echo "Código: {$codigo}";
```

### 10.2 Teste via Postman

**Request - Lançar Pagamento:**
```http
POST /api/admin/pagamentos-concessionaria/123/lancar
Authorization: Bearer {token}
Content-Type: application/json

{
    "codigo_barras": "23793381286000000000300000004001843400000100",
    "data_pagamento": "2026-03-15"
}
```

**Response Esperado:**
```json
{
    "success": true,
    "message": "Pagamento enviado para o Banco do Brasil com sucesso",
    "pagamento": {
        "id": 1,
        "uc": "12345678",
        "valor": 150.50,
        "tipo": "BOLETO",
        "data_pagamento": "2026-03-15",
        "numero_requisicao": 1234567,
        "id_pagamento_bb": "ABC123XYZ",
        "estado_requisicao": "CONSISTENTE",
        "status": "lancado"
    }
}
```

### 10.3 Validações Importantes

- [ ] Certificado PEM está acessível pelo PHP
- [ ] Token OAuth é obtido com sucesso
- [ ] Código de barras é convertido corretamente
- [ ] Pagamento é aceito pela API BB
- [ ] Status é atualizado no banco de dados
- [ ] Logs são registrados corretamente

---

## 11. Troubleshooting

### 11.1 Erro: "Certificado não encontrado"

```bash
# Verificar se os arquivos existem
ls -la /etc/ssl/private/aupus-bb/

# Verificar permissões
sudo chown www-data:www-data /etc/ssl/private/aupus-bb/*.pem
sudo chmod 600 /etc/ssl/private/aupus-bb/*.pem
```

### 11.2 Erro: "Falha na autenticação OAuth"

1. Verificar `BB_PAG_CLIENT_ID` e `BB_PAG_CLIENT_SECRET`
2. Verificar se o certificado corresponde às credenciais
3. Testar em ambiente de homologação primeiro

### 11.3 Erro: "Código de barras inválido"

1. Verificar se tem 44, 47 ou 48 dígitos
2. Remover caracteres especiais (pontos, espaços)
3. Usar a função `linhaDigitavelParaCodigoBarras()`

### 11.4 Erro: "Data de pagamento já passou"

1. Verificar se a data está no formato correto (`Y-m-d`)
2. Garantir que a data é >= hoje
3. Considerar timezone do servidor

---

## 12. Checklist de Implementação

### Configuração
- [ ] Obter credenciais no Portal BB Developers
- [ ] Obter certificado A1 digital
- [ ] Extrair cert.pem e key.pem do PFX
- [ ] Configurar permissões dos arquivos
- [ ] Adicionar variáveis no `.env`
- [ ] Criar `config/bb.php`

### Código
- [ ] Criar `BBAuthService`
- [ ] Criar `BBPagamentoService`
- [ ] Criar `PagamentoConcessionariaController`
- [ ] Criar migration `pagamentos_concessionaria`
- [ ] Criar model `PagamentoConcessionaria`
- [ ] Adicionar rotas em `routes/api.php`

### Testes
- [ ] Testar autenticação OAuth
- [ ] Testar conversão de código de barras
- [ ] Testar lançamento em homologação
- [ ] Testar cancelamento
- [ ] Testar sincronização de status
- [ ] Testar em produção com valor baixo

### Produção
- [ ] Configurar ambiente de produção
- [ ] Instalar certificado no servidor
- [ ] Configurar variáveis de ambiente
- [ ] Monitorar logs
- [ ] Configurar job de sincronização (opcional)

---

## 13. Referências

- **Portal BB Developers**: https://developers.bb.com.br/
- **Documentação API Pagamentos**: https://developers.bb.com.br/docs/pagamentos-lote
- **Laravel HTTP Client**: https://laravel.com/docs/http-client
- **mTLS com PHP/cURL**: https://curl.se/docs/sslcerts.html
