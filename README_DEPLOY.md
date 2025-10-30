# API BB - Sistema de Boletos Banco do Brasil

Sistema completo para geração e gerenciamento de boletos do Banco do Brasil, desenvolvido com React e Node.js.

## 🚀 Funcionalidades

- ✅ Geração automática de boletos de energia
- ✅ Integração com API do Banco do Brasil (OAuth2)
- ✅ Geração de boletos conjuntos (agrupamento)
- ✅ Geração de PDFs personalizados com código de barras e QR Code PIX
- ✅ Sincronização de status com API do BB
- ✅ Cancelamento de boletos
- ✅ Interface responsiva com React + Bootstrap
- ✅ Backend robusto com Express.js
- ✅ Banco de dados PostgreSQL

## 📋 Requisitos

### Desenvolvimento Local (Windows)
- Node.js 18+
- PostgreSQL 14+
- NPM ou Yarn

### Servidor de Produção (Linux/VPS)
- Ubuntu 20.04+ ou similar
- Node.js 18+
- PostgreSQL 14+
- Nginx
- PM2
- Git

## 🔧 Instalação Local (Desenvolvimento)

### 1. Clonar o repositório

```bash
git clone https://github.com/FagginAupus/API-BB.git
cd API-BB
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar banco de dados

Crie um banco PostgreSQL e configure as credenciais no arquivo `.env`:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações.

### 4. Executar a aplicação

```bash
# Modo desenvolvimento (backend + frontend simultaneamente)
npm start

# Ou separadamente:
npm run server   # Backend na porta 3001
npm run client   # Frontend na porta 3002
```

### 5. Acessar

- **Frontend:** http://localhost:3002
- **Backend API:** http://localhost:3001

## 🌐 Deploy em Produção

Para fazer deploy no servidor VPS, siga o guia completo em [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md).

### Resumo rápido:

1. Conectar ao servidor VPS
2. Instalar dependências do sistema (Node.js, PostgreSQL, Nginx, PM2)
3. Clonar repositório em `/var/www/api-bb`
4. Configurar `.env` com credenciais de produção
5. Executar `npm install` e `npm run build`
6. Configurar Nginx (arquivo `nginx-config.conf`)
7. Iniciar com PM2: `pm2 start ecosystem.config.js`
8. Configurar SSL com Certbot (recomendado)

**Deploy de atualizações:**

```bash
cd /var/www/api-bb
./deploy.sh
```

## 📁 Estrutura do Projeto

```
API_BB_REACT/
├── server/                 # Backend Node.js
│   ├── server.js          # Servidor Express principal
│   ├── config.js          # Configurações do BB
│   ├── database.js        # Operações do PostgreSQL
│   └── pdfGenerator.js    # Geração de PDFs
├── src/                   # Frontend React
│   ├── components/        # Componentes React
│   ├── App.js            # Componente principal
│   └── index.js          # Entry point
├── public/               # Arquivos estáticos
├── migrations/           # Migrations do banco de dados
├── .env                  # Variáveis de ambiente (não versionado)
├── .env.example          # Exemplo de configuração
├── .env.production       # Template para produção
├── ecosystem.config.js   # Configuração PM2
├── nginx-config.conf     # Configuração Nginx
├── deploy.sh            # Script de deploy
└── package.json         # Dependências
```

## 🔐 Variáveis de Ambiente

Principais variáveis necessárias no arquivo `.env`:

```env
# Banco de Dados
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=aupus_boletos
DB_USERNAME=aupus_user
DB_PASSWORD=sua_senha

# Banco do Brasil
BB_CLIENT_ID=seu_client_id
BB_CLIENT_SECRET=seu_client_secret
BB_DEVELOPER_KEY=sua_developer_key
BB_AGENCIA=sua_agencia
BB_CONTA=sua_conta
BB_CONVENIO=seu_convenio

# Servidor
NODE_ENV=production
PORT=3001
```

## 🌐 URLs em Produção

Após o deploy, o sistema estará disponível em:

- **Frontend:** https://bb.seudominio.com
- **API Backend:** https://api-bb.seudominio.com

Certifique-se de que os registros DNS tipo A estejam configurados:
- `bb` → 92.113.38.164
- `api-bb` → 92.113.38.164

## 📊 Comandos Úteis

### Desenvolvimento

```bash
npm start              # Iniciar dev (backend + frontend)
npm run server         # Apenas backend
npm run client         # Apenas frontend
npm run build          # Build do frontend
```

### Produção (PM2)

```bash
pm2 start ecosystem.config.js   # Iniciar
pm2 restart api-bb-backend      # Reiniciar
pm2 stop api-bb-backend         # Parar
pm2 logs api-bb-backend         # Ver logs
pm2 monit                       # Monitor
pm2 status                      # Status
```

### Banco de Dados

```bash
# Backup
pg_dump -U aupus_user aupus_boletos > backup.sql

# Restaurar
psql -U aupus_user aupus_boletos < backup.sql
```

## 🔧 Troubleshooting

### Backend não inicia
```bash
# Verificar logs
pm2 logs api-bb-backend

# Verificar se porta está em uso
netstat -tulpn | grep 3001
```

### Erro de conexão com banco
```bash
# Verificar status PostgreSQL
systemctl status postgresql

# Testar conexão
psql -U aupus_user -d aupus_boletos -h localhost
```

### Nginx retorna 502
```bash
# Verificar se backend está rodando
pm2 status

# Verificar logs do Nginx
tail -f /var/log/nginx/error.log
```

## 📝 Licença

Propriedade de CLUBE AUPUS LTDA.

## 📞 Suporte

Para suporte técnico, entre em contato com a equipe de desenvolvimento.

---

**Última atualização:** Outubro 2024
