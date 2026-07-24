# Integração de Envio de Mensagens - WhatsApp e Email

> **Documentação para Backend Laravel** - Especificação completa para implementação do sistema de envio de faturas via WhatsApp e Email.

---

## 1. Visão Geral

Este documento descreve a implementação do sistema de envio de faturas para clientes via **WhatsApp** (usando ChatCenter/Multiweb API) e **Email** (usando SMTP/Laravel Mail). A documentação é baseada no sistema atual em Node.js e na especificação do frontend React.

### 1.1 Fluxo de Envio

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│   Frontend  │───▶│   Backend    │───▶│  WhatsApp   │───▶│   Cliente    │
│   Solicita  │    │   Processa   │    │   ou Email  │    │   Recebe     │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
```

### 1.2 Canais Suportados

| Canal | Provedor | Tipo de Envio |
|-------|----------|---------------|
| **WhatsApp** | ChatCenter/Multiweb API | Mensagem de texto + Link para PDF |
| **Email** | SMTP (Hostinger/Gmail) | Email HTML + PDF em anexo |

---

## 2. Configuração de Ambiente

### 2.1 Variáveis de Ambiente (.env)

```env
# ========================================
# WHATSAPP - ChatCenter/Multiweb API
# ========================================
CHATCENTER_API_URL=https://api.multiweb.plus/send/chat/
CHATCENTER_API_KEY=sua_api_key_aqui

# ========================================
# EMAIL - SMTP
# ========================================
MAIL_MAILER=smtp
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_USERNAME=financeiro@aupusenergia.com.br
MAIL_PASSWORD=sua_senha_smtp
MAIL_ENCRYPTION=ssl
MAIL_FROM_ADDRESS=financeiro@aupusenergia.com.br
MAIL_FROM_NAME="AUPUS Energia"

# ========================================
# STORAGE - Caminho dos PDFs
# ========================================
DADOS_PATH=/var/www/aupus-microservicos-faturas/dados
APP_URL=https://api-bb.aupusenergia.com.br
```

### 2.2 Arquivo de Configuração (config/services.php)

```php
<?php

return [
    // ... outras configurações

    'chatcenter' => [
        'api_url' => env('CHATCENTER_API_URL', 'https://api.multiweb.plus/send/chat/'),
        'api_key' => env('CHATCENTER_API_KEY'),
    ],

    'faturas' => [
        'dados_path' => env('DADOS_PATH', '/var/www/aupus-microservicos-faturas/dados'),
    ],
];
```

---

## 3. Sistema de Templates com Variáveis

### 3.1 Variáveis Disponíveis

O sistema suporta variáveis de template que são substituídas pelos valores reais antes do envio:

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `{{nome_cliente}}` | Nome do cliente | João Silva |
| `{{numero_uc}}` | Número da UC | 123456789 |
| `{{valor_fatura}}` | Valor formatado | R$ 150,00 |
| `{{data_vencimento}}` | Data de vencimento | 15/03/2026 |
| `{{mes_referencia}}` | Mês de referência | 03/2026 |
| `{{nome_organizacao}}` | Nome da organização | AUPUS Energia |
| `[LINK]` | Link para download do PDF | https://api.../download/... |

### 3.2 Trait de Substituição de Variáveis

```php
<?php

namespace App\Traits;

use App\Models\FaturaAssociado;
use Carbon\Carbon;

trait SubstituiVariaveisMensagem
{
    /**
     * Substitui variáveis de template pelos valores reais da fatura
     */
    protected function substituirVariaveis(string $mensagem, FaturaAssociado $fatura, ?string $linkDownload = null): string
    {
        $valor = 'R$ ' . number_format($fatura->valor_fatura ?? 0, 2, ',', '.');
        
        $vencimento = $fatura->data_vencimento 
            ? Carbon::parse($fatura->data_vencimento)->format('d/m/Y')
            : '-';
        
        $mesRef = $fatura->mes_referencia 
            ? (str_contains($fatura->mes_referencia, '/') 
                ? $fatura->mes_referencia 
                : Carbon::parse($fatura->mes_referencia)->format('m/Y'))
            : '-';

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

        // Substituir placeholder de link
        if ($linkDownload) {
            if (str_contains($mensagemProcessada, '[LINK]')) {
                $mensagemProcessada = str_replace('[LINK]', $linkDownload, $mensagemProcessada);
            }
        }

        return $mensagemProcessada;
    }

