# 📋 Próximos Passos - Deploy Sistema BB

## ✅ O que já foi feito:

1. ✅ Projeto preparado para produção
2. ✅ Variáveis de ambiente configuradas (`.env`)
3. ✅ Git inicializado e commit feito
4. ✅ Scripts de deploy criados
5. ✅ Configurações do Nginx prontas
6. ✅ Configuração do PM2 pronta
7. ✅ Documentação completa criada

---

## 🚀 Passo 1: Fazer Push para o GitHub

**No seu PC (Windows), executar:**

```bash
git push -u origin main --force
```

> **Nota:** O `--force` é necessário porque vamos substituir todo o conteúdo do repositório existente.

Você precisará autenticar com suas credenciais do GitHub (FagginAupus).

---

## 🖥️ Passo 2: Conectar ao Servidor VPS

```bash
ssh root@92.113.38.164
```

---

## 📦 Passo 3: Instalar Dependências do Sistema

Execute os comandos abaixo **no servidor VPS**:

```bash
# Atualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verificar instalação
node --version  # Deve mostrar v18.x ou superior
npm --version

# Instalar PostgreSQL
apt install -y postgresql postgresql-contrib

# Instalar Nginx
apt install -y nginx

# Instalar PM2 globalmente
npm install -g pm2

# Instalar Git
apt install -y git

# Instalar Certbot (para SSL)
apt install -y certbot python3-certbot-nginx
```

---

## 🗄️ Passo 4: Verificar PostgreSQL (Já configurado!)

✅ **O PostgreSQL já está instalado e configurado no servidor!**

Vamos usar o banco existente:
- **Host:** 127.0.0.1
- **Porta:** 5432
- **Database:** aupus_staging
- **Username:** aupus_staging
- **Password:** AupusStaging2024

**Apenas verificar se o PostgreSQL está rodando:**

```bash
systemctl status postgresql
```

Se não estiver rodando:
```bash
systemctl start postgresql
systemctl enable postgresql
```

---

## 📥 Passo 5: Clonar Repositório no Servidor

```bash
# Criar diretório
mkdir -p /var/www
cd /var/www

# Clonar repositório
git clone https://github.com/FagginAupus/API-BB.git api-bb

# Entrar no diretório
cd api-bb

# Verificar se está correto
ls -la
```

---

## ⚙️ Passo 6: Configurar Variáveis de Ambiente

```bash
# Copiar arquivo de exemplo
cp .env.production .env

# Editar com nano
nano .env
```

**Configurar as seguintes variáveis:**

```env
# Banco de Dados (já existente no servidor)
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=aupus_staging
DB_USERNAME=aupus_staging
DB_PASSWORD=AupusStaging2024

# Banco do Brasil (mesmas credenciais atuais)
BB_CLIENT_ID=eyJpZCI6ImMzIiwiY29kaWdvUHVibGljYWRvciI6MCwiY29kaWdvU29mdHdhcmUiOjEyMTQ4NSwic2VxdWVuY2lhbEluc3RhbGFjYW8iOjF9
BB_CLIENT_SECRET=eyJpZCI6IjFiNTMxZjktMjZmYi00ZThjLThkZDItN2E1NDU1ODU5ODUzNmNjNjNlNCIsImNvZGlnb1B1YmxpY2Fkb3IiOjAsImNvZGlnb1NvZnR3YXJlIjoxMjE0ODUsInNlcXVlbmNpYWxJbnN0YWxhY2FvIjoxLCJzZXF1ZW5jaWFsQ3JlZGVuY2lhbCI6NCwiYW1iaWVudGUiOiJwcm9kdWNhbyIsImlhdCI6MTc2MTY4NDExNzI3N30
BB_DEVELOPER_KEY=549827f7531a4cdd880437df70bf3d86
BB_AGENCIA=4148
BB_CONTA=25651
BB_CONVENIO=3648981

# Servidor
NODE_ENV=production
PORT=3001
```

Salvar com `Ctrl+O`, Enter, `Ctrl+X`.

---

## 📦 Passo 7: Instalar Dependências e Build

```bash
# Instalar dependências
npm install --production

# Build do frontend React
npm run build

# Criar diretório de logs
mkdir -p logs
```

---

## 🌐 Passo 8: Configurar Nginx

**Importante:** Substitua `seudominio.com` pelo seu domínio real!

```bash
# Editar o arquivo de configuração
nano nginx-config.conf
```

Substituir todas as ocorrências de `seudominio.com` pelo seu domínio real (ex: `aupusenergia.com.br`).

