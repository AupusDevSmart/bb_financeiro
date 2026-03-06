// ========================================
// API PAGAMENTOS EM LOTE - BANCO DO BRASIL
// ========================================
// Integração para pagamento de boletos (contas de energia EQTL)

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Carregar variáveis de ambiente
require('dotenv').config();

// ========================================
// CONFIGURAÇÕES
// ========================================
const CONFIG_PAG = {
    // Credenciais da API de Pagamentos em Lote
    appKey: process.env.BB_PAG_APP_KEY,
    clientId: process.env.BB_PAG_CLIENT_ID,
    clientSecret: process.env.BB_PAG_CLIENT_SECRET,
    // Basic Token calculado dinamicamente (clientId:clientSecret em base64)
    get basicToken() {
        return Buffer.from(this.clientId + ':' + this.clientSecret).toString('base64');
    },
    appId: process.env.BB_PAG_APP_ID,

    // Dados da conta para débito
    agencia: parseInt(process.env.BB_AGENCIA) || 4148,
    conta: parseInt(process.env.BB_CONTA) || 25651,
    digitoConta: process.env.BB_CONTA_DIGITO || 'X', // Dígito verificador da conta

    // Contrato de pagamento (deve ser obtido no Portal BB)
    codigoContrato: parseInt(process.env.BB_PAG_CONTRATO) || 0,

    // URLs da API
    urls: {
        // Produção
        api: 'https://api-ip.bb.com.br/pagamentos-lote/v1',
        oauth: 'https://oauth.bb.com.br/oauth/token',
        // Homologação
        apiHomolog: 'https://api.hm.bb.com.br/pagamentos-lote/v1',
        oauthHomolog: 'https://oauth.hm.bb.com.br/oauth/token'
    },

    // Usar ambiente de homologação? (para testes)
    usarHomologacao: process.env.BB_PAG_HOMOLOGACAO === 'true',

    // Caminho para certificado A1 (obrigatório para produção)
    certificadoPath: process.env.BB_PAG_CERTIFICADO_PATH || ''
    // Senha do certificado deve ser informada a cada envio via interface
};

// Cache do token
let tokenCache = {
    accessToken: null,
    expiresAt: null
};

// ========================================
// FUNÇÕES AUXILIARES
// ========================================

/**
 * Obtém o agente HTTPS com certificado PEM
 * Certificados armazenados em /etc/ssl/private/aupus-bb/ (acesso restrito)
 */
function getHttpsAgent() {
    // Usar arquivos PEM (extraídos do PFX, não precisam de senha)
    const certDir = path.dirname(CONFIG_PAG.certificadoPath);
    const pemCert = path.join(certDir, 'cert.pem');
    const pemKey = path.join(certDir, 'key.pem');

    if (fs.existsSync(pemCert) && fs.existsSync(pemKey)) {
        console.log('🔐 Usando certificado PEM para autenticação mútua');
        const cert = fs.readFileSync(pemCert);
        const key = fs.readFileSync(pemKey);
        return new https.Agent({
            cert: cert,
            key: key,
            rejectUnauthorized: true
        });
    }

    // Sem certificado - erro
    throw new Error('Certificados PEM não encontrados em ' + certDir);
}

/**
 * Obtém a URL base da API
 */
function getApiUrl() {
    return CONFIG_PAG.usarHomologacao ? CONFIG_PAG.urls.apiHomolog : CONFIG_PAG.urls.api;
}

/**
 * Obtém a URL do OAuth
 */
function getOAuthUrl() {
    return CONFIG_PAG.usarHomologacao ? CONFIG_PAG.urls.oauthHomolog : CONFIG_PAG.urls.oauth;
}

/**
 * Obtém token de acesso OAuth2 (Client Credentials)
 */