    /**
     * Gera mensagem padrão para WhatsApp
     */
    protected function gerarMensagemPadraoWhatsApp(FaturaAssociado $fatura, string $linkDownload): string
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
     * Gera mensagem padrão para Email
     */
    protected function gerarMensagemPadraoEmail(FaturaAssociado $fatura): string
    {
        $nomeCliente = $fatura->cliente->nome ?? 'Cliente';
        $mesRef = $fatura->mes_referencia ?? '-';
        $uc = $fatura->numero_uc ?? $fatura->uc ?? '-';
        $valor = 'R$ ' . number_format($fatura->valor_fatura ?? 0, 2, ',', '.');
        $vencimento = $fatura->data_vencimento 
            ? Carbon::parse($fatura->data_vencimento)->format('d/m/Y')
            : '-';

        return "Prezado(a) {$nomeCliente},\n\n" .
            "Segue em anexo sua fatura de energia referente ao mês {$mesRef}.\n\n" .
            "UC: {$uc}\n" .
            "Valor: {$valor}\n" .
            "Vencimento: {$vencimento}\n\n" .
            "Qualquer dúvida, estamos à disposição.\n\n" .
            "Atenciosamente,\n" .
            "AUPUS Energia\n" .
            "financeiro@aupusenergia.com.br";
    }
}
```

---

## 4. Serviço de WhatsApp

### 4.1 WhatsAppService

```php
<?php

namespace App\Services;

