# Integração WhatsApp via ChatCenter - Laravel

> **Documentação Técnica Completa** - Guia de implementação e validação da integração WhatsApp usando ChatCenter API no Laravel.

---

## 📋 Índice

1. [Visão Geral](#1-visão-geral)
2. [Como Funciona o ChatCenter](#2-como-funciona-o-chatcenter)
3. [Configuração Inicial](#3-configuração-inicial)
4. [Implementação no Laravel](#4-implementação-no-laravel)
5. [Testes e Validação](#5-testes-e-validação)
6. [Troubleshooting](#6-troubleshooting)
7. [Checklist de Implementação](#7-checklist-de-implementação)

---

## 1. Visão Geral

### 1.1 O que é o ChatCenter?

O **ChatCenter** (também conhecido como **Multiweb**) é uma API de terceiros que permite enviar mensagens via WhatsApp sem precisar de uma conta WhatsApp Business API oficial. Ele funciona como um intermediário entre seu sistema e o WhatsApp.

### 1.2 Fluxo de Envio

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐     ┌──────────┐
│   Laravel    │────▶│  ChatCenter API │────▶│ WhatsApp Business│────▶│ Cliente  │
│  (Backend)   │     │  (Multiweb)     │     │   (Instância)    │     │  Final   │
└──────────────┘     └─────────────────┘     └──────────────────┘     └──────────┘
```

**Importante:** O número que aparece para o cliente é o número que você vinculou na instância do ChatCenter, **NÃO** é o número do servidor Laravel.

### 1.3 Baseado no Sistema Atual

Esta documentação é baseada na implementação atual em Node.js do repositório:

```javascript
// Implementação atual (Node.js)
const chatcenterApiUrl = 'https://api.multiweb.plus/send/chat/';
const chatcenterApiKey = process.env.CHATCENTER_API_KEY;

const payload = {
    key: chatcenterApiKey,
    numero: '5511999998888',
    texto: 'Mensagem aqui'
};

await axios.post(chatcenterApiUrl, payload);
```

---

## 2. Como Funciona o ChatCenter

### 2.1 Estrutura da API

| Componente | Descrição |
|------------|-----------|
| **URL Base** | `https://api.multiweb.plus/send/chat/` |
| **Método** | `POST` |
| **Autenticação** | Via `key` no body da requisição |
| **Formato** | JSON |

### 2.2 Payload da Requisição

```json
{
    "key": "sua_api_key_aqui",
    "numero": "5511999998888",
    "texto": "Olá! Segue sua fatura de energia..."
}
```

### 2.3 Resposta de Sucesso

```json
{
    "success": true,
    "message": "Mensagem enviada com sucesso",
    "messageId": "ABC123XYZ"
}
```

### 2.4 Resposta de Erro

```json
{
    "success": false,
    "error": "Número inválido ou instância desconectada"
}
```

---

## 3. Configuração Inicial

### 3.1 Obter Credenciais do ChatCenter

#### Passo 1: Acessar o Painel

1. Acesse: https://chatcenter.com.br ou https://multiweb.plus
2. Faça login ou crie uma conta
3. Contrate um plano (geralmente R$ 50-100/mês)

#### Passo 2: Criar Instância WhatsApp

1. No painel, clique em **"Nova Instância"**
2. Escolha um nome para sua instância (ex: `aupus-faturas`)
3. Escaneie o **QR Code** com o WhatsApp que você quer usar
4. Aguarde a conexão ser estabelecida

#### Passo 3: Obter API Key

1. Após conectar, vá em **"Configurações da Instância"**
2. Copie a **API Key** fornecida
3. Copie também a **URL da API** (geralmente `https://api.multiweb.plus/send/chat/`)

### 3.2 Configurar no Laravel

#### Arquivo `.env`

```env
# ========================================
# WHATSAPP - ChatCenter/Multiweb API
# ========================================
CHATCENTER_API_URL=https://api.multiweb.plus/send/chat/
CHATCENTER_API_KEY=sua_api_key_copiada_do_painel

# Exemplo real (substitua pela sua):
# CHATCENTER_API_KEY=684c757bdcb05b125e26b1c6
```

#### Arquivo `config/services.php`

```php
<?php

return [
    // ... outras configurações

    'chatcenter' => [
        'api_url' => env('CHATCENTER_API_URL', 'https://api.multiweb.plus/send/chat/'),
        'api_key' => env('CHATCENTER_API_KEY'),
        'timeout' => env('CHATCENTER_TIMEOUT', 30), // segundos
    ],
];
```

---

## 4. Implementação no Laravel

### 4.1 Service - WhatsAppChatCenterService

Crie o arquivo `app/Services/WhatsAppChatCenterService.php`:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WhatsAppChatCenterService
{
    protected string $apiUrl;
    protected string $apiKey;
    protected int $timeout;

    public function __construct()
    {
        $this->apiUrl = config('services.chatcenter.api_url');
        $this->apiKey = config('services.chatcenter.api_key');
        $this->timeout = config('services.chatcenter.timeout', 30);

        // Validar configuração
        if (empty($this->apiKey)) {
            throw new \Exception('CHATCENTER_API_KEY não configurada no .env');
        }
    }

    /**
     * Envia mensagem via WhatsApp usando ChatCenter API
     *
     * @param string $telefone Número do destinatário (com ou sem código do país)
     * @param string $mensagem Texto da mensagem a ser enviada
     * @return array ['sucesso' => bool, 'mensagem' => string, 'dados' => array|null]
     * @throws \Exception
     */
    public function enviarMensagem(string $telefone, string $mensagem): array
    {
        // Formatar número para padrão internacional
        $numeroFormatado = $this->formatarTelefone($telefone);

        // Montar payload exatamente como no sistema atual
        $payload = [
            'key' => $this->apiKey,
            'numero' => $numeroFormatado,
            'texto' => $mensagem,
        ];

        Log::info('📱 [ChatCenter] Enviando mensagem WhatsApp', [
            'telefone_original' => $telefone,
            'telefone_formatado' => $numeroFormatado,
            'tamanho_mensagem' => strlen($mensagem),
        ]);

        try {
            // Enviar requisição POST para ChatCenter
            $response = Http::timeout($this->timeout)
                ->post($this->apiUrl, $payload);

            // Verificar se a requisição foi bem-sucedida
            if (!$response->successful()) {
                $erro = $response->body();
                
                Log::error('❌ [ChatCenter] Erro no envio', [
                    'status' => $response->status(),
                    'erro' => $erro,
                    'telefone' => $numeroFormatado,
                ]);

                throw new \Exception("Falha ao enviar WhatsApp: {$erro}");
            }

            $dados = $response->json();

            Log::info('✅ [ChatCenter] Mensagem enviada com sucesso', [
                'telefone' => $numeroFormatado,
                'resposta' => $dados,
            ]);

            return [
                'sucesso' => true,
                'mensagem' => 'WhatsApp enviado com sucesso',
                'dados' => $dados,
            ];

        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            Log::error('❌ [ChatCenter] Erro de conexão', [
                'erro' => $e->getMessage(),
                'telefone' => $numeroFormatado,
            ]);

            throw new \Exception('Erro de conexão com ChatCenter API: ' . $e->getMessage());
        }
    }

    /**
     * Formata número de telefone para padrão internacional
     * 
     * Exemplos:
     * - "11999998888" → "5511999998888"
     * - "5511999998888" → "5511999998888" (já formatado)
     * - "(11) 99999-8888" → "5511999998888"
     */
    protected function formatarTelefone(string $telefone): string
    {
        // Remover tudo que não for número
        $numero = preg_replace('/\D/', '', $telefone);

        // Se tiver 10 ou 11 dígitos (número brasileiro sem código do país)
        if (strlen($numero) === 10 || strlen($numero) === 11) {
            $numero = '55' . $numero; // Adicionar código do Brasil
        }

        // Validar tamanho final (deve ter 12 ou 13 dígitos: 55 + DDD + número)
        if (strlen($numero) < 12 || strlen($numero) > 13) {
            throw new \Exception("Número de telefone inválido: {$telefone}");
        }

        return $numero;
    }

    /**
     * Verifica se a API está configurada corretamente
     */
    public function verificarConfiguracao(): array
    {
        return [
            'api_url' => $this->apiUrl,
            'api_key_configurada' => !empty($this->apiKey),
            'timeout' => $this->timeout,
        ];
    }
}
```

### 4.2 Service de Envio de Fatura (com Template)

Crie o arquivo `app/Services/EnvioFaturaWhatsAppService.php`:

```php
<?php

namespace App\Services;

use App\Models\FaturaAssociado;
use Carbon\Carbon;

class EnvioFaturaWhatsAppService
{
    public function __construct(
        protected WhatsAppChatCenterService $whatsappService
    ) {}

    /**
     * Envia fatura para cliente via WhatsApp
     *
     * @param string $telefone Número do cliente
     * @param FaturaAssociado $fatura Fatura a ser enviada
     * @param string|null $mensagemPersonalizada Mensagem customizada (opcional)
     * @return array
     */
    public function enviarFatura(
        string $telefone, 
        FaturaAssociado $fatura, 
        ?string $mensagemPersonalizada = null
    ): array {
        // Gerar link de download do PDF
        $linkDownload = $this->gerarLinkDownload($fatura);

        // Determinar mensagem a enviar
        if ($mensagemPersonalizada) {
            $mensagem = $this->processarMensagemPersonalizada(
                $mensagemPersonalizada, 
                $fatura, 
                $linkDownload
            );
        } else {
            $mensagem = $this->gerarMensagemPadrao($fatura, $linkDownload);
        }

        // Enviar via ChatCenter
        return $this->whatsappService->enviarMensagem($telefone, $mensagem);
    }

    /**
     * Gera mensagem padrão para envio de fatura
     * (Baseado no sistema atual Node.js)
     */
    protected function gerarMensagemPadrao(FaturaAssociado $fatura, string $linkDownload): string
    {
        $mesRef = $fatura->mes_referencia ?? '-';
        $uc = $fatura->numero_uc ?? $fatura->uc ?? '-';
        $valor = 'R$ ' . number_format($fatura->valor_fatura ?? 0, 2, ',', '.');
        $vencimento = $fatura->data_vencimento 
            ? Carbon::parse($fatura->data_vencimento)->format('d/m/Y')
            : '-';

        return "Olá! Segue sua fatura de energia referente ao mês {$mesRef}.\n\n" .
            "📄 *Baixar Fatura:*\n{$linkDownload}\n\n" .
            "UC: {$uc}\n" .
            "Valor: {$valor}\n" .
            "Vencimento: {$vencimento}\n\n" .
            "Qualquer dúvida, estamos à disposição!\n\n" .
            "*AUPUS Energia*";
    }

    /**
     * Processa mensagem personalizada substituindo variáveis
     */
    protected function processarMensagemPersonalizada(
        string $mensagem, 
        FaturaAssociado $fatura, 
        string $linkDownload
    ): string {
        $valor = 'R$ ' . number_format($fatura->valor_fatura ?? 0, 2, ',', '.');
        $vencimento = $fatura->data_vencimento 
            ? Carbon::parse($fatura->data_vencimento)->format('d/m/Y')
            : '-';
        $mesRef = $fatura->mes_referencia ?? '-';

        // Substituir variáveis
        $substituicoes = [
            '{{nome_cliente}}' => $fatura->cliente->nome ?? 'Cliente',
            '{{numero_uc}}' => $fatura->numero_uc ?? $fatura->uc ?? '-',
            '{{valor_fatura}}' => $valor,
            '{{data_vencimento}}' => $vencimento,
            '{{mes_referencia}}' => $mesRef,
            '{{nome_organizacao}}' => $fatura->organizacao->nome ?? 'AUPUS Energia',
        ];

        $mensagemProcessada = str_replace(
            array_keys($substituicoes),
            array_values($substituicoes),
            $mensagem
        );

        // Substituir placeholder [LINK]
        if (str_contains($mensagemProcessada, '[LINK]')) {
            $mensagemProcessada = str_replace('[LINK]', $linkDownload, $mensagemProcessada);
        } else {
            // Se não tiver [LINK], adicionar ao final
            $mensagemProcessada .= "\n\n📄 *Baixar Fatura:*\n{$linkDownload}";
        }

        return $mensagemProcessada;
    }

    /**
     * Gera link público para download do PDF
     */
    protected function gerarLinkDownload(FaturaAssociado $fatura): string
    {
        $baseUrl = config('app.url');
        $uc = $fatura->numero_uc ?? $fatura->uc;
        $mesRef = str_replace('/', '-', $fatura->mes_referencia ?? '');

        return "{$baseUrl}/api/faturas/download/{$uc}/{$mesRef}";
    }
}
```

### 4.3 Controller

Adicione ao `app/Http/Controllers/Admin/EnvioFaturaController.php`:

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\FaturaAssociado;
use App\Services\EnvioFaturaWhatsAppService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class EnvioFaturaController extends Controller
{
    public function __construct(
        protected EnvioFaturaWhatsAppService $whatsappService
    ) {}

    /**
     * Envia fatura para cliente via WhatsApp
     * 
     * POST /api/admin/pagamento-faturas/{faturaId}/enviar-whatsapp
     */
    public function enviarWhatsApp(Request $request, string $faturaId): JsonResponse
    {
        // Validação
        $validated = $request->validate([
            'telefone' => 'required|string',
            'mensagem_personalizada' => 'nullable|string|max:1000',
        ]);

        // Buscar fatura
        $fatura = FaturaAssociado::with(['cliente', 'organizacao'])
            ->findOrFail($faturaId);

        // Verificar permissão
        if ($fatura->organizacao_id !== auth()->user()->organizacao_id) {
            return response()->json([
                'success' => false,
                'message' => 'Sem permissão para enviar esta fatura.',
            ], 403);
        }

        try {
            // Enviar via WhatsApp
            $resultado = $this->whatsappService->enviarFatura(
                $validated['telefone'],
                $fatura,
                $validated['mensagem_personalizada'] ?? null
            );

            Log::info('📱 WhatsApp enviado com sucesso', [
                'fatura_id' => $faturaId,
                'telefone' => $validated['telefone'],
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Fatura enviada via WhatsApp com sucesso',
                'dados' => $resultado['dados'] ?? null,
            ]);

        } catch (\Exception $e) {
            Log::error('❌ Erro ao enviar WhatsApp', [
                'fatura_id' => $faturaId,
                'telefone' => $validated['telefone'],
                'erro' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Erro ao enviar WhatsApp',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
```

### 4.4 Rotas

Adicione em `routes/api.php`:

```php
<?php

use App\Http\Controllers\Admin\EnvioFaturaController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    
    // Envio de fatura via WhatsApp
    Route::post('/pagamento-faturas/{faturaId}/enviar-whatsapp', [
        EnvioFaturaController::class, 
        'enviarWhatsApp'
    ])->name('admin.faturas.enviar-whatsapp');

});
```

---

## 5. Testes e Validação

### 5.1 Teste via Tinker

```bash
php artisan tinker
```

```php
// Teste 1: Verificar configuração
$service = app(\App\Services\WhatsAppChatCenterService::class);
$service->verificarConfiguracao();

// Teste 2: Enviar mensagem simples
$service->enviarMensagem('11999998888', 'Teste de mensagem do Laravel!');

// Teste 3: Enviar fatura completa
$faturaService = app(\App\Services\EnvioFaturaWhatsAppService::class);
$fatura = \App\Models\FaturaAssociado::first();
$faturaService->enviarFatura('11999998888', $fatura);
```

### 5.2 Teste via Postman/Insomnia

**Request:**
```http
POST http://localhost/api/admin/pagamento-faturas/123/enviar-whatsapp
Authorization: Bearer {seu_token}
Content-Type: application/json

{
    "telefone": "11999998888",
    "mensagem_personalizada": "Olá {{nome_cliente}}! Sua fatura de {{mes_referencia}} está disponível. Valor: {{valor_fatura}}. [LINK]"
}
```

**Response Esperado (Sucesso):**
```json
{
    "success": true,
    "message": "Fatura enviada via WhatsApp com sucesso",
    "dados": {
        "success": true,
        "messageId": "ABC123XYZ"
    }
}
```

### 5.3 Teste via cURL

```bash
curl -X POST http://localhost/api/admin/pagamento-faturas/123/enviar-whatsapp \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telefone": "11999998888",
    "mensagem_personalizada": "Teste de envio!"
  }'
```

### 5.4 Validações Importantes

#### ✅ Checklist de Validação

- [ ] **Configuração**: `.env` tem `CHATCENTER_API_KEY` preenchida
- [ ] **Número formatado**: Telefone está sendo convertido para `55XXXXXXXXXXX`
- [ ] **Mensagem**: Texto está sendo enviado corretamente
- [ ] **Link**: URL de download está sendo gerada
- [ ] **Variáveis**: `{{nome_cliente}}`, `{{valor_fatura}}` estão sendo substituídas
- [ ] **Log**: Logs estão sendo registrados em `storage/logs/laravel.log`
- [ ] **Resposta**: API retorna JSON com `success: true`
- [ ] **WhatsApp**: Cliente recebe a mensagem no WhatsApp

---

## 6. Troubleshooting

### 6.1 Erro: "CHATCENTER_API_KEY não configurada"

**Causa:** Variável de ambiente não está definida.

**Solução:**
```bash
# 1. Adicionar no .env
echo "CHATCENTER_API_KEY=sua_chave_aqui" >> .env

# 2. Limpar cache de configuração
php artisan config:clear
php artisan config:cache
```

### 6.2 Erro: "Número de telefone inválido"

**Causa:** Formato do número está incorreto.

**Solução:** Certifique-se de enviar:
- ✅ `11999998888` (será formatado para `5511999998888`)
- ✅ `5511999998888` (já no formato correto)
- ❌ `(11) 99999-8888` (será limpo e formatado automaticamente)

### 6.3 Erro: "Falha ao enviar WhatsApp"

**Possíveis causas:**

1. **Instância desconectada no ChatCenter**
   - Acesse o painel do ChatCenter
   - Verifique se a instância está conectada (verde)
   - Se estiver desconectada, escaneie o QR Code novamente

2. **API Key inválida**
   - Verifique se copiou a chave correta do painel
   - Teste a chave manualmente via Postman

3. **Timeout de conexão**
   - Aumente o timeout em `config/services.php`:
   ```php
   'timeout' => 60, // 60 segundos
   ```

### 6.4 Mensagem não chega no WhatsApp

**Verificações:**

1. **Número correto?**
   - Verifique se o número do destinatário está correto
   - Teste enviando para seu próprio número primeiro

2. **Instância conectada?**
   - Acesse o painel do ChatCenter
   - Verifique status da conexão

3. **Número bloqueado?**
   - Alguns números podem estar bloqueados pelo WhatsApp
   - Teste com outro número

### 6.5 Como Debugar

```php
// Adicionar logs detalhados no Service
Log::debug('📱 [ChatCenter] Payload enviado', [
    'url' => $this->apiUrl,
    'payload' => $payload,
]);

Log::debug('📱 [ChatCenter] Resposta recebida', [
    'status' => $response->status(),
    'body' => $response->body(),
]);
```

---

## 7. Checklist de Implementação

### 7.1 Configuração

- [ ] Criar conta no ChatCenter/Multiweb
- [ ] Vincular número de WhatsApp Business
- [ ] Obter API Key do painel
- [ ] Adicionar `CHATCENTER_API_URL` no `.env`
- [ ] Adicionar `CHATCENTER_API_KEY` no `.env`
- [ ] Criar `config/services.php` com configurações do ChatCenter
- [ ] Executar `php artisan config:cache`

### 7.2 Código

- [ ] Criar `WhatsAppChatCenterService.php`
- [ ] Criar `EnvioFaturaWhatsAppService.php`
- [ ] Criar/atualizar `EnvioFaturaController.php`
- [ ] Adicionar rotas em `routes/api.php`
- [ ] Registrar services no `AppServiceProvider` (se necessário)

### 7.3 Testes

- [ ] Testar via Tinker: `verificarConfiguracao()`
- [ ] Testar via Tinker: `enviarMensagem()`
- [ ] Testar via Tinker: `enviarFatura()`
- [ ] Testar via Postman/Insomnia
- [ ] Testar com número real
- [ ] Verificar logs em `storage/logs/laravel.log`
- [ ] Confirmar recebimento no WhatsApp do cliente

### 7.4 Validação Final

- [ ] Mensagem chega no WhatsApp do cliente
- [ ] Link de download funciona
- [ ] Variáveis são substituídas corretamente
- [ ] Logs estão sendo registrados
- [ ] Erros são tratados adequadamente
- [ ] Resposta da API está correta

---

## 8. Exemplos Práticos

### 8.1 Exemplo Completo de Request/Response

**Request:**
```http
POST /api/admin/pagamento-faturas/01JNMEWG39CRAZN20SFK684A13/enviar-whatsapp
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
Content-Type: application/json

{
    "telefone": "11999998888",
    "mensagem_personalizada": "Olá {{nome_cliente}}! Segue sua fatura de {{mes_referencia}}. Valor: {{valor_fatura}}. Vencimento: {{data_vencimento}}. [LINK]"
}
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Fatura enviada via WhatsApp com sucesso",
    "dados": {
        "success": true,
        "message": "Mensagem enviada com sucesso",
        "messageId": "3EB0C767D71D38491C"
    }
}
```

**Mensagem Recebida pelo Cliente:**
```
Olá João Silva! Segue sua fatura de 03/2026. Valor: R$ 150,00. Vencimento: 15/03/2026.

📄 *Baixar Fatura:*
https://api-bb.aupusenergia.com.br/api/faturas/download/123456789/03-2026
```

### 8.2 Exemplo de Mensagem Padrão (sem personalização)

**Request:**
```json
{
    "telefone": "11999998888"
}
```

**Mensagem Enviada:**
```
Olá! Segue sua fatura de energia referente ao mês 03/2026.

📄 *Baixar Fatura:*
https://api-bb.aupusenergia.com.br/api/faturas/download/123456789/03-2026

UC: 123456789
Valor: R$ 150,00
Vencimento: 15/03/2026

Qualquer dúvida, estamos à disposição!

*AUPUS Energia*
```

---

## 9. Diferenças entre Node.js e Laravel

### 9.1 Comparação de Código

**Node.js (Atual):**
```javascript
const chatcenterApiUrl = 'https://api.multiweb.plus/send/chat/';
const chatcenterApiKey = process.env.CHATCENTER_API_KEY;

const payload = {
    key: chatcenterApiKey,
    numero: telefoneFormatado,
    texto: mensagem
};

const response = await axios.post(chatcenterApiUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000
});
```

**Laravel (Novo):**
```php
$payload = [
    'key' => $this->apiKey,
    'numero' => $numeroFormatado,
    'texto' => $mensagem,
];

$response = Http::timeout(30)->post($this->apiUrl, $payload);
```

### 9.2 Compatibilidade

✅ **100% compatível** - A implementação Laravel usa exatamente o mesmo:
- URL da API
- Estrutura do payload
- Método HTTP (POST)
- Formato de autenticação (key no body)

---

## 10. Informações Adicionais

### 10.1 Limites da API

| Limite | Valor |
|--------|-------|
| Mensagens/minuto | ~60 (depende do plano) |
| Tamanho da mensagem | ~4096 caracteres |
| Timeout recomendado | 30 segundos |

### 10.2 Boas Práticas

1. **Sempre logar envios** para auditoria
2. **Validar número** antes de enviar
3. **Tratar erros** adequadamente
4. **Usar filas** para envios em massa (Laravel Queue)
5. **Monitorar status** da instância no painel ChatCenter

### 10.3 Custos Aproximados

- **ChatCenter/Multiweb**: R$ 50-100/mês (plano básico)
- **Z-API**: R$ 40-80/mês
- **Evolution API**: Gratuito (self-hosted, custos de servidor)

---

## 11. Suporte e Documentação Oficial

- **ChatCenter**: https://chatcenter.com.br/documentacao
- **Multiweb**: https://multiweb.plus/docs
- **Laravel HTTP Client**: https://laravel.com/docs/http-client

---

## 12. Conclusão

Esta documentação fornece tudo que você precisa para:

✅ Configurar o ChatCenter  
✅ Implementar no Laravel  
✅ Testar a integração  
✅ Validar se está funcionando corretamente  
✅ Resolver problemas comuns  

**Próximos passos:**
1. Configure o ChatCenter e obtenha a API Key
2. Implemente os Services no Laravel
3. Teste com seu próprio número
4. Valide com um cliente real
5. Monitore os logs

Se tiver dúvidas, verifique a seção de [Troubleshooting](#6-troubleshooting).