async function obterToken() {
    // Verificar se token em cache ainda é válido
    if (tokenCache.accessToken && tokenCache.expiresAt && new Date() < tokenCache.expiresAt) {
        console.log('Usando token em cache');
        return tokenCache.accessToken;
    }

    console.log('Obtendo novo token OAuth...');

    const url = getOAuthUrl();
    const basicAuth = CONFIG_PAG.basicToken;

    try {
        const response = await axios.post(url,
            'grant_type=client_credentials&scope=pagamentos-lote.boletos-requisicao pagamentos-lote.boletos-info pagamentos-lote.cancelar-requisicao',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${basicAuth}`
                },
                httpsAgent: getHttpsAgent()
            }
        );

        const { access_token, expires_in } = response.data;

        // Armazenar em cache (com margem de 60 segundos)
        tokenCache.accessToken = access_token;
        tokenCache.expiresAt = new Date(Date.now() + (expires_in - 60) * 1000);

        console.log('Token obtido com sucesso');
        return access_token;

    } catch (error) {
        console.error('Erro ao obter token:', error.response?.data || error.message);
        throw new Error('Falha na autenticação OAuth: ' + (error.response?.data?.error_description || error.message));
    }
}

/**
 * Converte linha digitável (47 dígitos) para código de barras (44 dígitos)
 *
 * Estrutura da linha digitável de boleto bancário:
 * AAABC.CCCCX DDDDD.DDDDDX EEEEE.EEEEEX F GGGGHHHHHHHHHH
 *
 * Onde:
 * - AAA = Código do banco (001 para BB)
 * - B = Código da moeda (9 = Real)
 * - CCCCC = 5 primeiros dígitos do campo livre
 * - X = DV do primeiro campo
 * - DDDDDDDDDD = 10 dígitos seguintes do campo livre
 * - X = DV do segundo campo
 * - EEEEEEEEEE = 10 últimos dígitos do campo livre
 * - X = DV do terceiro campo
 * - F = DV geral do código de barras
 * - GGGG = Fator de vencimento
 * - HHHHHHHHHH = Valor (10 dígitos)
 */
function linhaDigitavelParaCodigoBarras(linhaDigitavel) {
    // Remover caracteres não numéricos
    const linha = linhaDigitavel.replace(/\D/g, '');

    // Se já tem 44 dígitos, é código de barras
    if (linha.length === 44) {
        return linha;
    }

    // Se tem 47 dígitos, é linha digitável de boleto bancário
    if (linha.length === 47) {
        // Estrutura do código de barras (44 dígitos):
        // AAABKUUUUVVVVVVVVVVCCCCCCCCCCCCCCCCCCCCCCCCC
        // AAA = banco, B = moeda, K = DV, UUUU = fator vencimento
        // VVVVVVVVVV = valor, C = campo livre (25 dígitos)

        const banco = linha.substring(0, 3);        // Posição 1-3 da linha
        const moeda = linha.substring(3, 4);         // Posição 4 da linha
        const dvGeral = linha.substring(32, 33);     // Posição 33 (DV geral)
        const fatorVenc = linha.substring(33, 37);   // Posição 34-37
        const valor = linha.substring(37, 47);       // Posição 38-47

        // Campo livre (25 dígitos) extraído da linha digitável
        const campoLivre =
            linha.substring(4, 9) +     // 5 primeiros do campo 1 (pos 5-9)
            linha.substring(10, 20) +   // Campo 2 completo (pos 11-20, ignorando DV na pos 10)
            linha.substring(21, 31);    // Campo 3 completo (pos 22-31, ignorando DV na pos 21)

        // Montar código de barras: banco + moeda + DV + fator + valor + campo livre
        const codigoBarras = banco + moeda + dvGeral + fatorVenc + valor + campoLivre;

        return codigoBarras;
    }

    // Se tem 48 dígitos, é código de barras de conta de consumo/concessionária
    if (linha.length === 48) {
        // Para contas de concessionária, retornar apenas os 44 primeiros
        // (removendo os dígitos verificadores dos campos)
        const campo1 = linha.substring(0, 11);
        const campo2 = linha.substring(12, 23);
        const campo3 = linha.substring(24, 35);
        const campo4 = linha.substring(36, 47);

        return campo1 + campo2.substring(0, 11) + campo3.substring(0, 11) + campo4.substring(0, 11);
    }

    throw new Error(`Formato de código de barras inválido. Esperado 44 ou 47 dígitos, recebido ${linha.length}`);
}

/**
 * Converte data para formato DDMMAAAA (inteiro)
 */
function formatarDataPagamento(data) {
    const d = new Date(data);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return parseInt(`${dia}${mes}${ano}`);
}

/**
 * Gera número único de requisição
 */
function gerarNumeroRequisicao() {
    // Gerar número sequencial único (máximo 7 dígitos para API BB)
    // Usando timestamp reduzido para garantir unicidade
    const now = Date.now();
    // Pegar os últimos 6 dígitos do timestamp + 1 dígito aleatório = 7 dígitos
    return parseInt(String(now).slice(-6) + Math.floor(Math.random() * 10));
}

// ========================================
// FUNÇÕES PRINCIPAIS DA API
// ========================================

/**
 * Efetua pagamento de boleto em lote
 *
 * @param {Object} dadosPagamento - Dados do pagamento
 * @param {string} dadosPagamento.codigoBarras - Código de barras ou linha digitável
 * @param {Date} dadosPagamento.dataPagamento - Data do pagamento
 * @param {number} dadosPagamento.valorPagamento - Valor a pagar
 * @param {string} dadosPagamento.descricao - Descrição do pagamento (max 40 chars)
 * @param {number} dadosPagamento.valorNominal - Valor original do boleto
 * @param {string} dadosPagamento.documentoBeneficiario - CPF ou CNPJ do beneficiário
 */
async function efetuarPagamentoBoleto(dadosPagamento) {
    console.log('Iniciando pagamento de boleto via API BB...');
    console.log('Dados recebidos:', JSON.stringify(dadosPagamento, null, 2));

    // Validar dados obrigatórios
    if (!dadosPagamento.codigoBarras) {
        throw new Error('Código de barras é obrigatório');
    }
    if (!dadosPagamento.valorPagamento || dadosPagamento.valorPagamento <= 0) {
        throw new Error('Valor do pagamento deve ser maior que zero');
    }
    if (!dadosPagamento.documentoBeneficiario) {
        throw new Error('Documento do beneficiário é obrigatório');
    }

    // Converter linha digitável para código de barras se necessário
    const codigoBarras = linhaDigitavelParaCodigoBarras(dadosPagamento.codigoBarras);
    console.log('Código de barras formatado:', codigoBarras);

    // Determinar tipo de documento do beneficiário
    const docBeneficiario = dadosPagamento.documentoBeneficiario.replace(/\D/g, '');
    const tipoDocBeneficiario = docBeneficiario.length === 11 ? 1 : 2; // 1=CPF, 2=CNPJ

    // Obter token de acesso
    const token = await obterToken();

    // Montar payload da requisição
    // Nota: dígito pode ser número ou 'X' (que vira 10 em alguns casos)
    let digitoConta = CONFIG_PAG.digitoConta;
    if (digitoConta === 'X' || digitoConta === 'x') {
        digitoConta = 'X'; // Manter como string 'X'
    }

    const payload = {
        numeroRequisicao: gerarNumeroRequisicao(),
        codigoContrato: CONFIG_PAG.codigoContrato,
        numeroAgenciaDebito: CONFIG_PAG.agencia,
        numeroContaCorrenteDebito: CONFIG_PAG.conta,
        digitoVerificadorContaCorrenteDebito: digitoConta,
        lancamentos: [{
            numeroCodigoBarras: codigoBarras,
            dataPagamento: formatarDataPagamento(dadosPagamento.dataPagamento || new Date()),
            valorPagamento: dadosPagamento.valorPagamento,
            descricaoPagamento: (dadosPagamento.descricao || 'Pagamento de conta').substring(0, 40),
            valorNominal: dadosPagamento.valorNominal || dadosPagamento.valorPagamento,
            codigoTipoBeneficiario: tipoDocBeneficiario,
            documentoBeneficiario: parseInt(docBeneficiario)
        }]
    };

    console.log('Payload da requisição:', JSON.stringify(payload, null, 2));

    // Fazer requisição para API
    const url = `${getApiUrl()}/lotes-boletos?gw-dev-app-key=${CONFIG_PAG.appKey}`;

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            httpsAgent: getHttpsAgent()
        });

        console.log('Resposta da API BB:', JSON.stringify(response.data, null, 2));

        return {
            sucesso: true,
            dados: response.data,
            mensagem: 'Pagamento enviado com sucesso'
        };

    } catch (error) {
        console.error('Erro na API BB:', error.response?.data || error.message);

        const erroMsg = error.response?.data?.erros?.[0]?.mensagem
            || error.response?.data?.message
            || error.message;

        return {
            sucesso: false,
            erro: erroMsg,
            detalhes: error.response?.data
        };
    }
}

/**
 * Consulta status de um lote de pagamentos de boletos
 *
 * @param {number} idLote - ID do lote retornado na criação
 */
async function consultarLoteBoletos(idLote) {
    console.log('Consultando lote de boletos:', idLote);

    const token = await obterToken();
    const url = `${getApiUrl()}/lotes-boletos/${idLote}/solicitacao?gw-dev-app-key=${CONFIG_PAG.appKey}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            httpsAgent: getHttpsAgent(),
            params: {
                numeroAgenciaDebito: CONFIG_PAG.agencia,
                numeroContaCorrenteDebito: CONFIG_PAG.conta,
                digitoVerificadorContaCorrenteDebito: CONFIG_PAG.digitoConta
            }
        });

        return {
            sucesso: true,
            dados: response.data
        };

    } catch (error) {
        console.error('Erro ao consultar lote:', error.response?.data || error.message);
        return {
            sucesso: false,
            erro: error.response?.data?.erros?.[0]?.mensagem || error.message
        };
    }
}