use App\Models\FaturaAssociado;
use App\Traits\SubstituiVariaveisMensagem;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WhatsAppService
{
    use SubstituiVariaveisMensagem;

    protected string $apiUrl;
    protected string $apiKey;

    public function __construct()
    {
        $this->apiUrl = config('services.chatcenter.api_url');
        $this->apiKey = config('services.chatcenter.api_key');
    }

    /**
     * Envia fatura para cliente via WhatsApp
     *
     * @param string $telefone Número do telefone (com ou sem código do país)
     * @param FaturaAssociado $fatura Fatura a ser enviada
     * @param string|null $mensagemPersonalizada Mensagem customizada (opcional)
     * @return array ['sucesso' => bool, 'mensagem' => string, 'resposta' => array|null]
     * @throws \Exception
     */
    public function enviarFatura(string $telefone, FaturaAssociado $fatura, ?string $mensagemPersonalizada = null): array
    {
        // Validar configuração
        if (empty($this->apiKey)) {
            throw new \Exception('API Key do ChatCenter não configurada');
        }

        // Formatar número de telefone
        $numeroFormatado = $this->formatarTelefone($telefone);

        // Gerar link de download do PDF
        $linkDownload = $this->gerarLinkDownload($fatura);

        // Determinar mensagem a enviar
        if ($mensagemPersonalizada) {
            $mensagem = $this->substituirVariaveis($mensagemPersonalizada, $fatura, $linkDownload);
            
            // Se não tiver placeholder [LINK], adicionar ao final
            if (!str_contains($mensagemPersonalizada, '[LINK]') && $linkDownload) {
                $mensagem .= "\n\n📄 *Baixar Fatura:*\n{$linkDownload}";
            }
        } else {
            $mensagem = $this->gerarMensagemPadraoWhatsApp($fatura, $linkDownload);
        }

        // Enviar via API ChatCenter
        $payload = [
            'key' => $this->apiKey,
            'numero' => $numeroFormatado,
            'texto' => $mensagem,
        ];

        Log::info('📱 [WhatsApp] Enviando mensagem', [
            'fatura_id' => $fatura->id,
            'uc' => $fatura->numero_uc ?? $fatura->uc,
            'telefone' => $numeroFormatado,
        ]);

        $response = Http::timeout(30)
            ->post($this->apiUrl, $payload);

        if (!$response->successful()) {
            $erro = $response->body();
            Log::error('❌ [WhatsApp] Falha no envio', [
                'fatura_id' => $fatura->id,
                'telefone' => $numeroFormatado,
                'erro' => $erro,
            ]);
            throw new \Exception("Falha ao enviar WhatsApp: {$erro}");
        }

        Log::info('✅ [WhatsApp] Mensagem enviada com sucesso', [
            'fatura_id' => $fatura->id,
            'telefone' => $numeroFormatado,
        ]);

        return [
            'sucesso' => true,
            'mensagem' => 'WhatsApp enviado com sucesso',
            'resposta' => $response->json(),
        ];
    }

    /**
     * Formata número de telefone para padrão internacional
     * Remove caracteres não numéricos e adiciona código do país (55) se necessário
     */
    protected function formatarTelefone(string $telefone): string
    {
        // Remover tudo que não for número
        $numero = preg_replace('/\D/', '', $telefone);

        // Se tiver 10 ou 11 dígitos, adicionar código do país
        if (strlen($numero) === 10 || strlen($numero) === 11) {
            $numero = '55' . $numero;
        }

        return $numero;
    }

    /**
     * Gera link público para download do PDF da fatura
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

---

## 5. Serviço de Email

### 5.1 EmailService

```php
<?php

namespace App\Services;

use App\Models\FaturaAssociado;
use App\Mail\FaturaClienteMail;
use App\Traits\SubstituiVariaveisMensagem;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;

class EmailService
{
    use SubstituiVariaveisMensagem;

    /**
     * Envia fatura para cliente via Email
     *
     * @param string|array $emails Email(s) do destinatário
     * @param FaturaAssociado $fatura Fatura a ser enviada
     * @param string|null $mensagemPersonalizada Mensagem customizada (opcional)
     * @param string|null $assuntoPersonalizado Assunto customizado (opcional)
     * @return array ['sucesso' => bool, 'mensagem' => string, 'message_id' => string|null]
     * @throws \Exception
     */
    public function enviarFatura(
        string|array $emails, 
        FaturaAssociado $fatura, 
        ?string $mensagemPersonalizada = null,
        ?string $assuntoPersonalizado = null
    ): array {
        // Normalizar emails para array
        $listaEmails = is_array($emails) ? $emails : [$emails];

        // Validar emails
        foreach ($listaEmails as $email) {
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new \Exception("Email inválido: {$email}");
            }
        }

        // Determinar mensagem
        $mensagem = $mensagemPersonalizada 
            ? $this->substituirVariaveis($mensagemPersonalizada, $fatura)
            : $this->gerarMensagemPadraoEmail($fatura);

        // Determinar assunto
        $uc = $fatura->numero_uc ?? $fatura->uc ?? '-';
        $mesRef = $fatura->mes_referencia ?? '-';
        $assunto = $assuntoPersonalizado ?? "Fatura de Energia - UC {$uc} - {$mesRef}";

        // Buscar caminho do PDF
        $caminhoPdf = $this->buscarCaminhoPdf($fatura);

        Log::info('📧 [Email] Enviando fatura', [
            'fatura_id' => $fatura->id,
            'uc' => $uc,
            'emails' => $listaEmails,
        ]);

        try {
            Mail::to($listaEmails)->send(new FaturaClienteMail(
                fatura: $fatura,
                mensagem: $mensagem,
                assunto: $assunto,
                caminhoPdf: $caminhoPdf
            ));

            Log::info('✅ [Email] Enviado com sucesso', [
                'fatura_id' => $fatura->id,
                'emails' => $listaEmails,
            ]);

            return [
                'sucesso' => true,
                'mensagem' => 'Email enviado com sucesso',
                'message_id' => null, // Laravel Mail não retorna message_id diretamente
            ];
        } catch (\Exception $e) {
            Log::error('❌ [Email] Falha no envio', [
                'fatura_id' => $fatura->id,
                'emails' => $listaEmails,
                'erro' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Busca o caminho do arquivo PDF da fatura
     */
    protected function buscarCaminhoPdf(FaturaAssociado $fatura): ?string
    {
        // Verificar se tem link direto do PDF
        if (!empty($fatura->boleto_pdf_link)) {
            return $fatura->boleto_pdf_link;
        }

        // Verificar se tem caminho de storage
        if (!empty($fatura->caminho_storage)) {
            $dadosPath = config('services.faturas.dados_path');
            $caminho = str_replace('/app/dados', $dadosPath, $fatura->caminho_storage);
            
            if (file_exists($caminho)) {
                return $caminho;
            }
        }

        return null;
    }
}
```

### 5.2 Mailable - FaturaClienteMail

```php
<?php

namespace App\Mail;

use App\Models\FaturaAssociado;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Queue\SerializesModels;

class FaturaClienteMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public FaturaAssociado $fatura,
        public string $mensagem,
        public string $assunto,
        public ?string $caminhoPdf = null
    ) {}

    /**
     * Get the message envelope.
     */
    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->assunto,
        );
    }

    /**
     * Get the message content definition.
     */
    public function content(): Content
    {
        return new Content(
            view: 'emails.fatura-cliente',
            with: [
                'fatura' => $this->fatura,
                'mensagem' => $this->mensagem,
            ],
        );
    }

    /**
     * Get the attachments for the message.
     *
     * @return array<int, \Illuminate\Mail\Mailables\Attachment>
     */
    public function attachments(): array
    {
        $attachments = [];

        if ($this->caminhoPdf && file_exists($this->caminhoPdf)) {
            $uc = $this->fatura->numero_uc ?? $this->fatura->uc ?? 'fatura';
            $mesRef = str_replace('/', '-', $this->fatura->mes_referencia ?? '');
            
            $attachments[] = Attachment::fromPath($this->caminhoPdf)
                ->as("Fatura_{$uc}_{$mesRef}.pdf")
                ->withMime('application/pdf');
        }

        return $attachments;
    }
}
```

### 5.3 Template de Email (resources/views/emails/fatura-cliente.blade.php)

```blade
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fatura de Energia</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #f59e0b; padding-bottom: 20px;">
            <h2 style="color: #f59e0b; margin: 0;">⚡ AUPUS Energia</h2>
        </div>

        <!-- Mensagem -->
        <div style="margin-bottom: 30px; line-height: 1.6;">
            {!! nl2br(e($mensagem)) !!}
        </div>

        <!-- Dados da Fatura -->
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <h3 style="margin-top: 0; color: #374151;">📄 Dados da Fatura</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>UC:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">{{ $fatura->numero_uc ?? $fatura->uc ?? '-' }}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Referência:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">{{ $fatura->mes_referencia ?? '-' }}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Vencimento:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                        {{ $fatura->data_vencimento ? \Carbon\Carbon::parse($fatura->data_vencimento)->format('d/m/Y') : '-' }}
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;"><strong>Valor:</strong></td>
                    <td style="padding: 8px 0; color: #059669; font-weight: bold; font-size: 1.1em;">
                        R$ {{ number_format($fatura->valor_fatura ?? 0, 2, ',', '.') }}
                    </td>
                </tr>
            </table>
        </div>

        <!-- Aviso sobre anexo -->
        @if($fatura->boleto_pdf_link || $fatura->caminho_storage)
        <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 20px;">
            <strong>📎 A fatura está em anexo neste email.</strong>
        </div>
        @endif

        <!-- Footer -->
        <div style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>Este é um email automático. Em caso de dúvidas, entre em contato.</p>
            <p><strong>AUPUS Energia</strong><br>financeiro@aupusenergia.com.br</p>
        </div>
    </div>
