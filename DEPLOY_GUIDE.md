# Guia de Deploy - API BB Sistema de Boletos

## 📋 Pré-requisitos no Servidor VPS (92.113.38.164)

1. **Node.js 18+** e **npm**
2. **PostgreSQL 14+**
3. **Nginx**
4. **PM2** (gerenciador de processos)
5. **Git**
6. **Certbot** (para SSL - opcional mas recomendado)

---

## 🚀 Passo a Passo - Deploy Inicial

### 1. Conectar ao Servidor

```bash
ssh root@92.113.38.164
```

### 2. Instalar Dependências do Sistema

```bash
# Atualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Instalar PostgreSQL
apt install -y postgresql postgresql-contrib

# Instalar Nginx
apt install -y nginx

# Instalar PM2 globalmente
npm install -g pm2

# Instalar Git
apt install -y git
```

### 3. Configurar PostgreSQL

```bash
# Entrar no PostgreSQL
sudo -u postgres psql

# Criar banco de dados e usuário
CREATE DATABASE aupus_boletos;
CREATE USER aupus_user WITH ENCRYPTED PASSWORD 'SENHA_FORTE_AQUI';
GRANT ALL PRIVILEGES ON DATABASE aupus_boletos TO aupus_user;
\q
```

### 4. Configurar Firewall

```bash
# Permitir HTTP, HTTPS e SSH
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 5. Clonar Repositório

```bash
# Criar diretório da aplicação
mkdir -p /var/www
cd /var/www

# Clonar repositório
git clone https://github.com/FagginAupus/API-BB.git api-bb
cd api-bb
```

### 6. Configurar Variáveis de Ambiente

```bash
# Copiar arquivo de exemplo
cp .env.production .env

# Editar com suas credenciais
nano .env
```

**Configurar no `.env`:**
- `DB_PASSWORD` - senha do PostgreSQL
- `BB_CLIENT_ID` - credenciais do Banco do Brasil
- `BB_CLIENT_SECRET` - credenciais do Banco do Brasil
- Substituir `seudominio.com` pelos domínios reais

### 7. Instalar Dependências e Build

```bash
# Instalar dependências
npm install

# Build do frontend React
npm run build
```

### 8. Criar Tabelas do Banco de Dados

```bash
# Executar migrations (se houver)
# Ou criar tabelas manualmente conforme necessário
```

### 9. Configurar Nginx

```bash
# Copiar configuração
cp nginx-config.conf /etc/nginx/sites-available/api-bb

# Editar e substituir 'seudominio.com' pelo domínio real
nano /etc/nginx/sites-available/api-bb

# Criar symlink
ln -s /etc/nginx/sites-available/api-bb /etc/nginx/sites-enabled/

# Remover configuração padrão
rm /etc/nginx/sites-enabled/default

# Testar configuração
nginx -t

# Reiniciar Nginx
systemctl restart nginx
```

### 10. Iniciar Aplicação com PM2

```bash
# Dar permissão de execução ao script
chmod +x deploy.sh

# Iniciar aplicação
pm2 start ecosystem.config.js

# Configurar PM2 para iniciar no boot
pm2 startup
pm2 save
```

### 11. Verificar Status

```bash
# Ver status da aplicação
pm2 status

# Ver logs
pm2 logs api-bb-backend

# Monitorar em tempo real
pm2 monit
```

---

## 🔒 Configurar SSL (HTTPS) - Recomendado

```bash
# Instalar Certbot
apt install -y certbot python3-certbot-nginx

# Obter certificado SSL (substitua pelos seus domínios)
certbot --nginx -d api-bb.seudominio.com -d bb.seudominio.com

# Renovação automática já está configurada
```

---

## 🔄 Deploy de Atualizações

Após fazer mudanças no código e fazer push para o GitHub:

```bash
# Conectar ao servidor
ssh root@92.113.38.164

# Ir para o diretório da aplicação
cd /var/www/api-bb

# Executar script de deploy
./deploy.sh
```

Ou manualmente:

```bash
git pull origin main
npm install --production
npm run build
pm2 restart api-bb-backend
```

---

## 📊 Comandos Úteis PM2

```bash
# Ver status
pm2 status

# Ver logs
pm2 logs api-bb-backend

# Ver logs em tempo real
pm2 logs api-bb-backend --lines 100

# Parar aplicação
pm2 stop api-bb-backend

# Reiniciar aplicação
pm2 restart api-bb-backend

# Deletar do PM2
pm2 delete api-bb-backend

# Monitoramento
pm2 monit
```

---

## 🔍 Troubleshooting

### Verificar se backend está rodando

```bash
curl http://localhost:3001/api/health
```

### Verificar logs do Nginx

```bash
tail -f /var/log/nginx/api-bb-error.log
tail -f /var/log/nginx/bb-frontend-error.log
```

### Verificar logs da aplicação

```bash
pm2 logs api-bb-backend --lines 200
```

### Reiniciar tudo

```bash
pm2 restart all
systemctl restart nginx
```

---

## 🌐 URLs da Aplicação

Após o deploy, a aplicação estará disponível em:

- **Frontend:** http://bb.seudominio.com (ou https:// se SSL configurado)
- **API Backend:** http://api-bb.seudominio.com (ou https:// se SSL configurado)

---

## 📝 Atualizar Sistema de Leituras Local

No seu PC local, atualizar o sistema de leituras Python para apontar para a nova API:

**Antes:**
```python
API_URL = "http://localhost:3001"
```

**Depois:**
```python
API_URL = "https://api-bb.seudominio.com"
```

---

## ⚠️ Segurança

1. **Sempre use HTTPS em produção** (configurar SSL)
2. **Mantenha as credenciais do BB seguras** no arquivo `.env`
3. **Use senhas fortes** para PostgreSQL
4. **Configure backup** do banco de dados
5. **Mantenha o sistema atualizado**

```bash
# Backup do banco de dados
pg_dump -U aupus_user aupus_boletos > backup_$(date +%Y%m%d).sql

# Restaurar backup
psql -U aupus_user aupus_boletos < backup_20241030.sql
```

---

## 📞 Suporte

Se encontrar problemas:

1. Verificar logs: `pm2 logs api-bb-backend`
2. Verificar status: `pm2 status`
3. Verificar Nginx: `nginx -t && systemctl status nginx`
4. Verificar PostgreSQL: `systemctl status postgresql`
