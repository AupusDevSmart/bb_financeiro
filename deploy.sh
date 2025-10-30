#!/bin/bash

# =====================================================
# Script de Deploy - API BB Sistema de Boletos
# =====================================================

echo "🚀 Iniciando deploy da API BB..."

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Diretório da aplicação
APP_DIR="/var/www/api-bb"

# Função para exibir erros
error_exit() {
    echo -e "${RED}❌ ERRO: $1${NC}" 1>&2
    exit 1
}

# Função para exibir sucesso
success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Função para exibir avisos
warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 1. Atualizar código do repositório
echo ""
echo "📥 Atualizando código do Git..."
cd $APP_DIR || error_exit "Diretório $APP_DIR não encontrado"
git pull origin main || error_exit "Falha ao atualizar código do Git"
success "Código atualizado com sucesso"

# 2. Instalar dependências
echo ""
echo "📦 Instalando dependências..."
npm install --production || error_exit "Falha ao instalar dependências"
success "Dependências instaladas"

# 3. Build do frontend React
echo ""
echo "🏗️  Building frontend React..."
npm run build || error_exit "Falha no build do frontend"
success "Frontend compilado com sucesso"

# 4. Verificar se .env existe
echo ""
if [ ! -f .env ]; then
    warning "Arquivo .env não encontrado!"
    echo "Por favor, crie o arquivo .env baseado em .env.production"
    error_exit "Configure o arquivo .env antes de continuar"
fi
success "Arquivo .env encontrado"

# 5. Criar diretório de logs se não existir
mkdir -p logs
success "Diretório de logs criado/verificado"

# 6. Reiniciar aplicação com PM2
echo ""
echo "🔄 Reiniciando aplicação..."
pm2 restart ecosystem.config.js --update-env || pm2 start ecosystem.config.js
success "Aplicação reiniciada"

# 7. Salvar configuração do PM2
pm2 save
success "Configuração do PM2 salva"

# 8. Mostrar status
echo ""
echo "📊 Status da aplicação:"
pm2 status

echo ""
success "🎉 Deploy concluído com sucesso!"
echo ""
echo "Para ver os logs:"
echo "  pm2 logs api-bb-backend"
echo ""
echo "Para monitorar:"
echo "  pm2 monit"
echo ""