</body>
</html>
```

---

## 6. Controller de Envio

### 6.1 EnvioFaturaController

```php
<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\FaturaAssociado;
use App\Services\WhatsAppService;
use App\Services\EmailService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class EnvioFaturaController extends Controller
{
    public function __construct(
        protected WhatsAppService $whatsappService,
        protected EmailService $emailService
    ) {}

    /**
     * Envia fatura para cliente via WhatsApp e/ou Email
     * 
     * POST /api/admin/pagamento-faturas/{faturaId}/enviar-cliente
     */
    public function enviarCliente(Request $request, string $faturaId): JsonResponse
    {
        // Validação
        $validated = $request->validate([
            'canal' => 'required|in:WHATSAPP,EMAIL,AMBOS',
            'whatsapp' => 'required_if:canal,WHATSAPP,AMBOS|nullable|string|regex:/^\d{10,11}$/',
            'emails' => 'required_if:canal,EMAIL,AMBOS|nullable|array|max:3',
            'emails.*' => 'email',
            'mensagem_personalizada' => 'nullable|string|max:500',
        ]);

        // Buscar fatura com relacionamentos
        $fatura = FaturaAssociado::with(['cliente', 'organizacao'])
            ->findOrFail($faturaId);

        // Verificar permissão (fatura deve ser da organização do usuário)
        if ($fatura->organizacao_id !== auth()->user()->organizacao_id) {
            return response()->json([
                'success' => false,
                'message' => 'Sem permissão para enviar esta fatura.',
            ], 403);
        }

        // Determinar mensagem a usar
        $mensagem = $validated['mensagem_personalizada'] 
            ?? $fatura->organizacao->mensagem_envio_fatura 
            ?? null; // null = usar mensagem padrão do serviço

        $envios = [];

        // Enviar via WhatsApp
        if (in_array($validated['canal'], ['WHATSAPP', 'AMBOS']) && !empty($validated['whatsapp'])) {
            try {
                $resultado = $this->whatsappService->enviarFatura(
                    $validated['whatsapp'],
                    $fatura,
                    $mensagem
                );

                $envios[] = [
                    'canal' => 'WHATSAPP',
                    'destino' => $validated['whatsapp'],
                    'status' => 'ENVIADO',
                ];

                Log::info('📱 WhatsApp enviado', [
                    'fatura_id' => $faturaId,
                    'destino' => $validated['whatsapp'],
                ]);
            } catch (\Exception $e) {
                $envios[] = [
                    'canal' => 'WHATSAPP',
                    'destino' => $validated['whatsapp'],
                    'status' => 'ERRO',
                    'erro' => $e->getMessage(),
                ];

                Log::error('❌ Erro WhatsApp', [
                    'fatura_id' => $faturaId,
                    'erro' => $e->getMessage(),
                ]);
            }
        }

        // Enviar via Email
        if (in_array($validated['canal'], ['EMAIL', 'AMBOS']) && !empty($validated['emails'])) {
            foreach ($validated['emails'] as $email) {
                try {
                    $this->emailService->enviarFatura(
                        $email,
                        $fatura,
                        $mensagem
                    );

                    $envios[] = [
                        'canal' => 'EMAIL',
                        'destino' => $email,
                        'status' => 'ENVIADO',
                    ];

                    Log::info('📧 Email enviado', [
                        'fatura_id' => $faturaId,
                        'destino' => $email,
                    ]);
                } catch (\Exception $e) {
                    $envios[] = [
                        'canal' => 'EMAIL',
                        'destino' => $email,
                        'status' => 'ERRO',
                        'erro' => $e->getMessage(),
                    ];

                    Log::error('❌ Erro Email', [
                        'fatura_id' => $faturaId,
                        'destino' => $email,
                        'erro' => $e->getMessage(),
                    ]);
                }
            }
        }

        // Determinar resultado
        $todosEnviados = collect($envios)->every(fn($e) => $e['status'] === 'ENVIADO');
        $algumEnviado = collect($envios)->contains(fn($e) => $e['status'] === 'ENVIADO');

        return response()->json([
            'success' => $algumEnviado,
            'message' => $todosEnviados 
                ? 'Fatura enviada com sucesso.' 
                : ($algumEnviado ? 'Fatura enviada parcialmente.' : 'Falha ao enviar fatura.'),
            'envios' => $envios,
        ]);
    }
}
```

---

## 7. Configuração da Organização

### 7.1 Migration - Adicionar campo mensagem_envio_fatura

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizacoes', function (Blueprint $table) {
            $table->text('mensagem_envio_fatura')
                ->nullable()
                ->after('senha_edicao_fatura')
                ->comment('Mensagem padrão para envio de faturas via WhatsApp/Email');
        });
    }

    public function down(): void
    {
        Schema::table('organizacoes', function (Blueprint $table) {
            $table->dropColumn('mensagem_envio_fatura');
        });
    }
};
```

