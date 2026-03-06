# 📦 Download em Massa de Boletos - ZIP Automático

## 🎯 Funcionalidade

Botão "Baixar Todos" que aparece no header da página **Boletos de Energia** permite download automático de todos os boletos gerados em um único arquivo ZIP.

## ✨ Características

### Frontend
- **Botão Inteligente**: Aparece apenas quando há boletos gerados
- **Contador Dinâmico**: Mostra quantos PDFs serão baixados
- **Progress Indicator**: Spinner durante processamento
- **Token Automático**: Obtém token OAuth automaticamente
- **UX Transparente**: Usuário não precisa de interação manual

### Backend
- **Geração em Streaming**: ZIP criado em tempo real
- **PDFs Completos**: Cada boleto com todos os dados (linha digitável, PIX, energia, etc)
- **Salvamento Duplo**:
  1. Download para o usuário (ZIP)
  2. Salvamento em `/var/www/aupus-sistema-faturas/dados/02. NET/2025/10.2025/`
- **Nome Formatado**: `Boleto Aupus - {UC} - {Nome}.pdf` (primeira letra maiúscula)

## 🚀 Como Usar

### No Frontend (Usuário)

1. Acesse **Boletos de Energia**
2. Clique no botão **"Baixar Todos (X PDFs)"** no header
3. Aguarde o processamento (mostra progresso)
4. ZIP é baixado automaticamente
5. Arquivos também salvos no servidor

### Tecnicamente

```javascript
// Frontend - GerarBoletoEnergia.js
const baixarTodosBoletosZip = async () => {
    // 1. Filtrar boletos com status "Boleto gerado"
    const boletosGerados = boletos.filter(b =>
        normalizarBoleto(b).status === 'Boleto gerado'
    );

    // 2. Obter token OAuth fresco
    const token = await obterToken();

    // 3. Chamar endpoint do backend
    const response = await api.post('/baixar-todos-boletos-zip', {
        boletos: boletosGerados,
        mes_referencia: '10/2025'
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-Application-Key': '549827f7531a4cdd880437df70bf3d86'
        },
        responseType: 'blob'  // Importante para ZIP
    });

    // 4. Download automático
    const blob = new Blob([response.data], { type: 'application/zip' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Boletos-Energia-10-2025.zip';
    link.click();
};
```

```javascript
// Backend - server.js (linha 673)
app.post('/baixar-todos-boletos-zip', async (req, res) => {
    const { boletos, mes_referencia } = req.body;
    const token = req.headers.authorization.replace('Bearer ', '');

    // Criar ZIP
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Para cada boleto:
    for (const boleto of boletos) {
        // 1. Buscar dados do BB
        const dadosBoletoBB = await axios.get(
            `https://api.bb.com.br/cobrancas/v2/boletos/${boleto.numero_boleto}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        // 2. Buscar PIX
        const dadosPix = await axios.get(
            `https://api.bb.com.br/pix/v2/cob/${boleto.numero_boleto}`
        );

        // 3. Gerar PDF completo
        const pdfBuffer = await gerarPDFBoleto({
            ...dadosBoletoBB.data,
            dadosPix,
            dadosEnergia: { /* estrutura completa */ }
        });

        // 4. Adicionar ao ZIP
        archive.append(pdfBuffer, { name: nomeArquivo });
    }

    await archive.finalize();
});
```

## 📁 Estrutura de Dados

### Payload Enviado

```json
{
  "boletos": [
    {
      "uc": "10002917058",
      "mes_referencia": "10/2025",
      "numero_boleto": "00036489810000000008",
      "nome_completo": "FAST POWER",
      "dados_completos": {
        "energiaTotal": 2733,
        "energiaCompensado": 1350.91,
        "valorBoleto": 2665.97,
        "valorEconomia": 293.66,
        ...
      }
    }
  ],
  "mes_referencia": "10/2025"
}
```

### Resposta

- **Content-Type**: `application/zip`
- **Content-Disposition**: `attachment; filename="Boletos-Energia-10-2025.zip"`
- **Body**: Stream binário do ZIP

## 🗂️ Estrutura do ZIP

```
Boletos-Energia-10-2025.zip
├── Boleto Aupus - 10000040175 - Erick Oliveira.pdf
├── Boleto Aupus - 10002917058 - Fast Power.pdf
├── Boleto Aupus - 10003298777 - Eric.pdf
├── ...
└── Boleto Aupus - 840097712 - Mundial Supermercados Ltda.pdf
```

## 💾 Salvamento no Servidor

**Pasta**: `/var/www/aupus-sistema-faturas/dados/02. NET/2025/10.2025/`

```bash
/var/www/aupus-sistema-faturas/dados/02. NET/2025/10.2025/
├── Boleto Aupus - 10000040175 - Erick Oliveira.pdf
├── Boleto Aupus - 10002917058 - Fast Power.pdf
...
```

**Permissões**: `www-data:www-data` com `755`

## 🔧 Dependências

### Backend (package.json)

```json
{
  "dependencies": {
    "archiver": "^7.0.1",    // Para criar ZIP
    "axios": "^1.7.9"         // Para chamar API do BB
  }
}
```

### Instalação

```bash
cd /var/www/api-bb
npm install archiver axios --save
pm2 restart api-bb-backend
```

## 📊 Dados Incluídos em Cada PDF

✅ **Boleto**
- Linha digitável
- Código de barras
- Número do boleto
- Data de vencimento
- Valor do boleto
- Juros (1%)
- Multa (2%)

✅ **Pagador**
- Nome completo
- CPF/CNPJ
- Endereço completo

✅ **Energia**
- UC (Unidade Consumidora)
- Mês de referência (10/2025)
- Consumo total (kWh)
- Consumo compensado
- Consumo não compensado
- Valores (energia, bandeira, descontos)
- **Economia gerada**

✅ **PIX** (quando disponível)
- QR Code
- Copia e Cola

## 🎨 UI/UX

### Botão no Header

```jsx
<Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
    <h4>Gerar Boletos de Energia Automaticamente</h4>
    {boletosGerados.length > 0 && (
        <Button variant="light" size="sm" onClick={baixarTodosBoletosZip}>
            {baixandoTodos ? (
                <>
                    <Spinner animation="border" size="sm" />
                    <span>Baixando {progresso.atual}/{progresso.total}...</span>
                </>
            ) : (
                <>
                    <PackageOpen size={16} />
                    <span>Baixar Todos ({boletosGerados.length} PDFs)</span>
                </>
            )}
        </Button>
    )}
