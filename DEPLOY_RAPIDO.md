# 🚀 Deploy Rápido - API BB

Guia simplificado para deploy no servidor VPS (92.113.38.164).

---

## ✅ Pré-requisitos já configurados:

- ✅ PostgreSQL rodando (aupus_staging)
- ✅ Domínios DNS configurados (bb e api-bb → 92.113.38.164)

---

## 📋 Comandos para executar no servidor

### 1️⃣ Conectar ao servidor

```bash
ssh root@92.113.38.164
```

---

### 2️⃣ Instalar Node.js, Nginx, PM2 e Git

```bash
# Atualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Instalar Nginx
apt install -y nginx

# Instalar PM2 globalmente
npm install -g pm2

# Instalar Git (se não tiver)
apt install -y git

# Verificar versões
node --version
npm --version
pm2 --version
```

---

### 3️⃣ Clonar repositório

```bash
# Criar diretório e clonar
mkdir -p /var/www
cd /var/www
git clone https://github.com/FagginAupus/API-BB.git api-bb
cd api-bb
```

---

### 4️⃣ Configurar variáveis de ambiente

```bash
# Copiar template
cp .env.production .env

# Editar .env (já vem com as credenciais corretas do PostgreSQL)
nano .env
```

**O arquivo já está pré-configurado com:**
- DB_HOST=127.0.0.1
- DB_DATABASE=aupus_staging
- DB_USERNAME=aupus_staging
- DB_PASSWORD=AupusStaging2024

**Você só precisa ajustar os domínios se necessário.**

Salvar: `Ctrl+O`, Enter, `Ctrl+X`

---

### 5️⃣ Instalar dependências e fazer build

```bash
# Instalar dependências
npm install --production

# Build do frontend React
npm run build

# Criar diretório de logs
mkdir -p logs
```

---

### 6️⃣ Configurar Nginx

```bash
# Editar configuração (substituir 'seudominio.com' pelo domínio real)
nano nginx-config.conf
```

**Substituir todas as ocorrências:**
- `api-bb.seudominio.com` → seu domínio real (ex: `api-bb.aupusenergia.com.br`)
- `bb.seudominio.com` → seu domínio real (ex: `bb.aupusenergia.com.br`)

```bash
# Copiar configuração
cp nginx-config.conf /etc/nginx/sites-available/api-bb

# Criar symlink
ln -s /etc/nginx/sites-available/api-bb /etc/nginx/sites-enabled/

# Remover config padrão (se existir)
rm -f /etc/nginx/sites-enabled/default

# Testar configuração
nginx -t

# Se OK, reiniciar Nginx
systemctl restart nginx
systemctl enable nginx
```

---

### 7️⃣ Iniciar aplicação com PM2

```bash
# Dar permissão ao script
chmod +x deploy.sh

# Iniciar com PM2
pm2 start ecosystem.config.js

# Configurar para iniciar no boot
pm2 startup
# IMPORTANTE: Copiar e executar o comando que aparecer na tela

# Salvar configuração
pm2 save

# Ver status
pm2 status

# Ver logs (Ctrl+C para sair)
pm2 logs api-bb-backend
```

---

### 8️⃣ Configurar Firewall

```bash
# Permitir SSH, HTTP e HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Ver status
ufw status
```

---

### 9️⃣ Configurar SSL (HTTPS) - IMPORTANTE!

```bash
# Instalar Certbot
apt install -y certbot python3-certbot-nginx

# Obter certificado SSL (substitua pelos seus domínios)
certbot --nginx -d api-bb.aupusenergia.com.br -d bb.aupusenergia.com.br

# Seguir instruções:
# - Informar email
# - Aceitar termos
# - Escolher opção 2 (redirect HTTP to HTTPS)
```

---

## ✅ Testar a Aplicação

### Testar backend:
```bash
curl http://localhost:3001/api/health
```

### Testar no navegador:
- Frontend: `http://bb.seudominio.com` (ou https:// se SSL configurado)
- API: `http://api-bb.seudominio.com/api/health`

---

## 🔄 Deploy de Atualizações Futuras

Quando houver mudanças no código:

```bash
# Conectar ao servidor
ssh root@92.113.38.164

# Ir para o diretório
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

## 📊 Comandos Úteis

```bash
# Ver status do PM2
pm2 status

# Ver logs em tempo real
pm2 logs api-bb-backend

# Reiniciar aplicação
pm2 restart api-bb-backend

# Ver logs do Nginx
tail -f /var/log/nginx/api-bb-error.log
tail -f /var/log/nginx/bb-frontend-error.log

# Ver status do PostgreSQL
systemctl status postgresql

# Ver status do Nginx
systemctl status nginx
```

---

## ⚠️ Troubleshooting

### Backend não inicia:
```bash
pm2 logs api-bb-backend --lines 50
```

### Nginx retorna 502:
```bash
pm2 status  # Verificar se backend está rodando
systemctl status nginx
```

### Erro de conexão com PostgreSQL:
```bash
systemctl status postgresql
PGPASSWORD=AupusStaging2024 psql -U aupus_staging -d aupus_staging -h 127.0.0.1 -c "SELECT 1;"
```

### Porta 3001 já em uso:
```bash
netstat -tulpn | grep 3001
pm2 restart api-bb-backend
```

---

## 🎯 Checklist de Deploy

- [ ] Conectado ao servidor via SSH
- [ ] Node.js, Nginx, PM2 instalados
- [ ] Repositório clonado em /var/www/api-bb
- [ ] Arquivo .env configurado
- [ ] Tabelas do banco criadas
- [ ] npm install executado
- [ ] npm run build executado
- [ ] Nginx configurado com domínios corretos
- [ ] PM2 iniciado e configurado para boot
- [ ] Firewall configurado
- [ ] SSL configurado (HTTPS)
- [ ] Frontend acessível no navegador
- [ ] Backend respondendo requisições

---

**Após deploy concluído, atualizar o sistema de Leituras Python no seu PC para apontar para a nova API:**

```python
# Arquivo de configuração Python:
API_URL = "https://api-bb.seudominio.com"  # Substituir pelo domínio real
```

---

**Boa sorte com o deploy! 🚀**