### 7.2 Model Organizacao - Atualizar $fillable

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Organizacao extends Model
{
    protected $table = 'organizacoes';

    protected $fillable = [
        // ... outros campos
        'dia_calculo',
        'senha_edicao_fatura',
        'mensagem_envio_fatura', // NOVO CAMPO
    ];

    // ... resto do model
}
```

### 7.3 Controller de Configurações

```php
<?php

namespace App\Http\Controllers\SPA;

use App\Http\Controllers\Controller;
use App\Models\Organizacao;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ConfiguracoesController extends Controller
{
    /**
     * GET /api/SPA/configuracoes/organizacao
     */
    public function show(): JsonResponse
    {
        $organizacao = auth()->user()->organizacao;

        return response()->json([
            'success' => true,
            'data' => [
                'dia_calculo' => $organizacao->dia_calculo,
                'tem_senha_edicao_fatura' => !empty($organizacao->senha_edicao_fatura),
                'mensagem_envio_fatura' => $organizacao->mensagem_envio_fatura,
                'updated_at' => $organizacao->updated_at,
                'updated_by' => $organizacao->updated_by,
            ],
        ]);
    }

    /**
     * PUT /api/SPA/configuracoes/organizacao
     */
    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'dia_calculo' => 'nullable|integer|min:1|max:31',
            'senha_edicao_fatura' => 'nullable|string|min:4',
            'mensagem_envio_fatura' => 'nullable|string|max:500',
        ]);

        $organizacao = auth()->user()->organizacao;

        // Atualizar apenas campos fornecidos
        if (isset($validated['dia_calculo'])) {
            $organizacao->dia_calculo = $validated['dia_calculo'];
        }

        if (isset($validated['senha_edicao_fatura'])) {
            $organizacao->senha_edicao_fatura = bcrypt($validated['senha_edicao_fatura']);
        }

        if (array_key_exists('mensagem_envio_fatura', $validated)) {
            $organizacao->mensagem_envio_fatura = $validated['mensagem_envio_fatura'];
        }

        $organizacao->updated_by = auth()->user()->name;
        $organizacao->save();

        return response()->json([
            'success' => true,
            'message' => 'Configurações atualizadas com sucesso.',
        ]);
    }
}
```

---

## 8. Resource de Fatura com Dados de Contato

### 8.1 FaturaResource

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FaturaResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'numero_uc' => $this->numero_uc ?? $this->uc,
            'mes_referencia' => $this->mes_referencia,
            'valor_fatura' => $this->valor_fatura,
            'data_vencimento' => $this->data_vencimento,
            'status' => $this->status,
            
            // Dados de contato do cliente para envio
            'cliente' => [
                'id' => $this->cliente?->id,
                'nome' => $this->cliente?->nome,
                'email' => $this->cliente?->email,
                'email_secundario' => $this->cliente?->email_secundario 
                    ?? $this->cliente?->telefone_secundario_email,
                'telefone' => $this->cliente?->telefone,
                'telefone_secundario' => $this->cliente?->telefone_secundario,
            ],

            // ... outros campos
        ];
    }
}
```

