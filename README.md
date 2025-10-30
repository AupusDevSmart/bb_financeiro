# 🏦 Sistema de Boletos - Banco do Brasil (React)

> **Status:** ✅ **FUNCIONANDO** - Backend (porta 3000) + Frontend React (porta 3001)

Sistema completo de geração de boletos bancários do Banco do Brasil com interface React moderna.

---

## 🚀 Início Rápido

### Para INICIAR o sistema:
```bash
INICIAR.bat
```
Duplo clique ou execute no terminal.

### Para PARAR o sistema:
```bash
PARAR.bat
```
Duplo clique ou execute no terminal.

### Acessar o sistema:
```
http://localhost:3001
```

---

## 📋 Funcionalidades

### 1️⃣ Criar Boleto
- ✅ Formulário completo com validações
- ✅ Máscaras automáticas (CPF/CNPJ, CEP)
- ✅ Juros: **1% ao mês** (automático)
- ✅ Multa: **2% após vencimento** (automático)
- ✅ **QR Code PIX** gerado automaticamente
- ✅ Remove acentos antes de enviar ao BB
- ✅ Formatação automática com zeros à esquerda

### 2️⃣ Listar Boletos
- ✅ Filtros por situação (Em Aberto, Baixado, Liquidado)
- ✅ Filtros por data (Vencimento, Registro, Movimento)
- ✅ Filtros por período (data início/fim)
- ✅ Tabela responsiva com detalhes expansíveis
- ✅ Ações: Ver, Copiar linha digitável, Baixar boleto

### 3️⃣ Consultar Boleto
- ✅ Busca por número do boleto
- ✅ Exibição completa de todas as informações
- ✅ Dados do pagador formatados
- ✅ QR Code PIX (quando disponível)
- ✅ Botão para copiar linha digitável

---

## 📁 Estrutura do Projeto

```
API_BB_REACT/
├── server/
│   ├── server.js           # Backend Express (porta 3000)
│   └── config.js           # Configurações do BB
├── src/
│   ├── components/
│   │   ├── App.js              # Componente principal
│   │   ├── CriarBoleto.js      # Formulário de criação ✅
│   │   ├── ListarBoletos.js    # Listagem com filtros ✅
│   │   ├── ConsultarBoleto.js  # Consulta individual ✅
│   │   ├── TabelaBoletos.js    # Tabela responsiva ✅
│   │   └── QRCodePIX.js        # QR Code PIX ✅
│   ├── services/
│   │   └── api.js              # Integração com backend ✅
│   ├── utils/
│   │   └── formatters.js       # Formatações (CPF/CNPJ, etc) ✅
│   ├── index.js                # Entry point ✅
│   └── App.css                 # Estilos globais ✅
├── public/
│   └── index.html              # HTML base ✅
├── package.json                # Dependências ✅
├── INICIAR.bat                 # Script para iniciar 🔧
├── PARAR.bat                   # Script para parar 🔧
└── README.md                   # Esta documentação
```

---

## 🛠️ Tecnologias

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| React | 18.2.0 | Interface do usuário |
| React Bootstrap | 2.9.0 | Componentes UI |
| Axios | 1.6.0 | Requisições HTTP |
| qrcode.react | 3.1.0 | QR Code PIX |
| react-input-mask | 2.0.4 | Máscaras de input |
| Font Awesome | 6.5.0 | Ícones |
| Express | 4.18.2 | Servidor backend |
| Concurrently | 8.2.0 | Múltiplos processos |

---

## ⚙️ Configurações da API

### Credenciais (src/services/api.js)
```javascript
Convênio: 3648981
Carteira: 17
Variação: 19
Developer Key: f3891824867348a3bc73ccb6b25a99c7
```

### Endpoints Backend
```
POST /proxy-oauth/oauth/token              # Autenticação
POST /proxy-api/cobrancas/v2/boletos       # Criar boleto
GET  /proxy-api/cobrancas/v2/boletos       # Listar boletos
GET  /proxy-api/cobrancas/v2/boletos/:id   # Consultar boleto
POST /proxy-api/cobrancas/v2/boletos/:id/baixar  # Baixar boleto
GET  /health                               # Health check
```

---

## 📖 Como Usar

### 1. Criar um Boleto

1. Acesse a aba **"Criar Boleto"**
2. Preencha os dados:
   - Número do título (único)
   - Data de vencimento
   - Valor do boleto
   - Tipo de documento (CPF ou CNPJ)
   - Dados do pagador (documento, nome, endereço)
3. Clique em **"Criar Boleto"**
4. ✅ QR Code PIX será exibido automaticamente
5. ✅ Linha digitável será exibida

**Observações:**
- CPF/CNPJ são formatados com zeros à esquerda automaticamente
- Acentos são removidos antes de enviar ao BB
- Juros e multa são calculados automaticamente

### 2. Listar Boletos

1. Acesse a aba **"Listar Boletos"**
2. Configure os filtros (opcional):
   - **Situação**: Todas, Em Aberto, Baixado, Liquidado
   - **Tipo de data**: Vencimento, Registro, Movimento
   - **Período**: Data início e fim
3. Clique em **"Buscar Boletos"**
4. Visualize os resultados em uma tabela responsiva
5. Clique na seta (▶) para expandir detalhes
6. Use os botões de ação:
   - 👁️ **Ver** - Exibir detalhes completos
   - 📋 **Copiar** - Copiar linha digitável
   - 🚫 **Baixar** - Cancelar boleto