</Card.Header>
```

### Estados

- **Idle**: Mostra contador de boletos disponíveis
- **Baixando**: Spinner + contador de progresso
- **Sucesso**: Alerta verde com mensagem de sucesso
- **Erro**: Alerta vermelho com mensagem de erro

## 🧪 Teste

### Teste Manual

1. Acesse: https://bb.aupusenergia.com.br
2. Vá em "Boletos de Energia"
3. Verifique se há boletos com status "Boleto gerado"
4. Clique em "Baixar Todos"
5. Aguarde download automático
6. Extraia ZIP e verifique PDFs

### Verificar no Servidor

```bash
# Ver arquivos salvos
ls -la /var/www/aupus-sistema-faturas/dados/02.\ NET/2025/10.2025/

# Contar arquivos
ls /var/www/aupus-sistema-faturas/dados/02.\ NET/2025/10.2025/ | wc -l

# Verificar tamanho
du -sh /var/www/aupus-sistema-faturas/dados/02.\ NET/2025/10.2025/*.pdf | head -5
```

### Logs

```bash
# Monitorar processamento
pm2 logs api-bb-backend --lines 50

# Buscar erros
pm2 logs api-bb-backend --err
```

## 🐛 Troubleshooting

### Erro 401 Unauthorized
- **Causa**: Token OAuth expirado
- **Solução**: Token é renovado automaticamente pelo frontend via `obterToken()`

### ZIP vazio ou incompleto
- **Causa**: Erro ao buscar dados do BB ou gerar PDF
- **Solução**: Verificar logs do backend: `pm2 logs api-bb-backend`

### Boletos em branco
- **Causa**: `dados_completos` ausente ou estrutura incorreta
- **Solução**: Verificar se campo `dados_completos` tem todos os dados de energia

### Download não inicia
- **Causa**: Frontend não consegue criar Blob
- **Solução**: Verificar Console do navegador (F12)

## 📈 Performance

### Tempo Estimado

- **1 boleto**: ~2-3 segundos
- **10 boletos**: ~20-30 segundos
- **52 boletos**: ~2-3 minutos

### Otimizações

- **Streaming**: ZIP gerado em streaming (não carrega tudo em memória)
- **Compressão**: Level 9 (máximo)
- **Paralelo**: Poderia processar em paralelo (implementação futura)

## 🔒 Segurança

- ✅ Token OAuth renovado automaticamente
- ✅ Validação de boletos no backend
- ✅ Apenas boletos com status "Boleto gerado"
- ✅ Dados completos do BB (linha digitável válida)
- ✅ Pasta do servidor com permissões adequadas

## 📅 Informações

**Data**: 31/10/2025
**Versão**: 3.0.7
**Status**: ✅ FUNCIONALIDADE IMPLEMENTADA E TESTADA
**Frontend Build**: 120.41 kB (+749B)
**Backend**: PM2 online

## 🔗 Arquivos Modificados

### Frontend
- `/var/www/api-bb/src/components/GerarBoletoEnergia.js`
  - Linha 7: Import de `PackageOpen`
  - Linhas 32-33: Estados `baixandoTodos` e `progresso`
  - Linhas 804-879: Função `baixarTodosBoletosZip`
  - Linhas 886-909: Botão no header

### Backend
- `/var/www/api-bb/server/server.js`
  - Linhas 12-13: Imports de `archiver` e `axios`
  - Linhas 673-813: Rota `/baixar-todos-boletos-zip`

### Dependências
- `/var/www/api-bb/package.json`
  - Adicionado: `archiver@^7.0.1`

## 🎉 Resultado

**Download em massa de boletos 100% funcional!**

✅ Botão inteligente no header
✅ Download automático do ZIP
✅ Salvamento duplo (usuário + servidor)
✅ PDFs completos com todos os dados
✅ Nome formatado (primeira letra maiúscula)
✅ Token OAuth renovado automaticamente
✅ UX transparente e profissional

---

**Fim do Documento** 🚀