```bash
# Copiar para sites-available
cp nginx-config.conf /etc/nginx/sites-available/api-bb

# Criar symlink
ln -s /etc/nginx/sites-available/api-bb /etc/nginx/sites-enabled/

# Remover configuração padrão
rm /etc/nginx/sites-enabled/default

# Testar configuração
nginx -t

# Se ok, reiniciar Nginx
systemctl restart nginx
systemctl enable nginx
```

---

## 🔥 Passo 9: Iniciar Aplicação com PM2

```bash
# Dar permissão ao script de deploy
chmod +x deploy.sh

# Iniciar aplicação
pm2 start ecosystem.config.js

# Configurar para iniciar no boot
pm2 startup
# Copiar e executar o comando que aparecer

pm2 save

# Verificar status
pm2 status
pm2 logs api-bb-backend
```

---

## 🔒 Passo 10: Configurar SSL (HTTPS) - IMPORTANTE!

```bash
# Obter certificado SSL (substitua pelos seus domínios)
certbot --nginx -d bb.aupusenergia.com.br -d api-bb.aupusenergia.com.br

# Seguir as instruções do Certbot
# Escolher opção 2 (redirect HTTP to HTTPS)
```

O Certbot irá:
- Obter certificados SSL gratuitos
- Configurar renovação automática
- Atualizar automaticamente o Nginx

---

## 🔥 Passo 11: Configurar Firewall

```bash
# Permitir SSH, HTTP e HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Verificar status
ufw status
```

---

## ✅ Passo 12: Testar a Aplicação

### Testar Backend:
```bash
curl http://localhost:3001/api/health
```

### Testar Frontend:
Abra no navegador:
- `http://bb.aupusenergia.com.br` (ou seu domínio)
- `http://api-bb.aupusenergia.com.br` (ou seu domínio)

Se SSL configurado:
- `https://bb.aupusenergia.com.br`
- `https://api-bb.aupusenergia.com.br`

---

## 📊 Comandos Úteis

### Ver logs em tempo real:
```bash
pm2 logs api-bb-backend
```

### Ver status:
```bash
pm2 status
```

### Reiniciar aplicação:
```bash
pm2 restart api-bb-backend
```

### Ver logs do Nginx:
```bash
tail -f /var/log/nginx/api-bb-error.log
tail -f /var/log/nginx/bb-frontend-error.log
```

---

## 🔄 Deploy de Atualizações Futuras

Quando fizer mudanças no código:

**No seu PC:**
```bash
git add .
git commit -m "Descrição das mudanças"
git push origin main
```

**No servidor:**
```bash
cd /var/www/api-bb
./deploy.sh
```

---

## 🖥️ Passo 13: Atualizar Sistema de Leituras Local

No seu PC, no sistema Python de leituras, atualizar a URL da API:

**Arquivo de configuração Python:**
```python
# Antes:
API_URL = "http://localhost:3001"

# Depois:
API_URL = "https://api-bb.aupusenergia.com.br"
```

---

## ⚠️ Troubleshooting

### Erro ao conectar no PostgreSQL:
```bash
systemctl status postgresql
sudo -u postgres psql -c "SELECT version();"
```

### Backend não inicia:
```bash
pm2 logs api-bb-backend --lines 50
```

### Nginx retorna 502:
```bash
pm2 status  # Verificar se backend está rodando
systemctl status nginx
tail -f /var/log/nginx/error.log
```

### Porta 3001 já em uso:
```bash
netstat -tulpn | grep 3001
pm2 delete all
pm2 start ecosystem.config.js
```

---

## 📞 Resumo dos Domínios

Certifique-se de que no seu provedor de DNS você tem:

| Tipo | Nome    | Valor          |
|------|---------|----------------|
| A    | bb      | 92.113.38.164  |
| A    | api-bb  | 92.113.38.164  |

---

## ✅ Checklist Final

- [ ] Push feito para GitHub
- [ ] Servidor VPS acessível via SSH
- [ ] Node.js 18+ instalado
- [ ] PostgreSQL instalado e configurado
- [ ] Nginx instalado e configurado
- [ ] PM2 instalado
- [ ] Repositório clonado em `/var/www/api-bb`
- [ ] Arquivo `.env` configurado
- [ ] Tabelas do banco criadas
- [ ] `npm install` executado
- [ ] `npm run build` executado
- [ ] Aplicação rodando com PM2
- [ ] Nginx configurado e rodando
- [ ] SSL configurado (HTTPS)
- [ ] Firewall configurado
- [ ] Frontend acessível no navegador
- [ ] Backend respondendo requisições
- [ ] Sistema de Leituras apontando para nova API

---

**Boa sorte com o deploy! 🚀**