### 3. Consultar Boleto Específico

1. Acesse a aba **"Consultar Boleto"**
2. Digite o número do boleto (nosso número)
3. Clique em **"Consultar"**
4. Veja todos os detalhes:
   - Informações gerais
   - Valores (original, atual, abatimento)
   - Juros e multa
   - Linha digitável e código de barras
   - Dados completos do pagador
   - QR Code PIX (se disponível)

---

## 🔧 Comandos Úteis

### Scripts NPM
```bash
npm start        # Inicia backend + React
npm run server   # Inicia apenas backend
npm run client   # Inicia apenas React
npm run build    # Build de produção
npm install      # Instalar dependências
```

### Gerenciar Portas (Windows)
```bash
# Ver processos nas portas
netstat -ano | findstr :3000
netstat -ano | findstr :3001

# Matar processo por PID
taskkill //F //PID <numero_do_PID>
```

---

## ⚠️ Troubleshooting

### Problema: Portas já em uso
**Solução:** Execute `PARAR.bat` antes de `INICIAR.bat`

### Problema: Erro ao instalar dependências
**Solução:**
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Problema: Frontend não atualiza
**Solução:** Limpe o cache do navegador com `Ctrl + Shift + R`

### Problema: Erro de autenticação
**Solução:** Verifique as credenciais em `src/services/api.js`

### Problema: CORS error
**Solução:** O servidor já está configurado com CORS permissivo. Se persistir, reinicie o servidor.

---

## 📊 Status dos Servidores

### Verificar se está rodando:
```bash
# Windows
netstat -ano | findstr ":3000"   # Backend
netstat -ano | findstr ":3001"   # React

# Ou acesse:
http://localhost:3000/health     # Health check do backend
http://localhost:3001            # Interface React
```

### URLs Importantes:
| Serviço | URL | Descrição |
|---------|-----|-----------|
| Frontend | http://localhost:3001 | Interface React |
| Backend | http://localhost:3000 | API Express |
| Health | http://localhost:3000/health | Status do servidor |
| Rede local | http://192.168.1.X:3001 | Acesso de outros dispositivos |

---

## 🎨 Tema Visual

O sistema usa as cores oficiais do Banco do Brasil:

```css
Amarelo BB:  #ffcc02
Azul BB:     #003087
Azul Escuro: #001e5c
```

---

## 📝 Detalhes Técnicos

### Formatação de Dados
- **CPF**: Sempre 11 dígitos (`padStart(11, '0')`)
- **CNPJ**: Sempre 14 dígitos (`padStart(14, '0')`)
- **CEP**: Sempre 8 dígitos (`padStart(8, '0')`)
- **Nomes**: Primeira letra maiúscula em cada palavra
- **Acentos**: Removidos antes de enviar ao BB

### Juros e Multa (Automático)
- **Juros**: 1% ao mês (tipo 3 - percentual mensal)
- **Multa**: 2% (tipo 2 - percentual)
- **Data da multa**: Vencimento + 1 dia (automático)

### Cache de Token OAuth
- Token armazenado em memória
- Renovação automática quando expira
- Margem de segurança de 5 minutos

### Validações
✅ Campos obrigatórios
✅ Valores numéricos
✅ Datas válidas
✅ CPF/CNPJ formatado
✅ CEP formatado

---

## 🔒 Segurança

- Token OAuth não é exposto no frontend
- Credenciais do BB apenas no backend
- CORS configurado para localhost
- Dados sensíveis não são armazenados em localStorage

---

## 📚 Documentação Adicional

Para mais detalhes sobre comandos úteis, consulte:
- **COMANDOS_UTEIS.md** - Guia completo de comandos e atalhos

---

## 📞 Suporte

### Checklist de Verificação:
- [ ] Node.js instalado (v14 ou superior)
- [ ] npm instalado
- [ ] Portas 3000 e 3001 disponíveis
- [ ] Firewall não bloqueando Node.js
- [ ] Conexão com internet ativa

### Logs do Sistema:
Os logs aparecem automaticamente no terminal:
- `📡` - Requisições HTTP
- `✅` - Operações bem-sucedidas
- `❌` - Erros
- `🔐` - Autenticação OAuth
- `🏦` - Chamadas à API do BB

---

## 🎯 Próximas Melhorias (Opcional)

- [ ] Impressão de boleto em PDF profissional
- [ ] Paginação na listagem de boletos
- [ ] Exportar lista para Excel/CSV
- [ ] Dashboard com gráficos
- [ ] Busca por nome do pagador
- [ ] Notificações por email
- [ ] Sistema de relatórios
- [ ] Histórico de alterações

---

## 📜 Licença

Este projeto é de uso interno.

---

**🎉 Sistema completo e funcionando!**

**Desenvolvido com React + Express**
**Versão: 3.0.0**
**Última atualização: Outubro 2025**

---

## Atalhos Rápidos

- **Iniciar:** `INICIAR.bat`
- **Parar:** `PARAR.bat`
- **Acessar:** http://localhost:3001
- **Logs:** Terminal onde executou o script
- **Ajuda:** Leia COMANDOS_UTEIS.md