---

## 9. Rotas

### 9.1 routes/api.php

```php
<?php

use App\Http\Controllers\Admin\EnvioFaturaController;
use App\Http\Controllers\SPA\ConfiguracoesController;
use Illuminate\Support\Facades\Route;

// Rotas autenticadas - Admin
Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    
    // Envio de fatura para cliente
    Route::post('/pagamento-faturas/{faturaId}/enviar-cliente', [
        EnvioFaturaController::class, 
        'enviarCliente'
    ])->name('admin.faturas.enviar-cliente');

});

// Rotas autenticadas - SPA
Route::middleware(['auth:sanctum'])->prefix('SPA')->group(function () {
    
    // Configurações da organização
    Route::get('/configuracoes/organizacao', [ConfiguracoesController::class, 'show']);
    Route::put('/configuracoes/organizacao', [ConfiguracoesController::class, 'update']);

});

// Rota pública para download de fatura (sem autenticação)
Route::get('/faturas/download/{uc}/{mesReferencia}', [
    \App\Http\Controllers\FaturaDownloadController::class, 
    'download'
])->name('faturas.download');
```

---

## 10. Registro de Envios (Auditoria)

### 10.1 Migration - Tabela controle_envios

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('controle_envios', function (Blueprint $table) {
            $table->id();
            $table->string('fatura_id')->nullable();
            $table->string('uc', 20)->nullable();
            $table->string('mes_referencia', 10)->nullable();
            $table->enum('tipo_envio', ['whatsapp', 'email']);
            $table->string('destinatario');
            $table->enum('status', ['enviado', 'erro', 'pendente'])->default('pendente');
            $table->text('mensagem')->nullable();
            $table->json('resposta_api')->nullable();
            $table->string('erro')->nullable();
            $table->string('enviado_por')->nullable();
            $table->foreignId('organizacao_id')->nullable()->constrained('organizacoes');
            $table->timestamps();

            $table->index(['uc', 'mes_referencia']);
            $table->index(['tipo_envio', 'status']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('controle_envios');
    }
};
```

### 10.2 Model ControleEnvio

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ControleEnvio extends Model
{
    protected $table = 'controle_envios';

    protected $fillable = [
        'fatura_id',
        'uc',
        'mes_referencia',
        'tipo_envio',
        'destinatario',
        'status',
        'mensagem',
        'resposta_api',
        'erro',
        'enviado_por',
        'organizacao_id',
    ];

    protected $casts = [
        'resposta_api' => 'array',
    ];

    public function organizacao()
    {
        return $this->belongsTo(Organizacao::class);
    }
}
```

### 10.3 Registrar Envio nos Services

Adicionar ao final dos métodos `enviarFatura` em ambos os services:

```php
// No WhatsAppService e EmailService, após envio bem-sucedido:
ControleEnvio::create([
    'fatura_id' => $fatura->id,
    'uc' => $fatura->numero_uc ?? $fatura->uc,
    'mes_referencia' => $fatura->mes_referencia,
    'tipo_envio' => 'whatsapp', // ou 'email'
    'destinatario' => $numeroFormatado, // ou $email
    'status' => 'enviado',
    'mensagem' => $mensagem,
    'resposta_api' => $response->json(),
    'enviado_por' => auth()->user()?->name ?? 'sistema',
    'organizacao_id' => $fatura->organizacao_id,
]);
```

---

## 11. Checklist de Implementação

### Configuração
- [ ] Adicionar variáveis de ambiente (CHATCENTER_API_KEY, SMTP)
- [ ] Criar `config/services.php` com configurações do ChatCenter

### Migrations
- [ ] Criar migration para `mensagem_envio_fatura` em `organizacoes`
- [ ] Criar migration para tabela `controle_envios`

### Models
- [ ] Atualizar `Organizacao` com `mensagem_envio_fatura` no `$fillable`
- [ ] Criar model `ControleEnvio`

### Traits
- [ ] Criar `SubstituiVariaveisMensagem` trait

### Services
- [ ] Criar `WhatsAppService`
- [ ] Criar `EmailService`

### Mail
- [ ] Criar `FaturaClienteMail` Mailable
- [ ] Criar view `emails/fatura-cliente.blade.php`

### Controllers
- [ ] Criar `EnvioFaturaController` com método `enviarCliente`
- [ ] Atualizar `ConfiguracoesController` para GET/PUT `mensagem_envio_fatura`

### Resources
- [ ] Atualizar `FaturaResource` para incluir dados de contato do cliente

### Rotas
- [ ] Adicionar rota `POST /admin/pagamento-faturas/{id}/enviar-cliente`
- [ ] Adicionar rotas de configurações

---

## 12. Exemplos de Request/Response

### 12.1 Enviar Fatura

**Request:**
```http
POST /api/admin/pagamento-faturas/01JNMEWG39CRAZN20SFK684A13/enviar-cliente
Authorization: Bearer {token}
Content-Type: application/json

{
    "canal": "AMBOS",
    "whatsapp": "11999998888",
    "emails": ["cliente@email.com", "financeiro@empresa.com"],
    "mensagem_personalizada": "Olá {{nome_cliente}}! Segue sua fatura da UC {{numero_uc}} no valor de {{valor_fatura}}."
}
```

**Response (Sucesso):**
```json
{
    "success": true,
    "message": "Fatura enviada com sucesso.",
    "envios": [
        {
            "canal": "WHATSAPP",
            "destino": "11999998888",
            "status": "ENVIADO"
        },
        {
            "canal": "EMAIL",
            "destino": "cliente@email.com",
            "status": "ENVIADO"
        },
        {
            "canal": "EMAIL",
            "destino": "financeiro@empresa.com",
            "status": "ENVIADO"
        }
    ]
}
```

**Response (Parcial):**
```json
{
    "success": true,
    "message": "Fatura enviada parcialmente.",
    "envios": [
        {
            "canal": "WHATSAPP",
            "destino": "11999998888",
            "status": "ENVIADO"
        },
        {
            "canal": "EMAIL",
            "destino": "email-invalido",
            "status": "ERRO",
            "erro": "E-mail inválido ou não entregue"
        }
    ]
}
```

### 12.2 Configurações da Organização

**GET /api/SPA/configuracoes/organizacao**
```json
{
    "success": true,
    "data": {
        "dia_calculo": 15,
        "tem_senha_edicao_fatura": true,
        "mensagem_envio_fatura": "Olá {{nome_cliente}}! Segue sua fatura de energia.",
        "updated_at": "2026-03-09T10:00:00Z",
        "updated_by": "Admin"
    }
}
```

**PUT /api/SPA/configuracoes/organizacao**
```json
{
    "mensagem_envio_fatura": "Olá {{nome_cliente}}! Segue em anexo sua fatura de energia referente a {{mes_referencia}}. Valor: {{valor_fatura}}. Vencimento: {{data_vencimento}}."
}
```

---

## 13. Diagrama de Sequência

```
┌─────────┐     ┌──────────┐     ┌────────────┐     ┌───────────┐     ┌─────────┐
│ Frontend│     │Controller│     │WhatsAppSvc │     │ EmailSvc  │     │ Cliente │
└────┬────┘     └────┬─────┘     └─────┬──────┘     └─────┬─────┘     └────┬────┘
     │               │                 │                  │                │
     │ POST /enviar  │                 │                  │                │
     │──────────────▶│                 │                  │                │
     │               │                 │                  │                │
     │               │ enviarFatura()  │                  │                │
     │               │────────────────▶│                  │                │
     │               │                 │                  │                │
     │               │                 │ POST ChatCenter  │                │
     │               │                 │─────────────────────────────────▶│
     │               │                 │                  │                │
     │               │                 │◀────────────────────────────────│
     │               │◀────────────────│                  │                │
     │               │                 │                  │                │
     │               │ enviarFatura()  │                  │                │
     │               │───────────────────────────────────▶│                │
     │               │                 │                  │                │
     │               │                 │                  │ SMTP Send      │
     │               │                 │                  │───────────────▶│
     │               │                 │                  │                │
     │               │                 │                  │◀───────────────│
     │               │◀───────────────────────────────────│                │
     │               │                 │                  │                │
     │ Response JSON │                 │                  │                │
     │◀──────────────│                 │                  │                │
     │               │                 │                  │                │
```

---

## 14. Considerações de Segurança

1. **API Keys**: Nunca expor `CHATCENTER_API_KEY` no frontend ou logs
2. **Validação de Email**: Sempre validar formato antes de enviar
3. **Rate Limiting**: Considerar implementar rate limiting para evitar spam
4. **Permissões**: Verificar se usuário tem acesso à fatura antes de enviar
5. **Logs**: Não logar mensagens completas com dados sensíveis do cliente
6. **HTTPS**: Garantir que todas as chamadas de API usem HTTPS

---

## 15. Prioridade de Implementação

1. **Migration** - Adicionar `mensagem_envio_fatura` na tabela `organizacoes`
2. **Model** - Atualizar `$fillable` da `Organizacao`
3. **Trait** - Criar `SubstituiVariaveisMensagem`
4. **Services** - Implementar `WhatsAppService` e `EmailService`
5. **Mailable** - Criar `FaturaClienteMail` e template
6. **Controller** - Implementar `EnvioFaturaController`
7. **Rotas** - Registrar rotas da API
8. **Resource** - Atualizar `FaturaResource` com dados de contato
9. **Auditoria** - Criar tabela e model `ControleEnvio`