/**
 * Consulta um pagamento específico de boleto
 *
 * @param {number} idPagamento - ID do pagamento retornado na criação
 */
async function consultarPagamentoBoleto(idPagamento) {
    console.log('Consultando pagamento de boleto:', idPagamento);

    const token = await obterToken();
    const url = `${getApiUrl()}/boletos/${idPagamento}?gw-dev-app-key=${CONFIG_PAG.appKey}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            httpsAgent: getHttpsAgent()
        });

        return {
            sucesso: true,
            dados: response.data
        };

    } catch (error) {
        console.error('Erro ao consultar pagamento:', error.response?.data || error.message);
        return {
            sucesso: false,
            erro: error.response?.data?.erros?.[0]?.mensagem || error.message
        };
    }
}

/**
 * Libera pagamentos de um lote (após criação)
 *
 * @param {number} numeroRequisicao - Número da requisição a liberar
 */
async function liberarPagamentos(numeroRequisicao) {
    console.log('Liberando pagamentos da requisição:', numeroRequisicao);

    const token = await obterToken();
    const url = `${getApiUrl()}/liberar-pagamentos?gw-dev-app-key=${CONFIG_PAG.appKey}`;

    const payload = {
        numeroRequisicao: numeroRequisicao,
        numeroAgenciaDebito: CONFIG_PAG.agencia,
        numeroContaCorrenteDebito: CONFIG_PAG.conta,
        digitoVerificadorContaCorrenteDebito: CONFIG_PAG.digitoConta
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            httpsAgent: getHttpsAgent()
        });

        return {
            sucesso: true,
            dados: response.data,
            mensagem: 'Pagamentos liberados com sucesso'
        };

    } catch (error) {
        console.error('Erro ao liberar pagamentos:', error.response?.data || error.message);
        return {
            sucesso: false,
            erro: error.response?.data?.erros?.[0]?.mensagem || error.message
        };
    }
}

/**
 * Cancela um pagamento pendente na API do BB
 * Funciona apenas para pagamentos que ainda não foram processados/debitados
 *
 * @param {string|number} codigoPagamento - ID do pagamento retornado pelo BB (id_pagamento_bb)
 */
async function cancelarPagamento(codigoPagamento) {
    console.log('Cancelando pagamento:', codigoPagamento);

    const token = await obterToken();

    // Endpoint correto para cancelar pagamentos: POST /cancelar-pagamentos
    const url = `${getApiUrl()}/cancelar-pagamentos?gw-dev-app-key=${CONFIG_PAG.appKey}`;

    const payload = {
        agenciaDebito: CONFIG_PAG.agencia,
        contaCorrenteDebito: CONFIG_PAG.conta,
        digitoVerificadorContaCorrente: CONFIG_PAG.digitoConta,
        numeroContratoPagamento: CONFIG_PAG.codigoContrato,
        listaPagamentos: [
            {
                codigoPagamento: String(codigoPagamento)
            }
        ]
    };

    console.log('Payload cancelamento:', JSON.stringify(payload, null, 2));

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            httpsAgent: getHttpsAgent()
        });

        console.log('Resposta do cancelamento:', JSON.stringify(response.data, null, 2));

        // Verificar se o pagamento foi cancelado
        const pagamentoCancelado = response.data?.pagamentos?.[0];
        if (pagamentoCancelado?.indicadorCancelamento === 'S') {
            return {
                sucesso: true,
                dados: response.data,
                mensagem: 'Pagamento cancelado com sucesso'
            };
        } else {
            const erroMsg = pagamentoCancelado?.mensagemRetorno
                || pagamentoCancelado?.estadoCancelamento
                || 'Pagamento não foi cancelado';
            const estadoBB = pagamentoCancelado?.estadoPagamento;
            const jaProcessada = estadoBB === 'BLOQUEADO' || estadoBB === 'PROCESSADO' || estadoBB === 'LIQUIDADO';
            return {
                sucesso: false,
                erro: erroMsg,
                jaProcessada,
                estadoBB,
                dados: response.data
            };
        }

    } catch (error) {
        console.error('Erro ao cancelar pagamento:', error.response?.data || error.message);

        const erroMsg = error.response?.data?.erros?.[0]?.mensagem
            || error.response?.data?.message
            || error.message;

        // Verificar se o erro é porque já foi processada
        const jaProcessada = erroMsg.toLowerCase().includes('processad') ||
                            erroMsg.toLowerCase().includes('debitad') ||
                            erroMsg.toLowerCase().includes('efetivad') ||
                            erroMsg.toLowerCase().includes('liquidado');

        return {
            sucesso: false,
            erro: erroMsg,
            jaProcessada: jaProcessada,
            detalhes: error.response?.data
        };
    }
}

// Alias para compatibilidade
const baixarRequisicao = cancelarPagamento;

// ========================================
// EXPORTAÇÕES
// ========================================
module.exports = {
    CONFIG_PAG,
    obterToken,
    efetuarPagamentoBoleto,
    consultarLoteBoletos,
    consultarPagamentoBoleto,
    liberarPagamentos,
    cancelarPagamento,
    baixarRequisicao, // alias para cancelarPagamento (compatibilidade)
    linhaDigitavelParaCodigoBarras,
    formatarDataPagamento
};
