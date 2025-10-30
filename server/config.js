// ========================================
// ⚙️ CONFIGURAÇÃO - BANCO DO BRASIL API
// ========================================

// Carregar variáveis de ambiente
require('dotenv').config();

const CONFIG = {
    // ========================================
    // 🔐 CREDENCIAIS DE ACESSO (Carregadas de .env)
    clientId: process.env.BB_CLIENT_ID || 'eyJpZCI6ImMzIiwiY29kaWdvUHVibGljYWRvciI6MCwiY29kaWdvU29mdHdhcmUiOjEyMTQ4NSwic2VxdWVuY2lhbEluc3RhbGFjYW8iOjF9',
    clientSecret: process.env.BB_CLIENT_SECRET || 'eyJpZCI6IjFiNTMxZjktMjZmYi00ZThjLThkZDItN2E1NDU1ODU5ODUzNmNjNjNlNCIsImNvZGlnb1B1YmxpY2Fkb3IiOjAsImNvZGlnb1NvZnR3YXJlIjoxMjE0ODUsInNlcXVlbmNpYWxJbnN0YWxhY2FvIjoxLCJzZXF1ZW5jaWFsQ3JlZGVuY2lhbCI6NCwiYW1iaWVudGUiOiJwcm9kdWNhbyIsImlhdCI6MTc2MTY4NDExNzI3N30',
    developerKey: process.env.BB_DEVELOPER_KEY || '549827f7531a4cdd880437df70bf3d86',

    // ========================================
    // 🏦 DADOS DA CONTA
    // ========================================
    agencia: process.env.BB_AGENCIA || '4148',
    conta: process.env.BB_CONTA || '25651',
    numeroConvenio: parseInt(process.env.BB_CONVENIO) || 3648981,
    
    // ========================================
    // 🌐 URLs DA API
    // ========================================
    oauthURL: '/proxy-oauth/oauth/token',
    apiURL: '/proxy-api',
        
    // ========================================
    // ⚙️ CONFIGURAÇÕES DE BOLETO
    // ========================================
    boleto: {
        numeroCarteira: 17,
        numeroVariacaoCarteira: 19,
        codigoModalidade: 1,
        quantidadeDiasProtesto: 0,
        quantidadeDiasNegativacao: 0,
        orgaoNegativador: 10,
        indicadorAceiteTituloVencido: 'S',
        numeroDiasLimiteRecebimento: 30,
        codigoAceite: 'N',
        codigoTipoTitulo: 2,
        descricaoTipoTitulo: 'DM',
        indicadorPermissaoRecebimentoParcial: 'N',
        indicadorPix: 'S'
    },
    
    // ========================================
    // 🏢 DADOS DO BENEFICIÁRIO (CEDENTE)
    // ========================================
    beneficiario: {
        nome: 'CLUBE AUPUS LTDA',
        cnpj: '51.527.699/0001-83',
        endereco: 'BROOKFIELD TOWERS - Av. Dep. Jamel Cecílio, 2929, - SALA 1013 BLOCO A - Jardim Goiás',
        cidade: 'Goiânia',
        uf: 'GO',
        cep: '74810-100',
        telefone: '(62) 99654-7888',
        email: 'financeiro@aupusenergia.com.br',
        site: 'https://aupusenergia.com.br/'
    },
    
    // ========================================
    // 🎨 CONFIGURAÇÕES DA INTERFACE
    // ========================================
    interface: {
        titulo: 'Banco do Brasil - Gerador de Boletos',
        versao: '2.0.0',
        autor: 'Sistema Corrigido',
        diasVencimentoPadrao: 7
    },
    
    // ========================================
    // 📊 CONFIGURAÇÕES DE DEBUG
    // ========================================
    debug: {
        logRequests: true,
        logResponses: true,
        logErrors: true,
        mostrarDadosCompletos: false
    }
};

// ========================================
// 🔧 VALIDAÇÃO DA CONFIGURAÇÃO
// ========================================
function validarConfiguracao() {
    const camposObrigatorios = [
        'clientId',
        'clientSecret', 
        'developerKey',
        'agencia',
        'conta',
        'numeroConvenio'
    ];
    
    const camposFaltantes = [];
    
    camposObrigatorios.forEach(campo => {
        if (!CONFIG[campo]) {
            camposFaltantes.push(campo);
        }
    });
    
    if (camposFaltantes.length > 0) {
        console.error('❌ Configuração inválida! Campos faltantes:', camposFaltantes);
        return false;
    }
    
    console.log('✅ Configuração validada com sucesso!');
    return true;
}

// ========================================
// 📋 INFORMAÇÕES DA CONFIGURAÇÃO
// ========================================
function exibirInfoConfiguracao() {
    console.log('🏦 === CONFIGURAÇÃO BANCO DO BRASIL ===');
    console.log(`🏛️ Agência: ${CONFIG.agencia}`);
    console.log(`💳 Conta: ${CONFIG.conta}`);
    console.log(`📄 Convênio: ${CONFIG.numeroConvenio}`);
    console.log(`🎯 Carteira: ${CONFIG.boleto.numeroCarteira}/${CONFIG.boleto.numeroVariacaoCarteira}`);
    console.log(`💳 PIX: ${CONFIG.boleto.indicadorPix === 'S' ? 'Habilitado' : 'Desabilitado'}`);
    console.log(`🌐 Ambiente: ${CONFIG.apiURL.includes('sandbox') ? 'SANDBOX' : 'PRODUÇÃO'}`);
    console.log('=======================================');
}

// ========================================
// 🛠️ FUNÇÕES UTILITÁRIAS
// ========================================
function obterConfiguracaoBoleto() {
    return {
        ...CONFIG.boleto,
        numeroConvenio: CONFIG.numeroConvenio
    };
}

function obterCredenciais() {
    return {
        clientId: CONFIG.clientId,
        clientSecret: CONFIG.clientSecret,
        developerKey: CONFIG.developerKey
    };
}

function obterDadosConta() {
    return {
        agencia: CONFIG.agencia,
        conta: CONFIG.conta,
        numeroConvenio: CONFIG.numeroConvenio
    };
}

function obterURLs() {
    return {
        oauth: CONFIG.oauthURL,
        api: CONFIG.apiURL
    };
}

// ========================================
// 🚀 INICIALIZAÇÃO
// ========================================
if (typeof window !== 'undefined') {
    // Ambiente do navegador
    window.CONFIG = CONFIG;
    window.validarConfiguracao = validarConfiguracao;
    window.exibirInfoConfiguracao = exibirInfoConfiguracao;
    
    console.log('🌐 Configuração carregada no navegador');
} else if (typeof module !== 'undefined' && module.exports) {
    // Ambiente Node.js
    module.exports = {
        CONFIG,
        validarConfiguracao,
        exibirInfoConfiguracao,
        obterConfiguracaoBoleto,
        obterCredenciais,
        obterDadosConta,
        obterURLs
    };
    
    console.log('🖥️ Configuração carregada no Node.js');
}

// Validar automaticamente
validarConfiguracao();