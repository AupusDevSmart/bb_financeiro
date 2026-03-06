// ========================================
// 🖥️ SERVIDOR WEB - BANCO DO BRASIL API (VERSÃO HÍBRIDA FUNCIONAL)
// ========================================

// Carregar variáveis de ambiente
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { gerarPDFBoleto, gerarPDFBoletoCogeracao } = require('./pdfGenerator');
const {
    criarTabelaSeNaoExistir,
    inserirOuAtualizarBoleto,
    atualizarBoletoParcial,
    listarBoletos,
    atualizarStatusBoleto,
    buscarBoleto,
    deletarBoleto,
    buscarBoletoPorNumero,
    atualizarStatusBoletoPorNumero,
    pool,
    // Controle de envios
    criarTabelaEnviosSeNaoExistir,
    registrarEnvio,
    verificarEnvioExistente,
    listarEnvios,
    // Status de envio de boletos
    sincronizarStatusEnviosBoletos,
    // Persistência dados BB
    salvarRespostaBB,
    buscarRespostaBBSalva
} = require('./database');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Módulo de Pagamentos em Lote do Banco do Brasil
const {
    efetuarPagamentoBoleto,
    consultarLoteBoletos,
    consultarPagamentoBoleto,
    liberarPagamentos,
    baixarRequisicao,
    CONFIG_PAG
} = require('./pagamentosLoteBB');
const { enviarLancamentoControl, enviarBoletoControl, cancelarLancamentoControl, pagarLancamentoControl, estornarPagamentoControl } = require('./lancamentoControl');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// 🔧 CORS PERMISSIVO COMO NO BACKUP QUE FUNCIONAVA
// ========================================
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['*'],
    exposedHeaders: ['content-disposition']
}));

// Headers adicionais para CORS (do backup)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Expose-Headers', 'content-disposition');
    next();
});

// ========================================
// 📁 SERVIR ARQUIVOS ESTÁTICOS (CORRIGIDO)
// ========================================
// Primeiro, verificar se existe pasta public
const publicPath = path.join(__dirname, '..', 'build');
const hasPublicFolder = fs.existsSync(publicPath);

if (hasPublicFolder) {
    console.log('📁 Servindo arquivos da pasta build/');
    app.use(express.static(publicPath));
} else {
    console.log('📁 Servindo arquivos da pasta raiz');
    app.use(express.static(__dirname));
}

// ========================================
// 📄 MIDDLEWARE JSON
// ========================================
app.use(express.json({ limit: '10mb', charset: 'utf-8' }));
app.use(express.urlencoded({ extended: true, limit: '10mb', charset: 'utf-8' }));

// ========================================
// 📡 LOG DE REQUISIÇÕES (MANTENDO O SEU)
// ========================================
app.use((req, res, next) => {
    const timestamp = new Date().toLocaleString('pt-BR');
    console.log(`📡 ${timestamp} - ${req.method} ${req.url}`);
    next();
});

// Log detalhado para API (do backup)
app.use((req, res, next) => {
    if (req.url.startsWith('/proxy-api') && req.method === 'POST') {
        console.log('🔍 POST Request Details:', {
            url: req.url,
            method: req.method,
            contentLength: req.headers['content-length'],
            contentType: req.headers['content-type'],
            authorization: req.headers.authorization ? 'PRESENT' : 'MISSING',
            developerKey: req.headers['x-application-key'] ? 'PRESENT' : 'MISSING'
        });
    }
    next();
});

// ========================================
// 🔤 FUNÇÃO AUXILIAR - NORMALIZAR TEXTO (REMOVER ACENTOS)
// ========================================
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ========================================
// 🔍 FUNÇÃO AUXILIAR - BUSCAR ARQUIVO COM FALLBACK DE ACENTOS
// Tenta encontrar arquivo mesmo com variações de acentos
// ========================================
function buscarArquivoComFallback(diretorio, nomeArquivoBuscado) {
    // Se o arquivo existe exatamente como pedido, retornar
    const caminhoExato = path.join(diretorio, nomeArquivoBuscado);
    if (fs.existsSync(caminhoExato)) {
        return { encontrado: true, caminho: caminhoExato, nomeReal: nomeArquivoBuscado };
    }

    // Se o diretório não existe, retornar não encontrado
    if (!fs.existsSync(diretorio)) {
        return { encontrado: false, caminho: caminhoExato, nomeReal: nomeArquivoBuscado };
    }

    // Extrair UC do nome do arquivo (padrão: "... - UCNUMBER - Nome.pdf")
    const ucMatch = nomeArquivoBuscado.match(/(\d{8,11})/);
    const uc = ucMatch ? ucMatch[1] : null;

    // Listar arquivos do diretório
    const arquivos = fs.readdirSync(diretorio);

    // Normalizar nome buscado (sem acentos, minúsculo)
    const nomeBuscadoNormalizado = normalizarTexto(nomeArquivoBuscado);

    for (const arquivo of arquivos) {
        // Se tem UC, verificar se o arquivo contém essa UC
        if (uc && arquivo.includes(uc)) {
            const caminhoEncontrado = path.join(diretorio, arquivo);
            if (fs.statSync(caminhoEncontrado).isFile()) {
                console.log(`   🔍 Arquivo encontrado por UC: ${arquivo}`);
                return { encontrado: true, caminho: caminhoEncontrado, nomeReal: arquivo };
            }
        }

        // Comparar versões normalizadas (sem acentos)
        const arquivoNormalizado = normalizarTexto(arquivo);
        if (arquivoNormalizado === nomeBuscadoNormalizado) {
            const caminhoEncontrado = path.join(diretorio, arquivo);
            console.log(`   🔍 Arquivo encontrado por normalização: ${arquivo}`);
            return { encontrado: true, caminho: caminhoEncontrado, nomeReal: arquivo };
        }
    }

    return { encontrado: false, caminho: caminhoExato, nomeReal: nomeArquivoBuscado };
}

// ========================================
// 🏥 ROTA DE HEALTH CHECK (MANTENDO A SUA)
// ========================================
app.get('/health', (req, res) => {
    const status = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        servidor: 'Banco do Brasil API Server (Híbrido)',
        versao: '2.1.0',
        correcoes: {
            'mapeamento_pagador': 'Corrigido',
            'consulta_boletos': 'Corrigido',
            'proxy_oauth': 'Restaurado do backup',
            'convenio_correto': '3648981',
            'urls_dinamicas': 'Implementado',
            'formatacao_dados': 'Implementado',
            'download_pdf': 'Funcional'
        }
    };
    
    console.log('✅ Health check solicitado');
    res.json(status);
});

// ========================================
// 🔐 ROTA: POST /api/login
// Autenticação de usuários
// ========================================
app.post('/api/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        console.log(`🔐 Tentativa de login: ${email}`);

        if (!email || !senha) {
            return res.status(400).json({
                success: false,
                message: 'Email e senha são obrigatórios'
            });
        }

        // Credenciais fixas para o sistema API-BB
        const USUARIO_FINANCEIRO = {
            email: 'financeiro@aupusenergia.com.br',
            senha: '#ASmart24',
            nome: 'Financeiro Aupus',
            id: 'financeiro-001'
        };

        // Verificar credenciais
        if (email !== USUARIO_FINANCEIRO.email || senha !== USUARIO_FINANCEIRO.senha) {
            console.log(`❌ Login falhou: credenciais incorretas (${email})`);
            return res.status(401).json({
                success: false,
                message: 'Email ou senha incorretos'
            });
        }

        // Gerar token JWT
        const token = jwt.sign(
            {
                id: USUARIO_FINANCEIRO.id,
                email: USUARIO_FINANCEIRO.email,
                nome: USUARIO_FINANCEIRO.nome
            },
            'aupus-secret-key-2024',
            { expiresIn: '24h' }
        );

        console.log(`✅ Login bem-sucedido: ${USUARIO_FINANCEIRO.nome} (${email})`);

        res.json({
            success: true,
            token: token,
            user: {
                id: USUARIO_FINANCEIRO.id,
                nome: USUARIO_FINANCEIRO.nome,
                email: USUARIO_FINANCEIRO.email
            }
        });

    } catch (error) {
        console.error('❌ Erro no login:', error);
        res.status(500).json({
            success: false,
            message: 'Erro no servidor ao processar login'
        });
    }
});

// ========================================
// 📥 ROTA: POST /api/dados-boleto-energia
// Recebe dados do Sistema_Faturas para gerar boleto
// ========================================
app.post('/api/dados-boleto-energia', async (req, res) => {
    try {
        console.log('📥 Recebendo dados de boleto de energia...');

        const dados = req.body;

        // Validação básica
        if (!dados.uc || !dados.mes_referencia) {
            console.error('❌ Dados incompletos: falta UC ou mês de referência');
            return res.status(400).json({
                error: 'Dados incompletos',
                message: 'UC e mês de referência são obrigatórios'
            });
        }

        // Validação: rejeitar boletos sem valor
        const valorBoleto = parseFloat(dados.valorBoleto) || 0;
        if (valorBoleto <= 0) {
            console.error(`❌ Boleto rejeitado: UC ${dados.uc} - valor zerado ou negativo (R$ ${valorBoleto})`);
            return res.status(400).json({
                error: 'Valor inválido',
                message: 'Valor do boleto deve ser maior que zero'
            });
        }

        // Validação: rejeitar faturas sem compensação (energia_compensado = 0)
        const energiaCompensado = parseFloat(dados.energiaCompensado) || 0;
        const energiaNaoCompensado = parseFloat(dados.energiaNaoCompensado) || 0;
        if (energiaCompensado <= 0 && energiaNaoCompensado > 0) {
            console.error(`❌ Boleto rejeitado: UC ${dados.uc} - fatura sem compensação (comp=${energiaCompensado}, n_comp=${energiaNaoCompensado})`);
            return res.status(400).json({
                error: 'Fatura sem compensação',
                message: 'Não é permitido criar boleto para fatura sem energia compensada'
            });
        }

        // Mapear campos - MANTER snake_case (banco usa snake_case)
        // Adicionar dataVencimento a partir de dataVencimentoBoleto
        const dadosMapeados = {
            ...dados,
            // Mapear dataVencimentoBoleto para dataVencimento
            dataVencimento: dados.dataVencimentoBoleto || dados.dataVencimento
        };

        // Inserir ou atualizar no banco de dados
        const resultado = await inserirOuAtualizarBoleto(dadosMapeados);

        if (resultado) {
            console.log(`✅ Boleto salvo no banco: UC ${dados.uc} - ${dados.mes_referencia}`);
            return res.status(201).json({
                message: 'Dados recebidos e salvos com sucesso',
                dados: resultado
            });
        } else {
            throw new Error('Falha ao salvar no banco de dados');
        }

    } catch (error) {
        console.error('❌ Erro ao processar dados de boleto de energia:', error);
        res.status(500).json({
            error: 'Erro ao processar dados',
            message: error.message
        });
    }
});

// ========================================
// 📤 ROTA: GET /api/dados-boleto-energia
// Lista todos os boletos de energia com filtros
// ========================================
app.get('/api/dados-boleto-energia', async (req, res) => {
    try {
        console.log('📤 Listando boletos de energia...');

        const { status, uc, mes_referencia, data_inicio, data_fim } = req.query;

        // Buscar do banco de dados com filtros
        const filtros = {};
        if (status) filtros.status = status;
        if (uc) filtros.uc = uc;
        if (mes_referencia) filtros.mes_referencia = mes_referencia;
        if (data_inicio) filtros.data_inicio = data_inicio;
        if (data_fim) filtros.data_fim = data_fim;

        const resultado = await listarBoletos(filtros);

        // Enriquecer com dados de contato do CRM (whatsapp/email mais atualizados)
        if (resultado.length > 0) {
            try {
                const { Pool } = require('pg');
                const crmPool = new Pool({
                    host: '92.113.38.164',
                    port: 5432,
                    database: 'aupus_prod',
                    user: 'aupus_prod',
                    password: 'AupusProd2024Hashtag'
                });

                const ucs = [...new Set(resultado.map(b => b.uc))];
                const crmResult = await crmPool.query(`
                    SELECT
                        uc.numero_unidade::text as uc,
                        COALESCE(NULLIF(uc.whatsapp_faturamento, ''), NULLIF(cc.whatsapp, ''), '') as whatsapp,
                        COALESCE(NULLIF(uc.email_faturamento_1, ''), NULLIF(cc.email, ''), '') as email
                    FROM unidades_consumidoras uc
                    LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                    WHERE uc.numero_unidade::text = ANY($1)
                `, [ucs]);
                await crmPool.end();

                const crmMap = {};
                crmResult.rows.forEach(r => { crmMap[r.uc] = r; });

                // Sobrescrever telefone/email do boleto com dados do CRM (mais atualizados)
                resultado.forEach(boleto => {
                    const crm = crmMap[boleto.uc];
                    if (crm) {
                        if (crm.whatsapp) boleto.telefone = crm.whatsapp;
                        if (crm.email) boleto.email = crm.email;
                    }
                });
            } catch (crmError) {
                console.error('⚠️ Erro ao buscar contatos do CRM para boletos:', crmError.message);
            }
        }

        console.log(`✅ Retornando ${resultado.length} boletos de energia`);
        res.json({
            total: resultado.length,
            boletos: resultado
        });

    } catch (error) {
        console.error('❌ Erro ao listar boletos de energia:', error);
        res.status(500).json({
            error: 'Erro ao listar boletos',
            message: error.message
        });
    }
});

// ========================================
// 🔄 ROTA: PATCH /api/dados-boleto-energia/:uc/:mes
// Atualiza dados do boleto de energia
// ========================================
app.patch('/api/dados-boleto-energia/:uc/:mes_referencia', async (req, res) => {
    try {
        const { uc, mes_referencia } = req.params;
        const dados = req.body;

        console.log(`🔄 Atualizando boleto: UC ${uc} - ${mes_referencia}`);
        console.log(`📦 Dados recebidos:`, JSON.stringify(dados, null, 2));
        console.log(`🔑 Flag permitir_zeragem: ${dados.permitir_zeragem}`);

        // Verificar se boleto existe
        const boletoExistente = await buscarBoleto(uc, mes_referencia);
        console.log(`📂 Boleto existente (campos principais):`, {
            valor_boleto: boletoExistente.valor_boleto,
            nome_completo: boletoExistente.nome_completo,
            valor_abatimento: boletoExistente.valor_abatimento,
            numero_boleto: boletoExistente.numero_boleto,
            status: boletoExistente.status
        });
        if (!boletoExistente) {
            return res.status(404).json({
                error: 'Boleto não encontrado',
                message: `Não há boleto para UC ${uc} e mês ${mes_referencia}`
            });
        }

        // PROTEÇÃO: Se boleto já foi gerado, só permite atualizar campos de energia (original/corrigido)
        // e campos informativos, NÃO permite alterar valor_boleto ou dados financeiros principais
        const boletoJaGerado = boletoExistente.numero_boleto && boletoExistente.numero_boleto.length > 0;

        // Campos que PODEM ser atualizados mesmo com boleto gerado (são informativos)
        const camposPermitidosAposGeracao = [
            'energia_compensado_original',
            'energia_nao_compensado_original',
            'energia_compensado_corrigido',
            'energia_nao_compensado_corrigido',
            'compensacao_completa_aplicada',
            'energia_compensado',      // Valor de exibição (corrigido)
            'energia_nao_compensado',  // Valor de exibição (corrigido)
            'status',                  // Status pode mudar (Gerado -> Pago, etc)
            'numero_boleto',           // Permite limpar ao cancelar boleto
            'data_geracao_boleto'      // Permite limpar ao cancelar boleto
        ];

        if (boletoJaGerado) {
            console.log(`⚠️ Boleto já gerado (${boletoExistente.numero_boleto}) - filtrando campos permitidos`);

            // Filtrar apenas campos permitidos
            const dadosFiltrados = {};
            for (const campo of camposPermitidosAposGeracao) {
                if (dados[campo] !== undefined) {
                    dadosFiltrados[campo] = dados[campo];
                }
            }

            if (Object.keys(dadosFiltrados).length === 0) {
                return res.status(400).json({
                    error: 'Boleto já gerado',
                    message: `O boleto ${boletoExistente.numero_boleto} já foi gerado. Apenas campos informativos de energia podem ser atualizados.`,
                    campos_permitidos: camposPermitidosAposGeracao
                });
            }

            console.log(`  📝 Campos permitidos a atualizar: ${Object.keys(dadosFiltrados).join(', ')}`);

            // Atualizar apenas os campos filtrados
            const resultado = await atualizarBoletoParcial(uc, mes_referencia, dadosFiltrados);
            console.log(`✅ Campos informativos atualizados (boleto já gerado)`);
            return res.json({
                message: 'Campos informativos atualizados com sucesso (boleto já gerado)',
                dados: resultado,
                aviso: 'Valores financeiros do boleto não foram alterados pois o boleto já foi gerado'
            });
        }

        // Se for apenas atualização de status
        if (dados.status && Object.keys(dados).length <= 2) {
            const resultado = await atualizarStatusBoleto(uc, mes_referencia, dados.status, dados.numero_boleto);
            console.log(`✅ Status atualizado: ${dados.status}`);
            return res.json({
                message: 'Boleto atualizado com sucesso',
                dados: resultado
            });
        }

        // Atualização completa de dados - filtrar campos undefined/null/vazios para não sobrescrever
        const camposFinanceiros = [
            'valor_energia_compensada',
            'valor_bandeira_compensada',
            'tarifa_minima_concessionaria',
            'valor_com_desconto_aupus',
            'valor_economia',
            'valor_com_desconto',
            'valor_bandeira_com_desconto',
            'valor_s_desconto',
            'energia_compensado',
            'energia_nao_compensado',
            'energia_total',
            'valor_boleto'  // Proteger também, exceto quando é abatimento
        ];

        const camposImportantes = [
            'nome_completo',
            'documento',
            'tipo_pessoa'
        ];

        const dadosLimpos = Object.keys(dados).reduce((acc, key) => {
            const valor = dados[key];

            // Ignora campos de controle que não existem no banco
            if (key === 'permitir_zeragem') {
                return acc;
            }

            // Ignora undefined e null SEMPRE
            if (valor === undefined || valor === null) {
                return acc;
            }

            // Para strings: ignora se for vazia E o campo original já existir
            if (typeof valor === 'string' && valor === '' && boletoExistente[key]) {
                console.log(`  ⚠️ Ignorando campo vazio: ${key} (mantendo valor existente)`);
                return acc;
            }

            // Para campos importantes: não permite apagar se já tem valor
            if (camposImportantes.includes(key)) {
                if ((valor === '' || valor === null) && boletoExistente[key]) {
                    console.log(`  ⚠️ Ignorando limpeza de campo importante: ${key} (mantendo '${boletoExistente[key]}')`);
                    return acc;
                }
            }

            // Para campos financeiros: ignora se vier 0 ou '' E o campo já tem valor no banco
            // EXCETO se vier com flag permitir_zeragem (indica edição manual intencional)
            if (camposFinanceiros.includes(key)) {
                const valorNumerico = typeof valor === 'string' ? parseFloat(valor) : valor;
                const valorExistente = parseFloat(boletoExistente[key] || 0);

                // Se está tentando zerar um campo que tinha valor, ignora (exceto se for atualização intencional)
                if ((valorNumerico === 0 || valor === '' || valor === '0') && valorExistente > 0) {
                    // Permite atualizar valor_boleto quando tem motivo_abatimento junto
                    if (key === 'valor_boleto' && 'motivo_abatimento' in dados) {
                        // Deixa passar, será recalculado depois
                    } else if (dados.permitir_zeragem === true) {
                        // Permite zeragem intencional via modal de edição
                        console.log(`  ✅ Permitindo zeragem intencional de campo: ${key} (R$ ${valorExistente.toFixed(2)} -> R$ 0.00)`);
                    } else {
                        console.log(`  ⚠️ Ignorando zeramento de campo financeiro: ${key} (mantendo R$ ${valorExistente.toFixed(2)})`);
                        return acc;
                    }
                }
            }

            // Inclui o valor
            acc[key] = valor;
            return acc;
        }, {});

        console.log(`  📝 Campos a atualizar: ${Object.keys(dadosLimpos).join(', ')}`);

        // Se está atualizando valor_abatimento, recalcular valor_boleto
        if ('valor_abatimento' in dadosLimpos) {
            // Pegar o valor original do boleto (antes do abatimento)
            // Se já tem abatimento anterior, precisamos "voltar" ao valor sem abatimento
            const abatimentoAnterior = parseFloat(boletoExistente.valor_abatimento || 0);
            const valorBoletoAtual = parseFloat(boletoExistente.valor_boleto || 0);
            const valorSemAbatimento = valorBoletoAtual + abatimentoAnterior;

            // Aplicar novo abatimento
            const novoAbatimento = parseFloat(dadosLimpos.valor_abatimento || 0);
            const valorFinal = valorSemAbatimento - novoAbatimento;

            dadosLimpos.valor_boleto = valorFinal;

            console.log(`  💰 Recalculando valor_boleto:`);
            console.log(`     Valor sem abatimento: R$ ${valorSemAbatimento.toFixed(2)}`);
            console.log(`     Abatimento anterior: R$ ${abatimentoAnterior.toFixed(2)}`);
            console.log(`     Novo abatimento: R$ ${novoAbatimento.toFixed(2)}`);
            console.log(`     Valor final: R$ ${valorFinal.toFixed(2)}`);
        }

        // IMPORTANTE: Desmarcar validação quando dados são atualizados
        // (exceto quando é apenas atualização de status ou validação)
        const camposQueInvalidam = ['valor_boleto', 'energia_compensado', 'energia_nao_compensado', 'nome_completo', 'documento'];
        const atualizouCampoCritico = camposQueInvalidam.some(campo => campo in dadosLimpos);
        if (atualizouCampoCritico) {
            dadosLimpos.validado = false;
            console.log(`  ⚠️ Campo crítico atualizado - desmarcando validação`);
        }

        // IMPORTANTE: Usar UPDATE parcial para não sobrescrever campos com null
        console.log(`  🔧 Atualizando apenas campos modificados no banco`);

        const resultado = await atualizarBoletoParcial(uc, mes_referencia, dadosLimpos);

        console.log(`✅ Dados do boleto atualizados`);
        res.json({
            message: 'Dados atualizados com sucesso',
            dados: resultado,
            validacao_desmarcada: atualizouCampoCritico
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar boleto de energia:', error);
        res.status(500).json({
            error: 'Erro ao atualizar boleto',
            message: error.message
        });
    }
});

// ========================================
// 🗑️ ROTA: DELETE /api/dados-boleto-energia/:uc/:mes
// Deleta boleto de energia (rota legada)
// ========================================
app.delete('/api/dados-boleto-energia/:uc/:mes_referencia', authenticateToken, async (req, res) => {
    try {
        const { uc } = req.params;
        // Decodificar mes_referencia pois pode vir encodado (ex: "12%2F2024" -> "12/2024")
        const mes_referencia = decodeURIComponent(req.params.mes_referencia);

        console.log(`🗑️ Deletando boleto: UC ${uc} - ${mes_referencia}`);

        // Verificar se boleto existe
        const boletoExistente = await buscarBoleto(uc, mes_referencia);
        if (!boletoExistente) {
            return res.status(404).json({
                error: 'Boleto não encontrado',
                message: `Não há boleto para UC ${uc} e mês ${mes_referencia}`
            });
        }

        // Deletar do banco
        const resultado = await deletarBoleto(uc, mes_referencia);

        console.log(`✅ Boleto deletado: UC ${uc} - ${mes_referencia}`);
        res.json({
            message: 'Boleto deletado com sucesso',
            dados: resultado
        });

    } catch (error) {
        console.error('❌ Erro ao deletar boleto de energia:', error);
        res.status(500).json({
            error: 'Erro ao deletar boleto',
            message: error.message
        });
    }
});

// ========================================
// 📇 ROTA: GET /api/dados-contato-crm/:uc
// Busca dados de contato atualizados do CRM para uma UC
// ========================================
app.get('/api/dados-contato-crm/:uc', authenticateToken, async (req, res) => {
    try {
        const { uc } = req.params;
        console.log(`📇 Buscando dados de contato do CRM para UC ${uc}...`);

        // Pool CRM (produção)
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        const query = `
            SELECT
                uc.numero_unidade as uc,
                COALESCE(NULLIF(uc.nome_faturamento, ''), NULLIF(cc.nome_cliente, ''), '') as nome,
                COALESCE(NULLIF(uc.whatsapp_faturamento, ''), NULLIF(cc.whatsapp, ''), '') as whatsapp,
                COALESCE(NULLIF(uc.email_faturamento_1, ''), NULLIF(cc.email, ''), '') as email,
                COALESCE(NULLIF(uc.email_faturamento_2, ''), '') as email_secundario
            FROM controle_clube cc
            JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
            WHERE uc.numero_unidade = $1
              AND cc.deleted_at IS NULL
            LIMIT 1
        `;

        const result = await crmPool.query(query, [uc]);
        await crmPool.end();

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'UC não encontrada no CRM',
                message: `Não foram encontrados dados de contato para a UC ${uc}`
            });
        }

        console.log(`✅ Dados de contato encontrados para UC ${uc}`);
        res.json(result.rows[0]);

    } catch (error) {
        console.error('❌ Erro ao buscar dados de contato do CRM:', error);
        res.status(500).json({
            error: 'Erro ao buscar dados de contato',
            message: error.message
        });
    }
});

// ========================================
// 🗑️ ROTA: DELETE /api/boletos-energia/excluir
// Deleta boleto de energia usando query params
// ========================================
app.delete('/api/boletos-energia/excluir', authenticateToken, async (req, res) => {
    try {
        const { uc, mes_referencia } = req.query;

        if (!uc || !mes_referencia) {
            return res.status(400).json({
                error: 'Parâmetros obrigatórios faltando',
                message: 'UC e mes_referencia são obrigatórios'
            });
        }

        console.log(`🗑️ Deletando boleto: UC ${uc} - ${mes_referencia}`);

        // Verificar se boleto existe
        const boletoExistente = await buscarBoleto(uc, mes_referencia);
        if (!boletoExistente) {
            return res.status(404).json({
                error: 'Boleto não encontrado',
                message: `Não há boleto para UC ${uc} e mês ${mes_referencia}`
            });
        }

        // Verificar se o boleto já foi gerado (não pode excluir)
        if (boletoExistente.numero_boleto || boletoExistente.status === 'Boleto gerado') {
            return res.status(400).json({
                error: 'Boleto não pode ser excluído',
                message: 'Boletos já gerados no Banco do Brasil não podem ser excluídos'
            });
        }

        // Deletar do banco
        const resultado = await deletarBoleto(uc, mes_referencia);

        console.log(`✅ Boleto deletado: UC ${uc} - ${mes_referencia}`);
        res.json({
            success: true,
            message: 'Boleto deletado com sucesso',
            dados: resultado
        });

    } catch (error) {
        console.error('❌ Erro ao deletar boleto de energia:', error);
        res.status(500).json({
            error: 'Erro ao deletar boleto',
            message: error.message
        });
    }
});

// ========================================
// 🔄 ROTA: POST /api/boletos-energia/sincronizar-status-envio
// Sincroniza o status de envio dos boletos baseado na tabela controle_envios
// Corrige retroativamente boletos que foram enviados mas não tiveram status atualizado
// ========================================
app.post('/api/boletos-energia/sincronizar-status-envio', authenticateToken, async (req, res) => {
    try {
        console.log('🔄 Iniciando sincronização de status de envios...');

        const resultado = await sincronizarStatusEnviosBoletos();

        res.json({
            success: true,
            message: 'Sincronização concluída',
            dados: resultado
        });

    } catch (error) {
        console.error('❌ Erro ao sincronizar status de envios:', error);
        res.status(500).json({
            error: 'Erro ao sincronizar status de envios',
            message: error.message
        });
    }
});

// ========================================
// ➕ ROTA: POST /api/boletos-energia/manual
// Cria boleto manual de cogeração
// ========================================
app.post('/api/boletos-energia/manual', authenticateToken, async (req, res) => {
    try {
        const {
            uc, nome, documento, endereco, bairro, cep, cidade, uf,
            data_vencimento, mes_referencia, valor_boleto,
            cogeracao_ponta, cogeracao_fora_ponta, cogeracao_horario_reservado,
            tarifa_ponta, tarifa_fora_ponta, tarifa_horario_reservado,
            valor_ponta, valor_fora_ponta, valor_horario_reservado,
            tipo_boleto
        } = req.body;

        console.log('➕ Criando boleto manual de cogeração...');
        console.log('   - UC:', uc);
        console.log('   - Nome:', nome);
        console.log('   - Documento:', documento);
        console.log('   - Valor:', valor_boleto);
        console.log('   - Vencimento:', data_vencimento);

        // Validações básicas
        if (!uc || !nome || !documento || !data_vencimento || !valor_boleto) {
            return res.status(400).json({
                error: 'Campos obrigatórios faltando',
                message: 'UC, nome, documento, data de vencimento e valor são obrigatórios'
            });
        }

        // Usar UC informada pelo usuário
        const ucManual = uc;

        // Inserir no banco de dados
        const query = `
            INSERT INTO boletos_energia (
                uc, mes_referencia, nome_completo, cpf_cnpj, documento,
                endereco, bairro, cep, cidade, uf,
                data_vencimento, valor_boleto,
                cogeracao_ponta, cogeracao_fora_ponta, cogeracao_horario_reservado,
                tarifa_ponta, tarifa_fora_ponta, tarifa_horario_reservado,
                valor_ponta, valor_fora_ponta, valor_horario_reservado,
                tipo_boleto, status, created_at
            ) VALUES (
                $1, $2, $3, $4, $4,
                $5, $6, $7, $8, $9,
                $10, $11,
                $12, $13, $14,
                $15, $16, $17,
                $18, $19, $20,
                $21, 'Pendente', NOW()
            )
            RETURNING *
        `;

        const values = [
            ucManual, mes_referencia, nome, documento,
            endereco, bairro, cep, cidade, uf,
            data_vencimento, valor_boleto,
            cogeracao_ponta || 0, cogeracao_fora_ponta || 0, cogeracao_horario_reservado || 0,
            tarifa_ponta || 0, tarifa_fora_ponta || 0, tarifa_horario_reservado || 0,
            valor_ponta || 0, valor_fora_ponta || 0, valor_horario_reservado || 0,
            tipo_boleto || 'manual_cogeracao'
        ];

        const result = await pool.query(query, values);
        const novoBoleto = result.rows[0];

        console.log('✅ Boleto manual criado com sucesso!');
        console.log('   - UC:', ucManual);
        console.log('   - ID:', novoBoleto.id);

        // Auto-enviar para Aupus Control (fire-and-forget)
        autoEnviarBoletoParaControl(novoBoleto.id).catch(() => {});

        res.json({
            sucesso: true,
            mensagem: 'Boleto manual criado com sucesso',
            boleto: novoBoleto
        });

    } catch (error) {
        console.error('❌ Erro ao criar boleto manual:', error);

        // Verificar se é erro de chave duplicada
        if (error.code === '23505') {
            return res.status(400).json({
                error: 'Boleto já existe',
                message: `Já existe um boleto para esta UC e mês de referência. Exclua o existente ou use outro mês.`
            });
        }

        res.status(500).json({
            error: 'Erro ao criar boleto manual',
            message: error.message
        });
    }
});

// ========================================
// 📄 ROTA: POST /api/boletos-energia/pdf-cogeracao
// Gera PDF do boleto de cogeração
// ========================================
app.post('/api/boletos-energia/pdf-cogeracao', authenticateToken, async (req, res) => {
    try {
        const {
            uc, mes_referencia, nome, documento, endereco, bairro, cep, cidade, uf,
            data_vencimento, valor_boleto,
            cogeracao_ponta, cogeracao_fora_ponta, cogeracao_horario_reservado,
            tarifa_ponta, tarifa_fora_ponta, tarifa_horario_reservado,
            valor_ponta, valor_fora_ponta, valor_horario_reservado
        } = req.body;

        console.log('📄 Gerando PDF de cogeração...');
        console.log('   - UC:', uc);
        console.log('   - Nome:', nome);
        console.log('   - Valor:', valor_boleto);

        // Montar objeto do boleto para o gerador de PDF
        const dadosBoleto = {
            uc,
            mesReferencia: mes_referencia,
            nome,
            documento,
            endereco,
            bairro,
            cep,
            cidade,
            uf,
            dataVencimento: data_vencimento,
            valorBoleto: valor_boleto,
            cogeracaoPonta: cogeracao_ponta || 0,
            cogeracaoForaPonta: cogeracao_fora_ponta || 0,
            cogeracaoHorarioReservado: cogeracao_horario_reservado || 0,
            tarifaPonta: tarifa_ponta || 0,
            tarifaForaPonta: tarifa_fora_ponta || 0,
            tarifaHorarioReservado: tarifa_horario_reservado || 0,
            valorPonta: valor_ponta || 0,
            valorForaPonta: valor_fora_ponta || 0,
            valorHorarioReservado: valor_horario_reservado || 0
        };

        // Gerar o PDF usando a função específica de cogeração
        const pdfBuffer = await gerarPDFBoletoCogeracao(dadosBoleto);

        // Definir headers para download do PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Boleto_Cogeracao_${uc}_${mes_referencia.replace('/', '-')}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        console.log('✅ PDF de cogeração gerado com sucesso!');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ Erro ao gerar PDF de cogeração:', error);
        res.status(500).json({
            error: 'Erro ao gerar PDF de cogeração',
            message: error.message
        });
    }
});

// ========================================
// 🔢 ROTA: GET /api/maior-sequencial-local
// Retorna o maior sequencial de boleto no banco local
// ========================================
app.get('/api/maior-sequencial-local', async (req, res) => {
    try {
        console.log('🔢 Buscando maior sequencial no banco local...');

        const query = `
            SELECT MAX(CAST(SUBSTRING(numero_boleto FROM 11) AS BIGINT)) as maior_sequencial
            FROM boletos_energia
            WHERE numero_boleto IS NOT NULL
              AND LENGTH(numero_boleto) = 20
              AND CAST(SUBSTRING(numero_boleto FROM 11) AS BIGINT) < 1000000
        `;

        const result = await pool.query(query);
        const maiorSequencial = parseInt(result.rows[0]?.maior_sequencial || 0);

        console.log(`✅ Maior sequencial local: ${maiorSequencial}`);
        res.json({ maiorSequencial });

    } catch (error) {
        console.error('❌ Erro ao buscar maior sequencial:', error);
        res.status(500).json({ error: error.message, maiorSequencial: 0 });
    }
});

// ========================================
// 📅 ROTA: GET /api/meses-disponiveis-boletos
// Retorna os meses disponíveis na tabela boletos_energia
// ========================================
app.get('/api/meses-disponiveis-boletos', async (req, res) => {
    try {
        console.log('📅 Buscando meses disponíveis na tabela boletos_energia...');

        const query = `
            SELECT mes_referencia
            FROM boletos_energia
            WHERE mes_referencia IS NOT NULL
            GROUP BY mes_referencia
            ORDER BY
                CAST(SPLIT_PART(mes_referencia, '/', 2) AS INTEGER) DESC,
                CAST(SPLIT_PART(mes_referencia, '/', 1) AS INTEGER) DESC
        `;

        const result = await pool.query(query);
        const meses = result.rows.map(row => row.mes_referencia);

        console.log(`✅ Meses encontrados: ${meses.join(', ')}`);
        res.json({ meses });

    } catch (error) {
        console.error('❌ Erro ao buscar meses disponíveis:', error);
        res.status(500).json({ error: error.message, meses: [] });
    }
});

// ========================================
// ✅ ROTA: PATCH /api/boleto-energia/validar/:uc/:mes
// Atualiza o status de validação de um boleto
// ========================================
app.patch('/api/boleto-energia/validar/:uc/:mes_referencia', async (req, res) => {
    try {
        const { uc, mes_referencia } = req.params;
        const { validado } = req.body;

        console.log(`✅ Atualizando validação: UC ${uc} - ${mes_referencia} -> ${validado}`);

        const query = `
            UPDATE boletos_energia
            SET validado = $1, data_atualizacao = NOW()
            WHERE uc = $2 AND mes_referencia = $3
            RETURNING *
        `;

        const result = await pool.query(query, [validado, uc, mes_referencia]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Boleto não encontrado',
                message: `Não há boleto para UC ${uc} e mês ${mes_referencia}`
            });
        }

        console.log(`✅ Validação atualizada: UC ${uc} - validado: ${validado}`);
        res.json({
            success: true,
            message: 'Validação atualizada com sucesso',
            boleto: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar validação:', error);
        res.status(500).json({
            error: 'Erro ao atualizar validação',
            message: error.message
        });
    }
});

// ========================================
// ✅ ROTA: POST /api/boleto-energia/validar-lote
// Atualiza validação de múltiplos boletos
// ========================================
app.post('/api/boleto-energia/validar-lote', async (req, res) => {
    try {
        const { boletos, validado } = req.body;

        if (!boletos || !Array.isArray(boletos) || boletos.length === 0) {
            return res.status(400).json({
                error: 'Lista de boletos é obrigatória'
            });
        }

        console.log(`✅ Atualizando validação em lote: ${boletos.length} boletos -> ${validado}`);

        // Usar transação para garantir consistência
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let atualizados = 0;
            for (const boleto of boletos) {
                const query = `
                    UPDATE boletos_energia
                    SET validado = $1, data_atualizacao = NOW()
                    WHERE uc = $2 AND mes_referencia = $3
                `;
                const result = await client.query(query, [validado, boleto.uc, boleto.mes_referencia]);
                atualizados += result.rowCount;
            }

            await client.query('COMMIT');

            console.log(`✅ Validação em lote concluída: ${atualizados} boletos atualizados`);
            res.json({
                success: true,
                message: `${atualizados} boletos atualizados`,
                atualizados
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ Erro ao atualizar validação em lote:', error);
        res.status(500).json({
            error: 'Erro ao atualizar validação em lote',
            message: error.message
        });
    }
});

// ========================================
// 🎫 JOBS DE GERAÇÃO DE BOLETOS EM BATCH
// ========================================

// Armazenamento de jobs em memória (em produção, usar Redis/DB)
const jobsGeracaoBoletos = new Map();

// ========================================
// 🚀 ROTA: POST /api/boleto-energia/gerar-validados
// Inicia job de geração de boletos validados
// ========================================
app.post('/api/boleto-energia/gerar-validados', async (req, res) => {
    try {
        const { mes_referencia } = req.body;

        if (!mes_referencia) {
            return res.status(400).json({
                error: 'Mês de referência é obrigatório'
            });
        }

        // Buscar boletos validados e pendentes
        const query = `
            SELECT * FROM boletos_energia
            WHERE mes_referencia = $1
              AND status = 'Pendente'
              AND validado = true
              AND (numero_boleto IS NULL OR numero_boleto = '')
            ORDER BY uc
        `;

        const result = await pool.query(query, [mes_referencia]);
        const boletosParaGerar = result.rows;

        if (boletosParaGerar.length === 0) {
            return res.status(400).json({
                error: 'Nenhum boleto validado encontrado',
                message: 'Marque os boletos como validados antes de gerar'
            });
        }

        // Criar job
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const job = {
            id: jobId,
            status: 'processando',
            mes_referencia,
            total: boletosParaGerar.length,
            processados: 0,
            sucesso: 0,
            erros: 0,
            detalhes: [],
            iniciado_em: new Date().toISOString(),
            finalizado_em: null
        };

        jobsGeracaoBoletos.set(jobId, job);

        console.log(`🚀 Job ${jobId} criado: ${boletosParaGerar.length} boletos para gerar`);

        // Responder imediatamente com o ID do job
        res.json({
            success: true,
            jobId,
            message: `Job iniciado para gerar ${boletosParaGerar.length} boletos`,
            total: boletosParaGerar.length
        });

        // Processar boletos em background (não bloqueia a resposta)
        processarJobGeracaoBoletos(jobId, boletosParaGerar);

    } catch (error) {
        console.error('❌ Erro ao iniciar geração de boletos:', error);
        res.status(500).json({
            error: 'Erro ao iniciar geração',
            message: error.message
        });
    }
});

// ========================================
// 📊 ROTA: GET /api/boleto-energia/job-status/:jobId
// Retorna o status de um job de geração
// ========================================
app.get('/api/boleto-energia/job-status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobsGeracaoBoletos.get(jobId);

    if (!job) {
        return res.status(404).json({
            error: 'Job não encontrado',
            message: `Job ${jobId} não existe ou expirou`
        });
    }

    res.json(job);
});

// ========================================
// 🔄 Função para processar boletos em background
// ========================================
async function processarJobGeracaoBoletos(jobId, boletos) {
    const job = jobsGeracaoBoletos.get(jobId);
    if (!job) return;

    console.log(`🔄 Iniciando processamento do job ${jobId}...`);

    // Obter o sequencial inicial uma única vez antes do loop
    // Isso evita que múltiplos boletos tentem usar o mesmo sequencial
    let sequencialAtual = await obterMaiorSequencial();
    console.log(`📊 Sequencial inicial para o job: ${sequencialAtual}`);

    for (const boleto of boletos) {
        try {
            console.log(`📄 [${job.processados + 1}/${job.total}] Gerando boleto para UC ${boleto.uc}...`);

            // Incrementar sequencial para este boleto
            sequencialAtual++;
            console.log(`🔢 Usando sequencial: ${sequencialAtual}`);

            // Gerar boleto via API do BB passando o sequencial específico
            const resultado = await gerarBoletoIndividual(boleto, sequencialAtual);

            if (resultado.success) {
                job.sucesso++;
                job.detalhes.push({
                    uc: boleto.uc,
                    status: 'sucesso',
                    numero_boleto: resultado.numero_boleto,
                    mensagem: 'Boleto gerado com sucesso'
                });
                console.log(`✅ Boleto gerado: UC ${boleto.uc} -> ${resultado.numero_boleto}`);
            } else {
                job.erros++;
                job.detalhes.push({
                    uc: boleto.uc,
                    status: 'erro',
                    mensagem: resultado.error
                });
                console.log(`❌ Erro ao gerar boleto UC ${boleto.uc}: ${resultado.error}`);
            }

        } catch (error) {
            job.erros++;
            job.detalhes.push({
                uc: boleto.uc,
                status: 'erro',
                mensagem: error.message
            });
            console.error(`❌ Exceção ao gerar boleto UC ${boleto.uc}:`, error.message);
        }

        job.processados++;

        // Pequena pausa entre boletos para não sobrecarregar a API do BB
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    job.status = 'concluido';
    job.finalizado_em = new Date().toISOString();

    console.log(`✅ Job ${jobId} concluído: ${job.sucesso} sucesso, ${job.erros} erros`);

    // Limpar job após 30 minutos
    setTimeout(() => {
        jobsGeracaoBoletos.delete(jobId);
        console.log(`🗑️ Job ${jobId} removido da memória`);
    }, 30 * 60 * 1000);
}

// ========================================
// 🔢 Função para obter o maior sequencial (banco local + API BB)
// ========================================
async function obterMaiorSequencial() {
    try {
        // Obter token OAuth
        const tokenResponse = await obterTokenBB();
        const token = tokenResponse.success ? tokenResponse.token : null;

        // Consultar banco local
        const sequencialQuery = `
            SELECT MAX(CAST(SUBSTRING(numero_boleto FROM 11) AS BIGINT)) as maior
            FROM boletos_energia
            WHERE numero_boleto IS NOT NULL
              AND LENGTH(numero_boleto) = 20
              AND CAST(SUBSTRING(numero_boleto FROM 11) AS BIGINT) < 1000000
        `;
        const seqResult = await pool.query(sequencialQuery);
        let sequencialLocal = parseInt(seqResult.rows[0]?.maior || 0);

        // Consultar maior sequencial na API do BB - buscar últimos 3 meses (inclui baixados)
        let sequencialBB = 0;
        if (token) {
            try {
                const hoje = new Date();
                const dataInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1); // 3 meses atrás
                const dataFim = hoje;
                const formatarData = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

                // Buscar TODOS os boletos (B = ambos ativos e baixados)
                let indice = 0;
                let continuar = true;

                while (continuar && indice < 500) {
                    const bbListaResponse = await fazerRequisicaoBB(
                        `/cobrancas/v2/boletos?indicadorSituacao=B&agenciaBeneficiario=4148&contaBeneficiario=25651&numeroConvenio=3648981&dataInicioRegistro=${formatarData(dataInicio)}&dataFimRegistro=${formatarData(dataFim)}&indice=${indice}`,
                        'GET',
                        null,
                        token
                    );

                    if (bbListaResponse.boletos && bbListaResponse.boletos.length > 0) {
                        for (const b of bbListaResponse.boletos) {
                            if (b.numeroBoletoBB && b.numeroBoletoBB.length === 20) {
                                const seq = parseInt(b.numeroBoletoBB.substring(10));
                                if (seq > sequencialBB && seq < 1000000) {
                                    sequencialBB = seq;
                                }
                            }
                        }
                    }

                    continuar = bbListaResponse.indicadorContinuidade === 'S';
                    indice = bbListaResponse.proximoIndice || (indice + 100);
                }

                console.log(`  📊 Maior sequencial encontrado: Local=${sequencialLocal}, BB=${sequencialBB}`);
            } catch (e) {
                console.log(`  ⚠️ Não foi possível consultar sequencial do BB: ${e.message}`);
            }
        }

        // Retorna o maior entre local e BB
        return Math.max(sequencialLocal, sequencialBB);
    } catch (error) {
        console.error('Erro ao obter maior sequencial:', error.message);
        return 0;
    }
}

// ========================================
// 🎫 Função para gerar um boleto individual
// ========================================
// Parâmetro sequencialFornecido: quando chamado em lote, o sequencial já vem calculado
async function gerarBoletoIndividual(boleto, sequencialFornecido = null) {
    try {
        // Obter token OAuth
        const tokenResponse = await obterTokenBB();
        if (!tokenResponse.success) {
            return { success: false, error: 'Falha ao obter token OAuth' };
        }

        const token = tokenResponse.token;

        // Calcular vencimento
        const dataVencimento = calcularVencimentoBoleto(boleto.mes_referencia, boleto.vencimento_consorcio);
        if (!dataVencimento) {
            return { success: false, error: 'Não foi possível calcular data de vencimento' };
        }

        let sequencial;

        // Se o sequencial foi fornecido (geração em lote), usar ele
        // Caso contrário, calcular (geração individual)
        if (sequencialFornecido !== null) {
            sequencial = sequencialFornecido;
            console.log(`  🔢 Usando sequencial fornecido: ${sequencial}`);
        } else {
            // Geração individual: calcular o próximo sequencial
            const maiorSequencial = await obterMaiorSequencial();
            sequencial = maiorSequencial + 1;
            console.log(`  🔢 Próximo sequencial calculado: ${sequencial}`);
        }

        // Gerar número título cliente
        const convenioStr = '3648981'.padStart(7, '0');
        const sequencialStr = sequencial.toString().padStart(10, '0');
        const numeroTituloCliente = `000${convenioStr}${sequencialStr}`;

        // Preparar documento
        const tipoPessoa = (boleto.tipo_pessoa || 'CPF').toUpperCase();
        const tipoInscricao = tipoPessoa === 'CPF' ? 1 : 2;
        const documentoLimpo = String(boleto.documento || '').replace(/\D/g, '');
        const documentoFormatado = tipoInscricao === 1
            ? documentoLimpo.padStart(11, '0')
            : documentoLimpo.padStart(14, '0');

        // Formatar CEP
        const cepLimpo = String(boleto.cep || '').replace(/\D/g, '');
        const cepFormatado = cepLimpo.length === 8 ? cepLimpo : undefined;

        // Preparar dados do boleto
        const dadosBoleto = {
            numeroConvenio: 3648981,
            numeroCarteira: 17,
            numeroVariacaoCarteira: 19,
            codigoModalidade: 1,
            dataEmissao: new Date().toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).replace(/\//g, '.'),
            dataVencimento: dataVencimento.replace(/\//g, '.'),
            valorOriginal: parseFloat(boleto.valor_boleto),
            numeroTituloCliente,
            descricaoTitulo: boleto.descricao || `Boleto referente ao arrendamento de energia do mês ${boleto.mes_referencia}`,
            indicadorAceiteTituloVencido: 'S',
            numeroDiasLimiteRecebimento: 300,
            quantidadeDiasProtesto: 45,
            codigoAceite: 'N',
            codigoTipoTitulo: 2,
            descricaoTipoTitulo: 'DM',
            indicadorPermissaoRecebimentoParcial: 'N',
            jurosMora: { tipo: 2, porcentagem: 1.00 },
            multa: {
                tipo: 2,
                data: calcularDataMultaBoleto(dataVencimento),
                porcentagem: 2.00
            },
            pagador: {
                tipoInscricao,
                numeroInscricao: documentoFormatado,
                nome: removerAcentosTexto((boleto.nome_completo || 'CLIENTE').toUpperCase()).substring(0, 60),
                endereco: removerAcentosTexto((boleto.endereco || 'ENDERECO NAO INFORMADO').toUpperCase()).substring(0, 100),
                ...(cepFormatado && { cep: cepFormatado }),
                ...(boleto.cidade && { cidade: removerAcentosTexto(boleto.cidade.toUpperCase()).substring(0, 30) }),
                ...(boleto.bairro && { bairro: removerAcentosTexto(boleto.bairro.toUpperCase()).substring(0, 30) }),
                uf: (boleto.uf || 'GO').toUpperCase()
            },
            indicadorPix: 'S'
        };

        // Chamar API do BB
        const https = require('https');
        const bbResponse = await fazerRequisicaoBB(
            '/cobrancas/v2/boletos',
            'POST',
            dadosBoleto,
            token
        );

        if (bbResponse.numero) {
            // Atualizar boleto no banco
            const updateQuery = `
                UPDATE boletos_energia
                SET numero_boleto = $1,
                    status = 'Boleto gerado',
                    data_geracao_boleto = NOW(),
                    data_vencimento = $2,
                    data_atualizacao = NOW()
                WHERE uc = $3 AND mes_referencia = $4
            `;
            await pool.query(updateQuery, [
                bbResponse.numero,
                dataVencimento,
                boleto.uc,
                boleto.mes_referencia
            ]);

            // Salvar resposta completa do BB para fallback de PDF
            try {
                await salvarRespostaBB(bbResponse.numero, bbResponse);
            } catch (saveErr) {
                console.warn(`  ⚠️ Falha ao salvar resposta BB (não-crítico):`, saveErr.message);
            }

            return { success: true, numero_boleto: bbResponse.numero };
        } else {
            return { success: false, error: bbResponse.erros?.[0]?.mensagem || 'Resposta inválida do BB' };
        }

    } catch (error) {
        console.error(`Erro ao gerar boleto UC ${boleto.uc}:`, error.message);
        return { success: false, error: error.message };
    }
}

// ========================================
// 🔧 Funções auxiliares para geração de boletos
// ========================================

function calcularVencimentoBoleto(mesReferencia, vencimentoConsorcio) {
    try {
        if (vencimentoConsorcio && vencimentoConsorcio !== 'nan' && !isNaN(parseInt(vencimentoConsorcio))) {
            const dia = parseInt(vencimentoConsorcio);
            const [mes, ano] = mesReferencia.split('/');
            const mesVencimento = (parseInt(mes) % 12) + 1;
            const anoVencimento = mesVencimento === 1 ? parseInt(ano) + 1 : parseInt(ano);
            return `${String(dia).padStart(2, '0')}/${String(mesVencimento).padStart(2, '0')}/${anoVencimento}`;
        }

        const [mes, ano] = mesReferencia.split('/');
        const mesVencimento = (parseInt(mes) % 12) + 1;
        const anoVencimento = mesVencimento === 1 ? parseInt(ano) + 1 : parseInt(ano);

        const dataVencimento = new Date(anoVencimento, mesVencimento - 1, 20);
        const hoje = new Date();

        if (dataVencimento < hoje) {
            // Usar 5 dias úteis a partir de hoje
            const novaData = new Date();
            novaData.setDate(novaData.getDate() + 7);
            return novaData.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }

        return `20/${String(mesVencimento).padStart(2, '0')}/${anoVencimento}`;
    } catch (error) {
        return null;
    }
}

function calcularDataMultaBoleto(dataVencimento) {
    try {
        const [dia, mes, ano] = dataVencimento.split('/');
        const data = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
        data.setDate(data.getDate() + 1);
        return data.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '.');
    } catch (error) {
        return dataVencimento.replace(/\//g, '.');
    }
}

function removerAcentosTexto(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Cache de token BB
let bbTokenCache = null;
let bbTokenExpiry = null;

async function obterTokenBB() {
    try {
        // Verificar se já temos um token válido em cache
        if (bbTokenCache && bbTokenExpiry && Date.now() < bbTokenExpiry) {
            console.log('🔐 Usando token BB em cache');
            return { success: true, token: bbTokenCache };
        }

        console.log('🔐 Obtendo novo token OAuth do BB...');

        // Credenciais corretas do Banco do Brasil
        const clientId = 'eyJpZCI6ImMzIiwiY29kaWdvUHVibGljYWRvciI6MCwiY29kaWdvU29mdHdhcmUiOjEyMTQ4NSwic2VxdWVuY2lhbEluc3RhbGFjYW8iOjF9';
        const clientSecret = 'eyJpZCI6IjFiNTMxZjktMjZmYi00ZThjLThkZDItN2E1NDU1ODU5ODUzNmNjNjNlNCIsImNvZGlnb1B1YmxpY2Fkb3IiOjAsImNvZGlnb1NvZnR3YXJlIjoxMjE0ODUsInNlcXVlbmNpYWxJbnN0YWxhY2FvIjoxLCJzZXF1ZW5jaWFsQ3JlZGVuY2lhbCI6NCwiYW1iaWVudGUiOiJwcm9kdWNhbyIsImlhdCI6MTc2MTY4NDExNzI3N30';
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        return new Promise((resolve) => {
            const postData = 'grant_type=client_credentials&scope=cobrancas.boletos-info cobrancas.boletos-requisicao';
            const options = {
                hostname: 'oauth.bb.com.br',
                port: 443,
                path: '/oauth/token',
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.access_token) {
                            // Armazenar em cache (50 minutos)
                            bbTokenCache = json.access_token;
                            bbTokenExpiry = Date.now() + (50 * 60 * 1000);
                            console.log('✅ Token BB obtido com sucesso');
                            resolve({ success: true, token: json.access_token });
                        } else {
                            console.error('❌ Resposta OAuth sem token:', data);
                            resolve({ success: false, error: json.error_description || 'Token não retornado' });
                        }
                    } catch (e) {
                        console.error('❌ Erro ao parsear resposta OAuth:', data);
                        resolve({ success: false, error: 'Erro ao parsear resposta' });
                    }
                });
            });

            req.on('error', (e) => {
                console.error('❌ Erro na requisição OAuth:', e.message);
                resolve({ success: false, error: e.message });
            });

            req.write(postData);
            req.end();
        });
    } catch (error) {
        console.error('❌ Exceção ao obter token:', error.message);
        return { success: false, error: error.message };
    }
}

async function fazerRequisicaoBB(endpoint, method, body, token) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';

        // Adicionar gw-dev-app-key corretamente (& se já tem ?, senão ?)
        const separator = endpoint.includes('?') ? '&' : '?';
        const fullPath = endpoint + separator + 'gw-dev-app-key=549827f7531a4cdd880437df70bf3d86';

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // Só adiciona Content-Length se tiver body
        if (postData) {
            headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const options = {
            hostname: 'api.bb.com.br',
            port: 443,
            path: fullPath,
            method: method,
            headers: headers
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    console.error('Erro ao parsear resposta BB:', data.substring(0, 200));
                    reject(new Error('Erro ao parsear resposta do BB'));
                }
            });
        });

        req.on('error', reject);
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// ========================================
// 🔄 ROTA: POST /api/verificar-boleto-conjunto
// Verifica se boleto gerado corresponde a uma UC de energia e atualiza status
// ========================================
app.post('/api/verificar-boleto-conjunto', async (req, res) => {
    try {
        const { numeroBoleto } = req.body;

        if (!numeroBoleto) {
            return res.status(400).json({
                error: 'Número do boleto é obrigatório'
            });
        }

        console.log(`🔍 Verificando boleto conjunto: ${numeroBoleto}`);

        // Buscar no banco de dados por número de boleto
        const boletoEnergia = await buscarBoletoPorNumero(numeroBoleto);

        if (boletoEnergia) {
            console.log(`✅ Boleto encontrado para UC ${boletoEnergia.uc} - Atualizando status`);

            // Atualizar status para "Boleto gerado"
            const resultado = await atualizarStatusBoletoPorNumero(numeroBoleto, 'Boleto gerado');

            return res.json({
                encontrado: true,
                message: 'Boleto de energia encontrado e status atualizado',
                dados: resultado
            });
        } else {
            console.log(`ℹ️ Nenhum boleto de energia encontrado para ${numeroBoleto}`);
            return res.json({
                encontrado: false,
                message: 'Nenhum boleto de energia correspondente encontrado'
            });
        }

    } catch (error) {
        console.error('❌ Erro ao verificar boleto conjunto:', error);
        res.status(500).json({
            error: 'Erro ao verificar boleto',
            message: error.message
        });
    }
});

// ========================================
// 📦 ROTA: GET /api/boleto-dados-bb/:numeroBoleto
// Retorna dados BB salvos localmente (fallback para PDF)
// ========================================
app.get('/api/boleto-dados-bb/:numeroBoleto', async (req, res) => {
    try {
        const { numeroBoleto } = req.params;
        if (!numeroBoleto) {
            return res.status(400).json({ error: 'Numero do boleto é obrigatório' });
        }

        const resultado = await buscarRespostaBBSalva(numeroBoleto);

        if (!resultado || !resultado.dados_resposta_bb) {
            return res.status(404).json({
                error: 'Dados BB não encontrados para este boleto',
                numeroBoleto
            });
        }

        res.json({
            success: true,
            dados_bb: resultado.dados_resposta_bb,
            dados_pix: resultado.dados_pix_bb,
            data_captura: resultado.data_ultima_consulta_bb
        });
    } catch (error) {
        console.error('❌ Erro ao buscar dados BB salvos:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 🔄 ROTA: POST /api/sincronizar-status-boleto
// Consulta status real do boleto na API do BB e atualiza no banco
// ========================================
app.post('/api/sincronizar-status-boleto', async (req, res) => {
    try {
        const { numeroBoleto, token } = req.body;

        if (!numeroBoleto) {
            return res.status(400).json({
                error: 'Número do boleto é obrigatório'
            });
        }

        if (!token) {
            return res.status(400).json({
                error: 'Token OAuth é obrigatório'
            });
        }

        console.log(`🔄 Sincronizando status do boleto: ${numeroBoleto}`);

        // Buscar no banco de dados
        const boletoEnergia = await buscarBoletoPorNumero(numeroBoleto);

        if (!boletoEnergia) {
            return res.status(404).json({
                error: 'Boleto não encontrado no banco de dados'
            });
        }

        // Consultar status real na API do BB através do proxy
        const url = `https://api.bb.com.br/cobrancas/v2/boletos/${numeroBoleto}?numeroConvenio=3648981`;

        try {
            // Fazer requisição HTTPS direta para API do BB
            const response = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'api.bb.com.br',
                    port: 443,
                    path: `/cobrancas/v2/boletos/${numeroBoleto}?numeroConvenio=3648981`,
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Application-Key': '549827f7531a4cdd880437df70bf3d86',
                        'User-Agent': 'Mozilla/5.0'
                    },
                    rejectUnauthorized: false
                };

                const proxyReq = https.request(options, (proxyRes) => {
                    let data = '';
                    proxyRes.on('data', (chunk) => { data += chunk; });
                    proxyRes.on('end', () => {
                        resolve({
                            statusCode: proxyRes.statusCode,
                            body: data
                        });
                    });
                });

                proxyReq.on('error', reject);
                proxyReq.setTimeout(10000, () => {
                    proxyReq.destroy();
                    reject(new Error('Timeout na requisição'));
                });
                proxyReq.end();
            });

            console.log(`📊 Response do BB: status ${response.statusCode}`);

            // Se recebeu 401, pode ser token expirado - informar ao frontend para renovar
            if (response.statusCode === 401) {
                console.log(`⚠️ Token expirado (401 Bad Credentials)`);
                return res.status(401).json({
                    error: 'Token OAuth expirado',
                    message: 'O token OAuth fornecido expirou. Por favor, renove o token e tente novamente.',
                    tokenExpired: true
                });
            }

            if (response.statusCode === 200) {
                const dadosBB = JSON.parse(response.body);

                // Salvar resposta BB para fallback de PDF
                salvarRespostaBB(numeroBoleto, dadosBB).catch(() => {});

                console.log(`📋 Dados do BB:`, {
                    numero: dadosBB.numero,
                    estado: dadosBB.codigoEstadoTituloCobranca,
                    tipo: typeof dadosBB.codigoEstadoTituloCobranca
                });

                // Determinar status baseado na situação do boleto no BB
                // Códigos podem vir como string ou número:
                // 1 = NORMAL (Em Aberto)
                // 2 = MOVIMENTO CARTORIO
                // 3 = EM CARTORIO
                // 4 = TITULO COM OCORRENCIA DE CARTORIO
                // 5 = PROTESTADO ELETRONICO
                // 6 = LIQUIDADO
                // 7 = BAIXADO
                // 8 = TITULO COM PENDENCIA DE CARTORIO
                // 9 = TITULO PROTESTADO MANUAL
                // 10 = TITULO BAIXADO/PAGO EM CARTORIO
                // 11 = TITULO LIQUIDADO/PROTESTADO
                // 12 = TITULO LIQUID/PGCRTO
                // 13 = TITULO PROTESTADO AGUARDANDO BAIXA
                // 14 = TITULO EM LIQUIDACAO
                // 15 = TITULO AGENDADO
                // 16 = TITULO CREDITADO

                let novoStatus = 'Boleto gerado';
                const estadoStr = String(dadosBB.codigoEstadoTituloCobranca).toUpperCase();
                const estadoNum = parseInt(dadosBB.codigoEstadoTituloCobranca);

                // BAIXADO (7) ou strings BAIXADO
                if (estadoNum === 7 || estadoStr === 'BAIXADO' || estadoStr === 'BAIXADO_AUTOMATICAMENTE') {
                    novoStatus = 'Cancelado';
                }
                // LIQUIDADO (6) ou strings LIQUIDADO
                else if (estadoNum === 6 || estadoNum === 10 || estadoNum === 11 || estadoNum === 12 ||
                         estadoStr === 'LIQUIDADO' || estadoStr.includes('LIQUIDADO')) {
                    novoStatus = 'Pago';
                }
                // EXPIRADO ou VENCIDO
                else if (estadoStr === 'EXPIRADO' || estadoStr === 'VENCIDO') {
                    novoStatus = 'Vencido';
                }
                // NORMAL (1) = Em aberto
                else if (estadoNum === 1 || estadoStr === 'NORMAL' || estadoStr === 'EM ABERTO') {
                    novoStatus = 'Boleto gerado';
                }

                console.log(`📊 Status no BB: ${dadosBB.codigoEstadoTituloCobranca} -> Novo status: ${novoStatus}`);

                // Atualizar no banco se for diferente
                if (boletoEnergia.status !== novoStatus) {
                    const resultado = await atualizarStatusBoletoPorNumero(numeroBoleto, novoStatus);

                    console.log(`✅ Status atualizado no banco: ${boletoEnergia.status} -> ${novoStatus}`);

                    return res.json({
                        sincronizado: true,
                        statusAnterior: boletoEnergia.status,
                        statusAtual: novoStatus,
                        statusBB: dadosBB.codigoEstadoTituloCobranca,
                        message: 'Status sincronizado com sucesso',
                        dados: resultado
                    });
                } else {
                    console.log(`ℹ️ Status já sincronizado: ${boletoEnergia.status}`);
                    return res.json({
                        sincronizado: false,
                        statusAtual: boletoEnergia.status,
                        statusBB: dadosBB.codigoEstadoTituloCobranca,
                        message: 'Status já está sincronizado'
                    });
                }
            } else if (response.statusCode === 404) {
                console.log(`⚠️ Boleto não encontrado na API do BB`);
                return res.status(404).json({
                    error: 'Boleto não encontrado na API do BB',
                    message: 'O boleto pode ter sido deletado ou nunca existiu no sistema do Banco do Brasil'
                });
            } else {
                console.error(`❌ Erro ${response.statusCode} da API do BB:`, response.body);
                return res.status(response.statusCode).json({
                    error: 'Erro ao consultar boleto na API do BB',
                    statusCode: response.statusCode,
                    details: response.body
                });
            }

        } catch (apiError) {
            console.error('❌ Erro ao consultar API do BB:', apiError);
            return res.status(500).json({
                error: 'Erro ao consultar API do BB',
                message: apiError.message
            });
        }

    } catch (error) {
        console.error('❌ Erro ao sincronizar status:', error);
        res.status(500).json({
            error: 'Erro ao sincronizar status',
            message: error.message
        });
    }
});

// ========================================
// 📅 ROTA: PATCH /api/boleto-energia/alterar-vencimento/:numeroBoleto
// Altera a data de vencimento de um boleto na API do BB
// ========================================
app.patch('/api/boleto-energia/alterar-vencimento/:numeroBoleto', async (req, res) => {
    const { numeroBoleto } = req.params;
    const { novaDataVencimento, token } = req.body;

    console.log(`\n📅 [ALTERAR VENCIMENTO] Boleto: ${numeroBoleto}`);
    console.log(`   Nova data: ${novaDataVencimento}`);

    try {
        // Validar parâmetros
        if (!numeroBoleto || !novaDataVencimento) {
            return res.status(400).json({
                error: 'Número do boleto e nova data de vencimento são obrigatórios'
            });
        }

        if (!token) {
            return res.status(401).json({
                error: 'Token OAuth é obrigatório',
                tokenExpired: true
            });
        }

        // Verificar se boleto existe no banco local
        const boletoLocal = await pool.query(
            'SELECT * FROM boletos_energia WHERE numero_boleto = $1',
            [numeroBoleto]
        );

        if (boletoLocal.rows.length === 0) {
            return res.status(404).json({
                error: 'Boleto não encontrado no banco de dados'
            });
        }

        const boleto = boletoLocal.rows[0];

        // Formatar data para o padrão do BB (dd.mm.yyyy)
        let dataFormatadaBB;
        if (novaDataVencimento.includes('-')) {
            // Formato yyyy-mm-dd -> dd.mm.yyyy
            const [ano, mes, dia] = novaDataVencimento.split('-');
            dataFormatadaBB = `${dia}.${mes}.${ano}`;
        } else if (novaDataVencimento.includes('/')) {
            // Formato dd/mm/yyyy -> dd.mm.yyyy
            dataFormatadaBB = novaDataVencimento.replace(/\//g, '.');
        } else {
            dataFormatadaBB = novaDataVencimento;
        }

        console.log(`   Data formatada para BB: ${dataFormatadaBB}`);

        // Montar payload para API do BB
        const payloadBB = {
            numeroConvenio: 3648981,
            indicadorNovaDataVencimento: 'S',
            alteracaoData: {
                novaDataVencimento: dataFormatadaBB
            }
        };

        console.log(`   Payload BB:`, JSON.stringify(payloadBB));

        // Fazer requisição PATCH para API do BB
        const response = await new Promise((resolve, reject) => {
            const postData = JSON.stringify(payloadBB);

            const options = {
                hostname: 'api.bb.com.br',
                port: 443,
                path: `/cobrancas/v2/boletos/${numeroBoleto}`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Application-Key': '549827f7531a4cdd880437df70bf3d86',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'Mozilla/5.0'
                },
                rejectUnauthorized: false
            };

            const proxyReq = https.request(options, (proxyRes) => {
                let data = '';
                proxyRes.on('data', (chunk) => { data += chunk; });
                proxyRes.on('end', () => {
                    resolve({
                        statusCode: proxyRes.statusCode,
                        body: data
                    });
                });
            });

            proxyReq.on('error', reject);
            proxyReq.setTimeout(15000, () => {
                proxyReq.destroy();
                reject(new Error('Timeout na requisição'));
            });
            proxyReq.write(postData);
            proxyReq.end();
        });

        console.log(`   Response BB: status ${response.statusCode}`);
        console.log(`   Body:`, response.body);

        if (response.statusCode === 401) {
            return res.status(401).json({
                error: 'Token OAuth expirado',
                message: 'O token OAuth fornecido expirou. Por favor, renove o token e tente novamente.',
                tokenExpired: true
            });
        }

        if (response.statusCode === 200 || response.statusCode === 204) {
            // Sucesso! Atualizar no banco local também
            // Formatar para o banco local (dd/mm/yyyy)
            let dataFormatadaLocal;
            if (novaDataVencimento.includes('-')) {
                const [ano, mes, dia] = novaDataVencimento.split('-');
                dataFormatadaLocal = `${dia}/${mes}/${ano}`;
            } else {
                dataFormatadaLocal = novaDataVencimento;
            }

            await pool.query(
                'UPDATE boletos_energia SET data_vencimento = $1, updated_at = NOW() WHERE numero_boleto = $2',
                [dataFormatadaLocal, numeroBoleto]
            );

            console.log(`✅ [ALTERAR VENCIMENTO] Sucesso! UC ${boleto.uc} - Nova data: ${dataFormatadaLocal}`);

            return res.json({
                success: true,
                message: 'Data de vencimento alterada com sucesso',
                boleto: {
                    numero_boleto: numeroBoleto,
                    uc: boleto.uc,
                    mes_referencia: boleto.mes_referencia,
                    data_vencimento_anterior: boleto.data_vencimento,
                    data_vencimento_nova: dataFormatadaLocal
                }
            });
        } else {
            // Erro da API do BB
            let errorMessage = 'Erro ao alterar vencimento na API do BB';
            try {
                const errorData = JSON.parse(response.body);
                errorMessage = errorData.erros?.[0]?.mensagem || errorData.message || errorMessage;
            } catch (e) {
                errorMessage = response.body || errorMessage;
            }

            console.error(`❌ [ALTERAR VENCIMENTO] Erro ${response.statusCode}: ${errorMessage}`);

            return res.status(response.statusCode || 500).json({
                error: errorMessage,
                statusCode: response.statusCode,
                details: response.body
            });
        }

    } catch (error) {
        console.error('❌ [ALTERAR VENCIMENTO] Erro:', error);
        res.status(500).json({
            error: 'Erro ao alterar data de vencimento',
            message: error.message
        });
    }
});

// ========================================
// 📄 GERAÇÃO DE PDF DE BOLETOS (PUPPETEER)
// ========================================
app.post('/gerar-pdf-boleto', async (req, res) => {
    try {
        console.log('📄 Solicitação de geração de PDF recebida');
        console.log('📋 Dados do boleto:', req.body.sequencial || req.body.numeroTitulo);

        const dadosBoleto = req.body;

        // Gerar PDF usando puppeteer
        const pdfBuffer = await gerarPDFBoleto(dadosBoleto);

        // Nome do arquivo customizado para faturas de energia
        let nomeArquivo;
        let nomeArquivoBoleto; // Nome padronizado para salvar na pasta NET
        let salvarNaPastaNET = false;
        let uc, mesRef, ano, mes, nomeFormatado;

        if (dadosBoleto.dadosEnergia) {
            uc = dadosBoleto.dadosEnergia.uc || 'sem-uc';
            mesRef = dadosBoleto.dadosEnergia.mes_referencia || 'sem-mes';

            // Buscar nome do cliente de várias fontes possíveis
            const nome = dadosBoleto.nomeSacadoCobranca ||
                         dadosBoleto.pagador?.nome ||
                         dadosBoleto.nome ||
                         'sem-nome';

            // Formatar nome (primeira letra maiúscula)
            nomeFormatado = nome
                .toLowerCase()
                .split(' ')
                .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1))
                .join(' ');

            // Extrair mês e ano da string de mês de referência (formato: "MM/AAAA")
            [mes, ano] = mesRef.split('/');
            const mesesExtenso = ['', 'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const mesExtenso = mes ? mesesExtenso[parseInt(mes)] : 'sem-mes';

            nomeArquivo = `Fatura AUPUS - ${uc} - ${nome} - ${mesExtenso} ${ano || 'sem-ano'}.pdf`;
            nomeArquivoBoleto = `Boleto Aupus - ${uc} - ${nomeFormatado}.pdf`;
            salvarNaPastaNET = true;
        } else {
            nomeArquivo = `boleto-${dadosBoleto.sequencial || dadosBoleto.numeroTitulo || 'sem-numero'}.pdf`;
        }

        // Salvar também na pasta NET para boletos de energia
        if (salvarNaPastaNET && mes && ano) {
            try {
                const mesReferenciaFormatado = `${mes}.${ano}`;
                const pastaBoletos = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesReferenciaFormatado}`;

                if (!fs.existsSync(pastaBoletos)) {
                    fs.mkdirSync(pastaBoletos, { recursive: true });
                }

                const caminhoBoleto = path.join(pastaBoletos, nomeArquivoBoleto);
                fs.writeFileSync(caminhoBoleto, pdfBuffer);
                console.log(`💾 Boleto também salvo em: ${caminhoBoleto}`);
            } catch (saveError) {
                console.error('⚠️ Erro ao salvar na pasta NET (não crítico):', saveError.message);
            }
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

        console.log(`✅ PDF do boleto ${dadosBoleto.sequencial || dadosBoleto.numeroTitulo} gerado com sucesso`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ Erro ao gerar PDF:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({
            error: 'Erro na geração do PDF',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ========================================
// 📄 ROTA ALTERNATIVA PARA COMPATIBILIDADE (MANTENDO)
// ========================================
app.post('/api/gerar-pdf', (req, res) => {
    console.log('🔄 Redirecionando para /gerar-pdf-boleto');
    req.url = '/gerar-pdf-boleto';
    app.handle(req, res);
});

// ========================================
// 📄 DOWNLOAD INDIVIDUAL COM OPÇÃO DE JUNTAR
// ========================================
app.post('/baixar-boleto-individual', async (req, res) => {
    try {
        console.log('📄 Solicitação de download individual com junção');

        const { boleto, dadosParaPDF, oauth_token, juntar_com_fatura } = req.body;
        const developerKey = '549827f7531a4cdd880437df70bf3d86';

        if (!boleto || !dadosParaPDF) {
            return res.status(400).json({ error: 'Dados do boleto ausentes' });
        }

        console.log(`📥 Processando boleto UC ${boleto.uc}`);
        console.log(`🔗 Juntar com fatura: ${juntar_com_fatura ? 'SIM' : 'NÃO'}`);

        // Gerar PDF do boleto
        const pdfBuffer = await gerarPDFBoleto(dadosParaPDF);

        // Nome formatado (primeira letra maiúscula)
        const nomeFormatado = (boleto.nome_completo || 'Sem Nome')
            .toLowerCase()
            .split(' ')
            .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1))
            .join(' ');

        const nomeArquivoBoleto = `Boleto Aupus - ${boleto.uc} - ${nomeFormatado}.pdf`;

        // Normalizar mes_referencia (pode vir como "10/2025" ou "10.2025")
        const [mes, ano] = (boleto.mes_referencia || '').split(/[./]/);
        if (!mes || !ano) {
            throw new Error(`mes_referencia inválido: ${boleto.mes_referencia}`);
        }
        const mesReferenciaFormatado = `${mes}.${ano}`;

        // SEMPRE salvar boleto na pasta NET (novo caminho microservicos)
        const pastaBoletos = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesReferenciaFormatado}`;
        if (!fs.existsSync(pastaBoletos)) {
            fs.mkdirSync(pastaBoletos, { recursive: true });
        }
        const caminhoBoleto = path.join(pastaBoletos, nomeArquivoBoleto);
        fs.writeFileSync(caminhoBoleto, pdfBuffer);
        console.log(`  💾 Boleto salvo: ${caminhoBoleto}`);

        // Se deve juntar com fatura
        if (juntar_com_fatura) {
            console.log(`  🔗 Juntando com fatura original da UC ${boleto.uc}...`);

            // Verificar se fatura existe na pasta de arquivos (busca recursiva em subpastas)
            const pastaFaturas = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesReferenciaFormatado}`;

            let faturaEncontrada = false;
            if (fs.existsSync(pastaFaturas)) {
                // Primeiro verifica na pasta raiz
                const arquivos = fs.readdirSync(pastaFaturas);
                faturaEncontrada = arquivos.some(arq => {
                    const caminho = path.join(pastaFaturas, arq);
                    return fs.statSync(caminho).isFile() && arq.includes(boleto.uc.toString()) && arq.toLowerCase().endsWith('.pdf');
                });

                // Se não encontrou, buscar nas subpastas (Grupo A, Grupo B, etc.)
                if (!faturaEncontrada) {
                    for (const subpasta of arquivos) {
                        const subpastaPath = path.join(pastaFaturas, subpasta);
                        if (fs.statSync(subpastaPath).isDirectory()) {
                            const arquivosSub = fs.readdirSync(subpastaPath);
                            if (arquivosSub.some(arq => arq.includes(boleto.uc.toString()) && arq.toLowerCase().endsWith('.pdf'))) {
                                faturaEncontrada = true;
                                break;
                            }
                        }
                    }
                }
            }

            if (faturaEncontrada) {
                console.log(`  📄 Fatura encontrada para UC ${boleto.uc}`);

                // Usar Python para juntar PDFs
                const { spawn } = require('child_process');
                const pythonInput = JSON.stringify({
                    uc: boleto.uc.toString(),
                    nome: nomeFormatado,
                    mes_referencia: mesReferenciaFormatado,
                    ano: ano,
                    boleto_path: caminhoBoleto,
                    imagem_path: '/var/www/aupus-microservicos-faturas/dados/_Controles/PAGO.png',
                    temp_dir: '/tmp',
                    output_dir: `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesReferenciaFormatado}`
                });

                const pastaCombinados = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesReferenciaFormatado}`;
                if (!fs.existsSync(pastaCombinados)) {
                    fs.mkdirSync(pastaCombinados, { recursive: true });
                }

                const python = spawn('python3', ['/var/www/api-bb/server/merge_pdfs.py']);
                python.stdin.write(pythonInput);
                python.stdin.end();

                let pythonOutput = '';
                let pythonError = '';

                python.stdout.on('data', (data) => {
                    pythonOutput += data.toString();
                });

                python.stderr.on('data', (data) => {
                    pythonError += data.toString();
                });

                await new Promise((resolve) => {
                    python.on('close', (code) => {
                        console.log(`  📋 Python merge finalizado com código ${code}`);

                        if (pythonError) {
                            console.error(`  ❌ Erro Python: ${pythonError}`);
                        }

                        if (code === 0 && pythonOutput) {
                            try {
                                const result = JSON.parse(pythonOutput);
                                console.log(`  ✅ PDF combinado: ${result.success ? 'SIM' : 'NÃO'}`);
                                if (!result.success && result.error) {
                                    console.error(`  ❌ Detalhes: ${result.error}`);
                                }
                            } catch (e) {
                                console.error(`  ⚠️ Erro ao parsear resultado Python: ${e.message}`);
                                console.error(`  Output: ${pythonOutput}`);
                            }
                        }
                        resolve();
                    });
                });

                // Ler e retornar o PDF combinado diretamente
                const nomePDFCombinado = `Fatura AUPUS - ${boleto.uc} - ${nomeFormatado}.pdf`;
                const caminhoCombinado = path.join(pastaCombinados, nomePDFCombinado);

                if (fs.existsSync(caminhoCombinado)) {
                    console.log(`  ✅ Retornando PDF combinado para download`);
                    const pdfCombinado = fs.readFileSync(caminhoCombinado);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nomePDFCombinado)}"`);
                    return res.send(pdfCombinado);
                } else {
                    console.error(`  ❌ PDF combinado não encontrado: ${caminhoCombinado}`);
                    return res.status(500).json({
                        error: 'PDF combinado não encontrado após geração'
                    });
                }
            } else {
                console.log(`  ⚠️ Fatura original não encontrada para UC ${boleto.uc}`);
            }
        }

        // Se não juntou ou não tinha fatura, retornar apenas o boleto
        return res.json({
            success: true,
            message: 'Boleto gerado',
            caminho: caminhoBoleto,
            tipo: 'boleto'
        });

    } catch (error) {
        console.error('❌ Erro ao processar boleto individual:', error.message);
        return res.status(500).json({
            error: 'Erro ao processar boleto',
            message: error.message
        });
    }
});

// ========================================
// 📄 SERVIR PDF COMBINADO (DOWNLOAD)
// ========================================
app.get('/pdf-combinado/:ano/:mes_referencia/:arquivo', (req, res) => {
    try {
        const { ano, mes_referencia, arquivo } = req.params;
        const filePath = path.join(
            '/var/www/aupus-microservicos-faturas/dados/processados/NET Completo',
            ano,
            mes_referencia,
            decodeURIComponent(arquivo)
        );

        console.log(`📥 Solicitação de PDF combinado: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            console.error(`❌ Arquivo não encontrado: ${filePath}`);
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(arquivo)}"`);
        res.sendFile(filePath);
    } catch (error) {
        console.error('❌ Erro ao servir PDF combinado:', error.message);
        res.status(500).json({ error: 'Erro ao servir arquivo', message: error.message });
    }
});

// ========================================
// 📱 ENVIAR BOLETO POR WHATSAPP (INDIVIDUAL)
// ========================================
app.post('/enviar-boleto-whatsapp', async (req, res) => {
    try {
        console.log('📱 Solicitação de envio por WhatsApp');

        const { boleto, dadosParaPDF, telefone, mensagem_customizada } = req.body;

        if (!boleto || !dadosParaPDF || !telefone) {
            return res.status(400).json({ error: 'Dados insuficientes para envio' });
        }

        console.log(`📱 Enviando boleto UC ${boleto.uc} para WhatsApp ${telefone}`);

        // Gerar PDF do boleto
        const pdfBuffer = await gerarPDFBoleto(dadosParaPDF);

        // Converter PDF para base64
        const pdfBase64 = pdfBuffer.toString('base64');

        // Nome do arquivo
        const nomeFormatado = (boleto.nome_completo || 'Cliente')
            .toLowerCase()
            .split(' ')
            .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1))
            .join(' ');

        const nomeArquivo = `Boleto_Aupus_${boleto.uc}.pdf`;

        // Normalizar mes_referencia
        const [mes, ano] = (boleto.mes_referencia || '').split(/[./]/);
        const mesReferenciaFormatado = `${mes}.${ano}`;

        // Salvar boleto na pasta NET (novo caminho microservicos)
        const pastaBoletos = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesReferenciaFormatado}`;
        if (!fs.existsSync(pastaBoletos)) {
            fs.mkdirSync(pastaBoletos, { recursive: true });
        }
        const nomeArquivoBoleto = `Boleto Aupus - ${boleto.uc} - ${nomeFormatado}.pdf`;
        const caminhoBoleto = path.join(pastaBoletos, nomeArquivoBoleto);
        fs.writeFileSync(caminhoBoleto, pdfBuffer);
        console.log(`  💾 Boleto salvo: ${caminhoBoleto}`);

        // Extrair data de vencimento
        const dataVencimento = dadosParaPDF.dataVencimento || dadosParaPDF.dataVencimentoTitulo || 'N/A';

        // Mensagem padrão ou customizada
        const mensagem = mensagem_customizada || `Olá! Segue o boleto referente à fatura de energia do mês ${mes}/${ano}.\n\nVencimento: ${dataVencimento}\n\nQualquer dúvida, estamos à disposição!`;

        // Enviar para Evolution API
        const evolutionApiUrl = 'https://evolution.aupusenergia.com.br/message/sendMedia/aupus-instance';
        const evolutionApiKey = 'B6D711FCDE4D4FD5936544120E713976';

        const payload = {
            number: telefone,
            mediatype: 'document',
            mimetype: 'application/pdf',
            caption: mensagem,
            fileName: nomeArquivo,
            media: `data:application/pdf;base64,${pdfBase64}`
        };

        const response = await axios.post(evolutionApiUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionApiKey
            }
        });

        console.log(`✅ Boleto enviado para WhatsApp ${telefone}`);

        return res.json({
            success: true,
            message: 'Boleto enviado com sucesso',
            telefone,
            evolutionResponse: response.data
        });

    } catch (error) {
        console.error('❌ Erro ao enviar boleto por WhatsApp:', error.message);
        return res.status(500).json({
            error: 'Erro ao enviar boleto',
            message: error.message
        });
    }
});

// ========================================
// 📂 SISTEMA DE FATURAS - MESES DISPONÍVEIS
// ========================================
app.get('/api/meses-disponiveis', (req, res) => {
    try {
        const basePath = '/var/www/aupus-microservicos-faturas/dados/arquivos';
        const mesesDisponiveis = [];

        // Listar anos
        const anos = fs.readdirSync(basePath).filter(item => {
            const itemPath = path.join(basePath, item);
            return fs.statSync(itemPath).isDirectory() && /^\d{4}$/.test(item);
        }).sort((a, b) => parseInt(b) - parseInt(a));

        // Para cada ano, listar meses
        anos.forEach(ano => {
            const anoPath = path.join(basePath, ano);
            const meses = fs.readdirSync(anoPath).filter(item => {
                const itemPath = path.join(anoPath, item);
                return fs.statSync(itemPath).isDirectory() && /^\d{1,2}\.\d{4}$/.test(item);
            }).sort((a, b) => {
                const [mesA] = a.split('.');
                const [mesB] = b.split('.');
                return parseInt(mesB) - parseInt(mesA);
            });

            meses.forEach(mes => {
                mesesDisponiveis.push({
                    ano,
                    mes,
                    label: mes.replace('.', '/')
                });
            });
        });

        res.json(mesesDisponiveis);
    } catch (error) {
        console.error('Erro ao listar meses:', error);
        res.status(500).json({ error: 'Erro ao listar meses disponíveis' });
    }
});

// ========================================
// 📂 SISTEMA DE FATURAS - BUSCA RECURSIVA
// ========================================
app.get('/api/sistema-faturas/buscar', (req, res) => {
    try {
        const { pasta, mes_referencia, termo } = req.query;

        if (!pasta || !mes_referencia || !termo) {
            return res.status(400).json({ error: 'Parâmetros pasta, mes_referencia e termo são obrigatórios' });
        }

        // Suporta tanto 11/2025 quanto 11.2025
        const separator = mes_referencia.includes('/') ? '/' : '.';
        const [mes, ano] = mes_referencia.split(separator);
        const mesFormatado = `${mes}.${ano}`;

        // Mapear pasta para novo caminho (case insensitive)
        const pastaUpper = pasta.toUpperCase();
        let basePath;
        if (pastaUpper === 'FATURAS' || pastaUpper === '01. FATURAS') {
            basePath = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET' || pastaUpper === '02. NET') {
            basePath = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET COMPLETO' || pastaUpper === '03. NET COMPLETO' || pastaUpper === 'PDF_COMBINADO' || pastaUpper === '04. PDF COMBINADO') {
            basePath = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`;
        } else {
            basePath = `/var/www/aupus-microservicos-faturas/dados/${pasta}/${ano}/${mesFormatado}`;
        }

        if (!fs.existsSync(basePath)) {
            return res.json({ resultados: [], total: 0 });
        }

        // Função recursiva para buscar arquivos
        const buscarRecursivo = (dir, subpastaRelativa = null) => {
            const resultados = [];
            const items = fs.readdirSync(dir);

            items.forEach(item => {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    // Buscar recursivamente dentro da subpasta
                    const novaSubpasta = subpastaRelativa ? `${subpastaRelativa}/${item}` : item;
                    resultados.push(...buscarRecursivo(itemPath, novaSubpasta));
                } else if (stats.isFile() && item.toLowerCase().endsWith('.pdf')) {
                    // Verificar se o nome do arquivo contém o termo de busca (case insensitive)
                    const termoLower = termo.toLowerCase();
                    const nomeLower = item.toLowerCase();

                    if (nomeLower.includes(termoLower)) {
                        resultados.push({
                            nome: item,
                            subpasta: subpastaRelativa,
                            tamanho: stats.size,
                            data_modificacao: stats.mtime,
                            caminho_completo: subpastaRelativa ? `${subpastaRelativa}/${item}` : item
                        });
                    }
                }
            });

            return resultados;
        };

        const resultados = buscarRecursivo(basePath);

        // Ordenar por nome
        resultados.sort((a, b) => a.nome.localeCompare(b.nome));

        res.json({
            resultados,
            total: resultados.length,
            termo,
            pasta,
            mes_referencia
        });
    } catch (error) {
        console.error('Erro na busca:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📂 SISTEMA DE FATURAS - LISTAR MESES
// ========================================
app.get('/api/sistema-faturas/meses', (req, res) => {
    try {
        const basePath = '/var/www/aupus-microservicos-faturas/dados/arquivos';
        const meses = [];

        if (!fs.existsSync(basePath)) {
            return res.json([]);
        }

        const anos = fs.readdirSync(basePath)
            .filter(item => fs.statSync(path.join(basePath, item)).isDirectory())
            .sort((a, b) => parseInt(b) - parseInt(a));

        anos.forEach(ano => {
            const anoPath = path.join(basePath, ano);
            const mesesAno = fs.readdirSync(anoPath)
                .filter(item => fs.statSync(path.join(anoPath, item)).isDirectory())
                .map(mes => ({ ano, mes }));
            meses.push(...mesesAno);
        });

        res.json(meses);
    } catch (error) {
        console.error('Erro ao listar meses:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📂 SISTEMA DE FATURAS - LISTAR ARQUIVOS
// Mapeamento de pastas para novos caminhos:
// - Faturas -> arquivos
// - NET -> processados/NET
// - NET Completo -> processados/NET Completo
// ========================================
app.get('/api/sistema-faturas/arquivos', (req, res) => {
    try {
        const { pasta, mes_referencia, subpasta } = req.query;

        if (!pasta || !mes_referencia) {
            return res.status(400).json({ error: 'Parâmetros pasta e mes_referencia são obrigatórios' });
        }

        // Suporta tanto 11/2025 quanto 11.2025
        const separator = mes_referencia.includes('/') ? '/' : '.';
        const [mes, ano] = mes_referencia.split(separator);
        const mesFormatado = `${mes}.${ano}`;

        // Mapear pasta para novo caminho (case insensitive)
        const pastaUpper = pasta.toUpperCase();
        let basePath;
        if (pastaUpper === 'FATURAS' || pastaUpper === '01. FATURAS') {
            basePath = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET' || pastaUpper === '02. NET') {
            basePath = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET COMPLETO' || pastaUpper === '03. NET COMPLETO' || pastaUpper === 'PDF_COMBINADO' || pastaUpper === '04. PDF COMBINADO') {
            basePath = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`;
        } else {
            basePath = `/var/www/aupus-microservicos-faturas/dados/${pasta}/${ano}/${mesFormatado}`;
        }

        // Se tem subpasta, adicionar ao caminho
        if (subpasta) {
            basePath = `${basePath}/${subpasta}`;
        }

        if (!fs.existsSync(basePath)) {
            return res.json({ arquivos: [], pastas: [] });
        }

        const items = fs.readdirSync(basePath);
        const arquivos = [];
        const pastas = [];

        items.forEach(item => {
            const itemPath = path.join(basePath, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                pastas.push({
                    nome: item,
                    tipo: 'pasta'
                });
            } else if (stats.isFile() && item.toLowerCase().endsWith('.pdf')) {
                arquivos.push({
                    nome: item,
                    tipo: 'arquivo',
                    tamanho: stats.size,
                    dataModificacao: stats.mtime
                });
            }
        });

        res.json({ arquivos, pastas });
    } catch (error) {
        console.error('Erro ao listar arquivos:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📂 SISTEMA DE FATURAS - DOWNLOAD
// ========================================
app.get('/api/sistema-faturas/download', (req, res) => {
    try {
        const { pasta, mes_referencia, arquivo, subpasta } = req.query;

        if (!pasta || !mes_referencia || !arquivo) {
            return res.status(400).json({ error: 'Parâmetros inválidos' });
        }

        // Suporta tanto 11/2025 quanto 11.2025
        const separator = mes_referencia.includes('/') ? '/' : '.';
        const [mes, ano] = mes_referencia.split(separator);
        const mesFormatado = `${mes}.${ano}`;

        // Mapear pasta para novo caminho (case insensitive)
        const pastaUpper = pasta.toUpperCase();
        let pastaBase;
        if (pastaUpper === 'FATURAS' || pastaUpper === '01. FATURAS') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET' || pastaUpper === '02. NET') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET COMPLETO' || pastaUpper === '03. NET COMPLETO' || pastaUpper === 'PDF_COMBINADO' || pastaUpper === '04. PDF COMBINADO') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`;
        } else {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/${pasta}/${ano}/${mesFormatado}`;
        }

        let diretorioBusca = pastaBase;
        if (subpasta) {
            diretorioBusca = `${diretorioBusca}/${subpasta}`;
        }

        // Usar função de busca com fallback para acentos
        const resultadoBusca = buscarArquivoComFallback(diretorioBusca, arquivo);

        if (!resultadoBusca.encontrado) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        res.download(resultadoBusca.caminho, resultadoBusca.nomeReal);
    } catch (error) {
        console.error('Erro ao fazer download:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📂 SISTEMA DE FATURAS - VISUALIZAR
// ========================================
app.get('/api/sistema-faturas/visualizar', (req, res) => {
    try {
        const { pasta, mes_referencia, arquivo, subpasta } = req.query;

        if (!pasta || !mes_referencia || !arquivo) {
            return res.status(400).json({ error: 'Parâmetros inválidos' });
        }

        // Suporta tanto 11/2025 quanto 11.2025
        const separator = mes_referencia.includes('/') ? '/' : '.';
        const [mes, ano] = mes_referencia.split(separator);
        const mesFormatado = `${mes}.${ano}`;

        // Mapear pasta para novo caminho (case insensitive)
        const pastaUpper = pasta.toUpperCase();
        let pastaBase;
        if (pastaUpper === 'FATURAS' || pastaUpper === '01. FATURAS') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET' || pastaUpper === '02. NET') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET COMPLETO' || pastaUpper === '03. NET COMPLETO' || pastaUpper === 'PDF_COMBINADO' || pastaUpper === '04. PDF COMBINADO') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`;
        } else {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/${pasta}/${ano}/${mesFormatado}`;
        }

        let diretorioBusca = pastaBase;
        if (subpasta) {
            diretorioBusca = `${diretorioBusca}/${subpasta}`;
        }

        // Usar função de busca com fallback para acentos
        const resultadoBusca = buscarArquivoComFallback(diretorioBusca, arquivo);

        if (!resultadoBusca.encontrado) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.sendFile(resultadoBusca.caminho);
    } catch (error) {
        console.error('Erro ao visualizar arquivo:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📱 SISTEMA DE FATURAS - ENVIAR POR WHATSAPP
// ========================================
app.post('/api/sistema-faturas/enviar-whatsapp', authenticateToken, async (req, res) => {
    try {
        const { pasta, mes_referencia, arquivo, subpasta, telefone, mensagem_customizada, forcar_reenvio, dados_boleto } = req.body;

        // Log detalhado para debug
        console.log(`📤 [ENVIO WHATSAPP] Recebido:`);
        console.log(`   - Pasta: ${pasta}`);
        console.log(`   - Mês: ${mes_referencia}`);
        console.log(`   - Arquivo: ${arquivo}`);
        console.log(`   - Telefone: ${telefone}`);

        if (!pasta || !mes_referencia || !arquivo || !telefone) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: pasta, mes_referencia, arquivo, telefone' });
        }

        // Formatar telefone (remover caracteres especiais, adicionar 55 se necessário)
        let telefoneFormatado = telefone.replace(/\D/g, '');
        if (telefoneFormatado.length === 11) {
            telefoneFormatado = '55' + telefoneFormatado;
        } else if (telefoneFormatado.length === 10) {
            telefoneFormatado = '55' + telefoneFormatado;
        }

        // Montar caminho do arquivo (movido para antes da verificação de envio existente)
        const separator = mes_referencia.includes('/') ? '/' : '.';
        const [mes, ano] = mes_referencia.split(separator);
        const mesFormatado = `${mes}.${ano}`;

        const pastaUpper = pasta.toUpperCase();
        let pastaBase;
        if (pastaUpper === 'FATURAS' || pastaUpper === '01. FATURAS') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET' || pastaUpper === '02. NET') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET COMPLETO' || pastaUpper === '03. NET COMPLETO' || pastaUpper === 'PDF_COMBINADO' || pastaUpper === '04. PDF COMBINADO') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`;
        } else {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/${pasta}/${ano}/${mesFormatado}`;
        }

        let diretorioBusca = pastaBase;
        if (subpasta) {
            diretorioBusca = `${diretorioBusca}/${subpasta}`;
        }

        // Usar função de busca com fallback para acentos
        let resultadoBusca = buscarArquivoComFallback(diretorioBusca, arquivo);
        let filePath = resultadoBusca.caminho;
        let arquivoReal = resultadoBusca.nomeReal;

        console.log(`   - Caminho completo: ${filePath}`);
        console.log(`   - Arquivo existe? ${resultadoBusca.encontrado}`);
        if (resultadoBusca.encontrado && arquivoReal !== arquivo) {
            console.log(`   - 🔄 Nome corrigido de "${arquivo}" para "${arquivoReal}"`);
        }

        // Se arquivo não existe e temos dados do boleto, gerar o PDF
        if (!resultadoBusca.encontrado && dados_boleto) {
            console.log(`📄 Arquivo não encontrado. Gerando boleto automaticamente...`);
            try {
                const pdfBuffer = await gerarPDFBoleto(dados_boleto);

                // Criar diretório se não existir
                if (!fs.existsSync(pastaBase)) {
                    fs.mkdirSync(pastaBase, { recursive: true });
                }

                // Salvar o arquivo
                fs.writeFileSync(filePath, pdfBuffer);
                console.log(`✅ Boleto gerado e salvo em: ${filePath}`);
                resultadoBusca.encontrado = true;
            } catch (genError) {
                console.error('❌ Erro ao gerar boleto:', genError);
                return res.status(500).json({ error: 'Erro ao gerar boleto automaticamente', message: genError.message });
            }
        }

        if (!resultadoBusca.encontrado) {
            return res.status(404).json({ error: 'Arquivo não encontrado e não foi possível gerar', path: filePath });
        }

        // Verificar se já foi enviado anteriormente para este mês específico
        const mesRefFormatado = `${mes}/${ano}`;
        const envioExistente = await verificarEnvioExistente(arquivo, 'whatsapp', telefoneFormatado, mesRefFormatado);
        if (envioExistente && !forcar_reenvio) {
            return res.status(409).json({
                error: 'Arquivo já enviado',
                ja_enviado: true,
                envio_anterior: {
                    data: envioExistente.data_envio,
                    destinatario: envioExistente.destinatario,
                    status: envioExistente.status,
                    mes_referencia: envioExistente.mes_referencia
                },
                mensagem: `Este arquivo já foi enviado para ${telefoneFormatado} em ${new Date(envioExistente.data_envio).toLocaleString('pt-BR')} (ref: ${envioExistente.mes_referencia})`
            });
        }

        // Gerar link público para download do arquivo (usar nome real do arquivo)
        const baseUrl = process.env.REACT_APP_API_URL || 'https://api-bb.aupusenergia.com.br';
        const downloadParams = new URLSearchParams({
            pasta: pasta,
            mes_referencia: `${mes}.${ano}`,
            arquivo: arquivoReal
        });
        if (subpasta) {
            downloadParams.append('subpasta', subpasta);
        }
        const linkDownload = `${baseUrl}/api/sistema-faturas/download?${downloadParams.toString()}`;

        // Mensagem padrão com link
        let mensagem;
        if (mensagem_customizada) {
            // Substituir placeholder pelo link real
            mensagem = mensagem_customizada.replace('[LINK SERÁ INSERIDO AUTOMATICAMENTE]', linkDownload);
        } else {
            mensagem = `Olá! Segue sua fatura de energia referente ao mês ${mes}/${ano}.\n\n📄 *Baixar Fatura:*\n${linkDownload}\n\nQualquer dúvida, estamos à disposição!\n\n*AUPUS Energia*`;
        }

        // Configuração do ChatCenter API
        const chatcenterApiUrl = process.env.CHATCENTER_API_URL || 'https://api.multiweb.plus/send/chat/';
        const chatcenterApiKey = process.env.CHATCENTER_API_KEY || '684c757bdcb05b125e26b1c6';

        console.log(`📱 Enviando ${arquivo} para WhatsApp ${telefoneFormatado}...`);
        console.log(`   API: ChatCenter`);
        console.log(`   Link: ${linkDownload}`);

        const payload = {
            key: chatcenterApiKey,
            numero: telefoneFormatado,
            texto: mensagem
        };

        const response = await axios.post(chatcenterApiUrl, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Registrar envio bem-sucedido
        await registrarEnvio({
            arquivo,
            pasta,
            mes_referencia: `${mes}/${ano}`,
            tipo_envio: 'whatsapp',
            destinatario: telefoneFormatado,
            status: 'enviado',
            mensagem,
            resposta_api: JSON.stringify(response.data),
            enviado_por: req.user?.email || 'sistema'
        });

        console.log(`✅ WhatsApp enviado com sucesso para ${telefoneFormatado}`);

        res.json({
            success: true,
            message: 'Arquivo enviado com sucesso via WhatsApp',
            destinatario: telefoneFormatado,
            arquivo,
            linkEnviado: linkDownload,
            apiResponse: response.data
        });

    } catch (error) {
        console.error('❌ Erro ao enviar por WhatsApp:', error.message);

        // Registrar falha
        try {
            await registrarEnvio({
                arquivo: req.body.arquivo,
                pasta: req.body.pasta,
                mes_referencia: req.body.mes_referencia,
                tipo_envio: 'whatsapp',
                destinatario: req.body.telefone?.replace(/\D/g, ''),
                status: 'falha',
                mensagem: req.body.mensagem_customizada,
                resposta_api: error.message,
                enviado_por: req.user?.email || 'sistema'
            });
        } catch (regError) {
            console.error('Erro ao registrar falha:', regError);
        }

        res.status(500).json({
            error: 'Erro ao enviar por WhatsApp',
            message: error.message,
            details: error.response?.data
        });
    }
});

// ========================================
// 📧 SISTEMA DE FATURAS - ENVIAR POR EMAIL
// ========================================
app.post('/api/sistema-faturas/enviar-email', authenticateToken, async (req, res) => {
    try {
        const { pasta, mes_referencia, arquivo, subpasta, email, email_secundario, assunto_customizado, mensagem_customizada, forcar_reenvio, dados_boleto } = req.body;

        if (!pasta || !mes_referencia || !arquivo || !email) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: pasta, mes_referencia, arquivo, email' });
        }

        // Validar emails
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email principal inválido' });
        }
        if (email_secundario && !emailRegex.test(email_secundario)) {
            return res.status(400).json({ error: 'Email secundário inválido' });
        }

        // Montar lista de emails para enviar
        const emailsParaEnviar = [email];
        if (email_secundario) {
            emailsParaEnviar.push(email_secundario);
        }

        // Montar caminho do arquivo
        const separator = mes_referencia.includes('/') ? '/' : '.';
        const [mes, ano] = mes_referencia.split(separator);

        // Verificar se já foi enviado anteriormente para este mês específico (apenas email principal para controle)
        const mesRefFormatado = `${mes}/${ano}`;
        const envioExistente = await verificarEnvioExistente(arquivo, 'email', email, mesRefFormatado);
        if (envioExistente && !forcar_reenvio) {
            return res.status(409).json({
                error: 'Arquivo já enviado',
                ja_enviado: true,
                envio_anterior: {
                    data: envioExistente.data_envio,
                    destinatario: envioExistente.destinatario,
                    status: envioExistente.status,
                    mes_referencia: envioExistente.mes_referencia
                },
                mensagem: `Este arquivo já foi enviado para ${email} em ${new Date(envioExistente.data_envio).toLocaleString('pt-BR')} (ref: ${envioExistente.mes_referencia})`
            });
        }
        const mesFormatado = `${mes}.${ano}`;

        const pastaUpper = pasta.toUpperCase();
        let pastaBase;
        if (pastaUpper === 'FATURAS' || pastaUpper === '01. FATURAS') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/arquivos/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET' || pastaUpper === '02. NET') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`;
        } else if (pastaUpper === 'NET COMPLETO' || pastaUpper === '03. NET COMPLETO' || pastaUpper === 'PDF_COMBINADO' || pastaUpper === '04. PDF COMBINADO') {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`;
        } else {
            pastaBase = `/var/www/aupus-microservicos-faturas/dados/${pasta}/${ano}/${mesFormatado}`;
        }

        let diretorioBusca = pastaBase;
        if (subpasta) {
            diretorioBusca = `${diretorioBusca}/${subpasta}`;
        }

        // Usar função de busca com fallback para acentos
        let resultadoBusca = buscarArquivoComFallback(diretorioBusca, arquivo);
        let filePath = resultadoBusca.caminho;
        let arquivoReal = resultadoBusca.nomeReal;

        console.log(`   - Caminho completo: ${filePath}`);
        console.log(`   - Arquivo existe? ${resultadoBusca.encontrado}`);
        if (resultadoBusca.encontrado && arquivoReal !== arquivo) {
            console.log(`   - 🔄 Nome corrigido de "${arquivo}" para "${arquivoReal}"`);
        }

        // Se arquivo não existe e temos dados do boleto, gerar o PDF
        if (!resultadoBusca.encontrado && dados_boleto) {
            console.log(`📄 Arquivo não encontrado. Gerando boleto automaticamente para email...`);
            try {
                const pdfBuffer = await gerarPDFBoleto(dados_boleto);

                // Criar diretório se não existir
                if (!fs.existsSync(pastaBase)) {
                    fs.mkdirSync(pastaBase, { recursive: true });
                }

                // Salvar o arquivo
                fs.writeFileSync(filePath, pdfBuffer);
                console.log(`✅ Boleto gerado e salvo em: ${filePath}`);
                resultadoBusca.encontrado = true;
            } catch (genError) {
                console.error('❌ Erro ao gerar boleto:', genError);
                return res.status(500).json({ error: 'Erro ao gerar boleto automaticamente', message: genError.message });
            }
        }

        if (!resultadoBusca.encontrado) {
            return res.status(404).json({ error: 'Arquivo não encontrado e não foi possível gerar', path: filePath });
        }

        // Configurar transporter do nodemailer
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER || 'financeiro@aupusenergia.com.br',
                pass: process.env.SMTP_PASS || ''
            }
        });

        // Assunto e corpo do email
        const assunto = assunto_customizado || `Fatura de Energia - ${mes}/${ano} - AUPUS Energia`;
        const corpo = mensagem_customizada || `
Prezado(a) Cliente,

Segue em anexo sua fatura de energia referente ao mês ${mes}/${ano}.

Qualquer dúvida, estamos à disposição.

Atenciosamente,
AUPUS Energia
financeiro@aupusenergia.com.br
        `.trim();

        console.log(`📧 Enviando ${arquivoReal} para ${emailsParaEnviar.length} destinatário(s): ${emailsParaEnviar.join(', ')}...`);

        // Enviar email para todos os destinatários
        const resultadosEnvio = [];
        for (const emailDestino of emailsParaEnviar) {
            try {
                const info = await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"AUPUS Energia" <financeiro@aupusenergia.com.br>',
                    to: emailDestino,
                    subject: assunto,
                    text: corpo,
                    html: corpo.replace(/\n/g, '<br>'),
                    attachments: [
                        {
                            filename: arquivoReal,
                            path: filePath
                        }
                    ]
                });

                // Registrar envio bem-sucedido
                await registrarEnvio({
                    arquivo,
                    pasta,
                    mes_referencia: `${mes}/${ano}`,
                    tipo_envio: 'email',
                    destinatario: emailDestino,
                    status: 'enviado',
                    mensagem: `Assunto: ${assunto}`,
                    resposta_api: JSON.stringify({ messageId: info.messageId }),
                    enviado_por: req.user?.email || 'sistema'
                });

                console.log(`✅ Email enviado com sucesso para ${emailDestino}`);
                resultadosEnvio.push({ email: emailDestino, success: true, messageId: info.messageId });
            } catch (emailError) {
                console.error(`❌ Erro ao enviar para ${emailDestino}:`, emailError.message);

                // Registrar falha para este email específico
                try {
                    await registrarEnvio({
                        arquivo,
                        pasta,
                        mes_referencia: `${mes}/${ano}`,
                        tipo_envio: 'email',
                        destinatario: emailDestino,
                        status: 'falha',
                        mensagem: `Assunto: ${assunto}`,
                        resposta_api: emailError.message,
                        enviado_por: req.user?.email || 'sistema'
                    });
                } catch (regError) {
                    console.error('Erro ao registrar falha:', regError);
                }

                resultadosEnvio.push({ email: emailDestino, success: false, error: emailError.message });
            }
        }

        // Verificar resultados
        const sucessos = resultadosEnvio.filter(r => r.success);
        const falhas = resultadosEnvio.filter(r => !r.success);

        if (sucessos.length === 0) {
            // Todos falharam - verificar se é rate limit
            const isRateLimit = falhas.some(f => f.error && f.error.includes('Ratelimit'));
            return res.status(500).json({
                error: isRateLimit
                    ? 'Limite de envio de emails atingido (Hostinger). Aguarde alguns minutos e tente novamente.'
                    : 'Erro ao enviar emails',
                message: isRateLimit
                    ? 'O servidor de email está temporariamente bloqueado por excesso de envios. Tente novamente em 10-15 minutos.'
                    : 'Nenhum email foi enviado com sucesso',
                resultados: resultadosEnvio
            });
        }

        // Pelo menos um sucesso
        res.json({
            success: true,
            message: falhas.length > 0
                ? `Arquivo enviado para ${sucessos.length} de ${emailsParaEnviar.length} destinatário(s)`
                : 'Arquivo enviado com sucesso via Email',
            destinatarios: emailsParaEnviar,
            arquivo,
            resultados: resultadosEnvio
        });

    } catch (error) {
        console.error('❌ Erro ao enviar por Email:', error.message);

        // Registrar falha
        try {
            await registrarEnvio({
                arquivo: req.body.arquivo,
                pasta: req.body.pasta,
                mes_referencia: req.body.mes_referencia,
                tipo_envio: 'email',
                destinatario: req.body.email,
                status: 'falha',
                mensagem: `Assunto: ${req.body.assunto_customizado || 'padrão'}`,
                resposta_api: error.message,
                enviado_por: req.user?.email || 'sistema'
            });
        } catch (regError) {
            console.error('Erro ao registrar falha:', regError);
        }

        res.status(500).json({
            error: 'Erro ao enviar por Email',
            message: error.message
        });
    }
});

// ========================================
// 📋 SISTEMA DE FATURAS - VERIFICAR STATUS ENVIO
// ========================================
app.get('/api/sistema-faturas/verificar-envio', authenticateToken, async (req, res) => {
    try {
        const { arquivo, tipo_envio, destinatario, mes_referencia } = req.query;

        if (!arquivo) {
            return res.status(400).json({ error: 'Parâmetro arquivo é obrigatório' });
        }

        // Se informou destinatário específico, verificar apenas esse
        if (destinatario && tipo_envio) {
            const envio = await verificarEnvioExistente(arquivo, tipo_envio, destinatario, mes_referencia || null);
            return res.json({
                ja_enviado: !!envio,
                envio: envio || null
            });
        }

        // Senão, buscar todos os envios do arquivo (filtrar por mês se informado)
        const filtros = { arquivo };
        if (mes_referencia) filtros.mes_referencia = mes_referencia;
        const envios = await listarEnvios(filtros);
        res.json({
            arquivo,
            mes_referencia: mes_referencia || 'todos',
            total_envios: envios.length,
            envios_whatsapp: envios.filter(e => e.tipo_envio === 'whatsapp'),
            envios_email: envios.filter(e => e.tipo_envio === 'email')
        });

    } catch (error) {
        console.error('Erro ao verificar envio:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📋 SISTEMA DE FATURAS - HISTÓRICO DE ENVIOS
// ========================================
app.get('/api/sistema-faturas/historico-envios', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia, tipo_envio, destinatario, arquivo, status } = req.query;

        const envios = await listarEnvios({
            mes_referencia,
            tipo_envio,
            destinatario,
            arquivo,
            status
        });

        res.json({
            total: envios.length,
            envios
        });

    } catch (error) {
        console.error('Erro ao listar histórico de envios:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📊 SISTEMA DE FATURAS - STATUS DE ENVIOS (PARA TABELA BOLETOS)
// ========================================
app.get('/api/sistema-faturas/status-envios', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia } = req.query;

        if (!mes_referencia) {
            return res.status(400).json({ error: 'mes_referencia é obrigatório' });
        }

        // Buscar todos os envios com status 'enviado' para o mês (independente da pasta)
        // Isso permite encontrar envios feitos tanto da pasta NET quanto NET Completo
        const envios = await listarEnvios({
            mes_referencia,
            status: 'enviado'
        });

        // Extrair UC dos nomes dos arquivos e agrupar por UC
        const enviosPorUc = {};
        envios.forEach(e => {
            // Extrair UC do nome do arquivo (padrões: "Boleto Aupus - UC - Nome.pdf" ou "Fatura AUPUS - UC - Nome.pdf")
            const ucMatch = e.arquivo.match(/(\d{8,15})/);
            if (ucMatch) {
                const uc = ucMatch[1];
                if (!enviosPorUc[uc]) {
                    enviosPorUc[uc] = { whatsapp: false, email: false };
                }
                if (e.tipo_envio === 'whatsapp') {
                    enviosPorUc[uc].whatsapp = true;
                }
                if (e.tipo_envio === 'email') {
                    enviosPorUc[uc].email = true;
                }
            }
        });

        res.json({
            total: envios.length,
            envios: envios.map(e => ({
                arquivo: e.arquivo,
                tipo_envio: e.tipo_envio,
                status: e.status,
                data_envio: e.data_envio
            })),
            // Novo: envios agrupados por UC para facilitar a busca no frontend
            enviosPorUc
        });

    } catch (error) {
        console.error('Erro ao consultar status de envios:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📊 SISTEMA DE FATURAS - EXPORTAR ENVIOS PARA EXCEL
// ========================================
app.get('/api/sistema-faturas/exportar-envios', async (req, res) => {
    try {
        // Autenticação via query param (para download direto)
        const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        try {
            jwt.verify(token, 'aupus-secret-key-2024');
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }

        const { mes_referencia, tipo_envio, status } = req.query;

        const envios = await listarEnvios({
            mes_referencia,
            tipo_envio,
            status
        });

        // Gerar CSV (compatível com Excel)
        const headers = ['Data/Hora', 'Tipo', 'Arquivo', 'Pasta', 'Mês Referência', 'Destinatário', 'Status', 'Enviado Por'];
        const csvRows = [headers.join(';')];

        for (const envio of envios) {
            const row = [
                new Date(envio.data_envio).toLocaleString('pt-BR'),
                envio.tipo_envio === 'whatsapp' ? 'WhatsApp' : 'Email',
                envio.arquivo || '',
                envio.pasta || '',
                envio.mes_referencia || '',
                envio.destinatario || '',
                envio.status === 'enviado' ? 'Enviado' : 'Falha',
                envio.enviado_por || ''
            ];
            // Escapar campos com ponto e vírgula ou aspas
            const escapedRow = row.map(field => {
                const str = String(field);
                if (str.includes(';') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            });
            csvRows.push(escapedRow.join(';'));
        }

        const csvContent = '\uFEFF' + csvRows.join('\n'); // BOM para UTF-8 no Excel

        const dataAtual = new Date().toISOString().split('T')[0];
        const nomeArquivo = `controle_envios_${dataAtual}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Erro ao exportar envios:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 🔐 PROXY MANUAL PARA OAUTH DO BB (SEM http-proxy-middleware)
// ========================================
app.all('/proxy-oauth/*', async (req, res) => {
    const targetPath = req.url.replace('/proxy-oauth', '');
    const targetUrl = `https://oauth.bb.com.br${targetPath}`;

    console.log('🔐 OAuth Proxy Request:', req.method, targetPath);

    try {
        // Coletar body para requisições POST
        let body = '';
        if (req.method === 'POST') {
            body = new URLSearchParams(req.body).toString();
        }

        // Preparar headers apenas com os necessários
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Length': Buffer.byteLength(body, 'utf8') || 0
        };

        // Copiar apenas headers importantes (sem 'authorization' para não causar prompt)
        if (req.headers['authorization']) {
            headers['Authorization'] = req.headers['authorization'];
        }
        if (req.headers['content-type']) {
            headers['Content-Type'] = req.headers['content-type'];
        }

        // Fazer requisição HTTPS direta
        const response = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'oauth.bb.com.br',
                port: 443,
                path: targetPath,
                method: req.method,
                headers: headers,
                rejectUnauthorized: false,
                timeout: 30000
            };

            const proxyReq = https.request(options, (proxyRes) => {
                let data = '';

                proxyRes.on('data', (chunk) => {
                    data += chunk;
                });

                proxyRes.on('end', () => {
                    resolve({
                        statusCode: proxyRes.statusCode,
                        headers: proxyRes.headers,
                        body: data
                    });
                });
            });

            proxyReq.on('error', (err) => {
                console.error('❌ Erro na requisição OAuth:', err.message);
                reject(err);
            });

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                reject(new Error('Timeout na requisição OAuth'));
            });

            if (body) {
                proxyReq.write(body);
            }

            proxyReq.end();
        });

        // Retornar resposta
        console.log('✅ OAuth Response:', response.statusCode);

        // Copiar headers relevantes (EXCETO www-authenticate que causa prompt de login)
        Object.keys(response.headers).forEach(key => {
            const keyLower = key.toLowerCase();
            if (!['transfer-encoding', 'connection', 'www-authenticate'].includes(keyLower)) {
                res.setHeader(key, response.headers[key]);
            }
        });

        res.status(response.statusCode).send(response.body);

    } catch (error) {
        console.error('❌ Erro no proxy OAuth:', {
            message: error.message,
            code: error.code,
            url: targetPath
        });

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Erro no proxy OAuth',
                message: error.message,
                code: error.code,
                timestamp: new Date().toISOString(),
                dica: 'Verifique firewall, antivírus ou conexão com internet'
            });
        }
    }
});

// ========================================
// 🏦 PROXY MANUAL PARA API DO BB (SEM http-proxy-middleware)
// ========================================
app.all('/proxy-api/*', async (req, res) => {
    const targetPath = req.url.replace('/proxy-api', '');
    const targetUrl = `https://api.bb.com.br${targetPath}`;

    console.log('🏦 API Proxy Request:', req.method, targetPath);

    try {
        // Coletar body para requisições POST/PUT/PATCH
        let body = '';
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            body = JSON.stringify(req.body);
            console.log('📤 Enviando para BB:', body);
        }

        // Preparar headers apenas com os necessários
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': req.headers['content-type'] || 'application/json',
            'Content-Length': Buffer.byteLength(body, 'utf8') || 0
        };

        // Copiar apenas headers importantes da API do BB
        if (req.headers['authorization']) {
            headers['Authorization'] = req.headers['authorization'];
        }
        if (req.headers['x-application-key']) {
            headers['x-application-key'] = req.headers['x-application-key'];
        }

        // Fazer requisição HTTPS direta
        const response = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.bb.com.br',
                port: 443,
                path: targetPath,
                method: req.method,
                headers: headers,
                rejectUnauthorized: false,
                timeout: 30000
            };

            const proxyReq = https.request(options, (proxyRes) => {
                let data = '';

                proxyRes.on('data', (chunk) => {
                    data += chunk;
                });

                proxyRes.on('end', () => {
                    console.log('📥 Resposta do BB (status ' + proxyRes.statusCode + '):', data);
                    resolve({
                        statusCode: proxyRes.statusCode,
                        headers: proxyRes.headers,
                        body: data
                    });
                });
            });

            proxyReq.on('error', (err) => {
                console.error('❌ Erro na requisição API:', err.message);
                reject(err);
            });

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                reject(new Error('Timeout na requisição API'));
            });

            if (body) {
                proxyReq.write(body);
            }

            proxyReq.end();
        });

        // Retornar resposta
        console.log('✅ API Response:', response.statusCode);

        // Salvar oportunisticamente dados do BB para fallback de PDF
        if (req.method === 'GET' && response.statusCode === 200) {
            try {
                const matchBoleto = targetPath.match(/\/cobrancas\/v2\/boletos\/(\d{20})(?:\?|$)/);
                const matchPix = targetPath.match(/\/cobrancas\/v2\/boletos\/(\d{20})\/pix/);
                if (matchPix) {
                    const dadosPix = JSON.parse(response.body);
                    pool.query(
                        `UPDATE boletos_energia SET dados_pix_bb = $1, data_atualizacao = CURRENT_TIMESTAMP WHERE numero_boleto = $2`,
                        [JSON.stringify(dadosPix), matchPix[1]]
                    ).catch(() => {});
                } else if (matchBoleto) {
                    const dadosBB = JSON.parse(response.body);
                    salvarRespostaBB(matchBoleto[1], dadosBB).catch(() => {});
                }
            } catch (e) { /* silencioso - oportunístico */ }
        }

        // Copiar headers relevantes (EXCETO www-authenticate que causa prompt de login)
        Object.keys(response.headers).forEach(key => {
            const keyLower = key.toLowerCase();
            if (!['transfer-encoding', 'connection', 'www-authenticate'].includes(keyLower)) {
                res.setHeader(key, response.headers[key]);
            }
        });

        res.status(response.statusCode).send(response.body);

    } catch (error) {
        console.error('❌ Erro no proxy API:', {
            message: error.message,
            code: error.code,
            url: targetPath
        });

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Erro no proxy API',
                message: error.message,
                code: error.code,
                timestamp: new Date().toISOString(),
                dica: 'Verifique firewall, antivírus ou conexão com internet'
            });
        }
    }
});

// ========================================
// 🔍 ROTA RAIZ (CORRIGIDA)
// ========================================
app.get('/', (req, res) => {
    const publicIndexPath = path.join(__dirname, '..', 'build', 'index.html');
    const rootIndexPath = path.join(__dirname, '..', 'build', 'index.html');
    
    // Verificar onde está o index.html
    if (fs.existsSync(publicIndexPath)) {
        console.log('📄 Servindo index.html da pasta build/');
        res.sendFile(publicIndexPath);
    } else if (fs.existsSync(rootIndexPath)) {
        console.log('📄 Servindo index.html da pasta raiz');
        res.sendFile(rootIndexPath);
    } else {
        console.error('❌ index.html não encontrado!');
        res.status(404).json({
            error: 'index.html não encontrado',
            message: 'Verifique se o arquivo index.html existe na pasta do projeto',
            localProcurado: [
                publicIndexPath,
                rootIndexPath
            ]
        });
    }
});

// PDF generation is now handled by pdfGenerator.js module

// ========================================
// 🔌 MICROSERVIÇOS - ENDPOINTS DE GERENCIAMENTO
// ========================================

const MICROSERVICOS_URL = 'http://localhost:8000';  // Orquestrador
const BUSCADOR_URL = 'http://localhost:8010';       // Buscador Email API

// Middleware de autenticação JWT para microserviços
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log(`🔐 [AUTH] ${req.method} ${req.url}`);
    console.log(`   - Auth Header: ${authHeader ? 'presente' : 'AUSENTE'}`);
    console.log(`   - Token extraído: ${token ? token.substring(0, 20) + '...' : 'NENHUM'}`);

    if (!token) {
        console.log(`   ❌ 401 - Token não fornecido`);
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, 'aupus-secret-key-2024');
        req.user = decoded;
        console.log(`   ✅ Token válido para: ${decoded.email}`);
        next();
    } catch (err) {
        console.log(`   ❌ 401 - Token inválido/expirado: ${err.message}`);
        return res.status(401).json({ error: 'Token inválido', expired: err.name === 'TokenExpiredError' });
    }
}

// Helper para fazer requisições aos microserviços
async function fetchMicroservico(url, options = {}) {
    const http = require('http');
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

// Dashboard - Dados gerais
app.get('/api/microservicos/dashboard', authenticateToken, async (req, res) => {
    try {
        // Buscar estatísticas do banco de dados dos microserviços
        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        // Estatísticas principais
        const statsQuery = `
            SELECT
                (SELECT COUNT(*) FROM faturas_baixadas WHERE DATE(data_download) = CURRENT_DATE) as faturas_hoje,
                (SELECT COUNT(*) FROM faturas_baixadas WHERE status = 'processado') as faturas_processadas,
                (SELECT COUNT(*) FROM job_queue WHERE status = 'pendente') as jobs_pendentes,
                (SELECT COUNT(*) FROM job_queue WHERE status = 'processando') as jobs_processando,
                (SELECT COUNT(*) FROM alertas_duplicatas WHERE status = 'pendente') as alertas_pendentes,
                (SELECT COUNT(DISTINCT uc) FROM faturas_baixadas) as total_ucs
        `;

        const statsResult = await microPool.query(statsQuery);
        const stats = statsResult.rows[0];

        // Estatísticas do mês atual
        const mesAtual = new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }).replace('/', '/');
        const mesQuery = `
            SELECT
                COUNT(*) as total_faturas,
                COUNT(*) FILTER (WHERE is_duplicata = FALSE) as faturas_unicas,
                COUNT(*) FILTER (WHERE is_duplicata = TRUE) as duplicatas,
                COUNT(*) FILTER (WHERE status = 'erro') as com_erro,
                AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::int as tempo_medio_ms
            FROM faturas_baixadas
            WHERE mes_referencia LIKE $1
        `;
        const mesResult = await microPool.query(mesQuery, [`%${new Date().getFullYear()}`]);

        // Últimas execuções
        const execQuery = `
            SELECT id, tipo_execucao, status, data_execucao, total_pdfs_baixados
            FROM controle_execucoes
            ORDER BY data_execucao DESC
            LIMIT 5
        `;
        const execResult = await microPool.query(execQuery);

        // Verificar status dos serviços
        // Nota: orquestrador usa "/" como endpoint de status, os outros usam "/health"
        const servicos = {};
        const servicosConfig = [
            { nome: 'orquestrador', url: 'http://localhost:8000/' },
            { nome: 'leitor-pdf', url: 'http://localhost:8001/health' },
            { nome: 'calculadora', url: 'http://localhost:8002/health' },
            { nome: 'exportador', url: 'http://localhost:8003/health' },
            { nome: 'storage', url: 'http://localhost:8005/health' },
            { nome: 'buscador-api', url: 'http://localhost:8010/health' }
        ];

        for (const servico of servicosConfig) {
            try {
                const result = await fetchMicroservico(servico.url);
                servicos[servico.nome] = result.status === 200 ? 'online' : 'offline';
            } catch (e) {
                servicos[servico.nome] = 'offline';
            }
        }

        await microPool.end();

        res.json({
            faturas_hoje: parseInt(stats.faturas_hoje) || 0,
            faturas_processadas: parseInt(stats.faturas_processadas) || 0,
            jobs_pendentes: parseInt(stats.jobs_pendentes) || 0,
            jobs_processando: parseInt(stats.jobs_processando) || 0,
            alertas_pendentes: parseInt(stats.alertas_pendentes) || 0,
            total_ucs: parseInt(stats.total_ucs) || 0,
            ucs_sem_fatura: 0,
            estatisticas_mes: mesResult.rows[0] || {},
            ultimas_execucoes: execResult.rows || [],
            servicos
        });
    } catch (error) {
        console.error('Erro ao carregar dashboard:', error);
        res.status(500).json({ error: 'Erro ao carregar dashboard', details: error.message });
    }
});

// Jobs - Listar fila de jobs
app.get('/api/microservicos/jobs', authenticateToken, async (req, res) => {
    try {
        const { status, pagina = 1 } = req.query;
        const limit = 50;
        const offset = (pagina - 1) * limit;

        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        let query = `
            SELECT job_id, tipo_job, status, criado_em, iniciado_em, concluido_em,
                   tempo_execucao_ms, erro_mensagem
            FROM job_queue
        `;
        const params = [];

        if (status && status !== 'todos') {
            query += ' WHERE status = $1';
            params.push(status);
        }

        query += ' ORDER BY criado_em DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(limit, offset);

        const result = await microPool.query(query, params);
        await microPool.end();

        res.json({ jobs: result.rows });
    } catch (error) {
        console.error('Erro ao listar jobs:', error);
        res.status(500).json({ error: 'Erro ao listar jobs' });
    }
});

// Reprocessar job com erro
app.post('/api/microservicos/jobs/:jobId/reprocessar', authenticateToken, async (req, res) => {
    try {
        const { jobId } = req.params;
        // Aqui você pode implementar a lógica de reprocessamento
        res.json({ sucesso: true, mensagem: 'Job enviado para reprocessamento' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao reprocessar job' });
    }
});

// Relatórios - Listar meses disponíveis
app.get('/api/microservicos/relatorios', authenticateToken, async (req, res) => {
    try {
        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        const query = `
            SELECT mes_referencia, COUNT(*) as total_faturas
            FROM faturas_baixadas
            WHERE mes_referencia IS NOT NULL
            GROUP BY mes_referencia
            ORDER BY mes_referencia DESC
        `;

        const result = await microPool.query(query);
        await microPool.end();

        res.json({ relatorios: result.rows });
    } catch (error) {
        console.error('Erro ao listar relatórios:', error);
        res.status(500).json({ error: 'Erro ao listar relatórios' });
    }
});

// Dados detalhados do relatório (similar ao Excel)
app.get('/api/microservicos/relatorios/dados', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia } = req.query;
        if (!mes_referencia) {
            return res.status(400).json({ error: 'mes_referencia é obrigatório' });
        }

        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        // Query completa com todos os dados relevantes
        const query = `
            SELECT
                f.uc,
                f.mes_referencia,
                f.status,
                COALESCE(f.dados_leitura->>'nome_cliente_crm', f.dados_leitura->>'nome_cliente', '') as nome_cliente,
                COALESCE(f.dados_leitura->>'cpf_cnpj_crm', f.dados_leitura->>'cpf_cnpj', '') as cpf_cnpj,
                COALESCE(f.dados_leitura->>'categoria', '') as categoria,
                COALESCE((f.dados_leitura->>'consumo')::float, 0) as consumo,
                COALESCE((f.dados_leitura->>'consumo_comp')::float, (f.dados_leitura->>'energia_compensado')::float, 0) as consumo_compensado,
                COALESCE((f.dados_leitura->>'consumo_n_comp')::float, (f.dados_leitura->>'energia_nao_compensado')::float, 0) as consumo_nao_compensado,
                COALESCE((f.dados_leitura->>'valor_concessionaria')::float, 0) as valor_concessionaria,
                COALESCE((f.dados_leitura->>'energia_injetada')::float, 0) as energia_injetada,
                COALESCE((f.dados_leitura->>'saldo_anterior')::float, 0) as saldo_anterior,
                COALESCE((f.dados_leitura->>'saldo_atual')::float, 0) as saldo_atual,
                COALESCE((f.dados_calculados->'valores_calculados'->>'valor_aupus')::float, 0) as valor_aupus,
                COALESCE((f.dados_calculados->'valores_calculados'->>'valor_economia')::float, 0) as economia,
                COALESCE((f.dados_calculados->'valores_calculados'->>'valor_consorcio')::float, 0) as valor_consorcio,
                COALESCE((f.dados_calculados->'valores_calculados'->>'valor_concessionaria')::float, 0) as valor_conc_calculado,
                COALESCE((f.dados_calculados->'descontos_aplicados'->>'desconto_fatura_percentual')::float, 0) as desconto_fatura,
                COALESCE((f.dados_calculados->'descontos_aplicados'->>'desconto_bandeira_percentual')::float, 0) as desconto_bandeira,
                COALESCE(f.dados_calculados->'flags'->>'compensacao_completa_aplicada', 'false')::boolean as compensacao_aplicada,
                b.numero_boleto,
                b.valor_boleto,
                b.data_geracao_boleto,
                b.data_vencimento,
                f.created_at as data_processamento
            FROM faturas_baixadas f
            LEFT JOIN boletos_energia b ON f.uc = b.uc AND f.mes_referencia = b.mes_referencia
            WHERE f.mes_referencia = $1
            ORDER BY f.uc
        `;

        const result = await microPool.query(query, [mes_referencia]);

        // Calcular totais
        const dados = result.rows;
        const totais = {
            total_faturas: dados.length,
            processadas: dados.filter(d => d.status === 'processado').length,
            pendentes: dados.filter(d => d.status === 'pendente').length,
            com_boleto: dados.filter(d => d.numero_boleto).length,
            sem_boleto: dados.filter(d => !d.numero_boleto).length,
            valor_total_concessionaria: dados.reduce((sum, d) => sum + (d.valor_concessionaria || 0), 0),
            valor_total_aupus: dados.reduce((sum, d) => sum + (d.valor_aupus || 0), 0),
            economia_total: dados.reduce((sum, d) => sum + (d.economia || 0), 0),
            consumo_total: dados.reduce((sum, d) => sum + (d.consumo || 0), 0),
            consumo_compensado_total: dados.reduce((sum, d) => sum + (d.consumo_compensado || 0), 0)
        };

        await microPool.end();

        res.json({
            sucesso: true,
            mes_referencia,
            faturas: dados,
            totais
        });
    } catch (error) {
        console.error('Erro ao buscar dados do relatório:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do relatório', details: error.message });
    }
});

// Faturas por mês
app.get('/api/microservicos/faturas', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia } = req.query;
        if (!mes_referencia) {
            return res.status(400).json({ error: 'mes_referencia é obrigatório' });
        }

        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        const query = `
            SELECT
                uc,
                mes_referencia,
                status,
                COALESCE(dados_leitura->>'nome_cliente_crm', dados_leitura->>'nome_cliente') as nome_cliente,
                (dados_leitura->>'consumo')::float as consumo,
                (dados_leitura->>'valor_concessionaria')::float as valor_concessionaria,
                (dados_calculados->'valores_calculados'->>'valor_aupus')::float as valor_aupus,
                (dados_calculados->'valores_calculados'->>'valor_economia')::float as economia
            FROM faturas_baixadas
            WHERE mes_referencia = $1
            ORDER BY uc
        `;

        const result = await microPool.query(query, [mes_referencia]);
        await microPool.end();

        res.json({ faturas: result.rows });
    } catch (error) {
        console.error('Erro ao listar faturas:', error);
        res.status(500).json({ error: 'Erro ao listar faturas' });
    }
});

// Exportar relatório Excel
app.get('/api/microservicos/relatorios/exportar', async (req, res) => {
    try {
        const { mes_referencia, token } = req.query;

        // Verificar token
        if (!token) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        try {
            jwt.verify(token, 'aupus-secret-key-2024');
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }

        // Chamar o serviço exportador dos microserviços
        const exportUrl = `http://localhost:8003/api/v1/relatorios/gerar?mes_referencia=${encodeURIComponent(mes_referencia)}`;

        try {
            const result = await fetchMicroservico(exportUrl);
            if (result.data && result.data.caminho) {
                // Enviar o arquivo
                res.download(result.data.caminho);
            } else {
                res.status(404).json({ error: 'Relatório não encontrado' });
            }
        } catch (e) {
            // Fallback: gerar Excel básico aqui
            res.status(500).json({ error: 'Serviço de exportação indisponível' });
        }
    } catch (error) {
        console.error('Erro ao exportar relatório:', error);
        res.status(500).json({ error: 'Erro ao exportar relatório' });
    }
});

// Exportar planilha "Primeira Compensação"
app.get('/api/microservicos/relatorios/primeira-compensacao', async (req, res) => {
    try {
        const { mes_referencia, token } = req.query;

        // Verificar token
        if (!token) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        try {
            jwt.verify(token, 'aupus-secret-key-2024');
        } catch (err) {
            return res.status(401).json({ error: 'Token inválido' });
        }

        if (!mes_referencia) {
            return res.status(400).json({ error: 'mes_referencia é obrigatório' });
        }

        const [mes, ano] = mes_referencia.split('/');
        const mesAnterior = mes === '01' ? '12' : String(parseInt(mes) - 1).padStart(2, '0');
        const anoAnterior = mes === '01' ? String(parseInt(ano) - 1) : ano;
        const mesRefAnterior = `${mesAnterior}/${anoAnterior}`;

        const { Pool } = require('pg');
        const ExcelJS = require('exceljs');

        // Pool local (faturas)
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        // Pool CRM (produção)
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        // Buscar UCs novas (estão no mês atual mas não no anterior)
        const queryUCsNovas = `
            SELECT
                b.uc,
                b.nome_completo,
                COALESCE(b.energia_nao_compensado, 0) as energia_nao_compensado,
                COALESCE(b.energia_compensado, 0) as energia_compensado,
                COALESCE(f.dados_leitura->>'tarifa_comp', '0') as tarifa,
                COALESCE(b.valor_com_desconto_aupus, 0) as valor_aupus
            FROM boletos_energia b
            LEFT JOIN faturas_baixadas f ON b.uc = f.uc AND b.mes_referencia = f.mes_referencia
            WHERE b.mes_referencia = $1
              AND b.status <> 'cancelado'
              AND b.uc NOT IN (
                SELECT DISTINCT uc FROM boletos_energia WHERE mes_referencia = $2 AND status <> 'cancelado'
              )
            ORDER BY b.uc
        `;

        const resultUCs = await microPool.query(queryUCsNovas, [mes_referencia, mesRefAnterior]);

        // Buscar consultores do CRM
        const ucs = resultUCs.rows.map(r => r.uc);
        let consultores = {};

        if (ucs.length > 0) {
            const queryConsultores = `
                SELECT
                    uc.numero_unidade as uc,
                    COALESCE(u.nome, 'Não informado') as consultor
                FROM unidades_consumidoras uc
                JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                JOIN propostas p ON cc.proposta_id = p.id
                LEFT JOIN usuarios u ON p.consultor_id = u.id
                WHERE uc.numero_unidade = ANY($1)
            `;

            try {
                const resultConsultores = await crmPool.query(queryConsultores, [ucs]);
                resultConsultores.rows.forEach(row => {
                    consultores[row.uc] = row.consultor;
                });
            } catch (e) {
                console.error('Erro ao buscar consultores:', e.message);
            }
        }

        await microPool.end();
        await crmPool.end();

        // Filtrar UCs com consultor "Não informado"
        const dadosFiltrados = resultUCs.rows
            .map(row => ({
                ...row,
                consultor: consultores[row.uc] || 'Não informado'
            }))
            .filter(row => row.consultor !== 'Não informado');

        // Criar planilha Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Primeira Compensação ' + mes);

        // Cabeçalhos
        worksheet.columns = [
            { header: 'UC', key: 'uc', width: 14 },
            { header: 'Consultor', key: 'consultor', width: 28 },
            { header: 'Nome Cliente', key: 'nome', width: 45 },
            { header: 'Consumo Não Compensado (kWh)', key: 'nao_compensado', width: 18 },
            { header: 'Consumo Compensado (kWh)', key: 'compensado', width: 18 },
            { header: 'Tarifa (R$/kWh)', key: 'tarifa', width: 16 },
            { header: 'Valor Aupus', key: 'valor_aupus', width: 14 },
            { header: 'Valor Compensação', key: 'valor_compensacao', width: 18 },
            { header: 'Valor 1º Pagamento', key: 'valor_pagamento', width: 18 },
            { header: 'Diferença', key: 'diferenca', width: 14 }
        ];

        // Estilo do cabeçalho
        worksheet.getRow(1).eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        worksheet.getRow(1).height = 40;

        // Adicionar dados com fórmulas
        dadosFiltrados.forEach((row, index) => {
            const rowNum = index + 2;
            worksheet.addRow({
                uc: row.uc,
                consultor: row.consultor,
                nome: row.nome_completo,
                nao_compensado: parseFloat(row.energia_nao_compensado) || 0,
                compensado: parseFloat(row.energia_compensado) || 0,
                tarifa: parseFloat(row.tarifa) || 0,
                valor_aupus: parseFloat(row.valor_aupus) || 0
            });

            // Fórmula: Valor Compensação = Valor Aupus * 0.5
            worksheet.getCell(`H${rowNum}`).value = { formula: `G${rowNum}*0.5` };
            worksheet.getCell(`H${rowNum}`).numFmt = '#,##0.00';

            // Coluna Valor 1º Pagamento (vazia, amarela)
            worksheet.getCell(`I${rowNum}`).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFF9C4' }
            };

            // Fórmula: Diferença = Valor Compensação - Valor 1º Pagamento
            worksheet.getCell(`J${rowNum}`).value = { formula: `H${rowNum}-I${rowNum}` };
            worksheet.getCell(`J${rowNum}`).numFmt = '#,##0.00';

            // Formatos numéricos
            worksheet.getCell(`D${rowNum}`).numFmt = '#,##0.00';
            worksheet.getCell(`E${rowNum}`).numFmt = '#,##0.00';
            worksheet.getCell(`F${rowNum}`).numFmt = '#,##0.000000';
            worksheet.getCell(`G${rowNum}`).numFmt = '#,##0.00';

            // Bordas
            for (let col = 1; col <= 10; col++) {
                worksheet.getCell(rowNum, col).border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            }
        });

        // Linha de totais
        const totalRow = dadosFiltrados.length + 2;
        worksheet.getCell(`A${totalRow}`).value = 'TOTAL';
        worksheet.getCell(`A${totalRow}`).font = { bold: true };
        worksheet.getCell(`C${totalRow}`).value = `${dadosFiltrados.length} UCs`;
        worksheet.getCell(`C${totalRow}`).font = { bold: true };

        worksheet.getCell(`D${totalRow}`).value = { formula: `SUM(D2:D${totalRow-1})` };
        worksheet.getCell(`D${totalRow}`).numFmt = '#,##0.00';
        worksheet.getCell(`D${totalRow}`).font = { bold: true };

        worksheet.getCell(`E${totalRow}`).value = { formula: `SUM(E2:E${totalRow-1})` };
        worksheet.getCell(`E${totalRow}`).numFmt = '#,##0.00';
        worksheet.getCell(`E${totalRow}`).font = { bold: true };

        worksheet.getCell(`F${totalRow}`).value = '-';
        worksheet.getCell(`F${totalRow}`).font = { bold: true };

        worksheet.getCell(`G${totalRow}`).value = { formula: `SUM(G2:G${totalRow-1})` };
        worksheet.getCell(`G${totalRow}`).numFmt = '#,##0.00';
        worksheet.getCell(`G${totalRow}`).font = { bold: true };

        worksheet.getCell(`H${totalRow}`).value = { formula: `SUM(H2:H${totalRow-1})` };
        worksheet.getCell(`H${totalRow}`).numFmt = '#,##0.00';
        worksheet.getCell(`H${totalRow}`).font = { bold: true };

        worksheet.getCell(`I${totalRow}`).value = { formula: `SUM(I2:I${totalRow-1})` };
        worksheet.getCell(`I${totalRow}`).numFmt = '#,##0.00';
        worksheet.getCell(`I${totalRow}`).font = { bold: true };
        worksheet.getCell(`I${totalRow}`).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF9C4' }
        };

        worksheet.getCell(`J${totalRow}`).value = { formula: `SUM(J2:J${totalRow-1})` };
        worksheet.getCell(`J${totalRow}`).numFmt = '#,##0.00';
        worksheet.getCell(`J${totalRow}`).font = { bold: true };

        // Congelar primeira linha
        worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

        // Enviar arquivo
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Primeira_Compensacao_${mes}_${ano}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Erro ao exportar primeira compensação:', error);
        res.status(500).json({ error: 'Erro ao exportar relatório', details: error.message });
    }
});

// Execuções recentes
app.get('/api/microservicos/execucoes', authenticateToken, async (req, res) => {
    try {
        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        const query = `
            SELECT id, tipo_execucao, status, data_execucao,
                   total_emails_verificados, total_pdfs_baixados,
                   total_duplicatas, total_erros, tempo_execucao_segundos
            FROM controle_execucoes
            ORDER BY data_execucao DESC
            LIMIT 20
        `;

        const result = await microPool.query(query);
        await microPool.end();

        res.json({ execucoes: result.rows });
    } catch (error) {
        console.error('Erro ao listar execuções:', error);
        res.status(500).json({ error: 'Erro ao listar execuções' });
    }
});

// Buscar emails manualmente
app.post('/api/microservicos/buscar-emails', authenticateToken, async (req, res) => {
    try {
        const { data_inicio, data_fim, limite = 50 } = req.body;

        // Chamar o buscador-api
        const result = await fetchMicroservico(`${BUSCADOR_URL}/api/v1/buscar`, {
            method: 'POST',
            body: {
                data_inicio: data_inicio ? new Date(data_inicio).toLocaleDateString('pt-BR') : undefined,
                data_fim: data_fim ? new Date(data_fim).toLocaleDateString('pt-BR') : undefined,
                limite,
                processar: true
            }
        });

        res.json(result.data);
    } catch (error) {
        console.error('Erro ao buscar emails:', error);
        res.status(500).json({ error: 'Erro ao executar busca de emails', details: error.message });
    }
});

// ==========================================
// GERENCIAR FATURAS - Endpoints de recálculo
// ==========================================

// Listar faturas para gerenciamento (com dados do CRM)
app.get('/api/microservicos/gerenciar/faturas', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia } = req.query;

        if (!mes_referencia) {
            return res.status(400).json({ error: 'Parâmetro mes_referencia é obrigatório' });
        }

        const { Pool } = require('pg');

        // Pool local (faturas)
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        // Pool CRM (produção)
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        // 1. Buscar faturas locais com status do boleto
        const queryFaturas = `
            SELECT
                f.id,
                f.uc,
                f.mes_referencia,
                f.status,
                f.dados_leitura->>'categoria' as categoria,
                f.dados_leitura->>'nome_cliente' as nome_cliente_pdf,
                f.dados_leitura->>'nome_cliente_crm' as nome_cliente_crm,
                f.dados_leitura->>'cpf_cnpj' as cpf_cnpj_local,
                f.dados_leitura,
                f.dados_calculados,
                f.updated_at,
                b.numero_boleto,
                CASE WHEN b.numero_boleto IS NOT NULL THEN true ELSE false END as boleto_gerado
            FROM faturas_baixadas f
            LEFT JOIN boletos_energia b ON f.uc = b.uc AND f.mes_referencia = b.mes_referencia
            WHERE f.mes_referencia = $1
            ORDER BY f.uc
        `;

        const resultFaturas = await microPool.query(queryFaturas, [mes_referencia]);

        // 2. Buscar dados do CRM para todas as UCs
        const ucs = [...new Set(resultFaturas.rows.map(r => r.uc))];

        let dadosCRM = {};
        if (ucs.length > 0) {
            const queryCRM = `
                SELECT
                    uc.numero_unidade as uc,
                    COALESCE(NULLIF(uc.nome_faturamento, ''), NULLIF(cc.nome_cliente, ''), p.nome_cliente) as nome_cliente,
                    COALESCE(
                        NULLIF(uc.cpf_cnpj_faturamento, ''),
                        NULLIF(cc.cpf_cnpj, ''),
                        ''
                    ) as cpf_cnpj,
                    COALESCE(NULLIF(cc.desconto_tarifa, ''), NULLIF(p.desconto_tarifa, ''), '20%') as desconto_fatura,
                    COALESCE(NULLIF(cc.desconto_bandeira, ''), NULLIF(p.desconto_bandeira, ''), '20%') as desconto_bandeira
                FROM controle_clube cc
                JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
                JOIN propostas p ON cc.proposta_id = p.id
                WHERE uc.numero_unidade = ANY($1)
                  AND cc.deleted_at IS NULL
            `;

            try {
                const resultCRM = await crmPool.query(queryCRM, [ucs]);
                resultCRM.rows.forEach(row => {
                    dadosCRM[row.uc] = row;
                });
            } catch (crmError) {
                console.error('Erro ao buscar dados do CRM:', crmError.message);
            }
        }

        await microPool.end();
        await crmPool.end();

        // 3. Combinar dados
        const faturas = resultFaturas.rows.map(row => {
            const crm = dadosCRM[row.uc] || {};
            const dadosCalc = row.dados_calculados || {};
            const valoresCalc = dadosCalc.valores_calculados || {};

            return {
                id: row.id,
                uc: row.uc,
                mes_referencia: row.mes_referencia,
                status: row.status,
                categoria: row.categoria || 'Não classificado',
                // Nome: prioridade CRM > já salvo no recálculo > PDF
                nome_cliente: crm.nome_cliente || row.nome_cliente_crm || row.nome_cliente_pdf || null,
                // CPF: prioridade CRM > local
                cpf_cnpj: crm.cpf_cnpj || row.cpf_cnpj_local || null,
                // Status do boleto
                boleto_gerado: row.boleto_gerado,
                numero_boleto: row.numero_boleto,
                pode_recalcular: !row.boleto_gerado,
                // Dados para o modal (detalhes)
                dados_leitura: row.dados_leitura,
                dados_calculados: row.dados_calculados,
                // Descontos do CRM
                desconto_fatura_crm: crm.desconto_fatura || null,
                desconto_bandeira_crm: crm.desconto_bandeira || null,
                updated_at: row.updated_at
            };
        });

        res.json({
            mes_referencia,
            total: faturas.length,
            faturas
        });
    } catch (error) {
        console.error('Erro ao listar faturas para gerenciamento:', error);
        res.status(500).json({ error: 'Erro ao listar faturas', details: error.message });
    }
});

// Recalcular faturas (proxy para orquestrador)
app.post('/api/microservicos/gerenciar/recalcular', authenticateToken, async (req, res) => {
    try {
        const { fatura_ids, mes_referencia, ucs } = req.body;

        if (!fatura_ids && !mes_referencia) {
            return res.status(400).json({ error: 'Forneça fatura_ids ou mes_referencia' });
        }

        console.log(`🔄 [Recálculo] Iniciando recálculo - IDs: ${fatura_ids?.join(',')} | Mês: ${mes_referencia} | UCs: ${ucs?.length || 'todas'}`);

        // Token do orquestrador
        const ORQUESTRADOR_TOKEN = '0517e9b8584750882104a143ba17a8b094f2ec71';

        // Montar dados para enviar ao orquestrador
        const dadosRecalculo = {};
        if (fatura_ids && fatura_ids.length > 0) dadosRecalculo.fatura_ids = fatura_ids;
        if (mes_referencia) dadosRecalculo.mes_referencia = mes_referencia;
        if (ucs && ucs.length > 0) dadosRecalculo.ucs = ucs;

        console.log(`📦 [Recálculo] Dados enviados ao orquestrador:`, JSON.stringify(dadosRecalculo));

        // Chamar orquestrador
        const http = require('http');
        const postData = JSON.stringify(dadosRecalculo);

        const options = {
            hostname: 'localhost',
            port: 8000,
            path: '/recalcular',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ORQUESTRADOR_TOKEN}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const orqRequest = http.request(options, (orqRes) => {
            let data = '';
            orqRes.on('data', chunk => data += chunk);
            orqRes.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log(`✅ [Recálculo] Resultado: ${result.atualizadas} atualizadas, ${result.bloqueadas} bloqueadas`);
                    res.json(result);
                } catch (e) {
                    console.error('Erro ao parsear resposta do orquestrador:', e);
                    res.status(500).json({ error: 'Erro ao processar resposta', details: data });
                }
            });
        });

        orqRequest.on('error', (e) => {
            console.error('Erro ao conectar com orquestrador:', e);
            res.status(500).json({ error: 'Erro ao conectar com orquestrador', details: e.message });
        });

        orqRequest.write(postData);
        orqRequest.end();

    } catch (error) {
        console.error('Erro ao recalcular faturas:', error);
        res.status(500).json({ error: 'Erro ao recalcular faturas', details: error.message });
    }
});

// Obter detalhes de uma fatura específica
app.get('/api/microservicos/gerenciar/fatura/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        const query = `
            SELECT
                f.*,
                b.numero_boleto,
                b.valor_boleto as valor_boleto_bb,
                b.data_geracao_boleto
            FROM faturas_baixadas f
            LEFT JOIN boletos_energia b ON f.uc = b.uc AND f.mes_referencia = b.mes_referencia
            WHERE f.id = $1
        `;

        const result = await microPool.query(query, [id]);
        await microPool.end();

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = result.rows[0];
        res.json({
            ...fatura,
            boleto_gerado: fatura.numero_boleto !== null,
            pode_recalcular: fatura.numero_boleto === null
        });
    } catch (error) {
        console.error('Erro ao buscar fatura:', error);
        res.status(500).json({ error: 'Erro ao buscar fatura', details: error.message });
    }
});

// Logs do sistema
app.get('/api/microservicos/logs', authenticateToken, async (req, res) => {
    try {
        const { nivel, servico } = req.query;

        const { Pool } = require('pg');
        const microPool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        // Tentar buscar da tabela log_processamento
        let query = `
            SELECT
                created_at as timestamp,
                CASE
                    WHEN status = 'erro' THEN 'error'
                    WHEN status = 'sucesso' THEN 'info'
                    ELSE 'info'
                END as nivel,
                etapa as servico,
                mensagem
            FROM log_processamento
            WHERE 1=1
        `;
        const params = [];

        if (nivel && nivel !== 'todos') {
            if (nivel === 'error') {
                query += ` AND status = 'erro'`;
            } else if (nivel === 'info') {
                query += ` AND status = 'sucesso'`;
            }
        }

        if (servico && servico !== 'todos') {
            params.push(servico);
            query += ` AND etapa ILIKE $${params.length}`;
        }

        query += ' ORDER BY created_at DESC LIMIT 100';

        const result = await microPool.query(query, params);
        await microPool.end();

        res.json({ logs: result.rows });
    } catch (error) {
        console.error('Erro ao listar logs:', error);
        // Retornar array vazio em vez de erro se tabela não existir
        res.json({ logs: [] });
    }
});

// ========================================
// 🛠️ FUNÇÕES DE FORMATAÇÃO (MANTENDO SUAS FUNÇÕES)
// ========================================
function formatarDataPDF(data) {
    if (!data || data === 'N/A') return '';
    
    // Se está no formato DD.MM.AAAA, manter
    if (data.includes('.')) return data;
    
    // Se está no formato AAAA-MM-DD, converter
    if (data.includes('-')) {
        const [ano, mes, dia] = data.split('-');
        return `${dia}/${mes}/${ano}`;
    }
    
    return data;
}

function formatarDocumento(numero, tipo) {
    if (!numero || numero === 'N/A') return '';
    
    const numeroStr = numero.toString();
    
    if (tipo === 'CPF' || tipo === 1) {
        if (numeroStr.length === 11) {
            return numeroStr.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
    } else if (tipo === 'CNPJ' || tipo === 2) {
        if (numeroStr.length === 14) {
            return numeroStr.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }
    }
    
    return numeroStr;
}

function formatarCEP(cep) {
    if (!cep || cep === 'N/A') return '';
    const cepStr = cep.toString().replace(/\D/g, '');
    if (cepStr.length === 8) {
        return cepStr.replace(/(\d{5})(\d{3})/, '$1-$2');
    }
    return cepStr;
}

function formatarLinhaDigitavel(linha) {
    if (!linha || linha === 'N/A') return '';
    
    // Remover espaços e formatar linha digitável
    const limpa = linha.replace(/\s/g, '');
    if (limpa.length === 47) {
        return limpa.replace(/(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d{1})(\d{14})/, 
                           '$1.$2 $3.$4 $5.$6 $7 $8');
    }
    
    return linha;
}

// ========================================
// 📤 SISTEMA DE UPLOAD E LEITURA DE FATURAS
// ========================================

const multer = require('multer');

// Configurar pasta de upload (dados/pendentes dos microserviços)
const PASTA_PENDENTES = '/var/www/aupus-microservicos-faturas/dados/pendentes';

// Configurar storage do multer
const storageUpload = multer.diskStorage({
    destination: (req, file, cb) => {
        // Garantir que a pasta existe
        if (!fs.existsSync(PASTA_PENDENTES)) {
            fs.mkdirSync(PASTA_PENDENTES, { recursive: true });
        }
        cb(null, PASTA_PENDENTES);
    },
    filename: (req, file, cb) => {
        // Gerar nome único: upload_{timestamp}_{random}_{original}
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `upload_${timestamp}_${random}_${originalName}`);
    }
});

const uploadFaturas = multer({
    storage: storageUpload,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são permitidos'), false);
        }
    }
});

// Endpoint para upload de faturas (múltiplos arquivos)
app.post('/api/inserir-faturas/upload', authenticateToken, uploadFaturas.array('faturas', 50), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ sucesso: false, erro: 'Nenhum arquivo enviado' });
        }

        console.log(`📤 [Upload Faturas] ${req.files.length} arquivo(s) recebido(s)`);

        const arquivosUpload = req.files.map(file => ({
            nome_original: file.originalname,
            nome_salvo: file.filename,
            caminho: file.path,
            tamanho: file.size
        }));

        res.json({
            sucesso: true,
            total: req.files.length,
            arquivos: arquivosUpload,
            mensagem: `${req.files.length} arquivo(s) enviado(s) para a pasta de pendentes`
        });

    } catch (error) {
        console.error('❌ [Upload Faturas] Erro:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// Endpoint para listar arquivos pendentes
app.get('/api/inserir-faturas/pendentes', authenticateToken, async (req, res) => {
    try {
        if (!fs.existsSync(PASTA_PENDENTES)) {
            return res.json({ sucesso: true, arquivos: [], total: 0 });
        }

        const arquivos = fs.readdirSync(PASTA_PENDENTES)
            .filter(file => file.endsWith('.pdf'))
            .map(file => {
                const caminho = path.join(PASTA_PENDENTES, file);
                const stats = fs.statSync(caminho);
                return {
                    nome: file,
                    caminho: caminho,
                    tamanho: stats.size,
                    tamanho_formatado: (stats.size / 1024).toFixed(2) + ' KB',
                    data_criacao: stats.birthtime,
                    data_modificacao: stats.mtime,
                    tipo: file.startsWith('upload_') ? 'upload_manual' :
                          file.startsWith('temp_') ? 'buscador_email' : 'outro'
                };
            })
            .sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));

        res.json({
            sucesso: true,
            total: arquivos.length,
            arquivos: arquivos
        });

    } catch (error) {
        console.error('❌ [Listar Pendentes] Erro:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// Endpoint para solicitar leitura de faturas (criar jobs)
app.post('/api/inserir-faturas/processar', authenticateToken, async (req, res) => {
    try {
        const { arquivos } = req.body;

        if (!arquivos || !Array.isArray(arquivos) || arquivos.length === 0) {
            return res.status(400).json({ sucesso: false, erro: 'Lista de arquivos não fornecida' });
        }

        console.log(`📋 [Processar Faturas] Solicitando leitura de ${arquivos.length} arquivo(s)`);

        const jobs = [];
        const erros = [];

        // Criar pool uma única vez fora do loop
        const { Pool } = require('pg');
        const poolMicro = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        for (const arquivo of arquivos) {
            try {
                const caminhoCompleto = path.join(PASTA_PENDENTES, arquivo);

                if (!fs.existsSync(caminhoCompleto)) {
                    erros.push({ arquivo, erro: 'Arquivo não encontrado' });
                    continue;
                }

                // Verificar se já existe job ativo (pendente ou processando) para este arquivo
                const jobExistenteQuery = `
                    SELECT job_id, status FROM job_queue
                    WHERE tipo_job = 'processar_fatura_local'
                      AND (status = 'pendente' OR status = 'processando')
                      AND payload->>'arquivo_original' = $1
                    LIMIT 1
                `;
                const jobExistente = await poolMicro.query(jobExistenteQuery, [arquivo]);
                if (jobExistente.rows.length > 0) {
                    const j = jobExistente.rows[0];
                    jobs.push({ arquivo, job_id: j.job_id, status: j.status, ja_enfileirado: true });
                    console.log(`   ⏭️ Job já existe (${j.status}): ${j.job_id} para ${arquivo}`);
                    continue;
                }

                // Criar job no banco de dados dos microserviços
                const jobId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Inserir job na fila
                const insertJobQuery = `
                    INSERT INTO job_queue (job_id, tipo_job, pdf_url, payload, status, criado_em)
                    VALUES ($1, $2, $3, $4, 'pendente', NOW())
                    RETURNING id, job_id
                `;

                const payload = JSON.stringify({
                    arquivo_original: arquivo,
                    caminho_local: caminhoCompleto,
                    origem: 'upload_manual',
                    usuario: req.user?.email || 'sistema'
                });

                await poolMicro.query(insertJobQuery, [
                    jobId,
                    'processar_fatura_local',
                    `file://${caminhoCompleto}`,
                    payload
                ]);

                jobs.push({
                    arquivo,
                    job_id: jobId,
                    status: 'pendente'
                });

                console.log(`   ✅ Job criado: ${jobId} para ${arquivo}`);

            } catch (jobError) {
                console.error(`   ❌ Erro ao criar job para ${arquivo}:`, jobError.message);
                erros.push({ arquivo, erro: jobError.message });
            }
        }

        await poolMicro.end();

        const jobsNovos = jobs.filter(j => !j.ja_enfileirado);
        const jobsJaEnfileirados = jobs.filter(j => j.ja_enfileirado);

        res.json({
            sucesso: true,
            total_solicitado: arquivos.length,
            jobs_criados: jobsNovos.length,
            jobs_ja_enfileirados: jobsJaEnfileirados.length,
            erros: erros.length,
            jobs,
            erros_detalhes: erros,
            mensagem: `${jobsNovos.length} job(s) criado(s) para processamento${jobsJaEnfileirados.length > 0 ? `, ${jobsJaEnfileirados.length} já estavam na fila` : ''}`
        });

    } catch (error) {
        console.error('❌ [Processar Faturas] Erro:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// Endpoint para consultar status dos jobs
app.get('/api/inserir-faturas/jobs', authenticateToken, async (req, res) => {
    try {
        const { status, limite = 50 } = req.query;

        const { Pool } = require('pg');
        const poolMicro = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'aupus_faturas',
            user: 'aupus',
            password: 'SuaSenhaAqui123!'
        });

        let query = `
            SELECT
                job_id, tipo_job, status,
                payload->>'arquivo_original' as arquivo,
                payload->>'origem' as origem,
                resultado,
                erro_mensagem,
                criado_em, iniciado_em, concluido_em,
                tentativas, max_tentativas
            FROM job_queue
            WHERE tipo_job = 'processar_fatura_local'
        `;

        const params = [];

        if (status && status !== 'todos') {
            query += ` AND status = $1`;
            params.push(status);
        }

        query += ` ORDER BY criado_em DESC LIMIT ${parseInt(limite)}`;

        const result = await poolMicro.query(query, params);
        await poolMicro.end();

        // Agrupar por status
        const porStatus = {
            pendente: result.rows.filter(j => j.status === 'pendente').length,
            processando: result.rows.filter(j => j.status === 'processando').length,
            concluido: result.rows.filter(j => j.status === 'concluido').length,
            erro: result.rows.filter(j => j.status === 'erro').length
        };

        res.json({
            sucesso: true,
            total: result.rows.length,
            por_status: porStatus,
            jobs: result.rows
        });

    } catch (error) {
        console.error('❌ [Listar Jobs] Erro:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// Endpoint para executar jobs pendentes (processar faturas)
app.post('/api/inserir-faturas/executar-jobs', authenticateToken, async (req, res) => {
    try {
        console.log('🔄 [Executar Jobs] Iniciando processamento via worker do container...');

        // Executar o worker dentro do container buscador-worker
        const { exec } = require('child_process');

        exec('docker exec aupus-buscador-worker python processar_jobs_locais.py --once', {
            timeout: 300000 // 5 minutos
        }, async (error, stdout, stderr) => {
            if (error) {
                console.error('❌ [Executar Jobs] Erro ao executar worker:', error.message);
            }
            if (stdout) {
                console.log('📋 [Worker Output]:', stdout);
            }
            if (stderr) {
                console.log('⚠️ [Worker Stderr]:', stderr);
            }
        });

        // Retornar imediatamente - o processamento acontece em background
        res.json({
            sucesso: true,
            mensagem: 'Processamento iniciado. Acompanhe o status dos jobs na lista.',
            info: 'O worker está processando os jobs em segundo plano.'
        });

    } catch (error) {
        console.error('❌ [Executar Jobs] Erro:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// Endpoint para remover arquivo pendente
app.delete('/api/inserir-faturas/pendentes/:arquivo', authenticateToken, async (req, res) => {
    try {
        const { arquivo } = req.params;
        const caminhoCompleto = path.join(PASTA_PENDENTES, arquivo);

        if (!fs.existsSync(caminhoCompleto)) {
            return res.status(404).json({ sucesso: false, erro: 'Arquivo não encontrado' });
        }

        fs.unlinkSync(caminhoCompleto);
        console.log(`🗑️ [Remover Pendente] Arquivo removido: ${arquivo}`);

        res.json({
            sucesso: true,
            mensagem: `Arquivo ${arquivo} removido com sucesso`
        });

    } catch (error) {
        console.error('❌ [Remover Pendente] Erro:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ========================================
// 📊 ENDPOINTS CONTROLE DE ENERGIA
// ========================================

// Endpoint: Faturas sem compensação
app.get('/api/controle/sem-compensacao', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia } = req.query;

        if (!mes_referencia) {
            return res.status(400).json({ erro: 'mes_referencia é obrigatório' });
        }

        console.log(`📊 [Controle] Buscando faturas sem compensação para ${mes_referencia}`);

        // Conectar ao banco de microserviços (aupus_faturas)
        const { Pool } = require('pg');
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: process.env.MICROSERVICOS_DB_PORT || 5432,
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // Faturas lidas que não têm compensação (energia_compensado = 0 ou NULL, ou categoria diferente)
        const query = `
            SELECT
                fb.uc,
                fb.mes_referencia,
                fb.dados_leitura->>'nome_cliente' as nome_cliente,
                fb.dados_leitura->>'categoria' as categoria,
                fb.dados_leitura->>'valor_total' as valor_fatura,
                fb.created_at as data_leitura,
                CASE
                    WHEN fb.dados_leitura->>'categoria' NOT LIKE '%Compensação%' THEN 'Categoria sem compensação'
                    WHEN COALESCE((fb.dados_leitura->>'valor_energia_compensada')::numeric, 0) = 0 THEN 'Valor compensado = 0'
                    ELSE 'Outro motivo'
                END as motivo
            FROM faturas_baixadas fb
            WHERE fb.mes_referencia = $1
              AND fb.status = 'processado'
              AND (
                  -- Categoria não é de compensação
                  fb.dados_leitura->>'categoria' NOT LIKE '%Compensação%'
                  OR
                  -- Ou valor de energia compensada é 0 ou nulo
                  COALESCE((fb.dados_leitura->>'valor_energia_compensada')::numeric, 0) = 0
              )
              -- Excluir as que já têm boleto (já estão na aba de boletos)
              AND NOT EXISTS (
                  SELECT 1 FROM boletos_energia be
                  WHERE be.uc = fb.uc
                    AND be.mes_referencia = fb.mes_referencia
                    AND be.status != 'cancelado'
              )
            ORDER BY fb.uc
        `;

        const result = await microPool.query(query, [mes_referencia]);
        await microPool.end();

        console.log(`📊 [Controle] Encontradas ${result.rows.length} faturas sem compensação`);

        res.json({
            sucesso: true,
            faturas: result.rows,
            total: result.rows.length
        });

    } catch (error) {
        console.error('❌ [Controle] Erro ao buscar faturas sem compensação:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint: UCs não baixadas (do CRM sem fatura no mês)
app.get('/api/controle/ucs-nao-baixadas', authenticateToken, async (req, res) => {
    try {
        const { mes_referencia } = req.query;

        if (!mes_referencia) {
            return res.status(400).json({ erro: 'mes_referencia é obrigatório' });
        }

        console.log(`📊 [Controle] Buscando UCs não baixadas para ${mes_referencia}`);

        const { Pool } = require('pg');

        // Conectar ao CRM (aupus_prod)
        const crmPool = new Pool({
            host: process.env.CRM_DB_HOST || '127.0.0.1',
            port: process.env.CRM_DB_PORT || 5432,
            database: process.env.CRM_DB_NAME || 'aupus_prod',
            user: process.env.CRM_DB_USER || 'aupus_prod',
            password: process.env.CRM_DB_PASSWORD || 'AupusProd2024Hashtag'
        });

        // Conectar ao banco de microserviços
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: process.env.MICROSERVICOS_DB_PORT || 5432,
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // Buscar todas as UCs ativas do CRM (Club Aupus)
        const queryCRM = `
            SELECT DISTINCT
                uc.numero_unidade::text as numero_unidade,
                COALESCE(NULLIF(cc.nome_cliente, ''), p.nome_cliente) as nome_cliente,
                COALESCE(NULLIF(cc.cpf_cnpj, ''), '') as cpf_cnpj,
                'CLA' as sigla
            FROM controle_clube cc
            JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
            JOIN propostas p ON cc.proposta_id = p.id
            WHERE cc.deleted_at IS NULL
              AND uc.numero_unidade IS NOT NULL
            ORDER BY 1
        `;

        const ucsCRM = await crmPool.query(queryCRM);
        await crmPool.end();

        if (ucsCRM.rows.length === 0) {
            await microPool.end();
            return res.json({ sucesso: true, ucs: [], total: 0 });
        }

        // Buscar UCs que já têm fatura baixada para o mês
        const ucsLista = ucsCRM.rows.map(r => r.numero_unidade);
        const queryFaturas = `
            SELECT DISTINCT uc
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND uc = ANY($2)
        `;

        const faturasBaixadas = await microPool.query(queryFaturas, [mes_referencia, ucsLista]);

        // Buscar última tentativa de download do buscador-eqtl
        const queryTentativas = `
            SELECT uc, MAX(data_tentativa) as ultima_tentativa
            FROM log_buscador_eqtl
            WHERE mes_referencia = $1
            GROUP BY uc
        `;

        let tentativas = { rows: [] };
        try {
            tentativas = await microPool.query(queryTentativas, [mes_referencia]);
        } catch (e) {
            // Tabela pode não existir ainda
            console.log('⚠️ Tabela log_buscador_eqtl não encontrada');
        }

        await microPool.end();

        const ucsBaixadas = new Set(faturasBaixadas.rows.map(r => r.uc));
        const tentativasMap = new Map(tentativas.rows.map(r => [r.uc, r.ultima_tentativa]));

        // Filtrar UCs que não têm fatura baixada
        const ucsNaoBaixadas = ucsCRM.rows
            .filter(uc => !ucsBaixadas.has(uc.numero_unidade))
            .map(uc => ({
                ...uc,
                ultima_tentativa: tentativasMap.get(uc.numero_unidade) || null
            }));

        console.log(`📊 [Controle] ${ucsNaoBaixadas.length} UCs não baixadas de ${ucsCRM.rows.length} totais`);

        res.json({
            sucesso: true,
            ucs: ucsNaoBaixadas,
            total: ucsNaoBaixadas.length,
            total_crm: ucsCRM.rows.length,
            total_baixadas: ucsBaixadas.size
        });

    } catch (error) {
        console.error('❌ [Controle] Erro ao buscar UCs não baixadas:', error);
        res.status(500).json({ erro: error.message });
    }
});

// ========================================
// 📊 DASHBOARD - RESUMO MENSAL
// ========================================

// Endpoint: Dashboard - Resumo do mês
app.get('/api/dashboard/resumo/:mes', authenticateToken, async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`📊 [Dashboard] Carregando resumo para ${mes_referencia}`);

        const { Pool } = require('pg');

        // Conectar ao CRM
        const crmPool = new Pool({
            host: process.env.CRM_DB_HOST || '127.0.0.1',
            port: process.env.CRM_DB_PORT || 5432,
            database: process.env.CRM_DB_NAME || 'aupus_prod',
            user: process.env.CRM_DB_USER || 'aupus_prod',
            password: process.env.CRM_DB_PASSWORD || 'AupusProd2024Hashtag'
        });

        // Conectar ao banco de microserviços
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: process.env.MICROSERVICOS_DB_PORT || 5432,
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // 1. Buscar LISTA de UCs ativas no CRM (não geradoras)
        const queryUCsAtivas = `
            SELECT DISTINCT uc.numero_unidade::text as uc
            FROM controle_clube cc
            JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
            WHERE cc.deleted_at IS NULL
              AND uc.deleted_at IS NULL
              AND uc.gerador = false
              AND uc.numero_unidade IS NOT NULL
        `;
        const ucsAtivasResult = await crmPool.query(queryUCsAtivas);
        const ucsAtivasList = ucsAtivasResult.rows.map(r => r.uc);
        const totalUCsAtivas = ucsAtivasList.length;

        await crmPool.end();

        // 2. Buscar LISTA de UCs com faturas no mês (apenas UCs do controle_clube, não UGs)
        const queryFaturasUCs = `
            SELECT DISTINCT uc
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND is_duplicata = false
              AND uc = ANY($2)
        `;
        const faturasUCsResult = await microPool.query(queryFaturasUCs, [mes_referencia, ucsAtivasList]);
        const faturasUCsList = new Set(faturasUCsResult.rows.map(r => r.uc));

        // 3. Calcular UCs faltando (UCs do CRM que NÃO têm fatura)
        const ucsFaltando = ucsAtivasList.filter(uc => !faturasUCsList.has(uc));
        const faturasFaltando = ucsFaltando.length;

        // 4. Estatísticas básicas de faturas (apenas UCs ativas, excluindo UGs)
        // Nota: pendentes na pasta 'pendentes' sem categoria = arquivos que não existem mais = Não Recebida
        const queryFaturasStats = `
            SELECT
                COUNT(*) as total,
                COUNT(CASE
                    WHEN COALESCE(caminho_storage, '') LIKE '%pendentes%'
                    AND COALESCE(dados_leitura->>'categoria', '') != ''
                    THEN 1
                END) as pendentes,
                COUNT(CASE WHEN status IN ('erro', 'erro_processamento') THEN 1 END) as com_erro,
                COUNT(CASE WHEN status NOT IN ('erro', 'erro_processamento') AND dados_leitura->>'categoria' LIKE '%Sem Compensação%' THEN 1 END) as sem_compensacao_total,
                COUNT(CASE WHEN status NOT IN ('erro', 'erro_processamento') AND dados_leitura->>'categoria' LIKE '%Compensação%' AND dados_leitura->>'categoria' NOT LIKE '%Sem Compensação%' THEN 1 END) as compensado
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND is_duplicata = false
              AND uc = ANY($2)
        `;
        const faturasRecebidas = await microPool.query(queryFaturasStats, [mes_referencia, ucsAtivasList]);
        const faturasStatsBase = faturasRecebidas.rows[0] || { total: 0, pendentes: 0, com_erro: 0, sem_compensacao_total: 0, compensado: 0 };

        await microPool.end();

        // 5. Dados de boletos (tabela boletos_energia) - incluindo comp_simulada
        // Conta enviados diretamente de controle_envios (fonte única de verdade)
        const queryBoletos = `
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'Boleto gerado' OR status = 'Pago' THEN 1 END) as gerados,
                COUNT(CASE WHEN status = 'Pago' THEN 1 END) as pagos,
                COUNT(CASE WHEN EXISTS (
                    SELECT 1 FROM controle_envios c
                    WHERE c.arquivo LIKE '%' || b.uc || '%'
                      AND c.mes_referencia = b.mes_referencia
                      AND c.status = 'enviado'
                ) THEN 1 END) as enviados,
                COUNT(CASE WHEN compensacao_completa_aplicada = true THEN 1 END) as comp_simulada,
                COALESCE(SUM(CASE WHEN status IN ('Boleto gerado', 'Pago') THEN valor_boleto ELSE 0 END), 0) as valor_total_boletos,
                COALESCE(SUM(CASE WHEN status = 'Pago' THEN valor_boleto ELSE 0 END), 0) as valor_total_pago
            FROM boletos_energia b
            WHERE mes_referencia = $1
        `;
        const boletos = await pool.query(queryBoletos, [mes_referencia]);
        const boletosStats = boletos.rows[0] || { total: 0, gerados: 0, pagos: 0, enviados: 0, comp_simulada: 0, valor_total_boletos: 0, valor_total_pago: 0 };

        // Total de faturas recebidas (para display)
        const faturasRecebidas_total = parseInt(faturasStatsBase.total || 0);

        // Extrair contagens das categorias
        const pendentes = parseInt(faturasStatsBase.pendentes || 0);
        const comErro = parseInt(faturasStatsBase.com_erro || 0);
        const compSimulada = parseInt(boletosStats.comp_simulada || 0);  // Vem dos boletos!
        const semCompensacaoTotal = parseInt(faturasStatsBase.sem_compensacao_total || 0);
        // Sem Compensação real = total sem compensação - as que tiveram compensação simulada
        const semCompensacao = Math.max(0, semCompensacaoTotal - compSimulada);
        const compensado = parseInt(faturasStatsBase.compensado || 0);

        // Montar lista de itens de atenção
        const itensAtencao = [];
        if (faturasFaltando > 0) {
            itensAtencao.push({
                tipo: 'erro',
                mensagem: `UCs sem fatura no mês (Não Recebida)`,
                quantidade: faturasFaltando
            });
        }
        if (comErro > 0) {
            itensAtencao.push({
                tipo: 'erro',
                mensagem: `Faturas com erro de processamento`,
                quantidade: comErro
            });
        }
        if (pendentes > 0) {
            itensAtencao.push({
                tipo: 'aviso',
                mensagem: `Faturas pendentes (não lidas)`,
                quantidade: pendentes
            });
        }
        if (semCompensacao > 0) {
            itensAtencao.push({
                tipo: 'info',
                mensagem: `Faturas sem compensação (enviar PDF original)`,
                quantidade: semCompensacao
            });
        }

        const resumo = {
            total_ucs_ativas: totalUCsAtivas,
            faturas_recebidas: faturasRecebidas_total,
            nao_recebidas: faturasFaltando,
            pendentes: pendentes,
            com_erro: comErro,
            comp_simulada: compSimulada,
            sem_compensacao: semCompensacao,
            compensado: compensado,
            // Boletos
            geradas: parseInt(boletosStats.gerados || 0),
            enviadas: parseInt(boletosStats.enviados || 0),
            pagas: parseInt(boletosStats.pagos || 0),
            valor_total_boletos: parseFloat(boletosStats.valor_total_boletos || 0),
            valor_total_pago: parseFloat(boletosStats.valor_total_pago || 0),
            itens_atencao: itensAtencao
        };

        console.log(`📊 [Dashboard] Resumo: ${JSON.stringify(resumo)}`);
        res.json(resumo);

    } catch (error) {
        console.error('❌ [Dashboard] Erro:', error);
        res.status(500).json({ erro: error.message });
    }
});

// ========================================
// 📋 CONTROLE MENSAL - TABELA COMPLETA
// ========================================

// Endpoint: Controle Mensal - Todas as UCs com status
app.get('/api/controle-mensal/completo/:mes', authenticateToken, async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`📋 [Controle Mensal] Carregando dados para ${mes_referencia}`);

        const { Pool } = require('pg');

        // Conectar ao CRM
        const crmPool = new Pool({
            host: process.env.CRM_DB_HOST || '127.0.0.1',
            port: process.env.CRM_DB_PORT || 5432,
            database: process.env.CRM_DB_NAME || 'aupus_prod',
            user: process.env.CRM_DB_USER || 'aupus_prod',
            password: process.env.CRM_DB_PASSWORD || 'AupusProd2024Hashtag'
        });

        // Conectar ao banco de microserviços
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: process.env.MICROSERVICOS_DB_PORT || 5432,
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // 1. Buscar todas as UCs ativas do CRM (do controle_clube - apenas UCs, não UGs)
        const queryUCs = `
            SELECT DISTINCT
                uc.numero_unidade::text as uc,
                COALESCE(NULLIF(cc.nome_cliente, ''), p.nome_cliente, '') as nome_cliente,
                COALESCE(NULLIF(uc.cpf_cnpj_faturamento, ''), NULLIF(cc.cpf_cnpj, ''), '') as cpf_cnpj,
                COALESCE(NULLIF(uc.email_faturamento_1, ''), NULLIF(cc.email, ''), '') as email,
                COALESCE(NULLIF(uc.whatsapp_faturamento, ''), NULLIF(cc.whatsapp, ''), '') as whatsapp
            FROM controle_clube cc
            JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
            JOIN propostas p ON cc.proposta_id = p.id
            WHERE cc.deleted_at IS NULL
              AND uc.deleted_at IS NULL
              AND uc.numero_unidade IS NOT NULL
            ORDER BY 1
        `;
        const ucsResult = await crmPool.query(queryUCs);

        // 1.1. Buscar UGs autorizadas (geradoras cadastradas no CRM)
        const queryUGsAutorizadas = `
            SELECT numero_unidade::text as uc
            FROM unidades_consumidoras
            WHERE gerador = true
              AND deleted_at IS NULL
        `;
        const ugsAutorizadasResult = await crmPool.query(queryUGsAutorizadas);
        const ugsAutorizadasSet = new Set(ugsAutorizadasResult.rows.map(r => r.uc));
        console.log(`📋 [Controle Mensal] ${ugsAutorizadasSet.size} UGs autorizadas: ${[...ugsAutorizadasSet].join(', ')}`);

        await crmPool.end();

        // 2. Buscar faturas baixadas
        const queryFaturas = `
            SELECT
                id,
                uc,
                status,
                dados_leitura,
                dados_calculados,
                tags,
                caminho_storage,
                created_at
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND is_duplicata = false
        `;
        const faturasResult = await microPool.query(queryFaturas, [mes_referencia]);
        await microPool.end();

        // Criar mapa de faturas por UC
        const faturasMap = new Map();
        faturasResult.rows.forEach(f => {
            faturasMap.set(f.uc, f);
        });

        // 3. Buscar boletos (incluindo flag de compensação simulada)
        // Busca status de envio diretamente de controle_envios (fonte única de verdade)
        const queryBoletos = `
            SELECT
                b.uc,
                b.status,
                b.valor_boleto,
                b.status_envio,
                b.compensacao_completa_aplicada,
                cw.data_envio as data_envio_whatsapp,
                ce.data_envio as data_envio_email
            FROM boletos_energia b
            LEFT JOIN LATERAL (
                SELECT data_envio FROM controle_envios
                WHERE arquivo LIKE '%' || b.uc || '%'
                  AND mes_referencia = b.mes_referencia
                  AND tipo_envio = 'whatsapp'
                  AND status = 'enviado'
                ORDER BY data_envio DESC LIMIT 1
            ) cw ON true
            LEFT JOIN LATERAL (
                SELECT data_envio FROM controle_envios
                WHERE arquivo LIKE '%' || b.uc || '%'
                  AND mes_referencia = b.mes_referencia
                  AND tipo_envio = 'email'
                  AND status = 'enviado'
                ORDER BY data_envio DESC LIMIT 1
            ) ce ON true
            WHERE b.mes_referencia = $1
        `;
        const boletosResult = await pool.query(queryBoletos, [mes_referencia]);

        // Criar mapa de boletos por UC
        const boletosMap = new Map();
        boletosResult.rows.forEach(b => {
            boletosMap.set(b.uc, b);
        });

        // 3.1. Buscar pagamentos da concessionária (status BB API)
        const queryPagamentos = `
            SELECT
                uc,
                fatura_id,
                status,
                numero_requisicao,
                valor_fatura,
                data_vencimento_fatura
            FROM pagamentos_concessionaria
            WHERE mes_referencia = $1
        `;
        const pagamentosResult = await pool.query(queryPagamentos, [mes_referencia]);

        // Criar mapa de pagamentos por UC
        const pagamentosMap = new Map();
        pagamentosResult.rows.forEach(p => {
            pagamentosMap.set(p.uc, p);
        });

        // 4. Montar lista final (apenas UCs, sem UGs)
        const faturas = ucsResult.rows.map(uc => {
            const fatura = faturasMap.get(uc.uc);
            const boleto = boletosMap.get(uc.uc);
            const pagamento = pagamentosMap.get(uc.uc);

            // Determinar status da fatura
            let status_fatura = 'Nao Recebida';
            let tem_compensacao = false;
            let nome_diferente = false;
            let valor_boleto = null;
            let caminho_pdf = null;
            let erro_mensagem = null;

            if (fatura) {
                const categoria = fatura.dados_leitura?.categoria || '';
                const isPendentesFolder = fatura.caminho_storage?.includes('pendentes') || false;
                const isNomeDiferente = fatura.tags?.nome_diferente === true;
                // Compensação Simulada: tem boleto com compensacao_completa_aplicada = true
                const isCompSimulada = boleto?.compensacao_completa_aplicada === true;

                // Verificar se tem UGs autorizadas injetando
                // Verificamos o array 'geradoras' da fatura contra a lista de UGs cadastradas no CRM
                const geradorasFatura = fatura.dados_leitura?.geradoras || [];
                const temUgAutorizada = Array.isArray(geradorasFatura) && geradorasFatura.some(g => {
                    const ucGeradora = String(g.uc_geradora || '').trim();
                    return ugsAutorizadasSet.has(ucGeradora);
                });

                // Ordem de prioridade: Com Erro > Comp. Simulada > Sem Compensação > Compensado > Comp. Terceiros > Pendente
                if (fatura.status === 'erro' || fatura.status === 'erro_processamento') {
                    status_fatura = 'Com Erro';
                    erro_mensagem = fatura.dados_leitura?.erro || 'Erro no processamento';
                } else if (isCompSimulada) {
                    status_fatura = 'Comp. Simulada';
                } else if (categoria.includes('Sem Compensação')) {
                    status_fatura = 'Sem Compensacao';
                } else if (categoria.includes('Compensação') && temUgAutorizada) {
                    // Compensação com pelo menos uma UG autorizada
                    status_fatura = 'Compensado';
                    tem_compensacao = true;
                } else if (categoria.includes('Compensação') && !temUgAutorizada) {
                    // Compensação apenas de UGs não autorizadas (terceiros)
                    status_fatura = 'Comp. Terceiros';
                    tem_compensacao = true;
                } else if (isPendentesFolder) {
                    // Se está na pasta pendentes e não foi processado, é Não Recebida (arquivo não existe mais)
                    // Pendentes processados teriam categoria preenchida
                    status_fatura = 'Nao Recebida';
                } else {
                    // Fallback - se tem fatura mas não se encaixa em nada, provavelmente é erro
                    status_fatura = 'Pendente';
                }

                // Tag nome_diferente (PIS/COFINS) é separada do status
                if (isNomeDiferente) {
                    nome_diferente = true;
                }

                caminho_pdf = fatura.caminho_storage;
            }

            // Dados do boleto
            let enviado = false;
            let enviado_whatsapp = false;
            let enviado_email = false;
            let status_pagamento_aupus = null;
            let status_pagamento_eqtl = null;
            let fatura_id = null;

            if (boleto) {
                valor_boleto = parseFloat(boleto.valor_boleto || 0);
                enviado_whatsapp = !!boleto.data_envio_whatsapp;
                enviado_email = !!boleto.data_envio_email;
                enviado = enviado_whatsapp || enviado_email || boleto.status_envio === 'Enviado';

                if (boleto.status === 'Pago') {
                    status_pagamento_aupus = 'Pago';
                } else if (boleto.status === 'Boleto gerado') {
                    status_pagamento_aupus = 'Pendente';
                }
            } else if (fatura && fatura.dados_calculados) {
                // Se não tem boleto, pegar valor de dados_calculados
                const valoresCalc = fatura.dados_calculados.valores_calculados || {};
                if (valoresCalc.valor_aupus) {
                    valor_boleto = parseFloat(valoresCalc.valor_aupus) || null;
                }
            }

            // fatura_id vem de faturas_baixadas (para lançar pagamentos)
            if (fatura) {
                fatura_id = fatura.id;
            }

            // Status de pagamento da concessionária (BB API)
            if (pagamento) {
                // Se já tem pagamento, usar fatura_id do pagamento (mais confiável)
                if (pagamento.fatura_id) {
                    fatura_id = pagamento.fatura_id;
                }
                const statusBB = pagamento.status;
                // Mapear status do BB API
                if (['pago', 'debitado'].includes(statusBB)) {
                    status_pagamento_eqtl = 'Pago';
                } else if (statusBB === 'lancado') {
                    status_pagamento_eqtl = 'Lancado';
                } else if (statusBB === 'aguardando_aprovacao') {
                    status_pagamento_eqtl = 'Aguard. Aprov.';
                } else if (statusBB === 'processando_lancamento') {
                    status_pagamento_eqtl = 'Proc. Lanc.';
                } else if (statusBB === 'processando_pagamento') {
                    status_pagamento_eqtl = 'Proc. Pgto.';
                } else if (['processando', 'liberado', 'agendado'].includes(statusBB)) {
                    status_pagamento_eqtl = 'Processando';
                } else if (['rejeitado', 'erro', 'cancelado'].includes(statusBB)) {
                    status_pagamento_eqtl = 'Rejeitado';
                } else if (statusBB === 'pendente') {
                    status_pagamento_eqtl = 'Pendente';
                } else if (statusBB === 'vencido') {
                    status_pagamento_eqtl = 'Vencido';
                } else if (statusBB === 'devolvido') {
                    status_pagamento_eqtl = 'Devolvido';
                }
            }

            // Campo legado para compatibilidade (prioriza EQTL, fallback Aupus)
            const status_pagamento = status_pagamento_eqtl || status_pagamento_aupus;

            // Dados da fatura PDF (valor da concessionária, vencimento e energia)
            let valor_concessionaria = null;
            let data_vencimento = null;
            let tipo_compensacao = null;
            let consumo = null;
            let consumo_comp = null;
            let consumo_n_comp = null;
            let energia_injetada = null;
            let saldo = null;
            let tipo_fornecimento = null;
            let tarifa_compensacao = null;
            let valor_aupus = null;
            let valor_consorcio = null;
            let valor_economia = null;
            let valor_s_desconto = null;

            if (fatura && fatura.dados_leitura) {
                const dl = fatura.dados_leitura;

                // Valor da concessionária (da fatura original)
                const valorConc = dl.valor_concessionaria;
                if (valorConc !== null && valorConc !== undefined) {
                    valor_concessionaria = parseFloat(valorConc) || null;
                }

                // Data de vencimento (da fatura original)
                data_vencimento = dl.vencimento || null;

                // Dados de energia
                consumo = parseFloat(dl.consumo) || null;
                consumo_comp = parseFloat(dl.consumo_comp) || null;
                consumo_n_comp = parseFloat(dl.consumo_n_comp) || null;
                energia_injetada = parseFloat(dl.energia_injetada) || null;
                saldo = parseFloat(dl.saldo) || null;
                tipo_fornecimento = dl.tipo_fornecimento || null;
            }

            if (fatura && fatura.dados_calculados) {
                const dc = fatura.dados_calculados;
                const vo = dc.valores_originais || {};
                const vc = dc.valores_calculados || {};

                tarifa_compensacao = parseFloat(vo.tarifa_compensacao) || null;
                valor_aupus = parseFloat(vc.valor_aupus) || null;
                valor_consorcio = parseFloat(vc.valor_consorcio) || null;
                valor_economia = parseFloat(vc.valor_economia) || null;
                valor_s_desconto = parseFloat(vc.valor_s_desconto) || null;
            }

            // Determinar tipo de compensação (Completa, Parcial, Corrigida, Simulada)
            if (status_fatura === 'Compensado' || status_fatura === 'Comp. Simulada') {
                const dadosCalc = fatura?.dados_calculados || {};
                const flags = dadosCalc.flags || {};
                const valoresOriginais = dadosCalc.valores_originais || {};

                // Usar tipo_compensacao_aplicada do banco se disponível
                const tipoCompensacaoBanco = flags.tipo_compensacao_aplicada;

                if (tipoCompensacaoBanco === 'simulada') {
                    // Fatura não tinha compensação, foi simulada do zero
                    tipo_compensacao = 'Simulada';
                } else if (tipoCompensacaoBanco === 'corrigida') {
                    // Fatura tinha compensação parcial, foi corrigida
                    tipo_compensacao = 'Corrigida';
                } else if (status_fatura === 'Comp. Simulada') {
                    // Fallback para status antigo (boleto com compensacao_completa_aplicada)
                    tipo_compensacao = 'Simulada';
                } else if (flags.compensacao_completa_aplicada === true) {
                    // Fallback: se flag true mas sem tipo específico, verificar dados originais
                    const consumoCompPdf = parseFloat(fatura?.dados_leitura?.consumo_comp) || 0;
                    tipo_compensacao = consumoCompPdf > 0 ? 'Corrigida' : 'Simulada';
                } else {
                    // Verificar consumo não compensado vs disponibilidade mínima
                    const consumoNaoCompensado = parseFloat(valoresOriginais.consumo_nao_compensado) || 0;

                    // Disponibilidade mínima baseada no tipo de fornecimento
                    // Monofásico: 30 kWh, Bifásico: 50 kWh, Trifásico: 100 kWh
                    const tipoFornecimento = (fatura?.dados_leitura?.tipo_fornecimento || '').toUpperCase();
                    let disponibilidadeMinima = 100; // Default: trifásico

                    if (tipoFornecimento.includes('MONOF')) {
                        disponibilidadeMinima = 30;
                    } else if (tipoFornecimento.includes('BIF')) {
                        disponibilidadeMinima = 50;
                    }

                    // Se consumo não compensado <= disponibilidade mínima, é completa
                    if (consumoNaoCompensado <= disponibilidadeMinima) {
                        tipo_compensacao = 'Completa';
                    } else {
                        tipo_compensacao = 'Parcial';
                    }
                }
            }

            return {
                uc: uc.uc,
                nome_cliente: uc.nome_cliente,
                cpf_cnpj: uc.cpf_cnpj,
                email: uc.email,
                whatsapp: uc.whatsapp,
                status_fatura,
                tem_compensacao,
                tipo_compensacao,
                nome_diferente,
                valor_boleto,
                em_boletos_energia: !!boleto,
                valor_concessionaria,
                data_vencimento,
                tipo_fornecimento,
                // Dados de energia (kWh)
                consumo,
                consumo_comp,
                consumo_n_comp,
                energia_injetada,
                saldo,
                // Valores calculados (R$)
                tarifa_compensacao,
                valor_aupus,
                valor_consorcio,
                valor_economia,
                valor_s_desconto,
                // Operacional
                enviado,
                enviado_whatsapp,
                enviado_email,
                status_pagamento,
                status_pagamento_aupus,
                status_pagamento_eqtl,
                fatura_id,
                caminho_pdf,
                erro_mensagem
            };
        });

        console.log(`📋 [Controle Mensal] Retornando ${faturas.length} registros`);
        res.json({ faturas, total: faturas.length });

    } catch (error) {
        console.error('❌ [Controle Mensal] Erro:', error);
        res.status(500).json({ erro: error.message });
    }
});

// ========================================
// ENDPOINT: Forçar envio para Boletos de Energia
// ========================================
app.post('/api/controle-mensal/enviar-boletos', authenticateToken, async (req, res) => {
    const { Pool } = require('pg');
    const microPool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'aupus_faturas',
        user: 'aupus',
        password: 'SuaSenhaAqui123!'
    });

    try {
        const { uc, mes_referencia } = req.body;
        console.log(`📤 [Enviar Boletos] UC: ${uc}, Mês: ${mes_referencia}`);

        if (!uc || !mes_referencia) {
            return res.status(400).json({ erro: 'UC e mês de referência são obrigatórios' });
        }

        // 1. Buscar dados da fatura
        const faturaResult = await microPool.query(`
            SELECT
                uc,
                mes_referencia,
                dados_leitura,
                dados_calculados
            FROM faturas_baixadas
            WHERE uc = $1 AND mes_referencia = $2 AND is_duplicata = false
            ORDER BY CASE WHEN status = 'processado' THEN 1 ELSE 2 END
            LIMIT 1
        `, [uc, mes_referencia]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];
        const dadosLeitura = fatura.dados_leitura || {};
        const dadosCalc = fatura.dados_calculados || {};
        const valores = dadosCalc.valores_calculados || {};

        // 2. Verificar se já existe boleto
        const boletoExistente = await pool.query(`
            SELECT id FROM boletos_energia WHERE uc = $1 AND mes_referencia = $2
        `, [uc, mes_referencia]);

        if (boletoExistente.rows.length > 0) {
            return res.status(400).json({ erro: 'Já existe boleto para esta UC/mês' });
        }

        // 3. Buscar dados do cliente no CRM
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        let dadosCliente = {};
        try {
            const clienteResult = await crmPool.query(`
                SELECT
                    COALESCE(NULLIF(uc.nome_faturamento, ''), cc.nome_cliente, '') as nome,
                    COALESCE(NULLIF(uc.cpf_cnpj_faturamento, ''), cc.cpf_cnpj, '') as cpf_cnpj,
                    COALESCE(NULLIF(uc.email_faturamento_1, ''), cc.email, '') as email,
                    COALESCE(NULLIF(uc.whatsapp_faturamento, ''), cc.whatsapp, '') as whatsapp,
                    COALESCE(uc.endereco_completo, '') as endereco,
                    COALESCE(uc.bairro, '') as bairro,
                    COALESCE(uc.cidade, '') as cidade,
                    COALESCE(uc.estado, 'GO') as uf,
                    COALESCE(uc.cep, '') as cep,
                    cc.dia_vencimento
                FROM controle_clube cc
                JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
                WHERE uc.numero_unidade = $1 AND cc.deleted_at IS NULL
                LIMIT 1
            `, [uc]);

            if (clienteResult.rows.length > 0) {
                dadosCliente = clienteResult.rows[0];
            }
            await crmPool.end();
        } catch (crmError) {
            console.error('⚠️ Erro ao buscar dados do CRM:', crmError.message);
        }

        // 4. Calcular valor do boleto
        const valorConsorcio = parseFloat(valores.valor_consorcio) || 0;
        const valorAupus = parseFloat(valores.valor_aupus) || 0;
        const valorBoleto = valorConsorcio > 0 ? valorConsorcio : valorAupus;

        // Verificar se valor foi calculado
        if (valorBoleto <= 0) {
            // Montar detalhes para justificativa
            const consumoComp = parseFloat(dadosLeitura.consumo_comp) || 0;
            const consumoNComp = parseFloat(dadosLeitura.consumo_n_comp) || 0;
            const valorConcessionaria = parseFloat(dadosLeitura.valor_concessionaria) || 0;

            let motivo = 'Valor do boleto não calculado.';
            let detalhes = [];

            if (consumoComp <= 0 && consumoNComp <= 0) {
                detalhes.push('Consumo não encontrado na fatura');
            } else if (consumoComp <= 0) {
                detalhes.push(`Fatura sem compensação (consumo não compensado: ${consumoNComp} kWh)`);
            }

            if (!valores.valor_consorcio && !valores.valor_aupus) {
                detalhes.push('Fatura não foi processada pela calculadora');
            }

            if (valorConcessionaria > 0) {
                detalhes.push(`Valor concessionária: R$ ${valorConcessionaria.toFixed(2)}`);
            }

            return res.status(400).json({
                erro: motivo,
                detalhes: detalhes.join('. ') + '.',
                dados_fatura: {
                    consumo_comp: consumoComp,
                    consumo_n_comp: consumoNComp,
                    valor_concessionaria: valorConcessionaria,
                    valor_consorcio_calc: valores.valor_consorcio || null,
                    valor_aupus_calc: valores.valor_aupus || null
                }
            });
        }

        // 5. Calcular data de vencimento
        const diaVencimento = dadosCliente.dia_vencimento || 20;
        const hoje = new Date();
        let dataVencimento = new Date(hoje.getFullYear(), hoje.getMonth(), diaVencimento);
        if (dataVencimento <= hoje) {
            dataVencimento.setMonth(dataVencimento.getMonth() + 1);
        }
        const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

        // 6. Preparar dados do boleto
        const consumoComp = parseFloat(dadosLeitura.consumo_comp) || parseFloat(dadosLeitura.energia_injetada) || 0;
        const consumoNComp = parseFloat(dadosLeitura.consumo_n_comp) || 0;
        const consumoTotal = consumoComp + consumoNComp;

        // Determinar tipo de pessoa
        const cpfCnpj = (dadosCliente.cpf_cnpj || '').replace(/\D/g, '');
        const tipoPessoa = cpfCnpj.length > 11 ? 'CNPJ' : 'CPF';

        // 7. Inserir boleto
        const insertResult = await pool.query(`
            INSERT INTO boletos_energia (
                uc, mes_referencia, data_vencimento, valor_boleto,
                tipo_pessoa, documento, nome_completo, endereco, bairro, cep, cidade, uf,
                energia_compensado, energia_nao_compensado,
                energia_compensado_original, energia_nao_compensado_original,
                valor_energia_compensada, valor_bandeira_compensada,
                tarifa_minima_concessionaria, valor_com_desconto_aupus, valor_economia,
                email, telefone, status, tipo_boleto,
                dados_completos
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16,
                $17, $18, $19, $20, $21,
                $22, $23, 'Pendente', 'manual',
                $24
            )
            RETURNING id
        `, [
            uc, mes_referencia, dataVencimentoStr, valorBoleto,
            tipoPessoa, cpfCnpj, dadosCliente.nome || '', dadosCliente.endereco || '',
            dadosCliente.bairro || '', dadosCliente.cep || '', dadosCliente.cidade || '', dadosCliente.uf || 'GO',
            consumoComp, consumoNComp, consumoComp, consumoNComp,
            parseFloat(valores.valor_comp_bruto) || 0, parseFloat(valores.valor_bandeira_bruto) || 0,
            parseFloat(dadosLeitura.valor_concessionaria) || 0, valorBoleto, parseFloat(valores.valor_economia) || 0,
            dadosCliente.email || '', (dadosCliente.whatsapp || '').replace(/\D/g, ''),
            JSON.stringify({ fonte: 'controle-mensal-manual', data_envio: new Date().toISOString() })
        ]);

        console.log(`✅ [Enviar Boletos] Boleto criado com ID: ${insertResult.rows[0].id}`);

        // Auto-enviar para Aupus Control (fire-and-forget)
        autoEnviarBoletoParaControl(insertResult.rows[0].id).catch(() => {});

        res.json({
            sucesso: true,
            mensagem: 'Boleto criado com sucesso',
            id: insertResult.rows[0].id,
            valor_boleto: valorBoleto
        });

    } catch (error) {
        console.error('❌ [Enviar Boletos] Erro:', error);
        res.status(500).json({ erro: error.message });
    } finally {
        await microPool.end();
    }
});

// ========================================
// ENDPOINT: Simular compensação completa
// ========================================
app.post('/api/controle-mensal/simular-compensacao', authenticateToken, async (req, res) => {
    const { Pool } = require('pg');
    const microPool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'aupus_faturas',
        user: 'aupus',
        password: 'SuaSenhaAqui123!'
    });

    try {
        const { uc, mes_referencia } = req.body;
        console.log(`🔄 [Simular Compensação] UC: ${uc}, Mês: ${mes_referencia}`);

        if (!uc || !mes_referencia) {
            return res.status(400).json({ erro: 'UC e mês de referência são obrigatórios' });
        }

        // 1. Buscar fatura original
        const faturaResult = await microPool.query(`
            SELECT id, uc, mes_referencia, dados_leitura, dados_calculados, status
            FROM faturas_baixadas
            WHERE uc = $1 AND mes_referencia = $2 AND is_duplicata = false
            ORDER BY CASE WHEN status = 'processado' THEN 1 ELSE 2 END
            LIMIT 1
        `, [uc, mes_referencia]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];
        const dadosLeitura = fatura.dados_leitura || {};

        // 2. Verificar se já tem compensação
        const consumoComp = parseFloat(dadosLeitura.consumo_comp) || 0;
        if (consumoComp > 0) {
            return res.status(400).json({ erro: 'Fatura já possui compensação' });
        }

        // 3. Obter consumo total e tipo de fornecimento
        let consumoNComp = parseFloat(dadosLeitura.consumo_n_comp) || parseFloat(dadosLeitura.consumo) || 0;
        const tipoFornecimento = (dadosLeitura.tipo_fornecimento || '').toUpperCase();

        // Fallback: calcular consumo a partir das leituras do medidor
        if (consumoNComp <= 0) {
            const leituraAtual = parseFloat(dadosLeitura.leitura_atual_energia_ativa) || 0;
            const leituraAnterior = parseFloat(dadosLeitura.leitura_anterior_energia_ativa) || 0;
            const constante = parseFloat(dadosLeitura.const_medidor_energia_ativa) || 1;

            if (leituraAtual > 0 && leituraAnterior > 0) {
                consumoNComp = (leituraAtual - leituraAnterior) * constante;
                console.log(`   📊 Consumo calculado das leituras: ${consumoNComp} kWh`);
            }
        }

        if (consumoNComp <= 0) {
            return res.status(400).json({ erro: 'Consumo não encontrado na fatura' });
        }

        // 4. Determinar tarifa mínima baseada no tipo de fornecimento
        let tarifaMinima = 100; // Trifásico padrão
        if (tipoFornecimento.includes('MONOF')) {
            tarifaMinima = 30;
        } else if (tipoFornecimento.includes('BIF')) {
            tarifaMinima = 50;
        }

        if (consumoNComp <= tarifaMinima) {
            return res.status(400).json({
                erro: `Consumo (${consumoNComp} kWh) menor ou igual à tarifa mínima (${tarifaMinima} kWh)`
            });
        }

        // 5. Buscar dados completos do cliente no CRM (incluindo descontos)
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        let dadosCliente = {};
        try {
            const clienteResult = await crmPool.query(`
                SELECT
                    COALESCE(NULLIF(uc.nome_faturamento, ''), cc.nome_cliente, '') as nome,
                    COALESCE(NULLIF(uc.cpf_cnpj_faturamento, ''), cc.cpf_cnpj, '') as cpf_cnpj,
                    COALESCE(NULLIF(uc.email_faturamento_1, ''), cc.email, '') as email,
                    COALESCE(NULLIF(uc.whatsapp_faturamento, ''), cc.whatsapp, '') as whatsapp,
                    COALESCE(uc.endereco_completo, '') as endereco,
                    COALESCE(uc.bairro, '') as bairro,
                    COALESCE(uc.cidade, '') as cidade,
                    COALESCE(uc.estado, 'GO') as uf,
                    COALESCE(uc.cep, '') as cep,
                    cc.dia_vencimento,
                    COALESCE(uc.desconto_fatura, 5) as desconto_fatura,
                    COALESCE(uc.desconto_bandeira, 5) as desconto_bandeira
                FROM controle_clube cc
                JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
                WHERE uc.numero_unidade = $1 AND cc.deleted_at IS NULL
                LIMIT 1
            `, [uc]);

            if (clienteResult.rows.length > 0) {
                dadosCliente = clienteResult.rows[0];
            } else {
                await crmPool.end();
                return res.status(404).json({ erro: 'Cliente não encontrado no CRM' });
            }
            await crmPool.end();
        } catch (crmError) {
            console.error('⚠️ [Simular Compensação] Erro ao buscar dados do CRM:', crmError.message);
            return res.status(500).json({ erro: 'Erro ao buscar dados do cliente no CRM' });
        }

        // 6. Simular compensação
        const novoConsumoComp = consumoNComp - tarifaMinima;
        const novoConsumoNComp = tarifaMinima;

        // 7. Buscar tarifas da fatura (SEM FALLBACK 0.80 - corrigido)
        let tarifaComp = parseFloat(dadosLeitura.tarifa_comp) ||
                          parseFloat(dadosLeitura.tarifa_consumo_n_comp) ||
                          parseFloat(dadosLeitura.tarifa_consumo) || 0;

        // Se não encontrou tarifa, calcular a partir de valor_consumo / consumo
        if (tarifaComp === 0) {
            const valorConsumo = parseFloat(dadosLeitura.valor_consumo) || 0;
            const consumoParaCalculo = parseFloat(dadosLeitura.consumo) || consumoNComp || 0;
            if (valorConsumo > 0 && consumoParaCalculo > 0) {
                tarifaComp = valorConsumo / consumoParaCalculo;
                console.log(`⚠️ [Compensação] Tarifa calculada: ${tarifaComp.toFixed(6)} (valor_consumo/consumo)`);
            } else {
                console.error(`❌ [Compensação] Tarifa não encontrada para UC ${uc}`);
                return res.status(400).json({
                    erro: 'Tarifa de energia não encontrada na fatura. Reprocesse a fatura primeiro.'
                });
            }
        }

        console.log(`📊 [Compensação] Tarifa energia: ${tarifaComp.toFixed(6)}`);

        const tarifaBandeira = parseFloat(dadosLeitura.tarifa_adc_bandeira_vermelha) ||
                              parseFloat(dadosLeitura.tarifa_adc_bandeira_amarela) || 0;

        // 8. Calcular valores usando descontos do CRM
        const descontoFatura = parseFloat(dadosCliente.desconto_fatura) / 100;
        const descontoBandeira = parseFloat(dadosCliente.desconto_bandeira) / 100;

        console.log(`📊 [Simular Compensação] Descontos do CRM: fatura=${descontoFatura*100}%, bandeira=${descontoBandeira*100}%`);

        const valorCompBruto = novoConsumoComp * tarifaComp;
        const valorComDesconto = valorCompBruto * (1 - descontoFatura);

        const valorBandeiraBruto = novoConsumoComp * tarifaBandeira;
        const valorBandeiraComDesconto = valorBandeiraBruto * (1 - descontoBandeira);

        const valorAupus = valorComDesconto + valorBandeiraComDesconto;

        // Calcular tarifa mínima em reais
        const tarifaMinimaConcessionaria = tarifaMinima * tarifaComp + tarifaMinima * tarifaBandeira;

        const valorConsorcio = tarifaMinimaConcessionaria + valorAupus;
        const valorEconomia = (valorCompBruto + valorBandeiraBruto) - (valorComDesconto + valorBandeiraComDesconto);

        console.log(`📊 [Simular Compensação] Valores calculados:`);
        console.log(`   - Energia bruto: R$ ${valorCompBruto.toFixed(2)}`);
        console.log(`   - Energia c/ desconto (${descontoFatura*100}%): R$ ${valorComDesconto.toFixed(2)}`);
        console.log(`   - Bandeira bruto: R$ ${valorBandeiraBruto.toFixed(2)}`);
        console.log(`   - Bandeira c/ desconto (${descontoBandeira*100}%): R$ ${valorBandeiraComDesconto.toFixed(2)}`);
        console.log(`   - Valor AUPUS: R$ ${valorAupus.toFixed(2)}`);
        console.log(`   - Tarifa mínima: R$ ${tarifaMinimaConcessionaria.toFixed(2)}`);
        console.log(`   - Valor total boleto: R$ ${valorConsorcio.toFixed(2)}`);
        console.log(`   - Economia: R$ ${valorEconomia.toFixed(2)}`);

        // 9. Atualizar dados_calculados na fatura
        const dadosCalc = fatura.dados_calculados || {};
        const novoDadosCalc = {
            ...dadosCalc,
            valores_originais: {
                ...dadosCalc.valores_originais,
                consumo_compensado: novoConsumoComp,
                consumo_nao_compensado: novoConsumoNComp
            },
            valores_calculados: {
                ...dadosCalc.valores_calculados,
                valor_comp_bruto: valorCompBruto,
                valor_com_desconto: valorComDesconto,
                valor_bandeira_bruto: valorBandeiraBruto,
                valor_bandeira_com_desconto: valorBandeiraComDesconto,
                valor_aupus: valorAupus,
                valor_consorcio: valorConsorcio,
                valor_economia: valorEconomia
            },
            flags: {
                ...dadosCalc.flags,
                compensacao_completa_aplicada: true,
                tipo_compensacao_aplicada: 'simulada'
            }
        };

        await microPool.query(`
            UPDATE faturas_baixadas
            SET dados_calculados = $1, status = 'processado'
            WHERE id = $2
        `, [JSON.stringify(novoDadosCalc), fatura.id]);

        // 10. Verificar se já existe boleto para esta UC/mês
        const boletoExistente = await pool.query(`
            SELECT id FROM boletos_energia WHERE uc = $1 AND mes_referencia = $2
        `, [uc, mes_referencia]);

        // 11. Calcular data de vencimento
        const diaVencimento = dadosCliente.dia_vencimento || 20;
        const hoje = new Date();
        let dataVencimento = new Date(hoje.getFullYear(), hoje.getMonth(), diaVencimento);
        if (dataVencimento <= hoje) {
            dataVencimento.setMonth(dataVencimento.getMonth() + 1);
        }
        const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

        // 12. Determinar tipo de pessoa
        const cpfCnpj = (dadosCliente.cpf_cnpj || '').replace(/\D/g, '');
        const tipoPessoa = cpfCnpj.length > 11 ? 'CNPJ' : 'CPF';

        let boletoId = null;

        if (boletoExistente.rows.length > 0) {
            // Atualizar boleto existente
            boletoId = boletoExistente.rows[0].id;
            await pool.query(`
                UPDATE boletos_energia SET
                    valor_boleto = $1,
                    energia_compensado = $2,
                    energia_nao_compensado = $3,
                    energia_total = $13,
                    energia_compensado_corrigido = $2,
                    energia_nao_compensado_corrigido = $3,
                    valor_energia_compensada = $4,
                    valor_bandeira_compensada = $5,
                    valor_com_desconto = $8,
                    valor_bandeira_com_desconto = $9,
                    valor_com_desconto_aupus = $10,
                    tarifa_minima_concessionaria = $11,
                    valor_economia = $6,
                    compensacao_completa_aplicada = true,
                    tipo_boleto = 'simulado',
                    dados_completos = $12,
                    updated_at = NOW()
                WHERE id = $7
            `, [
                valorConsorcio.toFixed(2),         // $1 - valor_boleto
                novoConsumoComp.toFixed(2),        // $2 - energia_compensado
                novoConsumoNComp.toFixed(2),       // $3 - energia_nao_compensado
                valorCompBruto.toFixed(2),         // $4 - valor_energia_compensada (bruto)
                valorBandeiraBruto.toFixed(2),     // $5 - valor_bandeira_compensada (bruto)
                valorEconomia.toFixed(2),          // $6 - valor_economia
                boletoId,                          // $7 - id
                valorComDesconto.toFixed(2),       // $8 - valor_com_desconto
                valorBandeiraComDesconto.toFixed(2), // $9 - valor_bandeira_com_desconto
                valorAupus.toFixed(2),             // $10 - valor_com_desconto_aupus
                tarifaMinimaConcessionaria.toFixed(2), // $11 - tarifa_minima_concessionaria
                JSON.stringify({
                    fonte: 'simular-compensacao',
                    data_simulacao: new Date().toISOString(),
                    desconto_fatura: dadosCliente.desconto_fatura,
                    desconto_bandeira: dadosCliente.desconto_bandeira
                }),
                consumoNComp.toFixed(2)            // $13 - energia_total
            ]);
            console.log(`✅ [Simular Compensação] Boleto ID ${boletoId} atualizado`);
        } else {
            // Criar novo boleto
            const insertResult = await pool.query(`
                INSERT INTO boletos_energia (
                    uc, mes_referencia, data_vencimento, valor_boleto,
                    tipo_pessoa, documento, nome_completo, endereco, bairro, cep, cidade, uf,
                    energia_compensado, energia_nao_compensado, energia_total,
                    energia_compensado_original, energia_nao_compensado_original,
                    energia_compensado_corrigido, energia_nao_compensado_corrigido,
                    valor_energia_compensada, valor_bandeira_compensada,
                    valor_com_desconto, valor_bandeira_com_desconto,
                    tarifa_minima_concessionaria, valor_com_desconto_aupus, valor_economia,
                    email, telefone, status, tipo_boleto,
                    compensacao_completa_aplicada,
                    dados_completos
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14, $26, 0, $15,
                    $13, $14,
                    $16, $17,
                    $18, $19,
                    $20, $21, $22,
                    $23, $24, 'Pendente', 'simulado',
                    true,
                    $25
                )
                RETURNING id
            `, [
                uc,                                 // $1
                mes_referencia,                    // $2
                dataVencimentoStr,                 // $3
                valorConsorcio.toFixed(2),         // $4 - valor_boleto
                tipoPessoa,                        // $5
                cpfCnpj,                           // $6
                dadosCliente.nome || '',           // $7
                dadosCliente.endereco || '',       // $8
                dadosCliente.bairro || '',         // $9
                dadosCliente.cep || '',            // $10
                dadosCliente.cidade || '',         // $11
                dadosCliente.uf || 'GO',           // $12
                novoConsumoComp.toFixed(2),        // $13 - energia_compensado
                novoConsumoNComp.toFixed(2),       // $14 - energia_nao_compensado
                consumoNComp.toFixed(2),           // $15 - energia_nao_compensado_original
                valorCompBruto.toFixed(2),         // $16 - valor_energia_compensada (bruto)
                valorBandeiraBruto.toFixed(2),     // $17 - valor_bandeira_compensada (bruto)
                valorComDesconto.toFixed(2),       // $18 - valor_com_desconto
                valorBandeiraComDesconto.toFixed(2), // $19 - valor_bandeira_com_desconto
                tarifaMinimaConcessionaria.toFixed(2), // $20 - tarifa_minima_concessionaria
                valorAupus.toFixed(2),             // $21 - valor_com_desconto_aupus
                valorEconomia.toFixed(2),          // $22 - valor_economia
                dadosCliente.email || '',          // $23
                (dadosCliente.whatsapp || '').replace(/\D/g, ''),  // $24
                JSON.stringify({
                    fonte: 'simular-compensacao',
                    data_simulacao: new Date().toISOString(),
                    desconto_fatura: dadosCliente.desconto_fatura,
                    desconto_bandeira: dadosCliente.desconto_bandeira
                }),
                consumoNComp.toFixed(2)            // $26 - energia_total
            ]);
            boletoId = insertResult.rows[0].id;
            console.log(`✅ [Simular Compensação] Novo boleto criado com ID ${boletoId}`);
            // Auto-enviar para Aupus Control (fire-and-forget)
            autoEnviarBoletoParaControl(boletoId).catch(() => {});
        }

        console.log(`✅ [Simular Compensação] Compensação simulada para UC ${uc}`);

        res.json({
            sucesso: true,
            mensagem: 'Compensação simulada com sucesso',
            dados: {
                consumo_original: consumoNComp,
                consumo_compensado: novoConsumoComp,
                consumo_nao_compensado: novoConsumoNComp,
                tarifa_minima_kwh: tarifaMinima,
                tarifa_minima_reais: tarifaMinimaConcessionaria,
                desconto_fatura: dadosCliente.desconto_fatura,
                desconto_bandeira: dadosCliente.desconto_bandeira,
                valor_energia_bruto: valorCompBruto,
                valor_energia_desconto: valorComDesconto,
                valor_bandeira_bruto: valorBandeiraBruto,
                valor_bandeira_desconto: valorBandeiraComDesconto,
                valor_aupus: valorAupus,
                valor_boleto: valorConsorcio,
                valor_economia: valorEconomia,
                boleto_id: boletoId
            }
        });

    } catch (error) {
        console.error('❌ [Simular Compensação] Erro:', error);
        res.status(500).json({ erro: error.message });
    } finally {
        await microPool.end();
    }
});

// ========================================
// ENDPOINT: Completar compensação parcial
// ========================================
app.post('/api/controle-mensal/completar-compensacao', authenticateToken, async (req, res) => {
    const { Pool } = require('pg');
    const microPool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'aupus_faturas',
        user: 'aupus',
        password: 'SuaSenhaAqui123!'
    });

    try {
        const { uc, mes_referencia } = req.body;
        console.log(`🔄 [Completar Compensação] UC: ${uc}, Mês: ${mes_referencia}`);

        if (!uc || !mes_referencia) {
            return res.status(400).json({ erro: 'UC e mês de referência são obrigatórios' });
        }

        // 1. Buscar fatura original
        const faturaResult = await microPool.query(`
            SELECT id, uc, mes_referencia, dados_leitura, dados_calculados, status
            FROM faturas_baixadas
            WHERE uc = $1 AND mes_referencia = $2 AND is_duplicata = false
            ORDER BY CASE WHEN status = 'processado' THEN 1 ELSE 2 END
            LIMIT 1
        `, [uc, mes_referencia]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];
        const dadosLeitura = fatura.dados_leitura || {};

        // 2. Verificar se tem compensação parcial
        const consumoComp = parseFloat(dadosLeitura.consumo_comp) || 0;
        const consumoNComp = parseFloat(dadosLeitura.consumo_n_comp) || parseFloat(dadosLeitura.consumo) || 0;
        const consumoTotal = consumoComp + consumoNComp;

        if (consumoComp <= 0) {
            return res.status(400).json({
                erro: 'Fatura não possui compensação. Use "Simular Compensação" em vez de "Completar Compensação".'
            });
        }

        // 3. Obter tipo de fornecimento para determinar tarifa mínima
        const tipoFornecimento = (dadosLeitura.tipo_fornecimento || '').toUpperCase();
        let tarifaMinima = 100; // Trifásico padrão
        if (tipoFornecimento.includes('MONOF')) {
            tarifaMinima = 30;
        } else if (tipoFornecimento.includes('BIF')) {
            tarifaMinima = 50;
        }

        // 4. Verificar se a compensação já está completa
        if (consumoNComp <= tarifaMinima) {
            return res.status(400).json({
                erro: `Consumo não compensado (${consumoNComp} kWh) já está na tarifa mínima (${tarifaMinima} kWh)`
            });
        }

        // 5. Buscar dados do cliente no CRM
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        let dadosCliente = {};
        try {
            const clienteResult = await crmPool.query(`
                SELECT
                    COALESCE(NULLIF(uc.nome_faturamento, ''), cc.nome_cliente, '') as nome,
                    COALESCE(NULLIF(uc.cpf_cnpj_faturamento, ''), cc.cpf_cnpj, '') as cpf_cnpj,
                    COALESCE(NULLIF(uc.email_faturamento_1, ''), cc.email, '') as email,
                    COALESCE(NULLIF(uc.whatsapp_faturamento, ''), cc.whatsapp, '') as whatsapp,
                    COALESCE(uc.endereco_completo, '') as endereco,
                    COALESCE(uc.bairro, '') as bairro,
                    COALESCE(uc.cidade, '') as cidade,
                    COALESCE(uc.estado, 'GO') as uf,
                    COALESCE(uc.cep, '') as cep,
                    cc.dia_vencimento,
                    COALESCE(uc.desconto_fatura, 5) as desconto_fatura,
                    COALESCE(uc.desconto_bandeira, 5) as desconto_bandeira
                FROM controle_clube cc
                JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
                WHERE uc.numero_unidade = $1 AND cc.deleted_at IS NULL
                LIMIT 1
            `, [uc]);

            if (clienteResult.rows.length > 0) {
                dadosCliente = clienteResult.rows[0];
            } else {
                await crmPool.end();
                return res.status(404).json({ erro: 'Cliente não encontrado no CRM' });
            }
            await crmPool.end();
        } catch (crmError) {
            console.error('⚠️ [Completar Compensação] Erro ao buscar dados do CRM:', crmError.message);
            return res.status(500).json({ erro: 'Erro ao buscar dados do cliente no CRM' });
        }

        // 6. Calcular compensação adicional
        const compensacaoAdicional = consumoNComp - tarifaMinima;
        const novoConsumoComp = consumoComp + compensacaoAdicional;
        const novoConsumoNComp = tarifaMinima;

        console.log(`📊 [Completar Compensação] Calculando:`);
        console.log(`   - Compensado original: ${consumoComp} kWh`);
        console.log(`   - Não compensado original: ${consumoNComp} kWh`);
        console.log(`   - Compensação adicional: ${compensacaoAdicional} kWh`);
        console.log(`   - Novo compensado: ${novoConsumoComp} kWh`);
        console.log(`   - Novo não compensado: ${novoConsumoNComp} kWh`);

        // 7. Buscar tarifas da fatura (SEM FALLBACK 0.80 - corrigido)
        let tarifaComp = parseFloat(dadosLeitura.tarifa_comp) ||
                          parseFloat(dadosLeitura.tarifa_consumo_n_comp) ||
                          parseFloat(dadosLeitura.tarifa_consumo) || 0;

        // Se não encontrou tarifa, calcular a partir de valor_consumo / consumo
        if (tarifaComp === 0) {
            const valorConsumo = parseFloat(dadosLeitura.valor_consumo) || 0;
            const consumoParaCalculo = parseFloat(dadosLeitura.consumo) || consumoNComp || 0;
            if (valorConsumo > 0 && consumoParaCalculo > 0) {
                tarifaComp = valorConsumo / consumoParaCalculo;
                console.log(`⚠️ [Compensação] Tarifa calculada: ${tarifaComp.toFixed(6)} (valor_consumo/consumo)`);
            } else {
                console.error(`❌ [Compensação] Tarifa não encontrada para UC ${uc}`);
                return res.status(400).json({
                    erro: 'Tarifa de energia não encontrada na fatura. Reprocesse a fatura primeiro.'
                });
            }
        }

        console.log(`📊 [Compensação] Tarifa energia: ${tarifaComp.toFixed(6)}`);

        const tarifaBandeira = parseFloat(dadosLeitura.tarifa_adc_bandeira_vermelha) ||
                              parseFloat(dadosLeitura.tarifa_adc_bandeira_amarela) || 0;

        // 8. Calcular valores usando descontos do CRM
        const descontoFatura = parseFloat(dadosCliente.desconto_fatura) / 100;
        const descontoBandeira = parseFloat(dadosCliente.desconto_bandeira) / 100;

        console.log(`📊 [Completar Compensação] Descontos do CRM: fatura=${descontoFatura*100}%, bandeira=${descontoBandeira*100}%`);

        // Calcular valores apenas da compensação adicional (o que estamos completando)
        const valorCompAdicionalBruto = compensacaoAdicional * tarifaComp;
        const valorCompAdicionalDesconto = valorCompAdicionalBruto * (1 - descontoFatura);

        const valorBandeiraAdicionalBruto = compensacaoAdicional * tarifaBandeira;
        const valorBandeiraAdicionalDesconto = valorBandeiraAdicionalBruto * (1 - descontoBandeira);

        const valorAupusAdicional = valorCompAdicionalDesconto + valorBandeiraAdicionalDesconto;

        // Calcular tarifa mínima em reais
        const tarifaMinimaConcessionaria = tarifaMinima * tarifaComp + tarifaMinima * tarifaBandeira;

        // Valor total do consórcio = tarifa mínima + valor AUPUS adicional
        const valorConsorcio = tarifaMinimaConcessionaria + valorAupusAdicional;
        const valorEconomia = (valorCompAdicionalBruto + valorBandeiraAdicionalBruto) - (valorCompAdicionalDesconto + valorBandeiraAdicionalDesconto);

        console.log(`📊 [Completar Compensação] Valores calculados:`);
        console.log(`   - Energia adicional bruto: R$ ${valorCompAdicionalBruto.toFixed(2)}`);
        console.log(`   - Energia adicional c/ desconto: R$ ${valorCompAdicionalDesconto.toFixed(2)}`);
        console.log(`   - Bandeira adicional bruto: R$ ${valorBandeiraAdicionalBruto.toFixed(2)}`);
        console.log(`   - Bandeira adicional c/ desconto: R$ ${valorBandeiraAdicionalDesconto.toFixed(2)}`);
        console.log(`   - Valor AUPUS adicional: R$ ${valorAupusAdicional.toFixed(2)}`);
        console.log(`   - Tarifa mínima: R$ ${tarifaMinimaConcessionaria.toFixed(2)}`);
        console.log(`   - Valor total boleto: R$ ${valorConsorcio.toFixed(2)}`);

        // 9. Atualizar dados_calculados na fatura
        const dadosCalc = fatura.dados_calculados || {};
        const novoDadosCalc = {
            ...dadosCalc,
            valores_originais: {
                ...dadosCalc.valores_originais,
                consumo_compensado_original: consumoComp,
                consumo_nao_compensado_original: consumoNComp,
                consumo_compensado: novoConsumoComp,
                consumo_nao_compensado: novoConsumoNComp
            },
            valores_calculados: {
                ...dadosCalc.valores_calculados,
                compensacao_adicional: compensacaoAdicional,
                valor_comp_adicional_bruto: valorCompAdicionalBruto,
                valor_comp_adicional_desconto: valorCompAdicionalDesconto,
                valor_bandeira_adicional_bruto: valorBandeiraAdicionalBruto,
                valor_bandeira_adicional_desconto: valorBandeiraAdicionalDesconto,
                valor_aupus_adicional: valorAupusAdicional,
                valor_consorcio: valorConsorcio,
                valor_economia: valorEconomia
            },
            flags: {
                ...dadosCalc.flags,
                compensacao_completa_aplicada: true,
                tipo_compensacao_aplicada: 'completada'
            }
        };

        await microPool.query(`
            UPDATE faturas_baixadas
            SET dados_calculados = $1, status = 'processado'
            WHERE id = $2
        `, [JSON.stringify(novoDadosCalc), fatura.id]);

        // 10. Verificar se já existe boleto para esta UC/mês
        const boletoExistente = await pool.query(`
            SELECT id FROM boletos_energia WHERE uc = $1 AND mes_referencia = $2
        `, [uc, mes_referencia]);

        // 11. Calcular data de vencimento
        const diaVencimento = dadosCliente.dia_vencimento || 20;
        const hoje = new Date();
        let dataVencimento = new Date(hoje.getFullYear(), hoje.getMonth(), diaVencimento);
        if (dataVencimento <= hoje) {
            dataVencimento.setMonth(dataVencimento.getMonth() + 1);
        }
        const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

        // 12. Determinar tipo de pessoa
        const cpfCnpj = (dadosCliente.cpf_cnpj || '').replace(/\D/g, '');
        const tipoPessoa = cpfCnpj.length > 11 ? 'CNPJ' : 'CPF';

        let boletoId = null;

        if (boletoExistente.rows.length > 0) {
            // Atualizar boleto existente
            boletoId = boletoExistente.rows[0].id;
            await pool.query(`
                UPDATE boletos_energia SET
                    valor_boleto = $1,
                    energia_compensado = $2,
                    energia_nao_compensado = $3,
                    energia_total = $13,
                    energia_compensado_original = $14,
                    energia_nao_compensado_original = $15,
                    energia_compensado_corrigido = $2,
                    energia_nao_compensado_corrigido = $3,
                    valor_energia_compensada = $4,
                    valor_bandeira_compensada = $5,
                    valor_com_desconto = $8,
                    valor_bandeira_com_desconto = $9,
                    valor_com_desconto_aupus = $10,
                    tarifa_minima_concessionaria = $11,
                    valor_economia = $6,
                    compensacao_completa_aplicada = true,
                    tipo_boleto = 'completado',
                    dados_completos = $12,
                    updated_at = NOW()
                WHERE id = $7
            `, [
                valorConsorcio.toFixed(2),                 // $1 - valor_boleto
                novoConsumoComp.toFixed(2),                // $2 - energia_compensado
                novoConsumoNComp.toFixed(2),               // $3 - energia_nao_compensado
                valorCompAdicionalBruto.toFixed(2),        // $4 - valor_energia_compensada (bruto)
                valorBandeiraAdicionalBruto.toFixed(2),    // $5 - valor_bandeira_compensada (bruto)
                valorEconomia.toFixed(2),                  // $6 - valor_economia
                boletoId,                                  // $7 - id
                valorCompAdicionalDesconto.toFixed(2),     // $8 - valor_com_desconto
                valorBandeiraAdicionalDesconto.toFixed(2), // $9 - valor_bandeira_com_desconto
                valorAupusAdicional.toFixed(2),            // $10 - valor_com_desconto_aupus
                tarifaMinimaConcessionaria.toFixed(2),     // $11 - tarifa_minima_concessionaria
                JSON.stringify({
                    fonte: 'completar-compensacao',
                    data_completada: new Date().toISOString(),
                    compensacao_original: consumoComp,
                    compensacao_adicional: compensacaoAdicional,
                    desconto_fatura: dadosCliente.desconto_fatura,
                    desconto_bandeira: dadosCliente.desconto_bandeira
                }),
                consumoTotal.toFixed(2),                   // $13 - energia_total
                consumoComp.toFixed(2),                    // $14 - energia_compensado_original
                consumoNComp.toFixed(2)                    // $15 - energia_nao_compensado_original
            ]);
            console.log(`✅ [Completar Compensação] Boleto ID ${boletoId} atualizado`);
        } else {
            // Criar novo boleto
            const insertResult = await pool.query(`
                INSERT INTO boletos_energia (
                    uc, mes_referencia, data_vencimento, valor_boleto,
                    tipo_pessoa, documento, nome_completo, endereco, bairro, cep, cidade, uf,
                    energia_compensado, energia_nao_compensado, energia_total,
                    energia_compensado_original, energia_nao_compensado_original,
                    energia_compensado_corrigido, energia_nao_compensado_corrigido,
                    valor_energia_compensada, valor_bandeira_compensada,
                    valor_com_desconto, valor_bandeira_com_desconto,
                    tarifa_minima_concessionaria, valor_com_desconto_aupus, valor_economia,
                    email, telefone, status, tipo_boleto,
                    compensacao_completa_aplicada,
                    dados_completos
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14, $27, $28, $29,
                    $13, $14,
                    $16, $17,
                    $18, $19,
                    $20, $21, $22,
                    $23, $24, 'Pendente', 'completado',
                    true,
                    $25
                )
                RETURNING id
            `, [
                uc,                                         // $1
                mes_referencia,                             // $2
                dataVencimentoStr,                          // $3
                valorConsorcio.toFixed(2),                  // $4 - valor_boleto
                tipoPessoa,                                 // $5
                cpfCnpj,                                    // $6
                dadosCliente.nome || '',                    // $7
                dadosCliente.endereco || '',                // $8
                dadosCliente.bairro || '',                  // $9
                dadosCliente.cep || '',                     // $10
                dadosCliente.cidade || '',                  // $11
                dadosCliente.uf || 'GO',                    // $12
                novoConsumoComp.toFixed(2),                 // $13 - energia_compensado
                novoConsumoNComp.toFixed(2),                // $14 - energia_nao_compensado
                valorCompAdicionalBruto.toFixed(2),         // $16 - valor_energia_compensada (bruto)
                valorBandeiraAdicionalBruto.toFixed(2),     // $17 - valor_bandeira_compensada (bruto)
                valorCompAdicionalDesconto.toFixed(2),      // $18 - valor_com_desconto
                valorBandeiraAdicionalDesconto.toFixed(2),  // $19 - valor_bandeira_com_desconto
                tarifaMinimaConcessionaria.toFixed(2),      // $20 - tarifa_minima_concessionaria
                valorAupusAdicional.toFixed(2),             // $21 - valor_com_desconto_aupus
                valorEconomia.toFixed(2),                   // $22 - valor_economia
                dadosCliente.email || '',                   // $23
                (dadosCliente.whatsapp || '').replace(/\D/g, ''),  // $24
                JSON.stringify({
                    fonte: 'completar-compensacao',
                    data_completada: new Date().toISOString(),
                    compensacao_original: consumoComp,
                    compensacao_adicional: compensacaoAdicional,
                    desconto_fatura: dadosCliente.desconto_fatura,
                    desconto_bandeira: dadosCliente.desconto_bandeira
                }),
                consumoTotal.toFixed(2),                    // $27 - energia_total
                consumoComp.toFixed(2),                     // $28 - energia_compensado_original
                consumoNComp.toFixed(2)                     // $29 - energia_nao_compensado_original
            ]);
            boletoId = insertResult.rows[0].id;
            console.log(`✅ [Completar Compensação] Novo boleto criado com ID ${boletoId}`);
            // Auto-enviar para Aupus Control (fire-and-forget)
            autoEnviarBoletoParaControl(boletoId).catch(() => {});
        }

        console.log(`✅ [Completar Compensação] Compensação completada para UC ${uc}`);

        res.json({
            sucesso: true,
            mensagem: 'Compensação completada com sucesso',
            dados: {
                consumo_total: consumoTotal,
                compensacao_original: consumoComp,
                compensacao_adicional: compensacaoAdicional,
                consumo_compensado: novoConsumoComp,
                consumo_nao_compensado: novoConsumoNComp,
                tarifa_minima_kwh: tarifaMinima,
                tarifa_minima_reais: tarifaMinimaConcessionaria,
                desconto_fatura: dadosCliente.desconto_fatura,
                desconto_bandeira: dadosCliente.desconto_bandeira,
                valor_aupus_adicional: valorAupusAdicional,
                valor_consorcio: valorConsorcio,
                valor_economia: valorEconomia,
                boleto_id: boletoId
            }
        });

    } catch (error) {
        console.error('❌ [Completar Compensação] Erro:', error);
        res.status(500).json({ erro: error.message });
    } finally {
        await microPool.end();
    }
});

// Endpoint: Download PDF da fatura
app.get('/api/faturas/pdf/:uc/:mes', authenticateToken, async (req, res) => {
    const { Pool } = require('pg');
    let microPool = null;

    try {
        const uc = decodeURIComponent(req.params.uc);
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`📥 [Download PDF] UC: ${uc}, Mês: ${mes_referencia}`);

        // Conectar ao banco de microserviços (aupus_faturas)
        microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: parseInt(process.env.MICROSERVICOS_DB_PORT || '5432'),
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // Buscar caminho do PDF no banco (excluir duplicatas, priorizar processadas)
        const result = await microPool.query(`
            SELECT caminho_storage, dados_leitura->>'nome_cliente' as nome_cliente
            FROM faturas_baixadas
            WHERE uc = $1 AND mes_referencia = $2
              AND (is_duplicata IS NULL OR is_duplicata = false)
            ORDER BY CASE WHEN status = 'processado' THEN 0 ELSE 1 END, id ASC
            LIMIT 1
        `, [uc, mes_referencia]);

        await microPool.end();
        microPool = null;

        if (result.rows.length === 0 || !result.rows[0].caminho_storage) {
            return res.status(404).json({ erro: 'PDF não encontrado' });
        }

        // Converter caminho do container para caminho local
        let caminho_pdf = result.rows[0].caminho_storage;
        const DADOS_PATH = process.env.DADOS_PATH || '/var/www/aupus-microservicos-faturas/dados';
        caminho_pdf = caminho_pdf.replace('/app/dados', DADOS_PATH);

        const fs = require('fs');
        const path = require('path');

        // Verificar se arquivo existe
        if (!fs.existsSync(caminho_pdf)) {
            console.error(`❌ [Download PDF] Arquivo não encontrado: ${caminho_pdf}`);
            return res.status(404).json({ erro: 'Arquivo PDF não encontrado no servidor' });
        }

        // Enviar arquivo
        const nome_arquivo = path.basename(caminho_pdf);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nome_arquivo}"`);

        const fileStream = fs.createReadStream(caminho_pdf);
        fileStream.pipe(res);

        console.log(`✅ [Download PDF] Enviando: ${nome_arquivo}`);
    } catch (error) {
        console.error('❌ [Download PDF] Erro:', error);
        if (microPool) await microPool.end();
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint: Download PDF da fatura EQTL - PÚBLICO (para links compartilhados via WhatsApp)
app.get('/api/faturas/download/:uc/:mes', async (req, res) => {
    try {
        const uc = decodeURIComponent(req.params.uc);
        let mes_referencia = decodeURIComponent(req.params.mes);

        // Converter formato 01-2026 para 01/2026
        if (mes_referencia.includes('-')) {
            mes_referencia = mes_referencia.replace('-', '/');
        }

        console.log(`📥 [Download Público] UC: ${uc}, Mês: ${mes_referencia}`);

        // Conectar ao banco de microserviços (aupus_faturas)
        const { Pool } = require('pg');
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: parseInt(process.env.MICROSERVICOS_DB_PORT || '5432'),
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // Buscar caminho do PDF no banco
        const result = await microPool.query(`
            SELECT caminho_storage, dados_leitura->>'nome_cliente' as nome_cliente
            FROM faturas_baixadas
            WHERE uc = $1 AND mes_referencia = $2
            LIMIT 1
        `, [uc, mes_referencia]);

        await microPool.end();

        if (result.rows.length === 0 || !result.rows[0].caminho_storage) {
            return res.status(404).json({ erro: 'PDF não encontrado' });
        }

        // Converter caminho do container para caminho local
        let caminho_pdf = result.rows[0].caminho_storage;
        const DADOS_PATH = process.env.DADOS_PATH || '/var/www/aupus-microservicos-faturas/dados';
        caminho_pdf = caminho_pdf.replace('/app/dados', DADOS_PATH);

        // Verificar se arquivo existe
        if (!fs.existsSync(caminho_pdf)) {
            console.error(`❌ [Download Público] Arquivo não encontrado: ${caminho_pdf}`);
            return res.status(404).json({ erro: 'Arquivo PDF não encontrado no servidor' });
        }

        // Enviar arquivo
        const nome_arquivo = path.basename(caminho_pdf);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nome_arquivo}"`);

        const fileStream = fs.createReadStream(caminho_pdf);
        fileStream.pipe(res);

        console.log(`✅ [Download Público] Enviando: ${nome_arquivo}`);
    } catch (error) {
        console.error('❌ [Download Público] Erro:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint: Exportar Controle Mensal para Excel
app.get('/api/controle-mensal/exportar/:mes', authenticateToken, async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`📥 [Controle Mensal] Exportando Excel para ${mes_referencia}`);

        // Reutilizar o endpoint de dados
        const axios = require('axios');
        const token = req.headers.authorization;

        // Fazer request interno para obter os dados
        const response = await axios.get(`http://localhost:${SERVER_PORT}/api/controle-mensal/completo/${encodeURIComponent(mes_referencia)}`, {
            headers: { Authorization: token }
        });

        const dados = response.data.faturas || [];

        // Gerar Excel usando exceljs (formatação avançada)
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AUPUS Sistema';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Controle Mensal');

        // Definir colunas - Relatório completo
        worksheet.columns = [
            // Identificação
            { header: 'UC', key: 'uc', width: 15 },
            { header: 'Cliente', key: 'cliente', width: 35 },
            { header: 'CPF/CNPJ', key: 'cpf_cnpj', width: 18 },
            // Fatura
            { header: 'Status Fatura', key: 'status_fatura', width: 18 },
            { header: 'Tipo Compensação', key: 'tipo_compensacao', width: 18 },
            { header: 'Tipo Fornecimento', key: 'tipo_fornecimento', width: 18 },
            { header: 'Vencimento', key: 'vencimento', width: 12 },
            { header: 'Nome Diferente', key: 'nome_diferente', width: 16 },
            // Energia (kWh)
            { header: 'Consumo (kWh)', key: 'consumo', width: 14 },
            { header: 'Compensado (kWh)', key: 'consumo_comp', width: 16 },
            { header: 'Não Comp. (kWh)', key: 'consumo_n_comp', width: 16 },
            { header: 'Injetada (kWh)', key: 'energia_injetada', width: 14 },
            { header: 'Saldo (kWh)', key: 'saldo', width: 14 },
            // Valores (R$)
            { header: 'Tarifa Comp. (R$)', key: 'tarifa_compensacao', width: 16 },
            { header: 'Valor Concessionária', key: 'valor_concessionaria', width: 20 },
            { header: 'Valor s/ Desconto', key: 'valor_s_desconto', width: 16 },
            { header: 'Valor AUPUS', key: 'valor_aupus', width: 14 },
            { header: 'Valor Boleto', key: 'valor_boleto', width: 14 },
            { header: 'Economia', key: 'valor_economia', width: 14 },
            // Operacional
            { header: 'Enviado', key: 'enviado', width: 10 },
            { header: 'WhatsApp', key: 'whatsapp_envio', width: 12 },
            { header: 'Email', key: 'email_envio', width: 10 },
            { header: 'Pag. AUPUS', key: 'pag_aupus', width: 14 },
            { header: 'Pag. EQTL', key: 'pag_eqtl', width: 14 }
        ];

        // Estilizar cabeçalho
        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } }; // Azul Bootstrap
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        headerRow.height = 22;

        // Adicionar dados
        dados.forEach(d => {
            worksheet.addRow({
                uc: d.uc,
                cliente: d.nome_cliente,
                cpf_cnpj: d.cpf_cnpj,
                status_fatura: d.status_fatura,
                tipo_compensacao: d.tipo_compensacao || '',
                tipo_fornecimento: d.tipo_fornecimento || '',
                vencimento: d.data_vencimento || '',
                nome_diferente: d.nome_diferente ? 'Sim' : 'Não',
                consumo: d.consumo || '',
                consumo_comp: d.consumo_comp || '',
                consumo_n_comp: d.consumo_n_comp || '',
                energia_injetada: d.energia_injetada || '',
                saldo: d.saldo != null ? d.saldo : '',
                tarifa_compensacao: d.tarifa_compensacao || '',
                valor_concessionaria: d.valor_concessionaria || '',
                valor_s_desconto: d.valor_s_desconto || '',
                valor_aupus: d.valor_aupus || '',
                valor_boleto: d.valor_boleto || '',
                valor_economia: d.valor_economia || '',
                enviado: d.enviado ? 'Sim' : 'Não',
                whatsapp_envio: d.enviado_whatsapp ? 'Sim' : 'Não',
                email_envio: d.enviado_email ? 'Sim' : 'Não',
                pag_aupus: d.status_pagamento_aupus || '',
                pag_eqtl: d.status_pagamento_eqtl || ''
            });
        });

        // Formatar colunas numéricas (kWh e R$)
        const numFmt2 = '#,##0.00';
        const numFmt6 = '#,##0.000000';
        const colsKwh = ['consumo', 'consumo_comp', 'consumo_n_comp', 'energia_injetada', 'saldo'];
        const colsReais = ['valor_concessionaria', 'valor_s_desconto', 'valor_aupus', 'valor_boleto', 'valor_economia'];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                colsKwh.forEach(key => {
                    const col = worksheet.getColumn(key);
                    if (col) {
                        const cell = row.getCell(col.number);
                        if (cell.value !== '' && cell.value != null) {
                            cell.numFmt = numFmt2;
                        }
                    }
                });
                colsReais.forEach(key => {
                    const col = worksheet.getColumn(key);
                    if (col) {
                        const cell = row.getCell(col.number);
                        if (cell.value !== '' && cell.value != null) {
                            cell.numFmt = numFmt2;
                        }
                    }
                });
                // Tarifa com 6 casas decimais
                const colTarifa = worksheet.getColumn('tarifa_compensacao');
                if (colTarifa) {
                    const cell = row.getCell(colTarifa.number);
                    if (cell.value !== '' && cell.value != null) {
                        cell.numFmt = numFmt6;
                    }
                }
            }
        });

        // Aplicar bordas e ajustar largura das colunas
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                    };
                });
            }
        });

        // Adicionar filtros na primeira linha
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: 24 }
        };

        // Congelar primeira linha
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Gerar buffer
        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Controle_Mensal_${mes_referencia.replace('/', '_')}.xlsx`);
        res.send(buffer);

        console.log(`✅ [Controle Mensal] Excel exportado com ${dados.length} registros`);

    } catch (error) {
        console.error('❌ [Controle Mensal] Erro ao exportar:', error);
        res.status(500).json({ erro: error.message });
    }
});

// ========================================
// 🔆 PAINEL DE UGs - USINAS GERADORAS
// ========================================

// Endpoint: UGs - Resumo e detalhamento
app.get('/api/ugs/resumo/:mes', authenticateToken, async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`🔆 [UGs] Carregando dados para ${mes_referencia}`);

        const { Pool } = require('pg');

        // Conectar ao CRM para buscar UGs cadastradas
        const crmPool = new Pool({
            host: process.env.CRM_DB_HOST || '127.0.0.1',
            port: process.env.CRM_DB_PORT || 5432,
            database: process.env.CRM_DB_NAME || 'aupus_prod',
            user: process.env.CRM_DB_USER || 'aupus_prod',
            password: process.env.CRM_DB_PASSWORD || 'AupusProd2024Hashtag'
        });

        // Conectar ao banco de microserviços
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: process.env.MICROSERVICOS_DB_PORT || 5432,
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // 1. Buscar UGs cadastradas
        const queryUGs = `
            SELECT
                numero_unidade::text as uc_geradora,
                nome_usina as nome_ug,
                potencia_cc,
                fator_capacidade
            FROM unidades_consumidoras
            WHERE gerador = true
              AND deleted_at IS NULL
            ORDER BY nome_usina
        `;
        const ugsResult = await crmPool.query(queryUGs);
        const ugsCadastradas = new Map(ugsResult.rows.map(ug => [ug.uc_geradora, ug]));

        // 2. Buscar UCs e nomes de clientes
        const queryClientes = `
            SELECT DISTINCT
                uc.numero_unidade::text as uc,
                COALESCE(NULLIF(cc.nome_cliente, ''), p.nome_cliente, '') as nome_cliente
            FROM controle_clube cc
            JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
            JOIN propostas p ON cc.proposta_id = p.id
            WHERE cc.deleted_at IS NULL
        `;
        const clientesResult = await crmPool.query(queryClientes);
        const clientesMap = new Map(clientesResult.rows.map(c => [c.uc, c.nome_cliente]));
        await crmPool.end();

        // 3. Buscar dados de injeção das faturas
        const queryInjecao = `
            SELECT
                uc,
                dados_leitura->'_ugs_injecao_lista' as ugs_injecao,
                dados_leitura->'_ugs_nao_autorizadas' as ugs_nao_autorizadas,
                dados_leitura->>'nome_cliente' as nome_cliente_fatura
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND status = 'processado'
              AND is_duplicata = false
              AND (dados_leitura->'_ugs_injecao_lista' IS NOT NULL OR dados_leitura->'_ugs_nao_autorizadas' IS NOT NULL)
        `;
        const injecaoResult = await microPool.query(queryInjecao, [mes_referencia]);
        await microPool.end();

        // 4. Processar dados de injeção
        const ugsDetalhado = new Map(); // Map de uc_geradora -> { destinatarios: [], totais }
        const ugsNaoAutorizadas = [];
        let energiaInjetadaTotal = 0;
        let energiaCobradaTotal = 0;
        let energiaDescartadaTotal = 0;

        injecaoResult.rows.forEach(fatura => {
            const ucDestino = fatura.uc;
            const nomeCliente = clientesMap.get(ucDestino) || fatura.nome_cliente_fatura || '';

            // Processar UGs injetadas
            if (fatura.ugs_injecao && Array.isArray(fatura.ugs_injecao)) {
                fatura.ugs_injecao.forEach(ug => {
                    const ucGeradora = String(ug.uc_geradora || '');
                    const energiaInjetada = parseFloat(ug.energia_injetada_ug || 0);

                    if (!ucGeradora || energiaInjetada <= 0) return;

                    const ugCadastrada = ugsCadastradas.get(ucGeradora);
                    const autorizada = !!ugCadastrada;
                    const energiaCobrada = autorizada ? energiaInjetada : 0;
                    const energiaDescartada = autorizada ? 0 : energiaInjetada;

                    energiaInjetadaTotal += energiaInjetada;
                    energiaCobradaTotal += energiaCobrada;
                    energiaDescartadaTotal += energiaDescartada;

                    // Agrupar por UG
                    if (!ugsDetalhado.has(ucGeradora)) {
                        ugsDetalhado.set(ucGeradora, {
                            uc_geradora: ucGeradora,
                            nome_ug: ugCadastrada?.nome_ug || 'NAO CADASTRADA',
                            destinatarios: [],
                            energia_injetada_total: 0,
                            energia_cobrada_total: 0,
                            energia_descartada_total: 0,
                            total_ucs: 0
                        });
                    }

                    const ugData = ugsDetalhado.get(ucGeradora);
                    ugData.destinatarios.push({
                        uc_destino: ucDestino,
                        nome_cliente: nomeCliente,
                        energia_injetada: energiaInjetada,
                        energia_cobrada: energiaCobrada,
                        energia_descartada: energiaDescartada,
                        autorizada
                    });
                    ugData.energia_injetada_total += energiaInjetada;
                    ugData.energia_cobrada_total += energiaCobrada;
                    ugData.energia_descartada_total += energiaDescartada;
                    ugData.total_ucs++;

                    // Se não autorizada, adicionar à lista de alertas
                    if (!autorizada) {
                        ugsNaoAutorizadas.push({
                            uc_geradora: ucGeradora,
                            uc_destino: ucDestino,
                            nome_cliente: nomeCliente,
                            energia_descartada: energiaDescartada
                        });
                    }
                });
            }

            // Processar UGs não autorizadas explícitas
            if (fatura.ugs_nao_autorizadas && Array.isArray(fatura.ugs_nao_autorizadas)) {
                fatura.ugs_nao_autorizadas.forEach(ug => {
                    const ucGeradora = String(ug.uc_geradora || '');
                    const energiaDescartada = parseFloat(ug.energia_injetada_ug || 0);

                    if (!ucGeradora || energiaDescartada <= 0) return;

                    // Verificar se já não foi contabilizada
                    const jaContada = ugsNaoAutorizadas.some(
                        u => u.uc_geradora === ucGeradora && u.uc_destino === ucDestino
                    );

                    if (!jaContada) {
                        ugsNaoAutorizadas.push({
                            uc_geradora: ucGeradora,
                            uc_destino: ucDestino,
                            nome_cliente: nomeCliente,
                            energia_descartada: energiaDescartada
                        });

                        energiaInjetadaTotal += energiaDescartada;
                        energiaDescartadaTotal += energiaDescartada;
                    }
                });
            }
        });

        // Converter Map para array e ordenar
        const ugsDetalhadoArray = Array.from(ugsDetalhado.values())
            .sort((a, b) => (a.nome_ug || '').localeCompare(b.nome_ug || ''));

        const resumo = {
            total_ugs: ugsCadastradas.size,
            energia_injetada_total: energiaInjetadaTotal,
            energia_cobrada_total: energiaCobradaTotal,
            energia_descartada_total: energiaDescartadaTotal,
            ugs_nao_autorizadas: ugsNaoAutorizadas
        };

        console.log(`🔆 [UGs] Resumo: ${ugsDetalhadoArray.length} UGs, ${energiaInjetadaTotal.toFixed(2)} kWh injetados`);

        res.json({
            resumo,
            ugs_detalhado: ugsDetalhadoArray
        });

    } catch (error) {
        console.error('❌ [UGs] Erro:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint: UGs - Lista com status de fatura
app.get('/api/ugs/lista/:mes', authenticateToken, async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`🔆 [UGs Lista] Carregando lista de UGs para ${mes_referencia}`);

        const { Pool } = require('pg');

        // Conectar ao CRM para buscar UGs cadastradas
        const crmPool = new Pool({
            host: process.env.CRM_DB_HOST || '127.0.0.1',
            port: process.env.CRM_DB_PORT || 5432,
            database: process.env.CRM_DB_NAME || 'aupus_prod',
            user: process.env.CRM_DB_USER || 'aupus_prod',
            password: process.env.CRM_DB_PASSWORD || 'AupusProd2024Hashtag'
        });

        // Conectar ao banco de microserviços
        const microPool = new Pool({
            host: process.env.MICROSERVICOS_DB_HOST || '127.0.0.1',
            port: process.env.MICROSERVICOS_DB_PORT || 5432,
            database: process.env.MICROSERVICOS_DB_NAME || 'aupus_faturas',
            user: process.env.MICROSERVICOS_DB_USER || 'aupus',
            password: process.env.MICROSERVICOS_DB_PASSWORD || 'SuaSenhaAqui123!'
        });

        // 1. Buscar UGs cadastradas no CRM
        const queryUGs = `
            SELECT
                numero_unidade::text as uc,
                nome_usina as nome_ug,
                potencia_cc
            FROM unidades_consumidoras
            WHERE gerador = true
              AND deleted_at IS NULL
            ORDER BY nome_usina
        `;
        const ugsResult = await crmPool.query(queryUGs);
        await crmPool.end();

        // 2. Buscar faturas das UGs no mês
        const ugsList = ugsResult.rows.map(ug => ug.uc);
        const queryFaturas = `
            SELECT
                uc,
                status,
                caminho_storage,
                dados_leitura->>'categoria' as categoria,
                created_at
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND uc = ANY($2)
              AND is_duplicata = false
        `;
        const faturasResult = await microPool.query(queryFaturas, [mes_referencia, ugsList]);
        await microPool.end();

        // Criar mapa de faturas por UC
        const faturasMap = new Map();
        faturasResult.rows.forEach(f => {
            faturasMap.set(f.uc, f);
        });

        // 3. Montar lista de UGs com status
        // Nota: Se tem categoria = foi processada, mesmo que status seja 'pendente'
        const ugsLista = ugsResult.rows.map(ug => {
            const fatura = faturasMap.get(ug.uc);
            let status = 'Nao Baixada';
            let caminho_pdf = null;

            if (fatura) {
                const temCategoria = fatura.categoria && fatura.categoria.trim() !== '';

                if (fatura.status === 'erro' || fatura.status === 'erro_processamento') {
                    status = 'Com Erro';
                } else if (fatura.status === 'processado' || temCategoria) {
                    // Se tem categoria preenchida, foi processada (mesmo que status seja 'pendente')
                    status = 'Baixada';
                } else {
                    status = 'Pendente';
                }
                caminho_pdf = fatura.caminho_storage;
            }

            return {
                uc: ug.uc,
                nome_ug: ug.nome_ug || `UG ${ug.uc}`,
                potencia_cc: ug.potencia_cc,
                status,
                caminho_pdf
            };
        });

        // Estatísticas
        const totalUGs = ugsLista.length;
        const baixadas = ugsLista.filter(ug => ug.status === 'Baixada').length;
        const naoBaixadas = ugsLista.filter(ug => ug.status === 'Nao Baixada').length;

        console.log(`🔆 [UGs Lista] ${totalUGs} UGs, ${baixadas} baixadas, ${naoBaixadas} não baixadas`);

        res.json({
            ugs: ugsLista,
            estatisticas: {
                total: totalUGs,
                baixadas,
                nao_baixadas: naoBaixadas
            }
        });

    } catch (error) {
        console.error('❌ [UGs Lista] Erro:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint: UGs - Exportar para Excel
app.get('/api/ugs/exportar/:mes', authenticateToken, async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`📥 [UGs] Exportando Excel para ${mes_referencia}`);

        const axios = require('axios');
        const token = req.headers.authorization;

        // Buscar dados do resumo de UGs
        const responseResumo = await axios.get(
            `http://localhost:${SERVER_PORT}/api/ugs/resumo/${encodeURIComponent(mes_referencia)}`,
            { headers: { Authorization: token } }
        );

        const resumo = responseResumo.data.resumo || {};
        const ugsDetalhado = responseResumo.data.ugs_detalhado || [];

        // Buscar lista de UGs com status de fatura
        const responseLista = await axios.get(
            `http://localhost:${SERVER_PORT}/api/ugs/lista/${encodeURIComponent(mes_referencia)}`,
            { headers: { Authorization: token } }
        );

        const ugsLista = responseLista.data.ugs || [];

        // Coletar todas as UCs de destino do detalhamento para buscar preços
        const ucsDestino = new Set();
        ugsDetalhado.forEach(ug => {
            if (ug.destinatarios && ug.destinatarios.length > 0) {
                ug.destinatarios.forEach(dest => {
                    ucsDestino.add(dest.uc_destino);
                });
            }
        });

        // Buscar dados de preços (tarifa energia e bandeira) das faturas dos destinatários
        let precosDestino = new Map();

        if (ucsDestino.size > 0) {
            const queryPrecos = `
                SELECT
                    uc,
                    dados_leitura->>'tarifa_comp' as tarifa_comp,
                    dados_leitura->>'tarifa_consumo_n_comp' as tarifa_consumo_n_comp,
                    dados_leitura->>'tarifa_consumo' as tarifa_consumo,
                    dados_leitura->>'tarifa_adc_bandeira_amarela' as tarifa_bandeira_amarela,
                    dados_leitura->>'tarifa_adc_bandeira_vermelha' as tarifa_bandeira_vermelha,
                    dados_leitura->>'valor_bandeira' as valor_bandeira,
                    dados_leitura->>'saldo' as saldo
                FROM faturas_baixadas
                WHERE mes_referencia = $1
                  AND uc = ANY($2)
                  AND status = 'processado'
                  AND is_duplicata = false
            `;
            const precosResult = await poolFaturas.query(queryPrecos, [mes_referencia, Array.from(ucsDestino)]);

            precosResult.rows.forEach(row => {
                // Preço único de energia (tarifa do kWh)
                const precoEnergia = parseFloat(row.tarifa_comp) ||
                                    parseFloat(row.tarifa_consumo_n_comp) ||
                                    parseFloat(row.tarifa_consumo) || 0;

                // Preços de bandeira
                const tarifaAmarela = parseFloat(row.tarifa_bandeira_amarela) || 0;
                const tarifaVermelha = parseFloat(row.tarifa_bandeira_vermelha) || 0;

                // Calcular preço médio da bandeira
                let precoBandeira = 0;
                if (tarifaAmarela > 0 && tarifaVermelha > 0) {
                    // Duas bandeiras: média das duas
                    precoBandeira = (tarifaAmarela + tarifaVermelha) / 2;
                } else {
                    // Uma bandeira ou nenhuma
                    precoBandeira = tarifaAmarela || tarifaVermelha;
                }

                precosDestino.set(row.uc, {
                    preco_energia: precoEnergia,
                    preco_bandeira: precoBandeira,
                    bandeira_amarela: tarifaAmarela,
                    bandeira_vermelha: tarifaVermelha,
                    tem_duas_bandeiras: tarifaAmarela > 0 && tarifaVermelha > 0,
                    saldo: row.saldo !== null && row.saldo !== undefined ? parseFloat(row.saldo) : null
                });
            });
        }

        // Gerar Excel usando exceljs (formatação avançada)
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AUPUS Sistema';
        workbook.created = new Date();

        // Função para formatar número com vírgula (padrão brasileiro)
        const formatarDecimal = (valor, casas = 2) => {
            if (valor === null || valor === undefined || isNaN(valor)) return '-';
            return Number(valor).toFixed(casas).replace('.', ',');
        };

        // Estilo do cabeçalho
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } }, // Verde escuro
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        // Função para adicionar dados a uma worksheet com formatação
        const addDataToSheet = (worksheet, data, columns) => {
            // Adicionar cabeçalhos
            worksheet.columns = columns.map(col => ({
                header: col.header,
                key: col.key,
                width: col.width || 15
            }));

            // Estilizar cabeçalho (linha 1)
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = headerStyle.font;
                cell.fill = headerStyle.fill;
                cell.alignment = headerStyle.alignment;
                cell.border = headerStyle.border;
            });
            worksheet.getRow(1).height = 20;

            // Adicionar dados
            data.forEach(row => {
                worksheet.addRow(row);
            });

            // Auto-fit: ajustar largura das colunas baseado no conteúdo
            worksheet.columns.forEach((column, idx) => {
                let maxLen = column.header ? column.header.length : 10;
                data.forEach(row => {
                    const val = String(row[column.key] || '');
                    if (val.length > maxLen) maxLen = val.length;
                });
                column.width = Math.max(maxLen + 2, 10);
            });

            // Adicionar filtros nos cabeçalhos
            if (data.length > 0) {
                worksheet.autoFilter = {
                    from: { row: 1, column: 1 },
                    to: { row: 1, column: columns.length }
                };
            }

            // Congelar primeira linha
            worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        };

        // ========== ABA 1: Resumo por UG ==========
        // Calcular médias de preço por UG (desconsiderando zeros)
        const resumoPorUG = [];
        ugsDetalhado.forEach(ug => {
            // Filtrar UGs não cadastradas
            if (ug.nome_ug === 'NAO CADASTRADA') return;

            if (ug.destinatarios && ug.destinatarios.length > 0) {
                let energiaCobradaTotal = 0;
                let somaPrecoEnergia = 0;
                let contPrecoEnergia = 0;
                let somaPrecoBandeira = 0;
                let contPrecoBandeira = 0;

                ug.destinatarios.forEach(dest => {
                    // Somar energia cobrada
                    energiaCobradaTotal += parseFloat(dest.energia_cobrada || 0);

                    // Buscar preços da UC de destino
                    const precos = precosDestino.get(dest.uc_destino) || {};

                    // Acumular preço energia (só se > 0)
                    if (precos.preco_energia > 0) {
                        somaPrecoEnergia += precos.preco_energia;
                        contPrecoEnergia++;
                    }

                    // Acumular preço bandeira (só se > 0)
                    if (precos.preco_bandeira > 0) {
                        somaPrecoBandeira += precos.preco_bandeira;
                        contPrecoBandeira++;
                    }
                });

                // Calcular médias
                const mediaPrecoEnergia = contPrecoEnergia > 0 ? somaPrecoEnergia / contPrecoEnergia : 0;
                const mediaPrecoBandeira = contPrecoBandeira > 0 ? somaPrecoBandeira / contPrecoBandeira : 0;

                resumoPorUG.push({
                    uc_geradora: ug.uc_geradora,
                    nome_ug: ug.nome_ug || '',
                    energia_cobrada: formatarDecimal(energiaCobradaTotal, 2),
                    media_preco_energia: mediaPrecoEnergia > 0 ? formatarDecimal(mediaPrecoEnergia, 6) : '-',
                    media_preco_bandeira: mediaPrecoBandeira > 0 ? formatarDecimal(mediaPrecoBandeira, 6) : '-',
                    qtd_ucs: ug.destinatarios.filter(d => d.autorizada).length
                });
            }
        });

        if (resumoPorUG.length > 0) {
            const wsResumo = workbook.addWorksheet('Resumo');
            addDataToSheet(wsResumo, resumoPorUG, [
                { header: 'UC Geradora', key: 'uc_geradora', width: 15 },
                { header: 'Nome UG', key: 'nome_ug', width: 25 },
                { header: 'Energia Cobrada (kWh)', key: 'energia_cobrada', width: 20 },
                { header: 'Média Preço Energia (R$/kWh)', key: 'media_preco_energia', width: 28 },
                { header: 'Média Preço Bandeira (R$/kWh)', key: 'media_preco_bandeira', width: 28 },
                { header: 'Qtd UCs Cobradas', key: 'qtd_ucs', width: 18 }
            ]);
        }

        // ========== ABA 2: Detalhamento por UC ==========
        const detalhamentoData = [];
        ugsDetalhado.forEach(ug => {
            if (ug.destinatarios && ug.destinatarios.length > 0) {
                ug.destinatarios.forEach(dest => {
                    // Buscar preços da UC de destino
                    const precos = precosDestino.get(dest.uc_destino) || {};
                    const precoBandeira = precos.preco_bandeira || 0;

                    // Determinar tipo de bandeira
                    let tipoBandeira = '-';
                    if (precos.tem_duas_bandeiras) {
                        tipoBandeira = `Média (Am+Vm)`;
                    } else if (precos.bandeira_amarela > 0) {
                        tipoBandeira = 'Amarela';
                    } else if (precos.bandeira_vermelha > 0) {
                        tipoBandeira = 'Vermelha';
                    } else if (precos.preco_energia > 0) {
                        tipoBandeira = 'Sem bandeira';
                    }

                    detalhamentoData.push({
                        uc_geradora: ug.uc_geradora,
                        nome_ug: ug.nome_ug || '',
                        uc_destino: dest.uc_destino,
                        cliente: dest.nome_cliente || '',
                        injetado: formatarDecimal(dest.energia_injetada, 2),
                        cobrado: formatarDecimal(dest.energia_cobrada, 2),
                        descartado: formatarDecimal(dest.energia_descartada, 2),
                        saldo: precos.saldo !== null && precos.saldo !== undefined ? formatarDecimal(precos.saldo, 2) : '-',
                        preco_energia: precos.preco_energia ? formatarDecimal(precos.preco_energia, 6) : '-',
                        preco_bandeira: precoBandeira ? formatarDecimal(precoBandeira, 6) : '-',
                        tipo_bandeira: tipoBandeira,
                        status: dest.autorizada ? 'OK' : 'NÃO AUTORIZADA'
                    });
                });
            }
        });

        if (detalhamentoData.length > 0) {
            const wsDetalhamento = workbook.addWorksheet('Detalhamento');
            const detalhamentoCols = [
                { header: 'UC Geradora', key: 'uc_geradora', width: 15 },
                { header: 'Nome UG', key: 'nome_ug', width: 20 },
                { header: 'UC Destino', key: 'uc_destino', width: 15 },
                { header: 'Cliente', key: 'cliente', width: 25 },
                { header: 'Injetado (kWh)', key: 'injetado', width: 15 },
                { header: 'Cobrado (kWh)', key: 'cobrado', width: 15 },
                { header: 'Descartado (kWh)', key: 'descartado', width: 18 },
                { header: 'Saldo (kWh)', key: 'saldo', width: 15 },
                { header: 'Preço Energia (R$/kWh)', key: 'preco_energia', width: 22 },
                { header: 'Preço Bandeira (R$/kWh)', key: 'preco_bandeira', width: 22 },
                { header: 'Tipo Bandeira', key: 'tipo_bandeira', width: 18 },
                { header: 'Status', key: 'status', width: 18 }
            ];
            addDataToSheet(wsDetalhamento, detalhamentoData, detalhamentoCols);

            // Identificar UCs que aparecem em mais de uma UG
            const contagemUC = {};
            detalhamentoData.forEach(row => {
                contagemUC[row.uc_destino] = (contagemUC[row.uc_destino] || 0) + 1;
            });

            // Destacar linhas de UCs duplicadas (linha 1 = cabeçalho, dados começam na linha 2)
            detalhamentoData.forEach((row, idx) => {
                if (contagemUC[row.uc_destino] > 1) {
                    const excelRow = wsDetalhamento.getRow(idx + 2);
                    excelRow.eachCell({ includeEmpty: true }, (cell) => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFF3CD' } // Amarelo suave
                        };
                        cell.font = { bold: true };
                    });
                }
            });
        }

        // ========== ABA 3: Status Faturas UGs ==========
        const statusData = ugsLista.map(ug => ({
            uc: ug.uc,
            nome_ug: ug.nome_ug || '',
            potencia: ug.potencia_cc || '',
            status: ug.status
        }));

        const wsStatus = workbook.addWorksheet('Status Faturas');
        addDataToSheet(wsStatus, statusData, [
            { header: 'UC', key: 'uc', width: 15 },
            { header: 'Nome UG', key: 'nome_ug', width: 25 },
            { header: 'Potência (kWp)', key: 'potencia', width: 15 },
            { header: 'Status Fatura', key: 'status', width: 18 }
        ]);

        // ========== ABA 4: UGs Não Autorizadas (se houver) ==========
        if (resumo.ugs_nao_autorizadas && resumo.ugs_nao_autorizadas.length > 0) {
            const naoAutorizadasData = resumo.ugs_nao_autorizadas.map(ug => ({
                uc_geradora: ug.uc_geradora,
                uc_destino: ug.uc_destino,
                cliente: ug.nome_cliente || '',
                energia_descartada: formatarDecimal(ug.energia_descartada, 2)
            }));

            const wsNaoAutorizadas = workbook.addWorksheet('Não Autorizadas');
            addDataToSheet(wsNaoAutorizadas, naoAutorizadasData, [
                { header: 'UC Geradora', key: 'uc_geradora', width: 15 },
                { header: 'UC Destino', key: 'uc_destino', width: 15 },
                { header: 'Cliente', key: 'cliente', width: 25 },
                { header: 'Energia Descartada (kWh)', key: 'energia_descartada', width: 25 }
            ]);
        }

        // Gerar buffer e enviar
        const buffer = await workbook.xlsx.writeBuffer();

        const mesFormatado = mes_referencia.replace('/', '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Controle_UGs_Geradoras_${mesFormatado}.xlsx`);
        res.send(buffer);

        console.log(`✅ [UGs] Excel exportado: Controle_UGs_Geradoras_${mesFormatado}.xlsx`);

    } catch (error) {
        console.error('❌ [UGs] Erro ao exportar:', error);
        res.status(500).json({ erro: error.message });
    }
});

// ========================================
// 🔔 WEBHOOK: Receber notificações de baixa/pagamento do Banco do Brasil
// ========================================
app.post('/api/webhook/bb/baixa', async (req, res) => {
    const dataRecebimento = new Date().toISOString();
    console.log(`\n🔔 [WEBHOOK BB] Notificação recebida em ${dataRecebimento}`);
    console.log(`📦 Payload:`, JSON.stringify(req.body, null, 2));

    try {
        const payload = req.body;

        // Encaminhar payload original para API Aupus (fire-and-forget)
        const aupusApiUrl = process.env.AUPUS_API_URL || 'https://api.aupusenergia.com.br';
        const axios = require('axios');
        axios.post(`${aupusApiUrl}/api/webhooks/bb/boletos`, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        }).then(() => {
            console.log(`📤 [WEBHOOK BB] Encaminhado para ${aupusApiUrl}/api/webhooks/bb/boletos`);
        }).catch((err) => {
            console.error(`⚠️ [WEBHOOK BB] Falha ao encaminhar para API Aupus: ${err.message}`);
        });

        // O BB pode enviar em diferentes formatos, vamos tratar os principais
        // Formato 1: { codigoEstadoTituloCobranca, numero, ... }
        // Formato 2: { boletos: [{ ... }] }
        // Formato 3: Array direto [{ ... }]

        let boletos = [];

        if (Array.isArray(payload)) {
            boletos = payload;
        } else if (payload.boletos && Array.isArray(payload.boletos)) {
            boletos = payload.boletos;
        } else if (payload.numero || payload.nossoNumero || payload.codigoBarraNumerico) {
            boletos = [payload];
        } else {
            // Tentar extrair de outros formatos possíveis
            console.log(`⚠️ [WEBHOOK BB] Formato não reconhecido, salvando payload completo para análise`);

            // Salvar log para análise posterior
            await pool.query(`
                INSERT INTO webhook_logs (origem, payload, criado_em)
                VALUES ($1, $2, NOW())
            `, ['bb_baixa', JSON.stringify(payload)]).catch(() => {
                // Tabela pode não existir ainda, ignorar
            });

            return res.json({
                sucesso: true,
                mensagem: 'Payload recebido e salvo para análise',
                timestamp: dataRecebimento
            });
        }

        console.log(`📋 [WEBHOOK BB] Processando ${boletos.length} boleto(s)`);

        let atualizados = 0;
        let naoEncontrados = 0;
        let erros = 0;

        for (const boleto of boletos) {
            try {
                // Extrair número do boleto (pode vir em diferentes campos)
                // O campo "id" é o nosso número com 20 dígitos (ex: "00036489810000000856")
                const numeroBoleto = boleto.id ||
                                    boleto.numero ||
                                    boleto.nossoNumero ||
                                    boleto.numeroTituloBeneficiario ||
                                    boleto.codigoBarraNumerico?.substring(0, 20);

                if (!numeroBoleto) {
                    console.log(`⚠️ [WEBHOOK BB] Boleto sem número identificável:`, boleto);
                    erros++;
                    continue;
                }

                console.log(`🔍 [WEBHOOK BB] Processando boleto: ${numeroBoleto}`);
                console.log(`   Pagador: ${boleto.nomePortador || 'N/A'}`);
                console.log(`   Valor: R$ ${boleto.valorPagoSacado || boleto.valorOriginal}`);
                console.log(`   Data Liquidação: ${boleto.dataLiquidacao || 'N/A'}`);
                console.log(`   Estado: ${boleto.codigoEstadoBaixaOperacional} (1=BB, 2=Outro banco, 10=Cancelamento)`);

                // Determinar novo status baseado no código do BB
                // codigoEstadoBaixaOperacional (webhook de baixa):
                //   1 = Baixa Operacional emitida pelo BB (boleto PAGO)
                //   2 = Baixa Operacional emitida por outro Banco (boleto PAGO)
                //   10 = Cancelamento da Baixa Operacional
                // codigoEstadoTituloCobranca (consulta de boletos):
                //   1 = NORMAL, 6 = LIQUIDADO, 7 = BAIXADO

                const estadoBaixa = parseInt(boleto.codigoEstadoBaixaOperacional);
                const estadoTitulo = parseInt(boleto.codigoEstadoTituloCobranca) ||
                                    parseInt(boleto.situacao) ||
                                    parseInt(boleto.estado);

                let novoStatus = null;

                // Priorizar codigoEstadoBaixaOperacional (webhook de baixa)
                if (estadoBaixa === 1 || estadoBaixa === 2) {
                    // Baixa operacional = boleto foi PAGO
                    novoStatus = 'Pago';
                } else if (estadoBaixa === 10) {
                    // Cancelamento de baixa
                    novoStatus = 'Cancelado';
                } else if ([6, 10, 11, 12, 14, 15, 16].includes(estadoTitulo) ||
                    boleto.situacao === 'LIQUIDADO' ||
                    boleto.situacao === 'PAGO') {
                    novoStatus = 'Pago';
                } else if (estadoTitulo === 7 || boleto.situacao === 'BAIXADO') {
                    novoStatus = 'Cancelado';
                } else if (estadoTitulo === 1 || boleto.situacao === 'NORMAL') {
                    // Verificar se está vencido (data de vencimento < hoje)
                    const dataVencimento = boleto.dataVencimento || boleto.data_vencimento;
                    if (dataVencimento) {
                        const hoje = new Date();
                        hoje.setHours(0, 0, 0, 0);
                        let dtVenc;
                        // Formato YYYY-MM-DD ou DD/MM/YYYY ou DD.MM.YYYY
                        if (dataVencimento.includes('-')) {
                            dtVenc = new Date(dataVencimento);
                        } else if (dataVencimento.includes('/')) {
                            const [dia, mes, ano] = dataVencimento.split('/');
                            dtVenc = new Date(ano, mes - 1, dia);
                        } else if (dataVencimento.includes('.')) {
                            const [dia, mes, ano] = dataVencimento.split('.');
                            dtVenc = new Date(ano, mes - 1, dia);
                        }
                        if (dtVenc && dtVenc < hoje) {
                            novoStatus = 'Vencido';
                        } else {
                            novoStatus = 'Boleto gerado';
                        }
                    } else {
                        novoStatus = 'Boleto gerado';
                    }
                }

                if (!novoStatus) {
                    console.log(`⚠️ [WEBHOOK BB] Estado não mapeado: baixa=${estadoBaixa}, titulo=${estadoTitulo}`);
                    continue;
                }

                console.log(`   Status determinado: ${novoStatus}`);

                // Buscar e atualizar no banco
                const result = await pool.query(`
                    UPDATE boletos_energia
                    SET status = $1,
                        data_atualizacao = NOW(),
                        dados_completos = COALESCE(dados_completos, '{}'::jsonb) || $2::jsonb
                    WHERE numero_boleto = $3
                    AND status != $1
                    RETURNING id, uc, mes_referencia, status
                `, [
                    novoStatus,
                    JSON.stringify({ ultima_atualizacao_webhook: dataRecebimento, dados_bb: boleto }),
                    numeroBoleto
                ]);

                if (result.rows.length > 0) {
                    const atualizado = result.rows[0];
                    console.log(`✅ [WEBHOOK BB] Boleto ${numeroBoleto} atualizado: UC ${atualizado.uc} -> ${novoStatus}`);
                    atualizados++;

                    // Auto-sincronizar com Aupus Control (fire-and-forget)
                    if (novoStatus === 'Pago') {
                        const valorPago = parseFloat(boleto.valorPago || boleto.valor || 0);
                        // Normalizar data para YYYY-MM-DD (BB pode enviar DD.MM.YYYY ou outros formatos)
                        let dataPag = new Date().toISOString().split('T')[0];
                        const rawDate = boleto.dataPagamento || boleto.dataCredito;
                        if (rawDate) {
                            if (/^\d{2}\.\d{2}\.\d{4}$/.test(rawDate)) {
                                const [d, m, y] = rawDate.split('.');
                                dataPag = `${y}-${m}-${d}`;
                            } else if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
                                dataPag = rawDate.substring(0, 10);
                            }
                        }
                        autoPagarBoletoNoControl(atualizado.id, valorPago, dataPag).catch(() => {});
                    } else if (novoStatus === 'Cancelado') {
                        autoCancelarBoletoNoControl(atualizado.id).catch(() => {});
                    }
                } else {
                    // Verificar se o boleto existe mas já está no status correto
                    const existe = await pool.query(
                        'SELECT id, status FROM boletos_energia WHERE numero_boleto = $1',
                        [numeroBoleto]
                    );

                    if (existe.rows.length > 0) {
                        console.log(`ℹ️ [WEBHOOK BB] Boleto ${numeroBoleto} já está como ${existe.rows[0].status}`);
                    } else {
                        console.log(`⚠️ [WEBHOOK BB] Boleto ${numeroBoleto} não encontrado no banco`);
                        naoEncontrados++;
                    }
                }

            } catch (err) {
                console.error(`❌ [WEBHOOK BB] Erro ao processar boleto:`, err.message);
                erros++;
            }
        }

        console.log(`📊 [WEBHOOK BB] Resultado: ${atualizados} atualizados, ${naoEncontrados} não encontrados, ${erros} erros`);

        res.json({
            sucesso: true,
            mensagem: 'Webhook processado com sucesso',
            resultado: {
                total_recebidos: boletos.length,
                atualizados,
                nao_encontrados: naoEncontrados,
                erros
            },
            timestamp: dataRecebimento
        });

    } catch (error) {
        console.error(`❌ [WEBHOOK BB] Erro geral:`, error);
        res.status(500).json({
            sucesso: false,
            erro: error.message,
            timestamp: dataRecebimento
        });
    }
});

// Endpoint GET para verificar se webhook está ativo (alguns sistemas fazem health check)
app.get('/api/webhook/bb/baixa', (req, res) => {
    res.json({
        status: 'ativo',
        endpoint: '/api/webhook/bb/baixa',
        metodo: 'POST',
        descricao: 'Webhook para receber notificações de baixa/pagamento de boletos do Banco do Brasil',
        timestamp: new Date().toISOString()
    });
});

// ========================================
// 💰 MÓDULO DE PAGAMENTOS - CONCESSIONÁRIA (EQTL)
// ========================================

// Pool para banco aupus_faturas
const poolFaturas = new (require('pg').Pool)({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: 'aupus_faturas',
    user: process.env.DB_USER || 'aupus',
    password: process.env.DB_PASSWORD || 'SuaSenhaAqui123!'
});

// Pool para CRM (dados de clientes)
const poolCRM_Pagamentos = new (require('pg').Pool)({
    host: '92.113.38.164',
    port: 5432,
    database: 'aupus_prod',
    user: 'aupus_prod',
    password: 'AupusProd2024Hashtag'
});

// ========================================
// 🔄 AUTO-ENVIO DE BOLETOS PARA AUPUS CONTROL
// ========================================

/**
 * Envia automaticamente um boleto recém-criado para o Aupus Control.
 * Fire-and-forget: não bloqueia a resposta ao usuário.
 * Envia como APROVADO para permitir pagamento automático posterior.
 */
async function autoEnviarBoletoParaControl(boletoId) {
    try {
        if (!process.env.CONTROL_API_URL || !process.env.CONTROL_API_KEY) return;

        const boletoResult = await pool.query(`
            SELECT id, uc, mes_referencia, valor_boleto, data_vencimento,
                   numero_boleto, status, status_control, control_lancamento_id, nome_completo
            FROM boletos_energia WHERE id = $1
        `, [boletoId]);

        if (boletoResult.rows.length === 0) return;
        const boleto = boletoResult.rows[0];

        // Pular se já foi enviado
        if (boleto.status_control === 'lancado') return;

        // Buscar nome do CRM
        let nomeCliente = boleto.nome_completo || null;
        try {
            const crmResult = await poolCRM_Pagamentos.query(`
                SELECT cc.nome_cliente
                FROM unidades_consumidoras uc
                LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                WHERE uc.numero_unidade::text = $1
            `, [boleto.uc]);
            if (crmResult.rows.length > 0 && crmResult.rows[0].nome_cliente) {
                nomeCliente = crmResult.rows[0].nome_cliente;
            }
        } catch (e) { /* CRM indisponível - usa nome do boleto */ }

        // ENTRADA vai como PENDENTE (aprovação é feita no Control), ou PAGO se já pago
        const statusControl = boleto.status === 'Pago' ? 'PAGO' : 'PENDENTE';

        const resultado = await enviarBoletoControl({
            numeroBoleto: boleto.numero_boleto,
            dataVencimento: boleto.data_vencimento,
            valor: parseFloat(boleto.valor_boleto),
            mesReferencia: boleto.mes_referencia,
            nomeCliente,
            uc: boleto.uc,
            status: statusControl,
        });

        if (resultado.sucesso) {
            await pool.query(`
                UPDATE boletos_energia
                SET status_control = 'lancado', control_lancamento_id = $1,
                    data_lancamento_control = CURRENT_TIMESTAMP,
                    resposta_control = $2, erro_control = NULL
                WHERE id = $3
            `, [resultado.dados.id, JSON.stringify(resultado.dados), boletoId]);
            console.log(`✅ [AUTO-CONTROL] Boleto ${boletoId} UC ${boleto.uc} → Control ID ${resultado.dados.id} (${statusControl})`);
        } else {
            await pool.query(`
                UPDATE boletos_energia
                SET status_control = 'erro', erro_control = $1,
                    resposta_control = $2, data_lancamento_control = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [resultado.erro, JSON.stringify(resultado.dados), boletoId]);
            console.error(`❌ [AUTO-CONTROL] Boleto ${boletoId}: ${resultado.erro}`);
        }
    } catch (error) {
        console.error(`❌ [AUTO-CONTROL] Erro ao enviar boleto ${boletoId}:`, error.message);
    }
}

/**
 * Registra pagamento automaticamente no Control quando BB confirma pagamento de boleto.
 * Fire-and-forget.
 */
async function autoPagarBoletoNoControl(boletoId, valorPago, dataPagamento) {
    try {
        if (!process.env.CONTROL_API_URL || !process.env.CONTROL_API_KEY) return;

        const boletoResult = await pool.query(`
            SELECT control_lancamento_id, status_control, uc
            FROM boletos_energia WHERE id = $1
        `, [boletoId]);

        if (boletoResult.rows.length === 0) return;
        const boleto = boletoResult.rows[0];

        // Só pode pagar se está como lancado ou aprovado no Control
        if (!boleto.control_lancamento_id || !['lancado', 'aprovado'].includes(boleto.status_control)) return;

        const resultado = await pagarLancamentoControl(boleto.control_lancamento_id, {
            dataPagamento: dataPagamento || new Date().toISOString().split('T')[0],
            valorPago: valorPago,
            contaBancariaNome: process.env.CONTROL_CONTA_BANCARIA || 'Conta Clube Aupus',
        });

        if (resultado.sucesso) {
            await pool.query(`
                UPDATE boletos_energia SET status_control = 'pago' WHERE id = $1
            `, [boletoId]);
            console.log(`✅ [AUTO-PAGAR] Boleto ${boletoId} UC ${boleto.uc} → pago no Control`);
        } else {
            console.error(`❌ [AUTO-PAGAR] Boleto ${boletoId}: ${resultado.erro}`);
        }
    } catch (error) {
        console.error(`❌ [AUTO-PAGAR] Erro boleto ${boletoId}:`, error.message);
    }
}

/**
 * Cancela automaticamente no Control quando BB cancela boleto.
 * Fire-and-forget.
 */
async function autoCancelarBoletoNoControl(boletoId) {
    try {
        if (!process.env.CONTROL_API_URL || !process.env.CONTROL_API_KEY) return;

        const boletoResult = await pool.query(`
            SELECT control_lancamento_id, status_control, uc
            FROM boletos_energia WHERE id = $1
        `, [boletoId]);

        if (boletoResult.rows.length === 0) return;
        const boleto = boletoResult.rows[0];

        if (!boleto.control_lancamento_id || boleto.status_control === 'cancelado') return;

        // Se está pago no Control, precisa estornar antes de cancelar
        if (boleto.status_control === 'pago') {
            const estorno = await estornarPagamentoControl(boleto.control_lancamento_id, 'Boleto cancelado pelo BB');
            if (!estorno.sucesso) {
                console.error(`❌ [AUTO-CANCELAR] Não foi possível estornar boleto ${boletoId}: ${estorno.erro}`);
                return;
            }
        }

        const resultado = await cancelarLancamentoControl(boleto.control_lancamento_id, 'Cancelamento baixa operacional BB');

        if (resultado.sucesso) {
            await pool.query(`
                UPDATE boletos_energia SET status_control = 'cancelado' WHERE id = $1
            `, [boletoId]);
            console.log(`✅ [AUTO-CANCELAR] Boleto ${boletoId} UC ${boleto.uc} → cancelado no Control`);
        } else {
            console.error(`❌ [AUTO-CANCELAR] Boleto ${boletoId}: ${resultado.erro}`);
        }
    } catch (error) {
        console.error(`❌ [AUTO-CANCELAR] Erro boleto ${boletoId}:`, error.message);
    }
}

/**
 * Registra pagamento automaticamente no Control quando EQTL é pago via BB.
 * Fire-and-forget.
 */
async function autoPagarEqtlNoControl(pagamentoId) {
    try {
        if (!process.env.CONTROL_API_URL || !process.env.CONTROL_API_KEY) return;

        const pagResult = await poolFaturas.query(`
            SELECT id, control_lancamento_id, status_control, uc, valor_fatura
            FROM pagamentos_concessionaria WHERE id = $1
        `, [pagamentoId]);

        if (pagResult.rows.length === 0) return;
        const pag = pagResult.rows[0];

        if (!pag.control_lancamento_id || !['lancado', 'aprovado'].includes(pag.status_control)) return;

        const resultado = await pagarLancamentoControl(pag.control_lancamento_id, {
            dataPagamento: new Date().toISOString().split('T')[0],
            valorPago: parseFloat(pag.valor_fatura),
            contaBancariaNome: process.env.CONTROL_CONTA_BANCARIA || 'Conta Clube Aupus',
        });

        if (resultado.sucesso) {
            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria SET status_control = 'pago' WHERE id = $1
            `, [pagamentoId]);
            console.log(`✅ [AUTO-PAGAR-EQTL] Pagamento ${pagamentoId} UC ${pag.uc} → pago no Control`);
        } else {
            console.error(`❌ [AUTO-PAGAR-EQTL] Pagamento ${pagamentoId}: ${resultado.erro}`);
        }
    } catch (error) {
        console.error(`❌ [AUTO-PAGAR-EQTL] Erro pagamento ${pagamentoId}:`, error.message);
    }
}

// GET /api/pagamentos-concessionaria - Listar pagamentos
app.get('/api/pagamentos-concessionaria', async (req, res) => {
    try {
        const { mes_referencia, status } = req.query;

        // Busca direto de faturas_baixadas com LEFT JOIN em pagamentos_concessionaria e boletos_energia
        // Assim não precisa "importar" faturas - elas aparecem automaticamente
        let query = `
            SELECT DISTINCT ON (f.uc)
                   f.id as fatura_id,
                   f.uc,
                   f.mes_referencia,
                   f.dados_leitura->>'valor_concessionaria' as valor_fatura,
                   f.dados_leitura->>'vencimento' as data_vencimento_fatura,
                   f.dados_leitura->>'codigo_barras' as codigo_barras,
                   f.dados_leitura->>'codigo_pix' as pix_copia_cola,
                   f.status as status_fatura,
                   pc.id as pagamento_id,
                   COALESCE(pc.status, 'pendente') as status,
                   pc.data_pagamento,
                   pc.numero_requisicao,
                   pc.tipo_pagamento,
                   pc.mensagem_erro,
                   pc.data_envio_whatsapp,
                   pc.data_envio_email,
                   COALESCE(pc.status_forcado, false) as status_forcado,
                   pc.status_original,
                   pc.tipo_forcado,
                   pc.status_control,
                   pc.control_lancamento_id,
                   pc.data_lancamento_control,
                   CASE WHEN be.id IS NOT NULL THEN true ELSE false END as tem_boleto_energia,
                   be.status as status_boleto_energia,
                   COALESCE((f.tags->>'nome_diferente')::boolean, false) as nome_diferente
            FROM faturas_baixadas f
            LEFT JOIN pagamentos_concessionaria pc ON f.uc = pc.uc AND f.mes_referencia = pc.mes_referencia
            LEFT JOIN boletos_energia be ON f.uc = be.uc AND f.mes_referencia = be.mes_referencia AND be.status <> 'cancelado'
            WHERE f.status IN ('processado', 'pendente', 'baixado')
              AND f.dados_leitura->>'valor_concessionaria' IS NOT NULL
        `;
        const params = [];

        if (mes_referencia) {
            params.push(mes_referencia);
            query += ` AND f.mes_referencia = $${params.length}`;
        }

        if (status) {
            params.push(status);
            query += ` AND COALESCE(pc.status, 'pendente') = $${params.length}`;
        }

        // Ordenação para DISTINCT ON - prioriza faturas com mais dados
        query += ` ORDER BY f.uc,
                          (f.dados_leitura->>'valor_concessionaria' IS NOT NULL)::int DESC,
                          (f.dados_leitura->>'codigo_pix' IS NOT NULL)::int DESC,
                          f.id DESC`;

        query = `SELECT * FROM (${query}) sub ORDER BY uc`;

        const result = await poolFaturas.query(query, params);

        // Buscar nomes e contatos dos clientes no CRM
        if (result.rows.length > 0) {
            const ucs = result.rows.map(r => r.uc);
            try {
                // Buscar nomes de clientes (controle_clube), usinas (geradoras), email e whatsapp
                const crmResult = await poolCRM_Pagamentos.query(`
                    SELECT
                        uc.numero_unidade::text as uc,
                        CASE
                            WHEN uc.gerador = true THEN uc.nome_usina
                            ELSE cc.nome_cliente
                        END as nome_cliente,
                        uc.gerador as is_ug,
                        COALESCE(NULLIF(uc.email_faturamento_1, ''), NULLIF(cc.email, ''), '') as email,
                        COALESCE(NULLIF(uc.whatsapp_faturamento, ''), NULLIF(cc.whatsapp, ''), '') as whatsapp
                    FROM unidades_consumidoras uc
                    LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                    WHERE uc.numero_unidade::text = ANY($1)
                `, [ucs]);

                // Criar mapa de UC -> {nome, is_ug, email, whatsapp}
                const ucInfoMap = {};
                crmResult.rows.forEach(r => {
                    ucInfoMap[r.uc] = {
                        nome_cliente: r.nome_cliente,
                        is_ug: r.is_ug,
                        email: r.email,
                        whatsapp: r.whatsapp
                    };
                });

                // Enriquecer resultados com nomes, is_ug, email e whatsapp
                result.rows.forEach(r => {
                    const info = ucInfoMap[r.uc] || {};
                    r.nome_cliente = info.nome_cliente || null;
                    r.is_ug = info.is_ug || false;
                    r.email = info.email || null;
                    r.whatsapp = info.whatsapp || null;
                });
            } catch (crmError) {
                console.error('⚠️ Erro ao buscar nomes do CRM:', crmError.message);
                // Continua sem os nomes
            }
        }

        res.json({
            total: result.rows.length,
            pagamentos: result.rows
        });

    } catch (error) {
        console.error('❌ Erro ao listar pagamentos:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/pagamentos-concessionaria/resumo/:mes - Resumo por mês
app.get('/api/pagamentos-concessionaria/resumo/:mes', async (req, res) => {
    try {
        const { mes } = req.params;

        // Busca de faturas_baixadas com LEFT JOIN para status de pagamento
        const result = await poolFaturas.query(`
            SELECT
                COALESCE(pc.status, 'pendente') as status,
                COUNT(DISTINCT f.uc) as quantidade,
                COALESCE(SUM((f.dados_leitura->>'valor_concessionaria')::numeric), 0) as valor_total
            FROM faturas_baixadas f
            LEFT JOIN pagamentos_concessionaria pc ON f.uc = pc.uc AND f.mes_referencia = pc.mes_referencia
            WHERE f.mes_referencia = $1
              AND f.status IN ('processado', 'pendente', 'baixado')
              AND f.dados_leitura->>'valor_concessionaria' IS NOT NULL
            GROUP BY COALESCE(pc.status, 'pendente')
        `, [mes]);

        // Status Control
        const resultControl = await poolFaturas.query(`
            SELECT
                COALESCE(pc.status_control, 'nao_enviado') as status_control,
                COUNT(DISTINCT f.uc) as quantidade
            FROM faturas_baixadas f
            LEFT JOIN pagamentos_concessionaria pc ON f.uc = pc.uc AND f.mes_referencia = pc.mes_referencia
            WHERE f.mes_referencia = $1
              AND f.status IN ('processado', 'pendente', 'baixado')
              AND f.dados_leitura->>'valor_concessionaria' IS NOT NULL
            GROUP BY COALESCE(pc.status_control, 'nao_enviado')
        `, [mes]);

        const resumo = {
            mes_referencia: mes,
            por_status: result.rows,
            por_status_control: resultControl.rows,
            total_geral: result.rows.reduce((acc, r) => acc + parseFloat(r.valor_total || 0), 0),
            quantidade_total: result.rows.reduce((acc, r) => acc + parseInt(r.quantidade), 0)
        };

        res.json(resumo);

    } catch (error) {
        console.error('❌ Erro ao buscar resumo:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/criar-do-fatura - Criar pagamento a partir de fatura
app.post('/api/pagamentos-concessionaria/criar-de-fatura', async (req, res) => {
    try {
        const { fatura_id } = req.body;

        if (!fatura_id) {
            return res.status(400).json({ error: 'fatura_id é obrigatório' });
        }

        // Buscar dados da fatura
        const faturaResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia,
                   dados_leitura->>'valor_concessionaria' as valor_concessionaria,
                   dados_leitura->>'vencimento' as vencimento,
                   dados_leitura->>'codigo_barras' as codigo_barras,
                   dados_leitura->>'linha_digitavel' as linha_digitavel,
                   dados_leitura->>'pix_copia_cola' as pix_copia_cola
            FROM faturas_baixadas
            WHERE id = $1
        `, [fatura_id]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];

        if (!fatura.valor_concessionaria) {
            return res.status(400).json({ error: 'Fatura não possui valor_concessionaria' });
        }

        // Converter vencimento para date
        let dataVencimento;
        if (fatura.vencimento) {
            const partes = fatura.vencimento.split('/');
            if (partes.length === 3) {
                // Formato dd/mm/yy ou dd/mm/yyyy
                const dia = partes[0];
                const mes = partes[1];
                let ano = partes[2];
                if (ano.length === 2) {
                    ano = '20' + ano;
                }
                dataVencimento = `${ano}-${mes}-${dia}`;
            }
        }

        // Inserir pagamento
        const insertResult = await poolFaturas.query(`
            INSERT INTO pagamentos_concessionaria
            (fatura_id, uc, mes_referencia, valor_fatura, data_vencimento_fatura,
             codigo_barras, linha_digitavel, pix_copia_cola, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendente')
            ON CONFLICT (uc, mes_referencia)
            DO UPDATE SET
                valor_fatura = EXCLUDED.valor_fatura,
                data_vencimento_fatura = EXCLUDED.data_vencimento_fatura,
                codigo_barras = EXCLUDED.codigo_barras,
                linha_digitavel = EXCLUDED.linha_digitavel,
                pix_copia_cola = EXCLUDED.pix_copia_cola,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [
            fatura_id,
            fatura.uc,
            fatura.mes_referencia,
            parseFloat(fatura.valor_concessionaria),
            dataVencimento,
            fatura.codigo_barras,
            fatura.linha_digitavel,
            fatura.pix_copia_cola
        ]);

        console.log(`✅ Pagamento criado/atualizado: UC ${fatura.uc} - ${fatura.mes_referencia} - R$ ${fatura.valor_concessionaria}`);

        res.json({
            success: true,
            pagamento: insertResult.rows[0]
        });

    } catch (error) {
        console.error('❌ Erro ao criar pagamento:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/criar-lote/:mes - Criar pagamentos para todas faturas do mês
app.post('/api/pagamentos-concessionaria/criar-lote/:mes', async (req, res) => {
    try {
        const { mes } = req.params;

        console.log(`\n💰 [PAGAMENTOS] Criando pagamentos para mês ${mes}...`);

        // Buscar todas faturas processadas do mês que têm valor_concessionaria
        const faturasResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia,
                   dados_leitura->>'valor_concessionaria' as valor_concessionaria,
                   dados_leitura->>'vencimento' as vencimento,
                   dados_leitura->>'codigo_barras' as codigo_barras,
                   dados_leitura->>'linha_digitavel' as linha_digitavel,
                   dados_leitura->>'pix_copia_cola' as pix_copia_cola
            FROM faturas_baixadas
            WHERE mes_referencia = $1
              AND status = 'processado'
              AND dados_leitura->>'valor_concessionaria' IS NOT NULL
              AND (dados_leitura->>'valor_concessionaria')::decimal > 0
        `, [mes]);

        console.log(`   Encontradas ${faturasResult.rows.length} faturas com valor_concessionaria`);

        let criados = 0;
        let atualizados = 0;
        let erros = 0;

        for (const fatura of faturasResult.rows) {
            try {
                // Converter vencimento
                let dataVencimento = null;
                if (fatura.vencimento) {
                    const partes = fatura.vencimento.split('/');
                    if (partes.length === 3) {
                        const dia = partes[0];
                        const mesPart = partes[1];
                        let ano = partes[2];
                        if (ano.length === 2) ano = '20' + ano;
                        dataVencimento = `${ano}-${mesPart}-${dia}`;
                    }
                }

                const result = await poolFaturas.query(`
                    INSERT INTO pagamentos_concessionaria
                    (fatura_id, uc, mes_referencia, valor_fatura, data_vencimento_fatura,
                     codigo_barras, linha_digitavel, pix_copia_cola, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendente')
                    ON CONFLICT (uc, mes_referencia)
                    DO UPDATE SET
                        valor_fatura = EXCLUDED.valor_fatura,
                        data_vencimento_fatura = EXCLUDED.data_vencimento_fatura,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING (xmax = 0) as is_insert
                `, [
                    fatura.id,
                    fatura.uc,
                    fatura.mes_referencia,
                    parseFloat(fatura.valor_concessionaria),
                    dataVencimento,
                    fatura.codigo_barras,
                    fatura.linha_digitavel,
                    fatura.pix_copia_cola
                ]);

                if (result.rows[0].is_insert) {
                    criados++;
                } else {
                    atualizados++;
                }

            } catch (err) {
                console.error(`   ❌ Erro UC ${fatura.uc}: ${err.message}`);
                erros++;
            }
        }

        console.log(`✅ [PAGAMENTOS] Concluído: ${criados} criados, ${atualizados} atualizados, ${erros} erros`);

        res.json({
            success: true,
            mes_referencia: mes,
            total_faturas: faturasResult.rows.length,
            criados,
            atualizados,
            erros
        });

    } catch (error) {
        console.error('❌ Erro ao criar lote de pagamentos:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/lancar/:id - Lançar pagamento na API do BB
// Agora recebe fatura_id e cria/atualiza pagamento automaticamente
// A autenticação OAuth é feita automaticamente no backend usando certificado PEM
app.post('/api/pagamentos-concessionaria/lancar/:id', async (req, res) => {
    try {
        const { id } = req.params; // Pode ser fatura_id ou pagamento_id
        const { codigo_barras, pix_copia_cola, data_pagamento, tipo } = req.body;
        // tipo: 'fatura' ou 'pagamento' (default: 'fatura')

        let pagamento;
        let faturaId;

        // Buscar dados da fatura primeiro
        const faturaResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia,
                   dados_leitura->>'valor_concessionaria' as valor_fatura,
                   dados_leitura->>'vencimento' as vencimento,
                   dados_leitura->>'codigo_barras' as codigo_barras,
                   dados_leitura->>'codigo_pix' as pix_copia_cola
            FROM faturas_baixadas
            WHERE id = $1
        `, [id]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];
        faturaId = fatura.id;

        // Verificar se já existe pagamento para esta UC/mês
        const pagExistente = await poolFaturas.query(
            'SELECT * FROM pagamentos_concessionaria WHERE uc = $1 AND mes_referencia = $2',
            [fatura.uc, fatura.mes_referencia]
        );

        if (pagExistente.rows.length > 0) {
            pagamento = pagExistente.rows[0];
        } else {
            // Criar pagamento na hora
            let dataVencimento = null;
            if (fatura.vencimento) {
                const partes = fatura.vencimento.split('/');
                if (partes.length === 3) {
                    const dia = partes[0];
                    const mesPart = partes[1];
                    let ano = partes[2];
                    if (ano.length === 2) ano = '20' + ano;
                    dataVencimento = `${ano}-${mesPart}-${dia}`;
                }
            }

            const insertResult = await poolFaturas.query(`
                INSERT INTO pagamentos_concessionaria
                (fatura_id, uc, mes_referencia, valor_fatura, data_vencimento_fatura,
                 codigo_barras, pix_copia_cola, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente')
                RETURNING *
            `, [
                faturaId,
                fatura.uc,
                fatura.mes_referencia,
                parseFloat(fatura.valor_fatura),
                dataVencimento,
                codigo_barras || fatura.codigo_barras,
                pix_copia_cola || fatura.pix_copia_cola
            ]);
            pagamento = insertResult.rows[0];
        }

        // Usar dados da fatura se pagamento não tiver
        const codigoFinal = pagamento.codigo_barras || fatura.codigo_barras;
        const pixFinal = pagamento.pix_copia_cola || fatura.pix_copia_cola;

        // Verificar se tem dados para pagamento
        if (!codigoFinal && !pixFinal) {
            return res.status(400).json({
                error: 'Pagamento não possui código de barras nem PIX',
                message: 'Informe o código de barras ou PIX para lançar o pagamento'
            });
        }

        // Determinar tipo de pagamento e data
        // PRIORIDADE: código de barras (BOLETO) tem preferência sobre PIX
        const tipoPagamento = codigoFinal ? 'BOLETO' : 'PIX';
        const dataPag = data_pagamento || pagamento.data_vencimento_fatura;

        // Validar se a data de pagamento não é passada
        if (dataPag) {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const dataObj = new Date(dataPag + 'T00:00:00');
            if (dataObj < hoje) {
                return res.status(400).json({
                    error: 'Data de pagamento ja passou',
                    message: `A data ${dataPag} ja passou. Informe uma nova data de pagamento.`,
                    dataPassada: true,
                    dataOriginal: dataPag
                });
            }
        }

        console.log(`\n💰 [LANÇAR PAGAMENTO] ID ${id} - UC ${pagamento.uc}`);
        console.log(`   Tipo: ${tipoPagamento}`);
        console.log(`   Valor: R$ ${pagamento.valor_fatura}`);
        console.log(`   Data: ${dataPag}`);

        // ========================================
        // INTEGRAÇÃO COM API DE PAGAMENTOS EM LOTE DO BB
        // ========================================

        // Por enquanto, só BOLETO é suportado (PIX será implementado depois)
        if (tipoPagamento === 'PIX') {
            return res.status(400).json({
                error: 'Pagamento via PIX ainda não implementado',
                message: 'Por favor, utilize o código de barras para efetuar o pagamento'
            });
        }

        // CNPJ da EQTL GO (Equatorial Energia Goiás)
        const CNPJ_EQTL = '01543032000104'; // CNPJ sem formatação

        // Chamar API de Pagamentos em Lote do BB
        const resultadoBB = await efetuarPagamentoBoleto({
            codigoBarras: codigoFinal,
            dataPagamento: dataPag ? new Date(dataPag) : new Date(),
            valorPagamento: parseFloat(pagamento.valor_fatura),
            descricao: `UC ${pagamento.uc} - ${pagamento.mes_referencia}`,
            valorNominal: parseFloat(pagamento.valor_fatura),
            documentoBeneficiario: CNPJ_EQTL
        });

        if (!resultadoBB.sucesso) {
            console.error('❌ Erro na API BB:', resultadoBB.erro);

            // Atualizar status para 'erro'
            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria
                SET status = 'erro',
                    observacao = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [`Erro API BB: ${resultadoBB.erro}`, pagamento.id]);

            return res.status(400).json({
                error: 'Erro ao enviar pagamento para o Banco do Brasil',
                message: resultadoBB.erro,
                detalhes: resultadoBB.detalhes
            });
        }

        // Extrair dados da resposta
        const dadosBB = resultadoBB.dados;
        const numeroRequisicao = dadosBB.numeroRequisicao;
        const estadoRequisicao = dadosBB.estadoRequisicao;
        const idPagamentoBB = dadosBB.lancamentos?.[0]?.codigoIdentificadorPagamento;
        const indicadorAceite = dadosBB.lancamentos?.[0]?.indicadorAceite;
        const errosLancamento = dadosBB.lancamentos?.[0]?.erros || [];

        // Verificar se foi realmente aceito pelo BB
        // indicadorAceite = "S" significa aceito, independente do estadoRequisicao inicial
        const foiAceito = indicadorAceite === 'S' || dadosBB.quantidadeLancamentosValidos > 0;

        if (!foiAceito && errosLancamento.length > 0) {
            console.error('❌ Lançamento rejeitado pela API BB:', errosLancamento);
            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria
                SET status = 'rejeitado',
                    mensagem_erro = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [`Rejeitado: ${errosLancamento.join(', ')}`, pagamento.id]);

            return res.status(400).json({
                error: 'Lançamento rejeitado pelo Banco do Brasil',
                message: errosLancamento.join(', '),
                detalhes: dadosBB
            });
        }

        // Atualizar status para 'lancado'
        await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET status = 'lancado',
                tipo_pagamento = $1,
                data_pagamento = $2,
                numero_requisicao = $3,
                id_pagamento_bb = $4,
                estado_requisicao = $5,
                resposta_api_bb = $6,
                data_lancamento = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
        `, [
            tipoPagamento,
            dataPag,
            numeroRequisicao,
            idPagamentoBB,
            estadoRequisicao,
            JSON.stringify(dadosBB),
            pagamento.id
        ]);

        console.log(`✅ [LANÇAR PAGAMENTO] Enviado para API BB - Requisição ${numeroRequisicao}`);

        res.json({
            success: true,
            message: 'Pagamento enviado para o Banco do Brasil com sucesso',
            pagamento: {
                id: pagamento.id,
                uc: pagamento.uc,
                valor: pagamento.valor_fatura,
                tipo: tipoPagamento,
                data_pagamento: dataPag,
                numero_requisicao: numeroRequisicao,
                id_pagamento_bb: idPagamentoBB,
                estado_requisicao: estadoRequisicao,
                status: 'lancado'
            },
            resposta_bb: dadosBB
        });

    } catch (error) {
        console.error('❌ Erro ao lançar pagamento:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/lancar-control/:id - Lançar no Aupus Control (independente do BB)
app.post('/api/pagamentos-concessionaria/lancar-control/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome_cliente, status } = req.body;

        // 1. Buscar fatura
        const faturaResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia,
                   dados_leitura->>'valor_concessionaria' as valor_fatura,
                   dados_leitura->>'vencimento' as vencimento,
                   dados_leitura->>'codigo_barras' as codigo_barras
            FROM faturas_baixadas
            WHERE id = $1
        `, [id]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];

        // 2. Encontrar ou criar pagamento
        let pagamento;
        const pagExistente = await poolFaturas.query(
            'SELECT * FROM pagamentos_concessionaria WHERE uc = $1 AND mes_referencia = $2',
            [fatura.uc, fatura.mes_referencia]
        );

        if (pagExistente.rows.length > 0) {
            pagamento = pagExistente.rows[0];
        } else {
            let dataVencimento = null;
            if (fatura.vencimento) {
                const partes = fatura.vencimento.split('/');
                if (partes.length === 3) {
                    const dia = partes[0];
                    const mesPart = partes[1];
                    let ano = partes[2];
                    if (ano.length === 2) ano = '20' + ano;
                    dataVencimento = `${ano}-${mesPart}-${dia}`;
                }
            }
            const insertResult = await poolFaturas.query(`
                INSERT INTO pagamentos_concessionaria
                (fatura_id, uc, mes_referencia, valor_fatura, data_vencimento_fatura,
                 codigo_barras, status)
                VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
                RETURNING *
            `, [
                fatura.id, fatura.uc, fatura.mes_referencia,
                parseFloat(fatura.valor_fatura), dataVencimento,
                fatura.codigo_barras
            ]);
            pagamento = insertResult.rows[0];
        }

        // 3. Verificar se já foi enviado ao Control
        if (pagamento.status_control === 'lancado') {
            return res.status(400).json({
                error: 'Já lançado no Aupus Control',
                message: `ID: ${pagamento.control_lancamento_id}`,
                control_lancamento_id: pagamento.control_lancamento_id
            });
        }

        // 4. Validar código de barras
        const codigoFinal = pagamento.codigo_barras || fatura.codigo_barras;
        if (!codigoFinal) {
            return res.status(400).json({
                error: 'Sem código de barras',
                message: 'Informe o código de barras para lançar no Control'
            });
        }

        // 5. Determinar status automático
        //    - Pago (boleto ou BB, mesmo forçado) → PAGO
        //    - Compensação real (categoria contém "Compensação" sem "Sem") → APROVADO
        //    - Demais (incluindo comp. simulada) → PENDENTE
        let statusControl = 'PENDENTE';
        const boletoResult = await poolFaturas.query(`
            SELECT status FROM boletos_energia
            WHERE uc = $1 AND mes_referencia = $2
            LIMIT 1
        `, [pagamento.uc, pagamento.mes_referencia]);

        if (boletoResult.rows.length > 0 && boletoResult.rows[0].status === 'Pago') {
            statusControl = 'PAGO';
        } else if (pagamento.status === 'pago') {
            statusControl = 'PAGO';
        }

        // Verificar compensação real pela categoria da fatura
        if (statusControl === 'PENDENTE') {
            const catResult = await poolFaturas.query(`
                SELECT dados_leitura->>'categoria' as categoria
                FROM faturas_baixadas
                WHERE id = $1
            `, [fatura.id]);
            const categoria = catResult.rows[0]?.categoria || '';
            if (categoria.includes('Compensação') && !categoria.includes('Sem Compensação')) {
                statusControl = 'APROVADO';
            }
        }

        // 6. Buscar nome e tipo (Associado/Usineiro) do CRM
        let nomeCliente = null;
        let isUg = false;
        try {
            const crmResult = await poolCRM_Pagamentos.query(`
                SELECT
                    CASE WHEN uc.gerador = true THEN uc.nome_usina ELSE cc.nome_cliente END as nome_cliente,
                    uc.gerador as is_ug
                FROM unidades_consumidoras uc
                LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                WHERE uc.numero_unidade::text = $1
            `, [pagamento.uc]);
            if (crmResult.rows.length > 0) {
                nomeCliente = crmResult.rows[0].nome_cliente;
                isUg = crmResult.rows[0].is_ug || false;
            }
        } catch (crmErr) {
            console.error('⚠️ Erro ao buscar CRM:', crmErr.message);
        }

        console.log(`\n📤 [LANÇAR CONTROL] ID ${id} - UC ${pagamento.uc} - R$ ${pagamento.valor_fatura} - Status: ${statusControl} - ${isUg ? 'UG' : 'UC'} - ${nomeCliente || '?'}`);

        // 7. Enviar para Aupus Control
        const resultado = await enviarLancamentoControl({
            codigoBarras: codigoFinal,
            dataPagamento: pagamento.data_vencimento_fatura,
            valor: parseFloat(pagamento.valor_fatura),
            mesReferencia: pagamento.mes_referencia,
            nomeCliente: nomeCliente || nome_cliente || null,
            uc: pagamento.uc,
            isUg,
            status: statusControl,
        });

        if (!resultado.sucesso) {
            console.error('❌ Erro ao enviar para Aupus Control:', resultado.erro);

            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria
                SET status_control = 'erro',
                    erro_control = $1,
                    resposta_control = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [resultado.erro, JSON.stringify(resultado.dados), pagamento.id]);

            return res.status(400).json({
                error: 'Erro ao enviar para Aupus Control',
                message: resultado.erro,
                detalhes: resultado.dados
            });
        }

        // 6. Sucesso
        const controlId = resultado.dados.id;
        await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET status_control = 'lancado',
                control_lancamento_id = $1,
                data_lancamento_control = CURRENT_TIMESTAMP,
                resposta_control = $2,
                erro_control = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [controlId, JSON.stringify(resultado.dados), pagamento.id]);

        console.log(`✅ [LANÇAR CONTROL] UC ${pagamento.uc} - ID ${controlId}`);

        res.json({
            success: true,
            message: 'Lançamento enviado para Aupus Control com sucesso',
            control_lancamento_id: controlId,
            pagamento: {
                id: pagamento.id,
                uc: pagamento.uc,
                valor: pagamento.valor_fatura,
                status_control: 'lancado',
                control_lancamento_id: controlId
            }
        });

    } catch (error) {
        console.error('❌ Erro ao lançar no Control:', error);
        res.status(500).json({ error: error.message });
    }
});


// POST /api/boletos-energia/lancar-control/:id - Lançar boleto de energia no Aupus Control (ENTRADA)
app.post('/api/boletos-energia/lancar-control/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Buscar boleto
        const boletoResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia, valor_boleto, data_vencimento,
                   numero_boleto, status, status_control, control_lancamento_id,
                   nome_completo
            FROM boletos_energia
            WHERE id = $1
        `, [id]);

        if (boletoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Boleto não encontrado' });
        }

        const boleto = boletoResult.rows[0];

        // 2. Verificar se já foi enviado ao Control
        if (boleto.status_control === 'lancado') {
            return res.status(400).json({
                error: 'Já lançado no Aupus Control',
                message: `ID: ${boleto.control_lancamento_id}`,
                control_lancamento_id: boleto.control_lancamento_id
            });
        }

        // 3. Buscar nome do CRM (boletos são sempre de Associados, não UGs)
        let nomeCliente = boleto.nome_completo || null;
        try {
            const crmResult = await poolCRM_Pagamentos.query(`
                SELECT cc.nome_cliente
                FROM unidades_consumidoras uc
                LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                WHERE uc.numero_unidade::text = $1
            `, [boleto.uc]);
            if (crmResult.rows.length > 0 && crmResult.rows[0].nome_cliente) {
                nomeCliente = crmResult.rows[0].nome_cliente;
            }
        } catch (crmErr) {
            console.error('⚠️ Erro ao buscar CRM:', crmErr.message);
        }

        // 4. Determinar status: Pago → PAGO, demais → PENDENTE
        const statusControl = boleto.status === 'Pago' ? 'PAGO' : 'PENDENTE';

        console.log(`\n📤 [BOLETO→CONTROL] ID ${id} - UC ${boleto.uc} - R$ ${boleto.valor_boleto} - ${boleto.mes_referencia} - Status: ${statusControl}`);

        // 5. Enviar para Aupus Control
        const resultado = await enviarBoletoControl({
            numeroBoleto: boleto.numero_boleto,
            dataVencimento: boleto.data_vencimento,
            valor: parseFloat(boleto.valor_boleto),
            mesReferencia: boleto.mes_referencia,
            nomeCliente,
            uc: boleto.uc,
            status: statusControl,
        });

        if (!resultado.sucesso) {
            console.error('❌ [BOLETO→CONTROL] Erro:', resultado.erro);

            await poolFaturas.query(`
                UPDATE boletos_energia
                SET status_control = 'erro',
                    erro_control = $1,
                    resposta_control = $2,
                    data_lancamento_control = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [resultado.erro, JSON.stringify(resultado.dados), boleto.id]);

            return res.status(400).json({
                error: 'Erro ao enviar para Aupus Control',
                message: resultado.erro,
                detalhes: resultado.dados
            });
        }

        // 6. Sucesso
        const controlId = resultado.dados.id;
        await poolFaturas.query(`
            UPDATE boletos_energia
            SET status_control = 'lancado',
                control_lancamento_id = $1,
                data_lancamento_control = CURRENT_TIMESTAMP,
                resposta_control = $2,
                erro_control = NULL
            WHERE id = $3
        `, [controlId, JSON.stringify(resultado.dados), boleto.id]);

        console.log(`✅ [BOLETO→CONTROL] UC ${boleto.uc} - ID ${controlId}`);

        res.json({
            success: true,
            message: 'Boleto lançado no Aupus Control com sucesso',
            control_lancamento_id: controlId,
            boleto: {
                id: boleto.id,
                uc: boleto.uc,
                valor: boleto.valor_boleto,
                status_control: 'lancado',
                control_lancamento_id: controlId
            }
        });

    } catch (error) {
        console.error('❌ [BOLETO→CONTROL] Erro:', error);
        res.status(500).json({ error: error.message });
    }
});


// DELETE /api/pagamentos-concessionaria/cancelar-control/:id - Cancelar lançamento de fatura no Control
app.delete('/api/pagamentos-concessionaria/cancelar-control/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body || {};

        const pagResult = await poolFaturas.query(
            'SELECT id, uc, mes_referencia, status_control, control_lancamento_id FROM pagamentos_concessionaria WHERE id = $1',
            [id]
        );

        if (pagResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }

        const pagamento = pagResult.rows[0];

        if (pagamento.status_control !== 'lancado') {
            return res.status(400).json({ error: 'Lançamento não está com status lancado no Control', status_control: pagamento.status_control });
        }

        if (!pagamento.control_lancamento_id) {
            return res.status(400).json({ error: 'Sem ID de lançamento no Control' });
        }

        console.log(`\n🗑️ [CANCELAR CONTROL] Fatura ID ${id} - UC ${pagamento.uc} - Control ID ${pagamento.control_lancamento_id}`);

        const resultado = await cancelarLancamentoControl(pagamento.control_lancamento_id, motivo);

        if (!resultado.sucesso) {
            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria
                SET erro_control = $1, resposta_control = $2, updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [resultado.erro, JSON.stringify(resultado.dados), pagamento.id]);

            return res.status(400).json({ error: 'Erro ao cancelar no Control', message: resultado.erro, detalhes: resultado.dados });
        }

        await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET status_control = 'cancelado',
                resposta_control = $1,
                erro_control = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [JSON.stringify(resultado.dados), pagamento.id]);

        console.log(`✅ [CANCELAR CONTROL] Fatura UC ${pagamento.uc} cancelada`);

        res.json({ success: true, message: 'Lançamento cancelado no Control', control_lancamento_id: pagamento.control_lancamento_id });
    } catch (error) {
        console.error('❌ Erro ao cancelar no Control:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/boletos-energia/cancelar-control/:id - Cancelar lançamento de boleto no Control
app.delete('/api/boletos-energia/cancelar-control/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body || {};

        const boletoResult = await poolFaturas.query(
            'SELECT id, uc, mes_referencia, status_control, control_lancamento_id FROM boletos_energia WHERE id = $1',
            [id]
        );

        if (boletoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Boleto não encontrado' });
        }

        const boleto = boletoResult.rows[0];

        if (boleto.status_control !== 'lancado') {
            return res.status(400).json({ error: 'Lançamento não está com status lancado no Control', status_control: boleto.status_control });
        }

        if (!boleto.control_lancamento_id) {
            return res.status(400).json({ error: 'Sem ID de lançamento no Control' });
        }

        console.log(`\n🗑️ [CANCELAR CONTROL] Boleto ID ${id} - UC ${boleto.uc} - Control ID ${boleto.control_lancamento_id}`);

        const resultado = await cancelarLancamentoControl(boleto.control_lancamento_id, motivo);

        if (!resultado.sucesso) {
            await poolFaturas.query(`
                UPDATE boletos_energia
                SET erro_control = $1, resposta_control = $2
                WHERE id = $3
            `, [resultado.erro, JSON.stringify(resultado.dados), boleto.id]);

            return res.status(400).json({ error: 'Erro ao cancelar no Control', message: resultado.erro, detalhes: resultado.dados });
        }

        await poolFaturas.query(`
            UPDATE boletos_energia
            SET status_control = 'cancelado',
                resposta_control = $1,
                erro_control = NULL
            WHERE id = $2
        `, [JSON.stringify(resultado.dados), boleto.id]);

        console.log(`✅ [CANCELAR CONTROL] Boleto UC ${boleto.uc} cancelado`);

        res.json({ success: true, message: 'Boleto cancelado no Control', control_lancamento_id: boleto.control_lancamento_id });
    } catch (error) {
        console.error('❌ Erro ao cancelar boleto no Control:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/webhook/control - Receber webhooks do Aupus Control
app.post('/api/webhook/control', async (req, res) => {
    // Responder 200 imediatamente (fire-and-forget)
    res.json({ ok: true });

    try {
        const crypto = require('crypto');
        const secret = process.env.CONTROL_WEBHOOK_SECRET;
        const signature = req.headers['x-webhook-signature'];
        const evento = req.headers['x-webhook-event'];
        const entregaId = req.headers['x-webhook-delivery'];
        const payload = req.body;

        // Validar assinatura se secret configurado
        if (secret && signature) {
            const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
            if (signature !== expectedSig) {
                console.error(`❌ [WEBHOOK] Assinatura inválida - Entrega: ${entregaId}`);
                return;
            }
        }

        const lancamentoId = payload.lancamentoId;
        if (!lancamentoId) {
            console.log(`⚠️ [WEBHOOK] Evento ${evento} sem lancamentoId`);
            return;
        }

        console.log(`\n📥 [WEBHOOK] Evento: ${evento} - Lançamento: ${lancamentoId}`);

        // Mapear evento para status_control
        const statusMap = {
            'lancamento.aprovado': 'aprovado',
            'lancamento.pago': 'pago',
            'lancamento.cancelado': 'cancelado',
            'lancamento.estornado': 'aprovado', // estorno reverte para aprovado
        };

        const novoStatus = statusMap[evento];
        if (!novoStatus) {
            console.log(`⚠️ [WEBHOOK] Evento ${evento} ignorado (não mapeado)`);
            return;
        }

        // Tentar atualizar em pagamentos_concessionaria
        const updPag = await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET status_control = $1, updated_at = CURRENT_TIMESTAMP
            WHERE control_lancamento_id = $2 AND status_control != $1
            RETURNING id, uc
        `, [novoStatus, lancamentoId]);

        if (updPag.rowCount > 0) {
            console.log(`✅ [WEBHOOK] Fatura UC ${updPag.rows[0].uc} → status_control = ${novoStatus}`);
            return;
        }

        // Tentar atualizar em boletos_energia
        const updBol = await poolFaturas.query(`
            UPDATE boletos_energia
            SET status_control = $1
            WHERE control_lancamento_id = $2 AND status_control != $1
            RETURNING id, uc
        `, [novoStatus, lancamentoId]);

        if (updBol.rowCount > 0) {
            console.log(`✅ [WEBHOOK] Boleto UC ${updBol.rows[0].uc} → status_control = ${novoStatus}`);
            return;
        }

        console.log(`⚠️ [WEBHOOK] Lançamento ${lancamentoId} não encontrado em nenhuma tabela local`);
    } catch (error) {
        console.error('❌ [WEBHOOK] Erro ao processar:', error.message);
    }
});

// PATCH /api/pagamentos-concessionaria/:id/codigo-barras - Atualizar código de barras
app.patch('/api/pagamentos-concessionaria/:id/codigo-barras', async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo_barras, linha_digitavel, pix_copia_cola } = req.body;

        const result = await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET codigo_barras = COALESCE($1, codigo_barras),
                linha_digitavel = COALESCE($2, linha_digitavel),
                pix_copia_cola = COALESCE($3, pix_copia_cola),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `, [codigo_barras, linha_digitavel, pix_copia_cola, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }

        res.json({
            success: true,
            pagamento: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar código de barras:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/pagamentos-concessionaria/:id - Cancelar pagamento
app.delete('/api/pagamentos-concessionaria/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar status atual antes de tentar cancelar
        const check = await poolFaturas.query(`SELECT id, uc, status FROM pagamentos_concessionaria WHERE id = $1`, [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }

        const statusAtual = check.rows[0].status;
        const statusPermitidos = ['pendente', 'lancado', 'aguardando_aprovacao', 'processando'];

        if (!statusPermitidos.includes(statusAtual)) {
            return res.status(400).json({
                error: `Pagamento com status "${statusAtual}" não pode ser cancelado`,
                uc: check.rows[0].uc,
                status: statusAtual
            });
        }

        const result = await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET status = 'cancelado',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = ANY($2)
            RETURNING *
        `, [id, statusPermitidos]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Pagamento não encontrado ou não pode ser cancelado'
            });
        }

        res.json({
            success: true,
            message: 'Pagamento cancelado',
            pagamento: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Erro ao cancelar pagamento:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/:id/cancelar-bb - Cancelar pagamento na API do BB
// Funciona apenas para pagamentos que ainda não foram processados/debitados
app.post('/api/pagamentos-concessionaria/:id/cancelar-bb', async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar pagamento
        const pagResult = await poolFaturas.query(
            'SELECT * FROM pagamentos_concessionaria WHERE id = $1',
            [id]
        );

        if (pagResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }

        const pagamento = pagResult.rows[0];

        // Verificar se pode ser cancelado
        const statusCancelaveis = ['lancado', 'aguardando_aprovacao', 'pendente_bb', 'consistente', 'processando'];
        if (!statusCancelaveis.includes(pagamento.status)) {
            return res.status(400).json({
                error: 'Pagamento não pode ser cancelado',
                message: `Status atual: ${pagamento.status}. Apenas pagamentos com status ${statusCancelaveis.join(', ')} podem ser cancelados.`
            });
        }

        const { forcar } = req.body || {};

        // Verificar se tem id_pagamento_bb (necessário para cancelar na API)
        if (!pagamento.id_pagamento_bb) {
            // Se não tem id do pagamento BB, apenas cancelar localmente
            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria
                SET status = 'cancelado',
                    observacao = 'Cancelado localmente (sem ID de pagamento BB)',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [id]);

            return res.json({
                success: true,
                message: 'Pagamento cancelado localmente (não havia ID de pagamento no BB)',
                canceladoBB: false
            });
        }

        console.log(`🚫 [CANCELAR BB] Tentando cancelar pagamento ${pagamento.id_pagamento_bb} - UC ${pagamento.uc}`);

        // Chamar API do BB para cancelar o pagamento (usa id_pagamento_bb como codigoPagamento)
        const resultadoBB = await baixarRequisicao(pagamento.id_pagamento_bb);

        if (resultadoBB.sucesso) {
            // Atualizar status local
            await poolFaturas.query(`
                UPDATE pagamentos_concessionaria
                SET status = 'cancelado',
                    observacao = 'Cancelado na API do BB',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [id]);

            console.log(`✅ [CANCELAR BB] Pagamento ${pagamento.id_pagamento_bb} cancelado com sucesso`);

            return res.json({
                success: true,
                message: 'Pagamento cancelado com sucesso na API do BB',
                canceladoBB: true,
                dados: resultadoBB.dados
            });
        } else {
            const erroBB = resultadoBB.erro;
            const estadoBB = resultadoBB.estadoBB || '';

            // Traduzir estado do BB para mensagem clara
            const explicacaoEstado = {
                'BLOQUEADO': 'O pagamento ja foi aprovado e esta aguardando a data de debito. Nao pode mais ser cancelado pelo BB.',
                'PROCESSADO': 'O pagamento ja foi debitado da conta. Nao pode ser cancelado.',
                'LIQUIDADO': 'O pagamento ja foi liquidado (pago ao destinatario). Nao pode ser cancelado.',
            };
            const explicacao = explicacaoEstado[estadoBB] || erroBB;

            // Se o usuário pediu para forçar cancelamento local
            if (forcar) {
                await poolFaturas.query(`
                    UPDATE pagamentos_concessionaria
                    SET status = 'cancelado',
                        observacao = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [`Cancelado localmente (forçado). BB retornou: ${erroBB} (estado: ${estadoBB})`, id]);

                console.log(`⚠️ [CANCELAR BB] Pagamento ${pagamento.id_pagamento_bb} cancelado LOCALMENTE (forçado) - UC ${pagamento.uc}`);

                return res.json({
                    success: true,
                    message: `Pagamento cancelado localmente. O BB retornou: ${erroBB}`,
                    canceladoBB: false,
                    forcado: true
                });
            }

            // Se erro é porque já foi processado/bloqueado, informar com opção de forçar
            if (resultadoBB.jaProcessada) {
                await poolFaturas.query(`
                    UPDATE pagamentos_concessionaria
                    SET observacao = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [`BB: ${erroBB} (estado: ${estadoBB})`, id]);

                return res.status(400).json({
                    error: `BB: ${erroBB}`,
                    message: explicacao,
                    jaProcessado: true,
                    podeForcar: true
                });
            }

            return res.status(400).json({
                error: `Erro ao cancelar no BB: ${erroBB}`,
                message: erroBB,
                detalhes: resultadoBB.detalhes,
                podeForcar: true
            });
        }

    } catch (error) {
        console.error('❌ Erro ao cancelar pagamento no BB:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/pagamentos-concessionaria/faturas-pendentes/:mes - Faturas sem pagamento lançado
app.get('/api/pagamentos-concessionaria/faturas-pendentes/:mes', async (req, res) => {
    try {
        const { mes } = req.params;

        const result = await poolFaturas.query(`
            SELECT f.id, f.uc, f.mes_referencia,
                   f.dados_leitura->>'nome_cliente_pdf' as nome_cliente,
                   f.dados_leitura->>'valor_concessionaria' as valor_concessionaria,
                   f.dados_leitura->>'vencimento' as vencimento,
                   f.dados_leitura->>'codigo_barras' as codigo_barras,
                   f.dados_leitura->>'linha_digitavel' as linha_digitavel,
                   f.dados_leitura->>'pix_copia_cola' as pix_copia_cola,
                   pc.id as pagamento_id,
                   pc.status as pagamento_status
            FROM faturas_baixadas f
            LEFT JOIN pagamentos_concessionaria pc ON f.id = pc.fatura_id
            WHERE f.mes_referencia = $1
              AND f.status = 'processado'
              AND (f.dados_leitura->>'valor_concessionaria')::decimal > 0
              AND (pc.id IS NULL OR pc.status = 'pendente')
            ORDER BY f.uc
        `, [mes]);

        res.json({
            mes_referencia: mes,
            total: result.rows.length,
            faturas: result.rows
        });

    } catch (error) {
        console.error('❌ Erro ao buscar faturas pendentes:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/pagamentos-concessionaria/ugs/:mes - Listar UGs autorizadas com faturas do mês
app.get('/api/pagamentos-concessionaria/ugs/:mes', async (req, res) => {
    try {
        const { mes } = req.params;
        const { Pool } = require('pg');

        // Primeiro buscar as UGs autorizadas no CRM
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: process.env.CRM_DB_PASSWORD || 'SuaSenhaAqui123!',
            ssl: false
        });

        const ugsQuery = await crmPool.query(`
            SELECT numero_unidade as uc, nome_usina
            FROM unidades_consumidoras
            WHERE gerador = true
              AND deleted_at IS NULL
            ORDER BY nome_usina
        `);

        await crmPool.end();

        const ugsAutorizadas = ugsQuery.rows;
        const ucsSet = ugsAutorizadas.map(u => u.uc);

        if (ucsSet.length === 0) {
            return res.json({ mes_referencia: mes, total: 0, ugs: [] });
        }

        // Buscar faturas das UGs no mês (usando DISTINCT ON para pegar apenas uma fatura por UC,
        // priorizando as que têm dados preenchidos)
        const result = await poolFaturas.query(`
            SELECT DISTINCT ON (f.uc)
                   f.id, f.uc, f.mes_referencia,
                   f.dados_leitura->>'valor_concessionaria' as valor_fatura,
                   f.dados_leitura->>'vencimento' as data_vencimento_fatura,
                   f.dados_leitura->>'codigo_barras' as codigo_barras,
                   f.dados_leitura->>'codigo_pix' as pix_copia_cola,
                   f.status as status_fatura
            FROM faturas_baixadas f
            WHERE f.mes_referencia = $1
              AND f.uc = ANY($2)
              AND f.status IN ('processado', 'pendente', 'baixado')
            ORDER BY f.uc,
                     (f.dados_leitura->>'valor_concessionaria' IS NOT NULL)::int DESC,
                     (f.dados_leitura->>'codigo_pix' IS NOT NULL)::int DESC,
                     f.id DESC
        `, [mes, ucsSet]);

        // Mesclar dados das UGs com dados das faturas
        const ugsComFaturas = ugsAutorizadas.map(ug => {
            const fatura = result.rows.find(f => f.uc === ug.uc);
            return {
                uc: ug.uc,
                nome_usina: ug.nome_usina,
                id: fatura?.id,
                valor_fatura: fatura?.valor_fatura,
                data_vencimento_fatura: fatura?.data_vencimento_fatura,
                codigo_barras: fatura?.codigo_barras,
                pix_copia_cola: fatura?.pix_copia_cola,
                status_fatura: fatura?.status_fatura
            };
        }).filter(ug => ug.id); // Apenas UGs que têm fatura no mês

        res.json({
            mes_referencia: mes,
            total: ugsComFaturas.length,
            ugs: ugsComFaturas
        });

    } catch (error) {
        console.error('❌ Erro ao buscar UGs:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/sincronizar-status - Sincronizar status com API BB
app.post('/api/pagamentos-concessionaria/sincronizar-status', async (req, res) => {
    try {
        console.log('\n🔄 [SINCRONIZAR STATUS] Iniciando sincronização de pagamentos...');

        // Buscar pagamentos que precisam de atualização (todos que não são finais)
        // Ignora itens com status_forcado = true
        const pagamentosResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia, valor_fatura, id_pagamento_bb, numero_requisicao,
                   tipo_pagamento, status, codigo_barras, estado_requisicao, status_forcado,
                   control_lancamento_id, status_control
            FROM pagamentos_concessionaria
            WHERE status IN ('lancado', 'aguardando_aprovacao', 'processando', 'processando_lancamento', 'processando_pagamento', 'agendado', 'pendente_bb', 'consistente', 'liberado')
              AND numero_requisicao IS NOT NULL
              AND (status_forcado IS NULL OR status_forcado = false)
            ORDER BY created_at DESC
        `);

        if (pagamentosResult.rows.length === 0) {
            return res.json({
                success: true,
                message: 'Nenhum pagamento para sincronizar',
                sincronizados: 0
            });
        }

        console.log(`   📋 ${pagamentosResult.rows.length} pagamentos para verificar`);

        // Importar módulo de pagamentos BB
        const pagBB = require('./pagamentosLoteBB');

        let sincronizados = 0;
        let erros = 0;
        const resultados = [];

        // Mapear estado da API para status local
        // Verifica indicadorAceite para estados 1 e 2 (que podem ser falsos positivos de erro)
        const mapearEstado = (estadoRequisicao, indicadorAceite, erros) => {
            // Se indicadorAceite = "S" e sem erros reais, não é erro
            const foiAceito = indicadorAceite === 'S' && (!erros || erros.length === 0);

            // Mapeamento conforme documentação oficial API BB Pagamentos em Lote:
            // 1 = Todos lançamentos consistentes (transitório)
            // 2 = Ao menos um lançamento inconsistente (transitório)
            // 3 = Todos lançamentos inconsistentes (migra para 7-Rejeitada)
            // 4 = Pendente de ação do Conveniado - falta autorizar/liberar
            // 5 = Em processamento pelo Banco (ao menos um agendado)
            // 6 = Processada (definitivo - pago)
            // 7 = Rejeitada (definitivo)
            // 8 = Preparando remessa não liberada (transitório)
            // 9 = Liberada via API
            // 10 = Preparando remessa liberada
            switch (estadoRequisicao) {
                case 1: return foiAceito ? 'processando_lancamento' : 'erro';
                case 2: return foiAceito ? 'processando_lancamento' : 'erro';
                case 3: return 'erro'; // Todos inconsistentes, será rejeitada
                case 4: return 'aguardando_aprovacao'; // Pendente de liberação
                case 5: return 'processando_pagamento'; // Aprovado, banco processando débito
                case 6: return 'pago'; // Processada (definitivo)
                case 7: return 'rejeitado'; // Rejeitada (definitivo)
                case 8: return 'processando_lancamento'; // Preparando remessa
                case 9: return 'liberado'; // Liberada via API
                case 10: return 'processando_lancamento'; // Preparando remessa liberada
                default: return null;
            }
        };

        for (const pagamento of pagamentosResult.rows) {
            try {
                console.log(`   🔍 Consultando pagamento ${pagamento.id} (UC ${pagamento.uc})...`);

                // Consultar pelo número de requisição (lote)
                const resultado = await pagBB.consultarLoteBoletos(pagamento.numero_requisicao);

                if (!resultado.sucesso) {
                    throw new Error(resultado.erro || 'Erro ao consultar');
                }

                const estadoRequisicao = resultado.dados.estadoRequisicao;
                const lancamento = resultado.dados.lancamentos?.[0];
                const indicadorAceite = lancamento?.indicadorAceite;
                const errosLancamento = lancamento?.erros || [];
                const novoStatus = mapearEstado(estadoRequisicao, indicadorAceite, errosLancamento);

                if (novoStatus && novoStatus !== pagamento.status) {
                    await poolFaturas.query(`
                        UPDATE pagamentos_concessionaria
                        SET status = $1,
                            estado_requisicao = $2,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $3
                    `, [novoStatus, estadoRequisicao, pagamento.id]);

                    console.log(`   ✅ Pagamento ${pagamento.id}: ${pagamento.status} → ${novoStatus} (estado ${estadoRequisicao})`);
                    sincronizados++;

                    // Auto-sincronizar com Aupus Control quando pagamento é confirmado pelo BB
                    if (novoStatus === 'pago' && pagamento.control_lancamento_id) {
                        autoPagarEqtlNoControl(pagamento.id).catch(() => {});
                    }
                } else {
                    console.log(`   ℹ️ Pagamento ${pagamento.id}: sem alteração (estado ${estadoRequisicao})`);
                }

                resultados.push({
                    id: pagamento.id,
                    uc: pagamento.uc,
                    status_anterior: pagamento.status,
                    status_novo: novoStatus || pagamento.status,
                    estado_bb: estadoRequisicao,
                    atualizado: novoStatus && novoStatus !== pagamento.status
                });

            } catch (err) {
                console.error(`   ❌ Erro no pagamento ${pagamento.id}: ${err.message}`);
                erros++;
                resultados.push({
                    id: pagamento.id,
                    uc: pagamento.uc,
                    erro: err.response?.data?.erros?.[0]?.mensagem || err.message
                });
            }
        }

        console.log(`✅ [SINCRONIZAR STATUS] Concluído: ${sincronizados} atualizados, ${erros} erros`);

        res.json({
            success: true,
            total_verificados: pagamentosResult.rows.length,
            sincronizados,
            erros,
            resultados
        });

    } catch (error) {
        console.error('❌ Erro ao sincronizar status:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/forcar-config - Forçar tipo (lote/enviar) e status
// Usa fatura_id para identificar, cria registro em pagamentos_concessionaria se não existir
app.post('/api/pagamentos-concessionaria/forcar-config', async (req, res) => {
    try {
        const { senha, fatura_id, tipo_forcado, novo_status, marcar_enviado_whatsapp, marcar_enviado_email } = req.body;

        // Validar senha
        const SENHA_CONFIG = 'DevSmart123';
        if (senha !== SENHA_CONFIG) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        if (!fatura_id) {
            return res.status(400).json({ error: 'fatura_id é obrigatório' });
        }

        // Buscar dados da fatura
        const faturaResult = await poolFaturas.query(`
            SELECT id, uc, mes_referencia,
                   dados_leitura->>'valor_concessionaria' as valor_fatura,
                   dados_leitura->>'vencimento' as vencimento
            FROM faturas_baixadas WHERE id = $1
        `, [fatura_id]);

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];

        // Verificar se já existe registro em pagamentos_concessionaria
        const pagResult = await poolFaturas.query(
            'SELECT id, status, status_forcado, status_original, tipo_forcado FROM pagamentos_concessionaria WHERE uc = $1 AND mes_referencia = $2',
            [fatura.uc, fatura.mes_referencia]
        );

        let pagamentoId;
        let statusOriginal = 'pendente';

        if (pagResult.rows.length === 0) {
            // Criar registro novo
            // Converter vencimento de DD/MM/YY para YYYY-MM-DD
            let dataVenc = fatura.vencimento;
            if (dataVenc && typeof dataVenc === 'string') {
                const matchYY = dataVenc.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
                if (matchYY) {
                    const [, dia, mes, ano] = matchYY;
                    const anoCompleto = parseInt(ano) < 50 ? `20${ano}` : `19${ano}`;
                    dataVenc = `${anoCompleto}-${mes}-${dia}`;
                }
                const matchYYYY = dataVenc.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                if (matchYYYY) {
                    const [, dia, mes, ano] = matchYYYY;
                    dataVenc = `${ano}-${mes}-${dia}`;
                }
            }
            if (!dataVenc) dataVenc = new Date().toISOString().split('T')[0];

            const insertResult = await poolFaturas.query(`
                INSERT INTO pagamentos_concessionaria (uc, mes_referencia, fatura_id, valor_fatura, data_vencimento_fatura, status, status_forcado, status_original, tipo_forcado)
                VALUES ($1, $2, $3, $4, $5, $6, true, 'pendente', $7)
                RETURNING id
            `, [fatura.uc, fatura.mes_referencia, fatura_id, fatura.valor_fatura || 0, dataVenc, novo_status || 'pendente', tipo_forcado]);

            pagamentoId = insertResult.rows[0].id;
            console.log(`🆕 [CONFIG FORÇADA] Criado registro pagamentos_concessionaria id=${pagamentoId} para UC ${fatura.uc}`);
        } else {
            // Atualizar registro existente
            const pagamento = pagResult.rows[0];
            pagamentoId = pagamento.id;
            statusOriginal = pagamento.status_forcado ? pagamento.status_original : pagamento.status;

            const updateFields = ['status_forcado = true', 'status_original = $2', 'updated_at = CURRENT_TIMESTAMP'];
            const params = [pagamentoId, statusOriginal];
            let paramIndex = 3;

            if (tipo_forcado) {
                updateFields.push(`tipo_forcado = $${paramIndex}`);
                params.push(tipo_forcado);
                paramIndex++;
            }

            if (novo_status) {
                updateFields.push(`status = $${paramIndex}`);
                params.push(novo_status);
                paramIndex++;
            }

            if (marcar_enviado_whatsapp) {
                updateFields.push(`data_envio_whatsapp = CURRENT_TIMESTAMP`);
            }

            if (marcar_enviado_email) {
                updateFields.push(`data_envio_email = CURRENT_TIMESTAMP`);
            }

            await poolFaturas.query(
                `UPDATE pagamentos_concessionaria SET ${updateFields.join(', ')} WHERE id = $1`,
                params
            );
        }

        console.log(`🔧 [CONFIG FORÇADA] UC ${fatura.uc}: tipo=${tipo_forcado || 'mantido'}, status=${novo_status || 'mantido'}, whatsapp=${marcar_enviado_whatsapp}, email=${marcar_enviado_email}`);

        res.json({
            success: true,
            message: 'Configuração forçada aplicada',
            pagamento_id: pagamentoId,
            status_original: statusOriginal
        });

    } catch (error) {
        console.error('❌ Erro ao forçar config:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pagamentos-concessionaria/reverter-config - Reverter para configuração original
app.post('/api/pagamentos-concessionaria/reverter-config', async (req, res) => {
    try {
        const { senha, fatura_id } = req.body;

        // Validar senha
        const SENHA_CONFIG = 'DevSmart123';
        if (senha !== SENHA_CONFIG) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        if (!fatura_id) {
            return res.status(400).json({ error: 'fatura_id é obrigatório' });
        }

        // Buscar dados da fatura para encontrar o registro
        const faturaResult = await poolFaturas.query(
            'SELECT uc, mes_referencia FROM faturas_baixadas WHERE id = $1',
            [fatura_id]
        );

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const { uc, mes_referencia } = faturaResult.rows[0];

        // Buscar pagamento atual
        const pagResult = await poolFaturas.query(
            'SELECT id, status, status_forcado, status_original, tipo_forcado FROM pagamentos_concessionaria WHERE uc = $1 AND mes_referencia = $2',
            [uc, mes_referencia]
        );

        if (pagResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }

        const pagamento = pagResult.rows[0];

        if (!pagamento.status_forcado) {
            return res.status(400).json({ error: 'Este pagamento não está com configuração forçada' });
        }

        // Reverter para configuração original (limpa tipo_forcado também)
        await poolFaturas.query(`
            UPDATE pagamentos_concessionaria
            SET status = COALESCE(status_original, status),
                status_forcado = false,
                status_original = NULL,
                tipo_forcado = NULL,
                data_envio_whatsapp = NULL,
                data_envio_email = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [pagamento.id]);

        console.log(`🔄 [CONFIG REVERTIDA] UC ${uc}: revertido para configuração original`);

        res.json({
            success: true,
            message: 'Configuração revertida para original',
            status_revertido: pagamento.status_original || pagamento.status
        });

    } catch (error) {
        console.error('❌ Erro ao reverter config:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/pagamentos-concessionaria/consultar/:id - Consultar status de um pagamento específico
app.get('/api/pagamentos-concessionaria/consultar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Token OAuth é obrigatório', tokenExpired: true });
        }

        // Buscar pagamento local
        const pagResult = await poolFaturas.query(
            'SELECT * FROM pagamentos_concessionaria WHERE id = $1',
            [id]
        );

        if (pagResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }

        const pagamento = pagResult.rows[0];

        if (!pagamento.id_pagamento_bb) {
            return res.json({
                success: true,
                pagamento,
                message: 'Pagamento ainda não foi enviado para API BB'
            });
        }

        // Consultar na API BB
        const BB_API_URL = 'https://api-ip.bb.com.br/pagamentos-lote/v1';
        const APP_KEY = process.env.BB_APP_KEY || 'd27b9511c24a133a1799c1d0190722b5f79a';

        const endpoint = pagamento.tipo_pagamento === 'PIX'
            ? `${BB_API_URL}/pix/${pagamento.id_pagamento_bb}`
            : `${BB_API_URL}/boletos/${pagamento.id_pagamento_bb}`;

        console.log(`🔍 [CONSULTAR PAGAMENTO] ID ${id} - Endpoint: ${endpoint}`);

        const response = await axios.get(endpoint, {
            params: {
                'gw-dev-app-key': APP_KEY
            },
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        const dadosBB = response.data;

        // Atualizar status local se mudou
        if (dadosBB.estadoPagamento) {
            let novoStatus = pagamento.status;
            switch (dadosBB.estadoPagamento) {
                case 'Pago': novoStatus = 'pago'; break;
                case 'Agendado': novoStatus = 'agendado'; break;
                case 'Cancelado': novoStatus = 'cancelado'; break;
                case 'Devolvido': novoStatus = 'devolvido'; break;
                case 'Rejeitado': novoStatus = 'rejeitado'; break;
                case 'Vencido': novoStatus = 'vencido'; break;
                case 'Pendente': novoStatus = 'pendente_bb'; break;
                case 'Consistente': novoStatus = 'consistente'; break;
                case 'Inconsistente': novoStatus = 'inconsistente'; break;
                case 'Debitado': novoStatus = 'debitado'; break;
            }

            if (novoStatus !== pagamento.status) {
                await poolFaturas.query(`
                    UPDATE pagamentos_concessionaria
                    SET status = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [novoStatus, id]);
                pagamento.status = novoStatus;
            }
        }

        res.json({
            success: true,
            pagamento_local: pagamento,
            dados_bb: dadosBB
        });

    } catch (error) {
        console.error('❌ Erro ao consultar pagamento:', error);
        res.status(500).json({
            error: error.response?.data?.message || error.message,
            details: error.response?.data
        });
    }
});

// ========================================
// 📤 PAGAMENTOS CONCESSIONÁRIA - ENVIO DE FATURA ORIGINAL
// ========================================

// POST /api/pagamentos-concessionaria/enviar-fatura-whatsapp - Envia fatura original EQTL por WhatsApp
app.post('/api/pagamentos-concessionaria/enviar-fatura-whatsapp', async (req, res) => {
    try {
        const { fatura_id, uc, mes_referencia, telefone, mensagem_customizada, forcar_reenvio } = req.body;

        console.log(`📱 [ENVIAR FATURA WHATSAPP] UC: ${uc}, Mês: ${mes_referencia}, Telefone: ${telefone}`);

        if ((!fatura_id && (!uc || !mes_referencia)) || !telefone) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: (fatura_id OU uc+mes_referencia) e telefone' });
        }

        // Formatar telefone
        let telefoneFormatado = telefone.replace(/\D/g, '');
        if (telefoneFormatado.length === 11 || telefoneFormatado.length === 10) {
            telefoneFormatado = '55' + telefoneFormatado;
        }

        // Buscar fatura original
        let faturaResult;
        if (fatura_id) {
            faturaResult = await poolFaturas.query(`
                SELECT * FROM faturas_baixadas WHERE id = $1
            `, [fatura_id]);
        } else {
            faturaResult = await poolFaturas.query(`
                SELECT * FROM faturas_baixadas WHERE uc = $1 AND mes_referencia = $2
            `, [uc, mes_referencia]);
        }

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];
        let caminhoPdf = fatura.caminho_storage;

        if (!caminhoPdf) {
            return res.status(404).json({ error: 'Fatura original não encontrada para esta UC/mês' });
        }

        // Converter caminho do container para caminho local
        const DADOS_PATH = process.env.DADOS_PATH || '/var/www/aupus-microservicos-faturas/dados';
        caminhoPdf = caminhoPdf.replace('/app/dados', DADOS_PATH);

        if (!fs.existsSync(caminhoPdf)) {
            return res.status(404).json({ error: 'Arquivo da fatura não encontrado no sistema de arquivos', path: caminhoPdf });
        }

        // Extrair nome do arquivo e dados da fatura
        const nomeArquivo = path.basename(caminhoPdf);
        const mesRef = fatura.mes_referencia;
        const ucFatura = fatura.uc;

        // Gerar link público para download (endpoint sem autenticação)
        const baseUrl = process.env.REACT_APP_API_URL || 'https://api-bb.aupusenergia.com.br';
        const linkDownload = `${baseUrl}/api/faturas/download/${ucFatura}/${mesRef.replace('/', '-')}`;

        // Mensagem para envio - se tiver customizada, substituir placeholder ou adicionar link ao final
        let mensagemFinal;
        if (mensagem_customizada) {
            if (mensagem_customizada.includes('[LINK]')) {
                mensagemFinal = mensagem_customizada.replace('[LINK]', linkDownload);
            } else {
                // Adicionar link ao final se não tiver placeholder
                mensagemFinal = `${mensagem_customizada}\n\n📄 *Baixar Fatura:*\n${linkDownload}`;
            }
        } else {
            mensagemFinal = `Olá! Segue sua fatura de energia referente ao mês ${mesRef}.\n\n📄 *Baixar Fatura:*\n${linkDownload}\n\nQualquer dúvida, estamos à disposição!\n\n*AUPUS Energia*`;
        }

        // Configuração do ChatCenter API
        const chatcenterApiUrl = process.env.CHATCENTER_API_URL || 'https://api.multiweb.plus/send/chat/';
        const chatcenterApiKey = process.env.CHATCENTER_API_KEY;

        console.log(`📱 Enviando fatura EQTL para WhatsApp ${telefoneFormatado}...`);

        const payload = {
            key: chatcenterApiKey,
            numero: telefoneFormatado,
            texto: mensagemFinal
        };

        const response = await axios.post(chatcenterApiUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        // Registrar envio no controle_envios
        try {
            await pool.query(`
                INSERT INTO controle_envios (arquivo, pasta, mes_referencia, tipo_envio, destinatario, status, mensagem, resposta_api, enviado_por)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                nomeArquivo,
                'FATURA_EQTL',
                mesRef,
                'whatsapp',
                telefoneFormatado,
                'enviado',
                mensagemFinal,
                JSON.stringify(response.data),
                'sistema'
            ]);
        } catch (regError) {
            console.error('Erro ao registrar envio:', regError.message);
        }

        // Atualizar ou criar registro de pagamento com data de envio WhatsApp
        const valorFatura = fatura.dados_leitura?.valor_concessionaria || 0;

        // Converter data de vencimento de DD/MM/YY para YYYY-MM-DD
        let vencimentoWpp = fatura.dados_leitura?.vencimento || null;
        if (vencimentoWpp && typeof vencimentoWpp === 'string') {
            // Se formato DD/MM/YY (ex: 25/01/26)
            const matchYY = vencimentoWpp.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
            if (matchYY) {
                const [, dia, mes, ano] = matchYY;
                const anoCompleto = parseInt(ano) < 50 ? `20${ano}` : `19${ano}`;
                vencimentoWpp = `${anoCompleto}-${mes}-${dia}`;
            }
            // Se formato DD/MM/YYYY (ex: 25/01/2026)
            const matchYYYY = vencimentoWpp.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (matchYYYY) {
                const [, dia, mes, ano] = matchYYYY;
                vencimentoWpp = `${ano}-${mes}-${dia}`;
            }
        }
        if (!vencimentoWpp) {
            vencimentoWpp = new Date().toISOString().split('T')[0];
        }

        await poolFaturas.query(`
            INSERT INTO pagamentos_concessionaria (uc, mes_referencia, fatura_id, valor_fatura, data_vencimento_fatura, data_envio_whatsapp, status)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, 'pendente')
            ON CONFLICT (uc, mes_referencia) DO UPDATE SET
                data_envio_whatsapp = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
        `, [ucFatura, mesRef, fatura.id, valorFatura, vencimentoWpp]);

        console.log(`✅ Fatura EQTL enviada com sucesso para ${telefoneFormatado}`);

        res.json({
            success: true,
            message: 'Fatura enviada com sucesso via WhatsApp',
            destinatario: telefoneFormatado,
            linkEnviado: linkDownload,
            apiResponse: response.data
        });

    } catch (error) {
        console.error('❌ Erro ao enviar fatura por WhatsApp:', error.message);
        res.status(500).json({
            error: 'Erro ao enviar fatura por WhatsApp',
            message: error.message,
            details: error.response?.data
        });
    }
});

// POST /api/pagamentos-concessionaria/enviar-fatura-email - Envia fatura original EQTL por Email
app.post('/api/pagamentos-concessionaria/enviar-fatura-email', async (req, res) => {
    try {
        const { fatura_id, uc, mes_referencia, email, email_secundario, assunto_customizado, mensagem_customizada, forcar_reenvio } = req.body;

        console.log(`📧 [ENVIAR FATURA EMAIL] UC: ${uc}, Mês: ${mes_referencia}, Email: ${email}`);

        if ((!fatura_id && (!uc || !mes_referencia)) || !email) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: (fatura_id OU uc+mes_referencia) e email' });
        }

        // Validar email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }
        if (email_secundario && !emailRegex.test(email_secundario)) {
            return res.status(400).json({ error: 'Email secundário inválido' });
        }

        // Buscar fatura original
        let faturaResult;
        if (fatura_id) {
            faturaResult = await poolFaturas.query(`
                SELECT * FROM faturas_baixadas WHERE id = $1
            `, [fatura_id]);
        } else {
            faturaResult = await poolFaturas.query(`
                SELECT * FROM faturas_baixadas WHERE uc = $1 AND mes_referencia = $2
            `, [uc, mes_referencia]);
        }

        if (faturaResult.rows.length === 0) {
            return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        const fatura = faturaResult.rows[0];
        let caminhoPdf = fatura.caminho_storage;

        if (!caminhoPdf) {
            return res.status(404).json({ error: 'Fatura original não encontrada para esta UC/mês' });
        }

        // Converter caminho do container para caminho local
        const DADOS_PATH = process.env.DADOS_PATH || '/var/www/aupus-microservicos-faturas/dados';
        caminhoPdf = caminhoPdf.replace('/app/dados', DADOS_PATH);

        if (!fs.existsSync(caminhoPdf)) {
            return res.status(404).json({ error: 'Arquivo da fatura não encontrado no sistema de arquivos', path: caminhoPdf });
        }

        // Extrair nome do arquivo e dados da fatura
        const nomeArquivo = path.basename(caminhoPdf);
        const mesRef = fatura.mes_referencia;
        const ucFatura = fatura.uc;
        const nomeCliente = fatura.dados_leitura?.nome_cliente || 'Cliente';
        const valorFatura = fatura.dados_leitura?.valor_total || fatura.dados_calculados?.valor_fatura_eqtl;
        const vencimento = fatura.dados_leitura?.data_vencimento;

        // Configurar transporter do nodemailer
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER || 'financeiro@aupusenergia.com.br',
                pass: process.env.SMTP_PASS || ''
            }
        });

        // Assunto e corpo do email
        const assuntoFinal = assunto_customizado || `Fatura de Energia EQTL - ${mesRef} - UC ${ucFatura}`;
        const corpoFinal = mensagem_customizada || `
Prezado(a) ${nomeCliente},

Segue em anexo sua fatura de energia da EQTL referente ao mês ${mesRef}.

UC: ${ucFatura}
Valor: R$ ${valorFatura ? parseFloat(valorFatura).toFixed(2) : 'N/A'}
Vencimento: ${vencimento || 'N/A'}

Qualquer dúvida, estamos à disposição.

Atenciosamente,
AUPUS Energia
financeiro@aupusenergia.com.br
        `.trim();

        // Lista de destinatários
        const destinatarios = email_secundario ? `${email}, ${email_secundario}` : email;

        console.log(`📧 Enviando fatura EQTL para email ${destinatarios}...`);

        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"AUPUS Energia" <financeiro@aupusenergia.com.br>',
            to: destinatarios,
            subject: assuntoFinal,
            text: corpoFinal,
            html: corpoFinal.replace(/\n/g, '<br>'),
            attachments: [
                {
                    filename: nomeArquivo,
                    path: caminhoPdf
                }
            ]
        });

        // Registrar envio no controle_envios
        try {
            await pool.query(`
                INSERT INTO controle_envios (arquivo, pasta, mes_referencia, tipo_envio, destinatario, status, mensagem, resposta_api, enviado_por)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                nomeArquivo,
                'FATURA_EQTL',
                mesRef,
                'email',
                destinatarios,
                'enviado',
                corpoFinal,
                JSON.stringify({ messageId: info.messageId }),
                'sistema'
            ]);
        } catch (regError) {
            console.error('Erro ao registrar envio:', regError.message);
        }

        // Atualizar ou criar registro de pagamento com data de envio Email
        const valorFaturaEmail = fatura.dados_leitura?.valor_concessionaria || valorFatura || 0;

        // Converter data de vencimento de DD/MM/YY para YYYY-MM-DD
        let vencimentoEmail = fatura.dados_leitura?.vencimento || vencimento || null;
        if (vencimentoEmail && typeof vencimentoEmail === 'string') {
            // Se formato DD/MM/YY (ex: 25/01/26)
            const matchYY = vencimentoEmail.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
            if (matchYY) {
                const [, dia, mes, ano] = matchYY;
                const anoCompleto = parseInt(ano) < 50 ? `20${ano}` : `19${ano}`;
                vencimentoEmail = `${anoCompleto}-${mes}-${dia}`;
            }
            // Se formato DD/MM/YYYY (ex: 25/01/2026)
            const matchYYYY = vencimentoEmail.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (matchYYYY) {
                const [, dia, mes, ano] = matchYYYY;
                vencimentoEmail = `${ano}-${mes}-${dia}`;
            }
        }
        if (!vencimentoEmail) {
            vencimentoEmail = new Date().toISOString().split('T')[0];
        }

        await poolFaturas.query(`
            INSERT INTO pagamentos_concessionaria (uc, mes_referencia, fatura_id, valor_fatura, data_vencimento_fatura, data_envio_email, status)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, 'pendente')
            ON CONFLICT (uc, mes_referencia) DO UPDATE SET
                data_envio_email = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
        `, [ucFatura, mesRef, fatura.id, valorFaturaEmail, vencimentoEmail]);

        console.log(`✅ Fatura EQTL enviada com sucesso para ${email}`);

        res.json({
            success: true,
            message: 'Fatura enviada com sucesso via Email',
            destinatario: email,
            messageId: info.messageId
        });

    } catch (error) {
        console.error('❌ Erro ao enviar fatura por Email:', error.message);
        res.status(500).json({
            error: 'Erro ao enviar fatura por Email',
            message: error.message,
            details: error.response?.data
        });
    }
});

// GET /api/pagamentos-concessionaria/exportar/:mes - Exportar para Excel formatado
app.get('/api/pagamentos-concessionaria/exportar/:mes', async (req, res) => {
    try {
        const mes_referencia = decodeURIComponent(req.params.mes);
        console.log(`📥 [Pagamentos EQTL] Exportando Excel para ${mes_referencia}`);

        // Buscar dados de pagamentos (mesma query do endpoint GET /api/pagamentos-concessionaria)
        let query = `
            SELECT DISTINCT ON (f.uc)
                   f.id as fatura_id,
                   f.uc,
                   f.mes_referencia,
                   f.dados_leitura->>'valor_concessionaria' as valor_fatura,
                   f.dados_leitura->>'vencimento' as data_vencimento_fatura,
                   f.dados_leitura->>'codigo_barras' as codigo_barras,
                   f.dados_leitura->>'codigo_pix' as pix_copia_cola,
                   f.status as status_fatura,
                   pc.id as pagamento_id,
                   COALESCE(pc.status, 'pendente') as status,
                   pc.data_pagamento,
                   pc.numero_requisicao,
                   pc.tipo_pagamento,
                   pc.data_envio_whatsapp,
                   pc.data_envio_email,
                   COALESCE(pc.status_forcado, false) as status_forcado,
                   COALESCE((f.tags->>'nome_diferente')::boolean, false) as nome_diferente
            FROM faturas_baixadas f
            LEFT JOIN pagamentos_concessionaria pc ON f.uc = pc.uc AND f.mes_referencia = pc.mes_referencia
            WHERE f.status IN ('processado', 'pendente', 'baixado')
              AND f.dados_leitura->>'valor_concessionaria' IS NOT NULL
              AND f.mes_referencia = $1
            ORDER BY f.uc,
                     (f.dados_leitura->>'valor_concessionaria' IS NOT NULL)::int DESC,
                     (f.dados_leitura->>'codigo_pix' IS NOT NULL)::int DESC,
                     f.id DESC
        `;

        const result = await poolFaturas.query(query, [mes_referencia]);

        // Buscar nomes dos clientes no CRM
        if (result.rows.length > 0) {
            const ucs = result.rows.map(r => r.uc);
            try {
                const crmResult = await poolCRM_Pagamentos.query(`
                    SELECT
                        uc.numero_unidade::text as uc,
                        CASE
                            WHEN uc.gerador = true THEN uc.nome_usina
                            ELSE cc.nome_cliente
                        END as nome_cliente,
                        uc.gerador as is_ug
                    FROM unidades_consumidoras uc
                    LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                    WHERE uc.numero_unidade::text = ANY($1)
                `, [ucs]);

                const ucInfoMap = {};
                crmResult.rows.forEach(r => {
                    ucInfoMap[r.uc] = { nome_cliente: r.nome_cliente, is_ug: r.is_ug };
                });

                result.rows.forEach(r => {
                    const info = ucInfoMap[r.uc] || {};
                    r.nome_cliente = info.nome_cliente || null;
                    r.is_ug = info.is_ug || false;
                });
            } catch (crmError) {
                console.error('⚠️ Erro ao buscar nomes do CRM:', crmError.message);
            }
        }

        // Separar em duas listas: Lote e Enviar ao Cliente
        const dadosLote = result.rows.filter(pag => !pag.nome_diferente && !pag.is_ug);
        const dadosEnviar = result.rows.filter(pag => pag.nome_diferente && !pag.is_ug);
        const dadosUGs = result.rows.filter(pag => pag.is_ug);

        // Gerar Excel usando exceljs
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AUPUS Sistema';
        workbook.created = new Date();

        // Estilo do cabeçalho
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF198754' } }, // Verde
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        // Função para criar uma aba formatada
        const criarAba = (nome, dados, corHeader) => {
            if (dados.length === 0) return;

            const ws = workbook.addWorksheet(nome);

            // Definir colunas
            ws.columns = [
                { header: 'UC', key: 'uc', width: 15 },
                { header: 'Cliente', key: 'cliente', width: 35 },
                { header: 'Valor EQTL', key: 'valor', width: 15 },
                { header: 'Vencimento', key: 'vencimento', width: 14 },
                { header: 'Status', key: 'status', width: 20 },
                { header: 'Código Barras', key: 'codigo_barras', width: 18 },
                { header: 'PIX', key: 'pix', width: 12 },
                { header: 'Env. WhatsApp', key: 'whatsapp', width: 15 },
                { header: 'Env. Email', key: 'email', width: 12 },
                { header: 'Config Forçada', key: 'forcado', width: 15 }
            ];

            // Estilizar cabeçalho
            const headerRow = ws.getRow(1);
            headerRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corHeader } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = headerStyle.border;
            });
            headerRow.height = 22;

            // Adicionar dados
            dados.forEach(pag => {
                ws.addRow({
                    uc: pag.uc,
                    cliente: pag.nome_cliente || '-',
                    valor: pag.valor_fatura ? `R$ ${Number(pag.valor_fatura).toFixed(2).replace('.', ',')}` : '-',
                    vencimento: pag.data_vencimento_fatura || '-',
                    status: pag.status || 'pendente',
                    codigo_barras: pag.codigo_barras ? 'Sim' : 'Não',
                    pix: pag.pix_copia_cola ? 'Sim' : 'Não',
                    whatsapp: pag.data_envio_whatsapp ? 'Sim' : 'Não',
                    email: pag.data_envio_email ? 'Sim' : 'Não',
                    forcado: pag.status_forcado ? 'Sim' : 'Não'
                });
            });

            // Bordas nas células de dados
            ws.eachRow((row, rowNumber) => {
                if (rowNumber > 1) {
                    row.eachCell((cell) => {
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                            left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                            right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                        };
                    });
                }
            });

            // Adicionar filtros
            ws.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: 10 }
            };

            // Congelar primeira linha
            ws.views = [{ state: 'frozen', ySplit: 1 }];
        };

        // Criar abas
        criarAba('Pagamento em Lote', dadosLote, 'FF198754'); // Verde
        criarAba('Enviar ao Cliente', dadosEnviar, 'FF0D6EFD'); // Azul
        if (dadosUGs.length > 0) {
            criarAba('UGs Geradoras', dadosUGs, 'FFFFC107'); // Amarelo
        }

        // Gerar buffer
        const buffer = await workbook.xlsx.writeBuffer();

        const mesFormatado = mes_referencia.replace('/', '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=EQTL_Pagamentos_${mesFormatado}.xlsx`);
        res.send(buffer);

        console.log(`✅ [Pagamentos EQTL] Excel exportado: ${dadosLote.length} lote, ${dadosEnviar.length} enviar, ${dadosUGs.length} UGs`);

    } catch (error) {
        console.error('❌ [Pagamentos EQTL] Erro ao exportar:', error);
        res.status(500).json({ erro: error.message });
    }
});

// ========================================
// 🔔 WEBHOOKS DO BANCO DO BRASIL
// ========================================

// POST /webhook/pagamentos-lote - Webhook de Pagamentos em Lote (recebe notificação de pagamento efetuado)
app.post('/webhook/pagamentos-lote', async (req, res) => {
    try {
        const pagamentos = req.body;

        console.log('\n🔔 [WEBHOOK PAGAMENTOS] Recebido notificação do BB');
        console.log(`   📦 Payload: ${JSON.stringify(pagamentos).substring(0, 500)}...`);

        if (!Array.isArray(pagamentos)) {
            console.warn('   ⚠️ Payload não é um array');
            return res.status(200).json({ success: true, message: 'Payload recebido' });
        }

        let atualizados = 0;
        let naoEncontrados = 0;

        for (const pag of pagamentos) {
            try {
                // Campos do webhook:
                // numeroRequisicaoPagamento, codigoIdentificadorPagamento, dataPagamento,
                // valorPagamento, codigoTextoEstado (1=Pago, 2=Não pago), textoEstado

                const numeroRequisicao = pag.numeroRequisicaoPagamento;
                const idPagamentoBB = pag.codigoIdentificadorPagamento;
                const estadoPago = pag.codigoTextoEstado === 1;
                const novoStatus = estadoPago ? 'pago' : 'nao_pago';

                console.log(`   💰 Pagamento ${idPagamentoBB}: ${pag.textoEstado} - R$ ${pag.valorPagamento}`);

                // Buscar pagamento local pelo numero_requisicao ou id_pagamento_bb
                const result = await poolFaturas.query(`
                    UPDATE pagamentos_concessionaria
                    SET status = $1,
                        id_pagamento_bb = COALESCE(id_pagamento_bb, $2),
                        data_pagamento = $3,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE numero_requisicao = $4 OR id_pagamento_bb = $2
                    RETURNING id, uc, mes_referencia
                `, [novoStatus, idPagamentoBB, pag.dataPagamento, numeroRequisicao]);

                if (result.rows.length > 0) {
                    console.log(`   ✅ Atualizado: UC ${result.rows[0].uc} - ${result.rows[0].mes_referencia}`);
                    atualizados++;
                } else {
                    console.log(`   ⚠️ Pagamento não encontrado: Req ${numeroRequisicao}`);
                    naoEncontrados++;
                }

            } catch (err) {
                console.error(`   ❌ Erro processando pagamento: ${err.message}`);
            }
        }

        console.log(`✅ [WEBHOOK PAGAMENTOS] Concluído: ${atualizados} atualizados, ${naoEncontrados} não encontrados`);

        // Sempre retornar 200 para o BB não reenviar
        res.status(200).json({
            success: true,
            processados: pagamentos.length,
            atualizados,
            naoEncontrados
        });

    } catch (error) {
        console.error('❌ [WEBHOOK PAGAMENTOS] Erro:', error);
        // Retornar 200 mesmo com erro para evitar reenvios infinitos
        res.status(200).json({ success: false, error: error.message });
    }
});

// POST /webhook/cobrancas - Webhook de Cobranças (recebe notificação de boleto pago/baixado)
app.post('/webhook/cobrancas', async (req, res) => {
    try {
        const boleto = req.body;

        console.log('\n🔔 [WEBHOOK COBRANCAS] Recebido notificação do BB');
        console.log(`   📦 Boleto ID: ${boleto.id}`);
        console.log(`   💰 Valor pago: ${boleto.valorPagoSacado}`);
        console.log(`   📅 Data liquidação: ${boleto.dataLiquidacao}`);
        console.log(`   🏦 Estado: ${boleto.codigoEstadoBaixaOperacional}`);

        // Campos do webhook de cobranças:
        // id (nosso número 20 dígitos), dataVencimento, valorOriginal, valorPagoSacado,
        // dataLiquidacao, codigoEstadoBaixaOperacional (1=Baixa BB, 2=Baixa outro banco, 10=Cancelamento)
        // canalLiquidacao (1=Agência, 3=Internet, 4=PIX, etc)

        const nossoNumero = boleto.id;
        const valorPago = boleto.valorPagoSacado;
        const dataLiquidacao = boleto.dataLiquidacao;
        const estadoBaixa = boleto.codigoEstadoBaixaOperacional;

        // Determinar novo status baseado no código de estado
        let novoStatus;
        switch (estadoBaixa) {
            case 1:
            case 2:
                novoStatus = 6; // Liquidado
                break;
            case 10:
                novoStatus = 7; // Baixado/Cancelado
                break;
            default:
                novoStatus = estadoBaixa;
        }

        // Atualizar boleto_energia pelo numero_boleto
        const result = await poolFaturas.query(`
            UPDATE boletos_energia
            SET status_bb = $1,
                valor_pago = $2,
                data_pagamento = $3,
                canal_pagamento = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE numero_boleto = $5
            RETURNING id, uc, mes_referencia
        `, [novoStatus, valorPago, dataLiquidacao, boleto.canalLiquidacao, nossoNumero]);

        if (result.rows.length > 0) {
            console.log(`   ✅ Boleto atualizado: UC ${result.rows[0].uc} - ${result.rows[0].mes_referencia}`);
        } else {
            console.log(`   ⚠️ Boleto não encontrado: ${nossoNumero}`);
        }

        // Sempre retornar 200
        res.status(200).json({
            success: true,
            boleto_id: nossoNumero,
            atualizado: result.rows.length > 0
        });

    } catch (error) {
        console.error('❌ [WEBHOOK COBRANCAS] Erro:', error);
        res.status(200).json({ success: false, error: error.message });
    }
});

// GET /webhook/status - Verificar se webhooks estão ativos
app.get('/webhook/status', (req, res) => {
    res.json({
        status: 'online',
        webhooks: {
            pagamentos_lote: {
                url: '/webhook/pagamentos-lote',
                metodo: 'POST',
                descricao: 'Recebe notificação quando pagamento é efetuado'
            },
            cobrancas: {
                url: '/webhook/cobrancas',
                metodo: 'POST',
                descricao: 'Recebe notificação quando boleto é pago/baixado'
            }
        },
        timestamp: new Date().toISOString()
    });
});

// ========================================
// ⏰ SERVIÇO DE VERIFICAÇÃO DE BOLETOS VENCIDOS E COBRANÇA AUTOMÁTICA
// ========================================
// VERIFICAÇÃO DE VENCIDOS: Roda SEMPRE às 3h da manhã (infalível)
// COBRANÇA AUTOMÁTICA: Roda às 12:30 e 18:30 (apenas se ativada)
// ========================================
// Regras da cobrança:
// - Não envia em fim de semana (sábado/domingo)
// - Mínimo 2 dias entre cobranças (não envia dois dias seguidos)
// - Alterna entre período tarde (12:30) e noite (18:30)
// - Envia por WhatsApp e Email (se preenchidos no CRM - faturamento)
// ========================================

// ⚙️ CONFIGURAÇÃO: Ativar/Desativar sistema de cobrança automática
// Para desativar: usar endpoint POST /api/boletos-energia/cobranca/desativar
// Ou definir COBRANCA_AUTOMATICA=false no .env
let COBRANCA_AUTOMATICA_ATIVA = process.env.COBRANCA_AUTOMATICA !== 'false'; // Ativo por padrão

// ⚙️ MODO SIMULAÇÃO: Gera Excel com lista dos que cobraria ao invés de cobrar
// Para ativar: POST /api/boletos-energia/cobranca/modo-simulacao/ativar
// Para desativar e voltar a cobrar: POST /api/boletos-energia/cobranca/modo-simulacao/desativar
// ALTERADO 03/02/2026: Modo simulação ATIVADO por padrão até nova instrução
let MODO_SIMULACAO_COBRANCA = process.env.COBRANCA_MODO_SIMULACAO !== 'false'; // ATIVADO por padrão

// Diretório para salvar relatórios de simulação
const DIRETORIO_RELATORIOS_COBRANCA = '/var/www/api-bb/relatorios-cobranca';

// Horários de execução (em horário de Brasília - UTC-3)
const HORA_VERIFICACAO_VENCIDOS = 3; // 3h da manhã Brasília - SEMPRE executa
const HORA_NOTIFICACAO_PROTESTO = 8; // 8h da manhã Brasília - notificações de protesto
const HORARIOS_COBRANCA = [
    { hora: 12, minuto: 30, periodo: 'tarde' },  // 12:30 Brasília
    { hora: 18, minuto: 30, periodo: 'noite' }   // 18:30 Brasília
];

// Função para obter data/hora atual em Brasília
function getDataBrasilia() {
    const agora = new Date();
    // Brasília é UTC-3, então subtraímos 3 horas do UTC
    const offsetBrasilia = -3 * 60; // -180 minutos
    const offsetLocal = agora.getTimezoneOffset(); // offset do servidor em minutos
    const diffMinutos = offsetBrasilia - offsetLocal;
    return new Date(agora.getTime() + diffMinutos * 60 * 1000);
}

// Função para criar uma data em horário de Brasília e converter para UTC do servidor
function criarDataBrasilia(hora, minuto = 0) {
    const agora = new Date();
    const brasilia = getDataBrasilia();

    // Criar data alvo em "horário de Brasília"
    const alvo = new Date(brasilia);
    alvo.setHours(hora, minuto, 0, 0);

    // Se já passou, vai para amanhã
    if (brasilia >= alvo) {
        alvo.setDate(alvo.getDate() + 1);
    }

    // Calcular a diferença e aplicar ao horário UTC
    const diffMs = alvo.getTime() - brasilia.getTime();
    return new Date(agora.getTime() + diffMs);
}

// Configurações Evolution API (já existentes no sistema)
const EVOLUTION_CONFIG = {
    url: 'https://evolution.aupusenergia.com.br',
    apiKey: 'B6D711FCDE4D4FD5936544120E713976',
    instance: 'aupus-instance'
};

// Pool CRM para cobranças
const poolCRM_Cobrancas = new (require('pg').Pool)({
    host: '92.113.38.164',
    port: 5432,
    database: 'aupus_prod',
    user: 'aupus_prod',
    password: process.env.CRM_DB_PASSWORD || 'AupusProd2024Hashtag'
});

// Função para verificar se é fim de semana (horário Brasília)
function ehFimDeSemana() {
    const brasilia = getDataBrasilia();
    const diaSemana = brasilia.getDay(); // 0 = domingo, 6 = sábado
    return diaSemana === 0 || diaSemana === 6;
}

// Função para calcular milissegundos até próxima verificação às 3h (horário Brasília)
function calcularTempoAteVerificacao3h() {
    const agora = new Date();
    const proximaExecucao = criarDataBrasilia(HORA_VERIFICACAO_VENCIDOS, 0);

    return {
        ms: proximaExecucao.getTime() - agora.getTime(),
        data: proximaExecucao,
        horarioBrasilia: `${HORA_VERIFICACAO_VENCIDOS}:00`
    };
}

/// Função para calcular milissegundos até próxima notificação de protesto às 8h (horário Brasília)
function calcularTempoAteNotificacaoProtesto() {
    const agora = new Date();
    const proximaExecucao = criarDataBrasilia(HORA_NOTIFICACAO_PROTESTO, 0);

    return {
        ms: proximaExecucao.getTime() - agora.getTime(),
        data: proximaExecucao,
        horarioBrasilia: `${HORA_NOTIFICACAO_PROTESTO}:00`
    };
}

// Função para calcular milissegundos até a próxima cobrança (12:30 ou 18:30 horário Brasília)
function calcularTempoAteProximaCobranca() {
    const agora = new Date();
    const brasilia = getDataBrasilia();
    let proximaExecucao = null;
    let periodoEscolhido = null;

    // Verificar cada horário de hoje (em horário de Brasília)
    for (const horario of HORARIOS_COBRANCA) {
        const candidatoBrasilia = new Date(brasilia);
        candidatoBrasilia.setHours(horario.hora, horario.minuto, 0, 0);

        if (candidatoBrasilia > brasilia) {
            if (!proximaExecucao || candidatoBrasilia < proximaExecucao) {
                proximaExecucao = candidatoBrasilia;
                periodoEscolhido = horario.periodo;
            }
        }
    }

    // Se não tem mais horário hoje, pegar o primeiro de amanhã
    if (!proximaExecucao) {
        proximaExecucao = new Date(brasilia);
        proximaExecucao.setDate(proximaExecucao.getDate() + 1);
        proximaExecucao.setHours(HORARIOS_COBRANCA[0].hora, HORARIOS_COBRANCA[0].minuto, 0, 0);
        periodoEscolhido = HORARIOS_COBRANCA[0].periodo;
    }

    // Calcular a diferença e converter para UTC do servidor
    const diffMs = proximaExecucao.getTime() - brasilia.getTime();
    const execucaoUTC = new Date(agora.getTime() + diffMs);

    return {
        ms: diffMs,
        data: execucaoUTC,
        periodo: periodoEscolhido,
        horarioBrasilia: `${proximaExecucao.getHours()}:${String(proximaExecucao.getMinutes()).padStart(2, '0')}`
    };
}

// Função para buscar contatos do CRM (faturamento)
async function buscarContatosCRM(uc) {
    try {
        const query = `
            SELECT
                uc.numero_unidade as uc,
                uc.whatsapp_faturamento,
                uc.email_faturamento_1,
                uc.email_faturamento_2,
                cc.whatsapp as whatsapp_cc,
                cc.email as email_cc,
                COALESCE(uc.nome_faturamento, cc.nome_cliente) as nome_cliente
            FROM unidades_consumidoras uc
            LEFT JOIN controle_clube cc ON cc.uc_id = uc.id
            WHERE uc.numero_unidade = $1
        `;
        const result = await poolCRM_Cobrancas.query(query, [uc]);

        if (result.rows.length === 0) {
            return null;
        }

        const dados = result.rows[0];
        return {
            nome: dados.nome_cliente || '',
            // Prioriza whatsapp_faturamento
            whatsapp: dados.whatsapp_faturamento || dados.whatsapp_cc || '',
            // Prioriza email_faturamento_1
            email: dados.email_faturamento_1 || dados.email_faturamento_2 || dados.email_cc || ''
        };
    } catch (error) {
        console.error(`❌ Erro ao buscar contatos CRM para UC ${uc}:`, error.message);
        return null;
    }
}

// Função para verificar se deve enviar cobrança para um boleto
async function deveEnviarCobranca(boletoId, periodoAtual) {
    try {
        // Buscar última cobrança enviada para este boleto
        const query = `
            SELECT
                data_envio,
                periodo
            FROM cobrancas_enviadas
            WHERE boleto_id = $1
            ORDER BY data_envio DESC
            LIMIT 1
        `;
        const result = await pool.query(query, [boletoId]);

        if (result.rows.length === 0) {
            // Nunca foi enviada cobrança, pode enviar
            return { enviar: true, motivo: 'primeira_cobranca' };
        }

        const ultimaCobranca = result.rows[0];
        const dataUltimaCobranca = new Date(ultimaCobranca.data_envio);
        const hoje = new Date();

        // Calcular diferença em dias
        const diffTime = hoje.getTime() - dataUltimaCobranca.getTime();
        const diffDias = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // Regra: mínimo 2 dias entre cobranças (não enviar dois dias seguidos)
        if (diffDias < 2) {
            return { enviar: false, motivo: `aguardando_intervalo (${diffDias} dias desde última)` };
        }

        // Regra: alternar períodos (se última foi tarde, próxima deve ser noite e vice-versa)
        if (ultimaCobranca.periodo === periodoAtual && diffDias === 2) {
            // Se são exatamente 2 dias e mesmo período, ok enviar
            return { enviar: true, motivo: 'intervalo_ok_mesmo_periodo' };
        }

        // Se passou mais de 2 dias ou período diferente, pode enviar
        return { enviar: true, motivo: `intervalo_ok (${diffDias} dias)` };

    } catch (error) {
        console.error(`❌ Erro ao verificar se deve enviar cobrança:`, error.message);
        return { enviar: false, motivo: `erro: ${error.message}` };
    }
}

// Função para verificar status do boleto na API do BB antes de cobrar
// Retorna: { deveCobrar: true/false, novoStatus: string|null, motivo: string }
async function verificarStatusBoletoBB(numeroBoleto) {
    try {
        if (!numeroBoleto) {
            return { deveCobrar: true, novoStatus: null, motivo: 'sem_numero_boleto' };
        }

        // Obter token OAuth
        const tokenResult = await obterTokenBB();
        if (!tokenResult.success) {
            console.log(`   ⚠️ Não foi possível verificar status no BB (token): ${tokenResult.error}`);
            return { deveCobrar: true, novoStatus: null, motivo: 'erro_token' };
        }

        // Consultar status na API do BB
        const endpoint = `/cobrancas/v2/boletos/${numeroBoleto}?numeroConvenio=3648981`;

        return new Promise((resolve) => {
            const separator = endpoint.includes('?') ? '&' : '?';
            const fullPath = endpoint + separator + 'gw-dev-app-key=549827f7531a4cdd880437df70bf3d86';

            const options = {
                hostname: 'api.bb.com.br',
                port: 443,
                path: fullPath,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${tokenResult.token}`,
                    'Content-Type': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const dadosBB = JSON.parse(data);
                            const estadoNum = parseInt(dadosBB.codigoEstadoTituloCobranca);
                            const estadoStr = String(dadosBB.codigoEstadoTituloCobranca).toUpperCase();

                            // BAIXADO (7) - Boleto cancelado/baixado (pode ter sido pago e baixado)
                            if (estadoNum === 7 || estadoStr === 'BAIXADO' || estadoStr === 'BAIXADO_AUTOMATICAMENTE') {
                                console.log(`   🔄 Boleto ${numeroBoleto} está BAIXADO no BB - atualizando para Cancelado`);
                                resolve({ deveCobrar: false, novoStatus: 'Cancelado', motivo: 'baixado_bb' });
                                return;
                            }

                            // LIQUIDADO (6, 10, 11, 12) - Boleto pago
                            if (estadoNum === 6 || estadoNum === 10 || estadoNum === 11 || estadoNum === 12 ||
                                estadoStr === 'LIQUIDADO' || estadoStr.includes('LIQUIDADO')) {
                                console.log(`   🔄 Boleto ${numeroBoleto} está LIQUIDADO no BB - atualizando para Pago`);
                                resolve({ deveCobrar: false, novoStatus: 'Pago', motivo: 'liquidado_bb' });
                                return;
                            }

                            // NORMAL (1) ou Em Aberto - continua devendo
                            if (estadoNum === 1 || estadoStr === 'NORMAL' || estadoStr === 'EM ABERTO') {
                                resolve({ deveCobrar: true, novoStatus: null, motivo: 'em_aberto_bb' });
                                return;
                            }

                            // Outros estados - por segurança, não cobrar
                            console.log(`   ⚠️ Boleto ${numeroBoleto} com status desconhecido no BB: ${dadosBB.codigoEstadoTituloCobranca}`);
                            resolve({ deveCobrar: true, novoStatus: null, motivo: `status_bb_${estadoNum}` });

                        } else if (res.statusCode === 404) {
                            // Boleto não encontrado no BB - não cobrar
                            console.log(`   ⚠️ Boleto ${numeroBoleto} não encontrado na API do BB`);
                            resolve({ deveCobrar: false, novoStatus: 'Cancelado', motivo: 'nao_encontrado_bb' });
                        } else {
                            // Erro na API - por segurança, permite cobrar
                            console.log(`   ⚠️ Erro ${res.statusCode} ao consultar boleto ${numeroBoleto} no BB`);
                            resolve({ deveCobrar: true, novoStatus: null, motivo: `erro_api_${res.statusCode}` });
                        }
                    } catch (e) {
                        console.log(`   ⚠️ Erro ao parsear resposta do BB: ${e.message}`);
                        resolve({ deveCobrar: true, novoStatus: null, motivo: 'erro_parse' });
                    }
                });
            });

            req.on('error', (e) => {
                console.log(`   ⚠️ Erro de conexão com API BB: ${e.message}`);
                resolve({ deveCobrar: true, novoStatus: null, motivo: 'erro_conexao' });
            });

            req.setTimeout(10000, () => {
                req.destroy();
                console.log(`   ⚠️ Timeout ao consultar boleto ${numeroBoleto} no BB`);
                resolve({ deveCobrar: true, novoStatus: null, motivo: 'timeout' });
            });

            req.end();
        });

    } catch (error) {
        console.error(`   ❌ Erro ao verificar status no BB:`, error.message);
        return { deveCobrar: true, novoStatus: null, motivo: `erro: ${error.message}` };
    }
}

// Função para limpar número de WhatsApp
function limparWhatsApp(numero) {
    if (!numero) return '';
    // Remove tudo que não é número
    return numero.replace(/\D/g, '');
}

// Função para buscar caminho do boleto PDF
async function buscarCaminhoBoleto(uc, mesReferencia) {
    try {
        // Formatar mês para busca (ex: "12/2025" -> "12.2025")
        const mesFormatado = mesReferencia.replace('/', '.');
        const [mes, ano] = mesReferencia.split('/');

        // Pastas onde os boletos podem estar
        const pastas = [
            `/var/www/aupus-microservicos-faturas/dados/processados/NET Completo/${ano}/${mesFormatado}`,
            `/var/www/aupus-microservicos-faturas/dados/processados/NET/${ano}/${mesFormatado}`
        ];

        for (const pastaBase of pastas) {
            if (fs.existsSync(pastaBase)) {
                const arquivos = fs.readdirSync(pastaBase);

                // Buscar por UC no nome do arquivo (boleto)
                const arquivoBoleto = arquivos.find(arq =>
                    arq.includes(uc.toString()) &&
                    arq.toLowerCase().includes('boleto') &&
                    arq.toLowerCase().endsWith('.pdf')
                );

                if (arquivoBoleto) {
                    const pasta = pastaBase.includes('NET Completo') ? 'NET Completo' : 'NET';
                    return {
                        caminho: path.join(pastaBase, arquivoBoleto),
                        nomeArquivo: arquivoBoleto,
                        pasta: pasta
                    };
                }
            }
        }

        return null;
    } catch (error) {
        console.error(`❌ Erro ao buscar boleto PDF:`, error.message);
        return null;
    }
}

// Função para gerar link de download do boleto
function gerarLinkBoleto(mesReferencia, nomeArquivo, pasta = 'NET Completo') {
    const baseUrl = 'https://api-bb.aupusenergia.com.br';
    const mesFormatado = mesReferencia.replace('/', '.');
    const params = new URLSearchParams({
        pasta: pasta,
        mes_referencia: mesFormatado,
        arquivo: nomeArquivo
    });
    return `${baseUrl}/api/sistema-faturas/download?${params.toString()}`;
}

// Função para registrar cobrança enviada
async function registrarCobrancaEnviada(dados) {
    try {
        const query = `
            INSERT INTO cobrancas_enviadas
            (boleto_id, uc, mes_referencia, periodo, enviado_whatsapp, enviado_email,
             whatsapp_destino, email_destino, valor_boleto, mensagem)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `;
        await pool.query(query, [
            dados.boleto_id,
            dados.uc,
            dados.mes_referencia,
            dados.periodo,
            dados.enviado_whatsapp,
            dados.enviado_email,
            dados.whatsapp_destino,
            dados.email_destino,
            dados.valor_boleto,
            dados.mensagem
        ]);
    } catch (error) {
        console.error('❌ Erro ao registrar cobrança:', error.message);
    }
}

// Função para gerar relatório Excel de simulação de cobrança
async function gerarRelatorioSimulacaoCobranca(boletosParaCobrar, periodo) {
    try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Cobranças Simuladas');

        // Definir colunas
        worksheet.columns = [
            { header: 'UC', key: 'uc', width: 15 },
            { header: 'Nome Cliente', key: 'nome', width: 35 },
            { header: 'Mês Referência', key: 'mes_referencia', width: 15 },
            { header: 'Data Vencimento', key: 'data_vencimento', width: 15 },
            { header: 'Valor Boleto', key: 'valor_boleto', width: 15 },
            { header: 'WhatsApp', key: 'whatsapp', width: 20 },
            { header: 'Email', key: 'email', width: 35 },
            { header: 'Status BB', key: 'status_bb', width: 20 },
            { header: 'Motivo', key: 'motivo', width: 30 }
        ];

        // Estilizar cabeçalho
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Adicionar dados
        boletosParaCobrar.forEach(boleto => {
            worksheet.addRow({
                uc: boleto.uc,
                nome: boleto.nome || boleto.nome_completo || '-',
                mes_referencia: boleto.mes_referencia,
                data_vencimento: boleto.data_vencimento,
                valor_boleto: boleto.valor_boleto ? `R$ ${parseFloat(boleto.valor_boleto).toFixed(2)}` : '-',
                whatsapp: boleto.whatsapp || '-',
                email: boleto.email || '-',
                status_bb: boleto.status_bb || '-',
                motivo: boleto.motivo || 'Elegível para cobrança'
            });
        });

        // Formatar coluna de valor
        worksheet.getColumn('valor_boleto').alignment = { horizontal: 'right' };

        // Gerar nome do arquivo com timestamp
        const agora = getDataBrasilia();
        const timestamp = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}h${String(agora.getMinutes()).padStart(2, '0')}`;
        const nomeArquivo = `cobranca_simulada_${periodo}_${timestamp}.xlsx`;
        const caminhoCompleto = path.join(DIRETORIO_RELATORIOS_COBRANCA, nomeArquivo);

        // Garantir que o diretório existe
        if (!fs.existsSync(DIRETORIO_RELATORIOS_COBRANCA)) {
            fs.mkdirSync(DIRETORIO_RELATORIOS_COBRANCA, { recursive: true });
        }

        // Salvar arquivo
        await workbook.xlsx.writeFile(caminhoCompleto);

        console.log(`📊 [SIMULAÇÃO] Relatório salvo: ${caminhoCompleto}`);
        console.log(`   📋 Total de boletos que seriam cobrados: ${boletosParaCobrar.length}`);

        return {
            sucesso: true,
            arquivo: nomeArquivo,
            caminho: caminhoCompleto,
            totalBoletos: boletosParaCobrar.length
        };
    } catch (error) {
        console.error('❌ Erro ao gerar relatório de simulação:', error.message);
        return { sucesso: false, erro: error.message };
    }
}

// Função para enviar cobrança por email (com boleto em anexo)
async function enviarCobrancaEmail(email, dados) {
    try {
        // Verificar se SMTP está configurado
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.log('   ⚠️ Email não configurado (SMTP_USER/SMTP_PASS)');
            return false;
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        // Buscar boleto PDF para anexar
        const boletoPDF = await buscarCaminhoBoleto(dados.uc, dados.mes_referencia);
        let linkBoleto = '';
        let attachments = [];

        if (boletoPDF && fs.existsSync(boletoPDF.caminho)) {
            linkBoleto = gerarLinkBoleto(dados.mes_referencia, boletoPDF.nomeArquivo, boletoPDF.pasta);
            attachments.push({
                filename: boletoPDF.nomeArquivo,
                path: boletoPDF.caminho
            });
            console.log(`   📎 Boleto anexado: ${boletoPDF.nomeArquivo}`);
        }

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #f59e0b;">⚡ Aupus Energia</h2>
                <p>Olá <strong>${dados.nome}</strong>,</p>
                <p>Identificamos que seu boleto de energia está <strong style="color: #dc2626;">vencido</strong>.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>UC:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${dados.uc}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Referência:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${dados.mes_referencia}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Vencimento:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${dados.data_vencimento}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Valor:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; color: #dc2626; font-weight: bold;">
                            R$ ${parseFloat(dados.valor_boleto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                    </tr>
                </table>
                ${linkBoleto ? `
                <p style="margin: 20px 0;">
                    <a href="${linkBoleto}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        📄 Baixar Boleto
                    </a>
                </p>
                ` : ''}
                <p>Por favor, regularize seu pagamento o mais breve possível para evitar juros e multas.</p>
                <p><strong>O boleto está em anexo neste email.</strong></p>
                <p>Em caso de dúvidas, entre em contato conosco.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #666; font-size: 12px;">
                    Aupus Energia<br>
                    Este é um email automático, favor não responder.
                </p>
            </div>
        `;

        await transporter.sendMail({
            from: process.env.SMTP_FROM || `"Aupus Energia" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `⚠️ Boleto Vencido - UC ${dados.uc} - Ref. ${dados.mes_referencia}`,
            html: html,
            attachments: attachments
        });

        return true;
    } catch (error) {
        console.error(`   ❌ Erro ao enviar email para ${email}:`, error.message);
        return false;
    }
}

// Função para enviar cobrança por WhatsApp (via ChatCenter API)
async function enviarCobrancaWhatsApp(whatsapp, dados) {
    try {
        const numero = limparWhatsApp(whatsapp);
        if (!numero || numero.length < 10) {
            console.log(`   ⚠️ Número WhatsApp inválido: ${whatsapp}`);
            return false;
        }

        // Formatar número para API (adicionar 55 se necessário)
        const numeroFormatado = numero.startsWith('55') ? numero : `55${numero}`;

        // Buscar link do boleto
        const boletoPDF = await buscarCaminhoBoleto(dados.uc, dados.mes_referencia);
        let linkBoleto = '';
        if (boletoPDF) {
            linkBoleto = gerarLinkBoleto(dados.mes_referencia, boletoPDF.nomeArquivo, boletoPDF.pasta);
        }

        const mensagem = `⚡ *Aupus Energia*

Olá *${dados.nome}*,

Identificamos que seu boleto de energia está *VENCIDO*.

📋 *Detalhes:*
• UC: ${dados.uc}
• Referência: ${dados.mes_referencia}
• Vencimento: ${dados.data_vencimento}
• Valor: *R$ ${parseFloat(dados.valor_boleto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}*
${linkBoleto ? `
📄 *Baixar Boleto:*
${linkBoleto}` : ''}

Por favor, regularize seu pagamento o mais breve possível.

Em caso de dúvidas, entre em contato conosco.`;

        // Usar ChatCenter API (mesma configuração do sistema de faturas)
        const chatcenterApiUrl = process.env.CHATCENTER_API_URL || 'https://api.multiweb.plus/send/chat/';
        const chatcenterApiKey = process.env.CHATCENTER_API_KEY || '684c757bdcb05b125e26b1c6';

        const response = await axios.post(chatcenterApiUrl, {
            key: chatcenterApiKey,
            numero: numeroFormatado,
            texto: mensagem
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        return response.status === 200 || response.status === 201;
    } catch (error) {
        console.error(`   ❌ Erro ao enviar WhatsApp para ${whatsapp}:`, error.message);
        return false;
    }
}

// ========================================
// SISTEMA DE NOTIFICAÇÃO DE PROTESTO (contagem regressiva 10 dias)
// Roda diariamente às 8h - envia WhatsApp e email avisando sobre protesto iminente
// ========================================
const DIAS_PROTESTO = 45; // dias após vencimento para protesto
const DIAS_INICIO_NOTIFICACAO = 10; // começa a notificar X dias antes do protesto

async function enviarNotificacaoProtestoWhatsApp(whatsapp, dados, diasRestantes, dataProtesto) {
    try {
        const numero = limparWhatsApp(whatsapp);
        if (!numero || numero.length < 10) {
            console.log(`   ⚠️ [PROTESTO] Número WhatsApp inválido: ${whatsapp}`);
            return false;
        }

        const numeroFormatado = numero.startsWith('55') ? numero : `55${numero}`;

        const mensagem = `⚡ *Aupus Energia - AVISO DE PROTESTO*

Olá *${dados.nome}*,

Seu boleto de energia está vencido e será *PROTESTADO em ${diasRestantes} dia${diasRestantes > 1 ? 's' : ''}*.

📋 *Detalhes:*
• UC: ${dados.uc}
• Referência: ${dados.mes_referencia}
• Vencimento: ${dados.data_vencimento}
• Valor: *R$ ${parseFloat(dados.valor_boleto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}*
• Data prevista de protesto: *${dataProtesto}*

⚠️ *O protesto pode resultar em restrição de crédito (SPC/Serasa).*

Regularize seu pagamento o mais breve possível para evitar o protesto.

Em caso de dúvidas, entre em contato conosco.`;

        const chatcenterApiUrl = process.env.CHATCENTER_API_URL || 'https://api.multiweb.plus/send/chat/';
        const chatcenterApiKey = process.env.CHATCENTER_API_KEY || '684c757bdcb05b125e26b1c6';

        const response = await axios.post(chatcenterApiUrl, {
            key: chatcenterApiKey,
            numero: numeroFormatado,
            texto: mensagem
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        return response.status === 200 || response.status === 201;
    } catch (error) {
        console.error(`   ❌ [PROTESTO] Erro WhatsApp para ${whatsapp}:`, error.message);
        return false;
    }
}

async function enviarNotificacaoProtestoEmail(email, dados, diasRestantes, dataProtesto) {
    try {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.log('   ⚠️ [PROTESTO] Email não configurado');
            return false;
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        const corUrgencia = diasRestantes <= 3 ? '#dc2626' : '#f59e0b';
        const textoUrgencia = diasRestantes <= 3 ? 'MUITO URGENTE' : 'URGENTE';

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: ${corUrgencia};">⚡ Aupus Energia - AVISO DE PROTESTO</h2>
                <div style="background-color: ${corUrgencia}; color: white; padding: 15px; border-radius: 8px; margin: 15px 0; text-align: center;">
                    <strong style="font-size: 18px;">⚠️ ${textoUrgencia}: Seu boleto será protestado em ${diasRestantes} dia${diasRestantes > 1 ? 's' : ''}!</strong>
                </div>
                <p>Olá <strong>${dados.nome}</strong>,</p>
                <p>Identificamos que seu boleto de energia está <strong style="color: #dc2626;">vencido</strong> e será encaminhado para <strong>protesto</strong> caso não seja regularizado.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>UC:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${dados.uc}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Referência:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${dados.mes_referencia}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Vencimento:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${dados.data_vencimento}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Valor:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; color: #dc2626; font-weight: bold;">
                            R$ ${parseFloat(dados.valor_boleto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Data prevista de protesto:</strong></td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee; color: #dc2626; font-weight: bold;">${dataProtesto}</td>
                    </tr>
                </table>
                <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 15px 0;">
                    <strong>⚠️ O protesto pode resultar em:</strong>
                    <ul style="margin: 8px 0;">
                        <li>Restrição de crédito (SPC/Serasa)</li>
                        <li>Custos adicionais de cartório</li>
                        <li>Dificuldade para obter crédito</li>
                    </ul>
                </div>
                <p><strong>Regularize seu pagamento o mais breve possível para evitar o protesto.</strong></p>
                <p>Em caso de dúvidas, entre em contato conosco.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #666; font-size: 12px;">
                    Aupus Energia<br>
                    Este é um email automático, favor não responder.
                </p>
            </div>
        `;

        await transporter.sendMail({
            from: process.env.SMTP_FROM || `"Aupus Energia" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `⚠️ ${textoUrgencia}: Boleto será protestado em ${diasRestantes} dia${diasRestantes > 1 ? 's' : ''} - UC ${dados.uc}`,
            html: html
        });

        return true;
    } catch (error) {
        console.error(`   ❌ [PROTESTO] Erro email para ${email}:`, error.message);
        return false;
    }
}

async function verificarEEnviarNotificacoesProtesto() {
    try {
        console.log('\n⏰ [PROTESTO 8h] Verificando boletos próximos de protesto...');

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const hojeISO = hoje.toISOString().split('T')[0];

        // Buscar boletos vencidos onde estamos na janela de 10 dias antes do protesto
        // Protesto = vencimento + 70 dias | Notificação começa vencimento + 60 dias
        const query = `
            SELECT id, uc, mes_referencia, data_vencimento, valor_boleto,
                   nome_completo, numero_boleto, notificacoes_protesto,
                   CASE
                       WHEN data_vencimento ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
                           TO_DATE(data_vencimento, 'DD/MM/YYYY')
                       WHEN data_vencimento ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$' THEN
                           TO_DATE(data_vencimento, 'DD.MM.YYYY')
                       WHEN data_vencimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                           data_vencimento::date
                   END as data_venc_parsed
            FROM boletos_energia
            WHERE status = 'Vencido'
            AND data_vencimento IS NOT NULL
            AND (
                CASE
                    WHEN data_vencimento ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
                        TO_DATE(data_vencimento, 'DD/MM/YYYY') + INTERVAL '${DIAS_PROTESTO - DIAS_INICIO_NOTIFICACAO} days' <= $1::date
                        AND TO_DATE(data_vencimento, 'DD/MM/YYYY') + INTERVAL '${DIAS_PROTESTO} days' > $1::date
                    WHEN data_vencimento ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$' THEN
                        TO_DATE(data_vencimento, 'DD.MM.YYYY') + INTERVAL '${DIAS_PROTESTO - DIAS_INICIO_NOTIFICACAO} days' <= $1::date
                        AND TO_DATE(data_vencimento, 'DD.MM.YYYY') + INTERVAL '${DIAS_PROTESTO} days' > $1::date
                    WHEN data_vencimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                        data_vencimento::date + INTERVAL '${DIAS_PROTESTO - DIAS_INICIO_NOTIFICACAO} days' <= $1::date
                        AND data_vencimento::date + INTERVAL '${DIAS_PROTESTO} days' > $1::date
                    ELSE false
                END
            )
            AND (
                CASE WHEN mes_referencia ~ '^[0-9]{2}/[0-9]{4}$' THEN
                    TO_DATE('01/' || mes_referencia, 'DD/MM/YYYY')
                ELSE NULL END
            ) >= '2025-11-01'::date
            ORDER BY data_vencimento ASC
        `;

        const result = await pool.query(query, [hojeISO]);
        console.log(`📋 [PROTESTO] ${result.rowCount} boleto(s) na janela de notificação de protesto`);

        if (result.rowCount === 0) {
            return { sucesso: true, total: 0, notificados: 0 };
        }

        // Conectar ao CRM para buscar contatos
        const { Pool } = require('pg');
        const crmPool = new Pool({
            host: '92.113.38.164',
            port: 5432,
            database: 'aupus_prod',
            user: 'aupus_prod',
            password: 'AupusProd2024Hashtag'
        });

        let notificados = 0;
        let erros = 0;

        for (const boleto of result.rows) {
            try {
                const dataVenc = boleto.data_venc_parsed;
                const dataProtestoDate = new Date(dataVenc);
                dataProtestoDate.setDate(dataProtestoDate.getDate() + DIAS_PROTESTO);

                const diffMs = dataProtestoDate.getTime() - hoje.getTime();
                const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

                if (diasRestantes < 1 || diasRestantes > DIAS_INICIO_NOTIFICACAO) continue;

                // Verificar se já notificou para este dia
                const notificacoes = boleto.notificacoes_protesto || {};
                if (notificacoes[diasRestantes.toString()]) {
                    console.log(`   ⏭️ UC ${boleto.uc} - dia ${diasRestantes}: já notificado em ${notificacoes[diasRestantes.toString()]}`);
                    continue;
                }

                // Buscar contato no CRM
                const contactQuery = `
                    SELECT
                        COALESCE(NULLIF(uc.nome_faturamento, ''), NULLIF(cc.nome_cliente, ''), '') as nome,
                        COALESCE(NULLIF(uc.whatsapp_faturamento, ''), NULLIF(cc.whatsapp, ''), '') as whatsapp,
                        COALESCE(NULLIF(uc.email_faturamento_1, ''), NULLIF(cc.email, ''), '') as email,
                        COALESCE(NULLIF(uc.email_faturamento_2, ''), '') as email_secundario
                    FROM controle_clube cc
                    JOIN unidades_consumidoras uc ON cc.uc_id = uc.id
                    WHERE uc.numero_unidade = $1
                      AND cc.deleted_at IS NULL
                    LIMIT 1
                `;
                const contactResult = await crmPool.query(contactQuery, [boleto.uc]);

                if (contactResult.rows.length === 0) {
                    console.log(`   ⚠️ UC ${boleto.uc}: sem dados de contato no CRM`);
                    continue;
                }

                const contato = contactResult.rows[0];
                const dataProtestoFormatada = dataProtestoDate.toLocaleDateString('pt-BR');

                const dadosEnvio = {
                    uc: boleto.uc,
                    nome: contato.nome || boleto.nome_completo || 'Cliente',
                    mes_referencia: boleto.mes_referencia,
                    data_vencimento: boleto.data_vencimento,
                    valor_boleto: boleto.valor_boleto
                };

                let enviouWhatsapp = false;
                let enviouEmail = false;

                // Enviar WhatsApp
                if (contato.whatsapp) {
                    enviouWhatsapp = await enviarNotificacaoProtestoWhatsApp(
                        contato.whatsapp, dadosEnvio, diasRestantes, dataProtestoFormatada
                    );
                    if (enviouWhatsapp) {
                        console.log(`   ✅ UC ${boleto.uc}: WhatsApp enviado (faltam ${diasRestantes} dias)`);
                    }
                }

                // Enviar Email (primário + secundário)
                if (contato.email) {
                    enviouEmail = await enviarNotificacaoProtestoEmail(
                        contato.email, dadosEnvio, diasRestantes, dataProtestoFormatada
                    );
                    if (enviouEmail) {
                        console.log(`   ✅ UC ${boleto.uc}: Email enviado para ${contato.email} (faltam ${diasRestantes} dias)`);
                    }
                    // Email secundário
                    if (contato.email_secundario) {
                        await enviarNotificacaoProtestoEmail(
                            contato.email_secundario, dadosEnvio, diasRestantes, dataProtestoFormatada
                        );
                    }
                }

                // Registrar notificação enviada
                if (enviouWhatsapp || enviouEmail) {
                    notificacoes[diasRestantes.toString()] = new Date().toISOString();
                    await pool.query(
                        `UPDATE boletos_energia SET notificacoes_protesto = $1, data_atualizacao = CURRENT_TIMESTAMP WHERE id = $2`,
                        [JSON.stringify(notificacoes), boleto.id]
                    );
                    notificados++;
                }

            } catch (err) {
                console.error(`   ❌ [PROTESTO] Erro processando UC ${boleto.uc}:`, err.message);
                erros++;
            }
        }

        await crmPool.end();

        console.log(`✅ [PROTESTO] Concluído: ${notificados} notificado(s), ${erros} erro(s)`);
        return { sucesso: true, total: result.rowCount, notificados, erros };

    } catch (error) {
        console.error('❌ [PROTESTO] Erro geral:', error.message);
        return { sucesso: false, erro: error.message };
    }
}

// Função APENAS para atualizar status de boletos vencidos (roda às 3h)
// FILTRO: Somente meses a partir de 11/2025 (ignora outubro/2025 e anteriores)
async function atualizarStatusBoletosVencidos() {
    try {
        console.log('\n⏰ [CRON 3h] Verificando boletos vencidos...');

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const hojeISO = hoje.toISOString().split('T')[0];

        const query = `
            UPDATE boletos_energia
            SET status = 'Vencido'
            WHERE status = 'Boleto gerado'
            AND data_vencimento IS NOT NULL
            AND (
                (data_vencimento ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
                 AND TO_DATE(data_vencimento, 'DD/MM/YYYY') < $1)
                OR
                (data_vencimento ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'
                 AND TO_DATE(data_vencimento, 'DD.MM.YYYY') < $1)
                OR
                (data_vencimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 AND data_vencimento::date < $1)
            )
            AND (
                CASE WHEN mes_referencia ~ '^[0-9]{2}/[0-9]{4}$' THEN
                    TO_DATE('01/' || mes_referencia, 'DD/MM/YYYY')
                ELSE NULL END
            ) >= '2025-11-01'::date
            RETURNING id, uc, mes_referencia, data_vencimento, numero_boleto
        `;

        const result = await pool.query(query, [hojeISO]);

        if (result.rowCount > 0) {
            console.log(`✅ [CRON 3h] ${result.rowCount} boleto(s) marcado(s) como vencido(s):`);
            result.rows.forEach(b => {
                console.log(`   - UC ${b.uc} | ${b.mes_referencia} | Venc: ${b.data_vencimento}`);
            });
        } else {
            console.log('✅ [CRON 3h] Nenhum novo boleto vencido encontrado.');
        }

        return { sucesso: true, boletosAtualizados: result.rowCount, detalhes: result.rows };
    } catch (error) {
        console.error('❌ [CRON 3h] Erro ao verificar boletos vencidos:', error.message);
        return { sucesso: false, erro: error.message };
    }
}

// Função principal: verificar vencidos E enviar cobranças (roda 12:30 e 18:30)
async function executarCobrancaAutomatica(periodoAtual = 'tarde') {
    try {
        console.log(`\n⏰ [COBRANÇA ${periodoAtual.toUpperCase()}] Iniciando processo de cobrança automática...`);

        // Verificar se cobrança está ativa
        if (!COBRANCA_AUTOMATICA_ATIVA) {
            console.log('⏸️ [COBRANÇA] Sistema de cobrança automática DESATIVADO.');
            return { sucesso: true, mensagem: 'Cobrança automática desativada' };
        }

        // Verificar se é fim de semana
        if (ehFimDeSemana()) {
            console.log('📅 [COBRANÇA] Fim de semana - cobranças suspensas.');
            return { sucesso: true, mensagem: 'Fim de semana - cobranças suspensas' };
        }

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const hojeISO = hoje.toISOString().split('T')[0];

        // 1. Primeiro, atualizar status dos boletos vencidos
        // FILTRO: Somente meses a partir de 11/2025 (ignora outubro/2025 e anteriores)
        const queryAtualizar = `
            UPDATE boletos_energia
            SET status = 'Vencido'
            WHERE status = 'Boleto gerado'
            AND data_vencimento IS NOT NULL
            AND (
                (data_vencimento ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
                 AND TO_DATE(data_vencimento, 'DD/MM/YYYY') < $1)
                OR
                (data_vencimento ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'
                 AND TO_DATE(data_vencimento, 'DD.MM.YYYY') < $1)
                OR
                (data_vencimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 AND data_vencimento::date < $1)
            )
            AND (
                CASE WHEN mes_referencia ~ '^[0-9]{2}/[0-9]{4}$' THEN
                    TO_DATE('01/' || mes_referencia, 'DD/MM/YYYY')
                ELSE NULL END
            ) >= '2025-11-01'::date
            RETURNING id, uc, mes_referencia, data_vencimento, numero_boleto
        `;

        const resultAtualizar = await pool.query(queryAtualizar, [hojeISO]);
        if (resultAtualizar.rowCount > 0) {
            console.log(`✅ [COBRANÇA] ${resultAtualizar.rowCount} boleto(s) marcado(s) como vencido(s)`);
        }

        // 2. Buscar todos os boletos vencidos para enviar cobrança
        // FILTRO: Somente meses a partir de 11/2025 (ignora outubro/2025 e anteriores)
        const queryVencidos = `
            SELECT
                id, uc, mes_referencia, data_vencimento, valor_boleto,
                nome_completo, numero_boleto
            FROM boletos_energia
            WHERE status = 'Vencido'
            AND (
                -- Converte mes_referencia (MM/YYYY) para comparação
                CASE
                    WHEN mes_referencia ~ '^[0-9]{2}/[0-9]{4}$' THEN
                        TO_DATE('01/' || mes_referencia, 'DD/MM/YYYY')
                    ELSE NULL
                END
            ) >= '2025-11-01'::date
            ORDER BY data_vencimento ASC
        `;

        const boletosVencidos = await pool.query(queryVencidos);
        console.log(`📋 [COBRANÇA] ${boletosVencidos.rowCount} boleto(s) vencido(s) encontrado(s)`);

        // ============================================
        // MODO SIMULAÇÃO: Gera Excel ao invés de cobrar
        // ============================================
        if (MODO_SIMULACAO_COBRANCA) {
            console.log(`\n🔬 [MODO SIMULAÇÃO] Coletando dados para relatório...`);

            const boletosParaRelatorio = [];

            for (const boleto of boletosVencidos.rows) {
                const verificacao = await deveEnviarCobranca(boleto.id, periodoAtual);

                if (!verificacao.enviar) {
                    continue; // Ignora boletos fora do intervalo
                }

                // Verificar status real no BB
                let statusBBInfo = { motivo: 'não verificado' };
                if (boleto.numero_boleto) {
                    const statusBB = await verificarStatusBoletoBB(boleto.numero_boleto);
                    statusBBInfo = statusBB;

                    // Se o boleto foi pago/baixado no BB, atualizar status local
                    if (!statusBB.deveCobrar && statusBB.novoStatus) {
                        await pool.query(
                            'UPDATE boletos_energia SET status = $1 WHERE id = $2',
                            [statusBB.novoStatus, boleto.id]
                        );
                        console.log(`   🔄 UC ${boleto.uc}: Status atualizado para ${statusBB.novoStatus}`);
                        continue; // Não inclui no relatório
                    }
                }

                // Buscar contatos do CRM
                const contatos = await buscarContatosCRM(boleto.uc);

                boletosParaRelatorio.push({
                    uc: boleto.uc,
                    nome: contatos?.nome || boleto.nome_completo || '-',
                    mes_referencia: boleto.mes_referencia,
                    data_vencimento: boleto.data_vencimento,
                    valor_boleto: boleto.valor_boleto,
                    whatsapp: contatos?.whatsapp || '-',
                    email: contatos?.email || '-',
                    status_bb: statusBBInfo.motivo,
                    motivo: verificacao.motivo
                });
            }

            // Gerar relatório Excel
            const relatorio = await gerarRelatorioSimulacaoCobranca(boletosParaRelatorio, periodoAtual);

            console.log(`\n📊 [SIMULAÇÃO] Resumo: ${boletosParaRelatorio.length} boletos que SERIAM cobrados`);
            console.log(`   📁 Arquivo: ${relatorio.caminho || 'erro ao gerar'}`);

            return {
                sucesso: true,
                modo: 'simulacao',
                boletosVencidos: boletosVencidos.rowCount,
                boletosQueSeriasCobrados: boletosParaRelatorio.length,
                relatorio: relatorio
            };
        }

        // ============================================
        // MODO REAL: Envia cobranças efetivamente
        // ============================================
        let cobrancasEnviadas = 0;
        let cobrancasIgnoradas = 0;

        // 3. Para cada boleto vencido, verificar se deve enviar cobrança
        for (const boleto of boletosVencidos.rows) {
            const verificacao = await deveEnviarCobranca(boleto.id, periodoAtual);

            if (!verificacao.enviar) {
                cobrancasIgnoradas++;
                continue;
            }

            // Verificar status real no BB antes de cobrar (evita cobrar boletos já pagos/baixados)
            if (boleto.numero_boleto) {
                const statusBB = await verificarStatusBoletoBB(boleto.numero_boleto);

                // Se o boleto foi pago/baixado no BB, atualizar status local e não cobrar
                if (!statusBB.deveCobrar) {
                    console.log(`   ⏭️ UC ${boleto.uc} | ${boleto.mes_referencia}: Não cobrar (${statusBB.motivo})`);

                    // Atualizar status no banco local
                    if (statusBB.novoStatus) {
                        await pool.query(
                            'UPDATE boletos_energia SET status = $1 WHERE id = $2',
                            [statusBB.novoStatus, boleto.id]
                        );
                        console.log(`      ✅ Status atualizado para: ${statusBB.novoStatus}`);
                    }

                    cobrancasIgnoradas++;
                    continue;
                }
            }

            // Buscar contatos do CRM
            const contatos = await buscarContatosCRM(boleto.uc);
            if (!contatos) {
                console.log(`   ⚠️ UC ${boleto.uc}: Não encontrado no CRM`);
                continue;
            }

            const temWhatsApp = !!limparWhatsApp(contatos.whatsapp);
            const temEmail = !!contatos.email;

            if (!temWhatsApp && !temEmail) {
                console.log(`   ⚠️ UC ${boleto.uc}: Sem contatos para envio`);
                continue;
            }

            console.log(`   📤 UC ${boleto.uc} | ${boleto.mes_referencia} | R$ ${boleto.valor_boleto}`);
            console.log(`      Nome: ${contatos.nome}`);
            console.log(`      WhatsApp: ${contatos.whatsapp || 'N/A'} | Email: ${contatos.email || 'N/A'}`);

            const dadosEnvio = {
                nome: contatos.nome,
                uc: boleto.uc,
                mes_referencia: boleto.mes_referencia,
                data_vencimento: boleto.data_vencimento,
                valor_boleto: boleto.valor_boleto
            };

            let enviadoWhatsApp = false;
            let enviadoEmail = false;

            // Enviar por WhatsApp
            if (temWhatsApp) {
                enviadoWhatsApp = await enviarCobrancaWhatsApp(contatos.whatsapp, dadosEnvio);
                console.log(`      ${enviadoWhatsApp ? '✅' : '❌'} WhatsApp`);
            }

            // Enviar por Email
            if (temEmail) {
                enviadoEmail = await enviarCobrancaEmail(contatos.email, dadosEnvio);
                console.log(`      ${enviadoEmail ? '✅' : '❌'} Email`);
            }

            // Registrar cobrança enviada (se pelo menos um canal funcionou)
            if (enviadoWhatsApp || enviadoEmail) {
                await registrarCobrancaEnviada({
                    boleto_id: boleto.id,
                    uc: boleto.uc,
                    mes_referencia: boleto.mes_referencia,
                    periodo: periodoAtual,
                    enviado_whatsapp: enviadoWhatsApp,
                    enviado_email: enviadoEmail,
                    whatsapp_destino: contatos.whatsapp,
                    email_destino: contatos.email,
                    valor_boleto: boleto.valor_boleto,
                    mensagem: `Cobrança automática - ${verificacao.motivo}`
                });
                cobrancasEnviadas++;
            }
        }

        console.log(`\n📊 [COBRANÇA] Resumo: ${cobrancasEnviadas} cobranças enviadas, ${cobrancasIgnoradas} ignoradas (intervalo)`);

        return {
            sucesso: true,
            boletosVencidos: boletosVencidos.rowCount,
            cobrancasEnviadas,
            cobrancasIgnoradas
        };

    } catch (error) {
        console.error('❌ [COBRANÇA] Erro no processo de cobrança:', error.message);
        return { sucesso: false, erro: error.message };
    }
}

// Endpoint manual para forçar APENAS atualização de status (sem cobrança)
app.post('/api/boletos-energia/verificar-vencidos', authenticateToken, async (req, res) => {
    try {
        const resultado = await atualizarStatusBoletosVencidos();
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint manual para verificar e enviar notificações de protesto
app.post('/api/boletos-energia/verificar-protesto', authenticateToken, async (req, res) => {
    try {
        const resultado = await verificarEEnviarNotificacoesProtesto();
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para alterar protesto e prazo de recebimento em boletos existentes (em massa)
app.post('/api/boletos-energia/alterar-protesto-massa', authenticateToken, async (req, res) => {
    try {
        console.log('\n🔧 [ALTERAR MASSA] Iniciando alteração de protesto e prazo em boletos em aberto...');

        // Buscar boletos em aberto (Boleto gerado + Vencido)
        const queryBoletos = `
            SELECT id, uc, mes_referencia, numero_boleto, status, valor_boleto, data_vencimento
            FROM boletos_energia
            WHERE status IN ('Boleto gerado', 'Vencido')
            AND numero_boleto IS NOT NULL
            AND numero_boleto != ''
            ORDER BY id ASC
        `;
        const boletos = await pool.query(queryBoletos);
        console.log(`📋 [ALTERAR MASSA] ${boletos.rowCount} boleto(s) para alterar`);

        if (boletos.rowCount === 0) {
            return res.json({ sucesso: true, total: 0, mensagem: 'Nenhum boleto em aberto para alterar' });
        }

        // Obter token BB
        const tokenResult = await obterTokenBB();
        if (!tokenResult.success) {
            return res.status(500).json({ erro: 'Falha ao obter token BB', detalhes: tokenResult.error });
        }

        const resultados = { total: boletos.rowCount, alterados: 0, erros: 0, detalhes: [] };

        for (const boleto of boletos.rows) {
            try {
                const bodyAlteracao = {
                    numeroConvenio: 3648981,
                    indicadorProtestar: 'S',
                    protesto: {
                        quantidadeDiasProtesto: 45
                    },
                    indicadorAlterarPrazoBoletoVencido: 'S',
                    alteracaoPrazo: {
                        quantidadeDiasAceite: 300
                    },
                    // Campos obrigatórios com "N" (sem alteração)
                    indicadorAlterarAbatimento: 'N',
                    indicadorAlterarDataDesconto: 'N',
                    indicadorAlterarDesconto: 'N',
                    indicadorAlterarEnderecoPagador: 'N',
                    indicadorAlterarSeuNumero: 'N',
                    indicadorAtribuirDesconto: 'N',
                    indicadorCancelarProtesto: 'N',
                    indicadorCobrarJuros: 'N',
                    indicadorCobrarMulta: 'N',
                    indicadorDispensarJuros: 'N',
                    indicadorDispensarMulta: 'N',
                    indicadorIncluirAbatimento: 'N',
                    indicadorNegativar: 'N',
                    indicadorNovaDataVencimento: 'N',
                    indicadorSustacaoProtesto: 'N',
                    indicadorNovoValorNominal: 'N'
                };

                const resposta = await fazerRequisicaoBB(
                    `/cobrancas/v2/boletos/${boleto.numero_boleto}`,
                    'PATCH',
                    bodyAlteracao,
                    tokenResult.token
                );

                if (resposta && !resposta.errors) {
                    resultados.alterados++;
                    console.log(`   ✅ ${boleto.numero_boleto} (UC ${boleto.uc}) - Alterado com sucesso`);
                    resultados.detalhes.push({ numero_boleto: boleto.numero_boleto, uc: boleto.uc, status: 'alterado' });
                } else {
                    resultados.erros++;
                    const erroMsg = resposta?.errors?.[0]?.message || JSON.stringify(resposta);
                    console.log(`   ❌ ${boleto.numero_boleto} (UC ${boleto.uc}) - Erro: ${erroMsg}`);
                    resultados.detalhes.push({ numero_boleto: boleto.numero_boleto, uc: boleto.uc, status: 'erro', erro: erroMsg });
                }

                // Delay entre requisições para não sobrecarregar a API do BB
                await new Promise(r => setTimeout(r, 500));

            } catch (err) {
                resultados.erros++;
                console.log(`   ❌ ${boleto.numero_boleto} (UC ${boleto.uc}) - Exceção: ${err.message}`);
                resultados.detalhes.push({ numero_boleto: boleto.numero_boleto, uc: boleto.uc, status: 'erro', erro: err.message });
            }
        }

        console.log(`✅ [ALTERAR MASSA] Concluído: ${resultados.alterados} alterado(s), ${resultados.erros} erro(s)`);
        res.json({ sucesso: true, ...resultados });

    } catch (error) {
        console.error('❌ [ALTERAR MASSA] Erro geral:', error.message);
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint manual para forçar cobrança (se ativa)
app.post('/api/boletos-energia/executar-cobranca', authenticateToken, async (req, res) => {
    try {
        if (!COBRANCA_AUTOMATICA_ATIVA) {
            return res.json({
                sucesso: false,
                mensagem: 'Sistema de cobrança automática está DESATIVADO. Use /api/boletos-energia/cobranca/ativar para ativar.'
            });
        }
        const periodo = new Date().getHours() < 15 ? 'tarde' : 'noite';
        const resultado = await executarCobrancaAutomatica(periodo);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para ATIVAR cobrança automática
app.post('/api/boletos-energia/cobranca/ativar', authenticateToken, async (req, res) => {
    COBRANCA_AUTOMATICA_ATIVA = true;
    console.log('✅ [COBRANÇA] Sistema de cobrança automática ATIVADO via API');
    res.json({
        sucesso: true,
        cobranca_ativa: true,
        mensagem: 'Sistema de cobrança automática ATIVADO'
    });
});

// Endpoint para DESATIVAR cobrança automática
app.post('/api/boletos-energia/cobranca/desativar', authenticateToken, async (req, res) => {
    COBRANCA_AUTOMATICA_ATIVA = false;
    console.log('⏸️ [COBRANÇA] Sistema de cobrança automática DESATIVADO via API');
    res.json({
        sucesso: true,
        cobranca_ativa: false,
        mensagem: 'Sistema de cobrança automática DESATIVADO'
    });
});

// ============================================
// ENDPOINTS MODO SIMULAÇÃO
// ============================================

// Endpoint para ATIVAR modo simulação (gera Excel ao invés de cobrar)
app.post('/api/boletos-energia/cobranca/modo-simulacao/ativar', authenticateToken, async (req, res) => {
    MODO_SIMULACAO_COBRANCA = true;
    COBRANCA_AUTOMATICA_ATIVA = true; // Ativa também a cobrança para o cron executar
    console.log('🔬 [SIMULAÇÃO] Modo simulação ATIVADO via API');
    console.log('   📊 Relatórios serão salvos em:', DIRETORIO_RELATORIOS_COBRANCA);
    res.json({
        sucesso: true,
        modo_simulacao: true,
        cobranca_ativa: true,
        diretorio_relatorios: DIRETORIO_RELATORIOS_COBRANCA,
        mensagem: 'Modo SIMULAÇÃO ativado - Relatórios Excel serão gerados ao invés de cobrar'
    });
});

// Endpoint para DESATIVAR modo simulação (volta a cobrar efetivamente)
app.post('/api/boletos-energia/cobranca/modo-simulacao/desativar', authenticateToken, async (req, res) => {
    MODO_SIMULACAO_COBRANCA = false;
    console.log('💰 [SIMULAÇÃO] Modo simulação DESATIVADO via API - Voltando ao modo real');
    res.json({
        sucesso: true,
        modo_simulacao: false,
        cobranca_ativa: COBRANCA_AUTOMATICA_ATIVA,
        mensagem: 'Modo simulação DESATIVADO - Sistema voltou ao modo de cobrança REAL'
    });
});

// Endpoint para verificar status do modo simulação
app.get('/api/boletos-energia/cobranca/modo-simulacao/status', authenticateToken, async (req, res) => {
    // Listar relatórios existentes
    let relatorios = [];
    try {
        if (fs.existsSync(DIRETORIO_RELATORIOS_COBRANCA)) {
            relatorios = fs.readdirSync(DIRETORIO_RELATORIOS_COBRANCA)
                .filter(f => f.endsWith('.xlsx'))
                .map(f => ({
                    arquivo: f,
                    caminho: path.join(DIRETORIO_RELATORIOS_COBRANCA, f),
                    data_criacao: fs.statSync(path.join(DIRETORIO_RELATORIOS_COBRANCA, f)).mtime
                }))
                .sort((a, b) => b.data_criacao - a.data_criacao);
        }
    } catch (e) {
        console.error('Erro ao listar relatórios:', e.message);
    }

    res.json({
        modo_simulacao: {
            ativo: MODO_SIMULACAO_COBRANCA,
            status: MODO_SIMULACAO_COBRANCA ? '🔬 ATIVADO (gera Excel)' : '💰 DESATIVADO (cobrança real)'
        },
        cobranca_automatica: {
            ativa: COBRANCA_AUTOMATICA_ATIVA,
            status: COBRANCA_AUTOMATICA_ATIVA ? '✅ ATIVADA' : '⏸️ DESATIVADA'
        },
        diretorio_relatorios: DIRETORIO_RELATORIOS_COBRANCA,
        relatorios_gerados: relatorios.slice(0, 10), // Últimos 10
        total_relatorios: relatorios.length,
        endpoints: {
            ativar_simulacao: 'POST /api/boletos-energia/cobranca/modo-simulacao/ativar',
            desativar_simulacao: 'POST /api/boletos-energia/cobranca/modo-simulacao/desativar',
            baixar_relatorio: 'GET /api/boletos-energia/cobranca/relatorios/:arquivo'
        }
    });
});

// Endpoint para baixar relatório de simulação
app.get('/api/boletos-energia/cobranca/relatorios/:arquivo', authenticateToken, async (req, res) => {
    try {
        const { arquivo } = req.params;
        const caminhoArquivo = path.join(DIRETORIO_RELATORIOS_COBRANCA, arquivo);

        if (!fs.existsSync(caminhoArquivo)) {
            return res.status(404).json({ erro: 'Relatório não encontrado' });
        }

        res.download(caminhoArquivo, arquivo);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint para listar todos os relatórios
app.get('/api/boletos-energia/cobranca/relatorios', authenticateToken, async (req, res) => {
    try {
        let relatorios = [];
        if (fs.existsSync(DIRETORIO_RELATORIOS_COBRANCA)) {
            relatorios = fs.readdirSync(DIRETORIO_RELATORIOS_COBRANCA)
                .filter(f => f.endsWith('.xlsx'))
                .map(f => {
                    const stats = fs.statSync(path.join(DIRETORIO_RELATORIOS_COBRANCA, f));
                    return {
                        arquivo: f,
                        tamanho: `${(stats.size / 1024).toFixed(2)} KB`,
                        data_criacao: stats.mtime,
                        url_download: `/api/boletos-energia/cobranca/relatorios/${f}`
                    };
                })
                .sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));
        }

        res.json({
            diretorio: DIRETORIO_RELATORIOS_COBRANCA,
            total: relatorios.length,
            relatorios
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint para enviar cobrança de TESTE
app.post('/api/boletos-energia/cobranca/teste', authenticateToken, async (req, res) => {
    try {
        const { whatsapp, email, uc, mes_referencia } = req.body;

        if (!whatsapp && !email) {
            return res.status(400).json({ erro: 'Informe pelo menos whatsapp ou email' });
        }

        // Buscar dados do boleto se UC e mes_referencia foram fornecidos
        let dadosBoleto = {
            nome: 'Cliente Teste',
            uc: uc || '12345678',
            mes_referencia: mes_referencia || '12/2025',
            data_vencimento: '20/01/2026',
            valor_boleto: 150.00
        };

        if (uc && mes_referencia) {
            // Buscar boleto real
            const query = `
                SELECT id, uc, mes_referencia, data_vencimento, valor_boleto, nome_completo
                FROM boletos_energia
                WHERE uc = $1 AND mes_referencia = $2
            `;
            const result = await pool.query(query, [uc, mes_referencia]);

            if (result.rows.length > 0) {
                const boleto = result.rows[0];
                dadosBoleto = {
                    nome: boleto.nome_completo || 'Cliente',
                    uc: boleto.uc,
                    mes_referencia: boleto.mes_referencia,
                    data_vencimento: boleto.data_vencimento,
                    valor_boleto: boleto.valor_boleto
                };
            }
        }

        console.log('\n🧪 [TESTE] Enviando cobrança de teste...');
        console.log(`   Dados: UC ${dadosBoleto.uc} | ${dadosBoleto.mes_referencia} | R$ ${dadosBoleto.valor_boleto}`);

        let resultadoWhatsApp = null;
        let resultadoEmail = null;

        // Enviar por WhatsApp
        if (whatsapp) {
            console.log(`   📱 WhatsApp: ${whatsapp}`);
            resultadoWhatsApp = await enviarCobrancaWhatsApp(whatsapp, dadosBoleto);
            console.log(`   ${resultadoWhatsApp ? '✅' : '❌'} WhatsApp ${resultadoWhatsApp ? 'enviado' : 'falhou'}`);
        }

        // Enviar por Email
        if (email) {
            console.log(`   📧 Email: ${email}`);
            resultadoEmail = await enviarCobrancaEmail(email, dadosBoleto);
            console.log(`   ${resultadoEmail ? '✅' : '❌'} Email ${resultadoEmail ? 'enviado' : 'falhou'}`);
        }

        res.json({
            sucesso: resultadoWhatsApp || resultadoEmail,
            teste: true,
            dados_enviados: dadosBoleto,
            resultados: {
                whatsapp: whatsapp ? { enviado: resultadoWhatsApp, destino: whatsapp } : null,
                email: email ? { enviado: resultadoEmail, destino: email } : null
            }
        });

    } catch (error) {
        console.error('❌ Erro no teste de cobrança:', error.message);
        res.status(500).json({ erro: error.message });
    }
});

// Endpoint para ver status do serviço de verificação e cobranças
app.get('/api/boletos-energia/status-verificacao-vencidos', authenticateToken, async (req, res) => {
    try {
        // Buscar estatísticas de boletos
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM boletos_energia WHERE status = 'Vencido') as total_vencidos,
                (SELECT COUNT(*) FROM boletos_energia WHERE status = 'Boleto gerado') as total_em_aberto,
                (SELECT MIN(data_vencimento) FROM boletos_energia
                 WHERE status = 'Boleto gerado'
                 AND data_vencimento IS NOT NULL) as proximo_vencimento
        `);

        // Buscar estatísticas de cobranças
        const cobrancas = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM cobrancas_enviadas WHERE DATE(data_envio) = CURRENT_DATE) as cobrancas_hoje,
                (SELECT COUNT(*) FROM cobrancas_enviadas WHERE data_envio >= NOW() - INTERVAL '7 days') as cobrancas_semana,
                (SELECT COUNT(DISTINCT boleto_id) FROM cobrancas_enviadas) as boletos_cobrados
        `);

        const proximaVerificacao = calcularTempoAteVerificacao3h();
        const proximaCobranca = calcularTempoAteProximaCobranca();

        res.json({
            cobranca_automatica: {
                ativa: COBRANCA_AUTOMATICA_ATIVA,
                status: COBRANCA_AUTOMATICA_ATIVA ? '✅ ATIVADA' : '⏸️ DESATIVADA',
                horarios: '12:30 e 18:30 (dias úteis)',
                proxima_execucao: COBRANCA_AUTOMATICA_ATIVA ? {
                    data: proximaCobranca.data.toLocaleString('pt-BR'),
                    periodo: proximaCobranca.periodo
                } : 'Desativada'
            },
            verificacao_vencidos: {
                horario: '03:00 (diária, sempre ativa)',
                proxima_execucao: proximaVerificacao.data.toLocaleString('pt-BR')
            },
            regras_cobranca: {
                fim_de_semana: 'Não envia',
                intervalo_minimo: '2 dias entre cobranças',
                canais: 'WhatsApp e Email (faturamento CRM)'
            },
            estatisticas_boletos: stats.rows[0],
            estatisticas_cobrancas: cobrancas.rows[0],
            endpoints: {
                ativar_cobranca: 'POST /api/boletos-energia/cobranca/ativar',
                desativar_cobranca: 'POST /api/boletos-energia/cobranca/desativar',
                executar_cobranca_manual: 'POST /api/boletos-energia/executar-cobranca',
                verificar_vencidos: 'POST /api/boletos-energia/verificar-vencidos'
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para listar histórico de cobranças
app.get('/api/boletos-energia/historico-cobrancas', authenticateToken, async (req, res) => {
    try {
        const { uc, limite = 50 } = req.query;

        let query = `
            SELECT
                c.*,
                b.nome_completo,
                b.data_vencimento
            FROM cobrancas_enviadas c
            JOIN boletos_energia b ON b.id = c.boleto_id
        `;

        const params = [];
        if (uc) {
            query += ` WHERE c.uc = $1`;
            params.push(uc);
        }

        query += ` ORDER BY c.data_envio DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limite));

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 📁 MIDDLEWARE PARA 404 (DEVE SER O ÚLTIMO ANTES DA INICIALIZAÇÃO)
// ========================================
app.use('*', (req, res) => {
    console.warn(`⚠️ 404 - Rota não encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        error: 'Rota não encontrada',
        message: `O endpoint ${req.method} ${req.originalUrl} não existe`,
        rotasDisponiveis: [
            'GET /health - Status do servidor',
            'POST /gerar-pdf-boleto - Gerar PDF do boleto (principal)',
            'POST /api/gerar-pdf - Gerar PDF do boleto (compatibilidade)',
            'GET /index.html - Interface web',
            '/proxy-oauth/* - Proxy para OAuth BB',
            '/proxy-api/* - Proxy para API BB',
            '/api/microservicos/* - Endpoints de microserviços'
        ],
        timestamp: new Date().toISOString()
    });
});

// ========================================
// 🛠️ MIDDLEWARE PARA TRATAMENTO DE ERROS
// ========================================
app.use((error, req, res, next) => {
    console.error('💥 Erro não tratado:', error);

    if (!res.headersSent) {
        res.status(500).json({
            error: 'Erro interno do servidor',
            message: 'Ocorreu um erro inesperado',
            timestamp: new Date().toISOString()
        });
    }
});

// ========================================
// ========================================
// 🔄 SINCRONIZAÇÃO PERIÓDICA DE STATUS COM API BB
// Consulta a API do BB para verificar se boletos "Pago", "Boleto gerado" e "Vencido"
// estão com o status correto. Roda diariamente às 6h.
// ========================================
const HORA_SINCRONIZACAO_BB = 6;

function calcularTempoAteSincronizacaoBB() {
    const agora = new Date();
    const proximaExecucao = criarDataBrasilia(HORA_SINCRONIZACAO_BB, 0);
    return {
        ms: proximaExecucao.getTime() - agora.getTime(),
        data: proximaExecucao,
        horarioBrasilia: `${HORA_SINCRONIZACAO_BB}:00`
    };
}

async function sincronizarStatusBoletosBB() {
    console.log('\n🔄 [SYNC BB 6h] Iniciando sincronização de status com API do BB...');
    const inicio = Date.now();

    try {
        // Obter token
        const tokenResult = await obterTokenBB();
        if (!tokenResult.success) {
            console.log('❌ [SYNC BB] Falha ao obter token:', tokenResult.error);
            return;
        }
        let token = tokenResult.token;

        // Buscar boletos que precisam de verificação (últimos 4 meses)
        const quatroMesesAtras = new Date();
        quatroMesesAtras.setMonth(quatroMesesAtras.getMonth() - 4);
        const mesMin = `${String(quatroMesesAtras.getMonth() + 1).padStart(2, '0')}/${quatroMesesAtras.getFullYear()}`;

        const result = await pool.query(`
            SELECT id, uc, mes_referencia, numero_boleto, valor_boleto, status
            FROM boletos_energia
            WHERE numero_boleto IS NOT NULL
              AND status IN ('Pago', 'Boleto gerado', 'Vencido')
            ORDER BY id
        `);

        console.log(`🔄 [SYNC BB] ${result.rows.length} boletos a verificar`);

        let verificados = 0, corrigidos = 0, errosApi = 0;
        const divergencias = [];

        for (const boleto of result.rows) {
            verificados++;
            try {
                const resp = await new Promise((resolve, reject) => {
                    const req = https.request({
                        hostname: 'api.bb.com.br', port: 443,
                        path: `/cobrancas/v2/boletos/${boleto.numero_boleto}?numeroConvenio=3648981`,
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'X-Application-Key': '549827f7531a4cdd880437df70bf3d86'
                        }
                    }, (res) => {
                        let data = '';
                        res.on('data', c => data += c);
                        res.on('end', () => {
                            try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                            catch(e) { resolve({ status: res.statusCode, data }); }
                        });
                    });
                    req.on('error', reject);
                    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
                    req.end();
                });

                // Token expirou, renovar
                if (resp.status === 401) {
                    const newToken = await obterTokenBB();
                    if (newToken.success) token = newToken.token;
                    errosApi++;
                    continue;
                }

                if (resp.status !== 200) { errosApi++; continue; }

                const bb = resp.data;
                const estadoBB = bb.codigoEstadoTituloCobranca;
                const valorPagoBB = bb.valorPagoTituloCobranca || 0;

                let statusCorreto = null;

                // Pago localmente mas NÃO liquidado no BB
                if (boleto.status === 'Pago' && ![5, 6].includes(estadoBB)) {
                    if (estadoBB === 7) {
                        statusCorreto = 'Cancelado';
                    } else if (estadoBB === 1) {
                        // Normal = verificar se vencido
                        const dtVenc = bb.dataVencimentoTituloCobranca;
                        if (dtVenc) {
                            const [dia, mes, ano] = dtVenc.split('.');
                            const venc = new Date(ano, mes - 1, dia);
                            statusCorreto = (venc < new Date()) ? 'Vencido' : 'Boleto gerado';
                        } else {
                            statusCorreto = 'Boleto gerado';
                        }
                    }
                }
                // Não pago localmente mas LIQUIDADO no BB
                else if (['Boleto gerado', 'Vencido'].includes(boleto.status) && [5, 6].includes(estadoBB)) {
                    statusCorreto = 'Pago';
                }

                if (statusCorreto) {
                    await pool.query(
                        `UPDATE boletos_energia SET status = $1, data_atualizacao = NOW() WHERE id = $2`,
                        [statusCorreto, boleto.id]
                    );
                    corrigidos++;
                    const msg = `ID ${boleto.id} UC ${boleto.uc} ${boleto.mes_referencia}: ${boleto.status} → ${statusCorreto} (BB estado ${estadoBB})`;
                    divergencias.push(msg);
                    console.log(`   ⚠️ [SYNC BB] Corrigido: ${msg}`);
                }

                // Rate limiting
                await new Promise(r => setTimeout(r, 100));

            } catch(e) {
                errosApi++;
            }
        }

        const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
        console.log(`✅ [SYNC BB] Concluído em ${duracao}s: ${verificados} verificados, ${corrigidos} corrigidos, ${errosApi} erros API`);
        if (divergencias.length > 0) {
            console.log(`   📋 Divergências corrigidas:`);
            divergencias.forEach(d => console.log(`      - ${d}`));
        }

    } catch (error) {
        console.error('❌ [SYNC BB] Erro geral:', error.message);
    }
}

// Endpoint manual para forçar sincronização
app.post('/api/boletos-energia/sincronizar-status-bb', authenticateToken, async (req, res) => {
    try {
        await sincronizarStatusBoletosBB();
        res.json({ sucesso: true, mensagem: 'Sincronização com BB concluída' });
    } catch (error) {
        console.error('❌ Erro na sincronização manual:', error);
        res.status(500).json({ error: error.message });
    }
});

// 🚀 INICIALIZAÇÃO DO SERVIDOR
// ========================================
const SERVER_PORT = process.env.PORT || 3001;

app.listen(SERVER_PORT, async () => {
    console.log('\n🎉 ====================================');
    console.log('🏦 SERVIDOR BANCO DO BRASIL REACT INICIADO!');
    console.log('     (VERSÃO REACT)');
    console.log('🎉 ====================================');
    console.log(`🚀 Servidor rodando em http://localhost:${SERVER_PORT}`);
    console.log(`📂 URL completa: http://localhost:${SERVER_PORT}/index.html`);
    console.log('');
    console.log('✅ FUNCIONALIDADES MANTIDAS:');
    console.log('   🏥 Health check completo');
    console.log('   📄 Geração de PDF funcional');
    console.log('   📡 Logs detalhados');
    console.log('   🔧 Formatação de dados');
    console.log('   📁 Arquivos estáticos');
    console.log('');
    console.log('🔧 CORREÇÕES APLICADAS:');
    console.log('   🔐 Proxy OAuth manual (HTTPS direto)');
    console.log('   🏦 Proxy API manual (HTTPS direto)');
    console.log('   🌐 CORS permissivo');
    console.log('   📄 Convênio correto: 3648981');
    console.log('   ✅ Sem http-proxy-middleware (causa ECONNRESET)');
    console.log('');
    console.log('🔗 PROXIES IMPLEMENTADOS:');
    console.log('   🔐 /proxy-oauth/* -> https://oauth.bb.com.br (manual)');
    console.log('   🏦 /proxy-api/*   -> https://api.bb.com.br (manual)');
    console.log('');
    console.log('💾 INICIALIZANDO BANCO DE DADOS...');

    // Inicializar tabela do banco de dados
    await criarTabelaSeNaoExistir();
    await criarTabelaEnviosSeNaoExistir();

    // Iniciar serviço de verificação de boletos vencidos e cobrança automática
    // ========================================
    // SERVIÇO 1: VERIFICAÇÃO DE VENCIDOS (3h da manhã - SEMPRE ATIVO)
    // ========================================
    console.log('');
    console.log('⏰ SERVIÇO DE VERIFICAÇÃO DE VENCIDOS');
    console.log('   📅 Horário: 03:00 (diária) - SEMPRE ATIVO');

    // Executar verificação inicial
    await atualizarStatusBoletosVencidos();

    // Agendar verificação diária às 3h
    const agendarVerificacao3h = () => {
        const proxima = calcularTempoAteVerificacao3h();
        console.log(`   ⏰ Próxima verificação 3h: ${proxima.data.toLocaleString('pt-BR')}`);

        setTimeout(async () => {
            await atualizarStatusBoletosVencidos();
            agendarVerificacao3h(); // Reagendar
        }, proxima.ms);
    };
    agendarVerificacao3h();

    // ========================================
    // SERVIÇO 1.5: NOTIFICAÇÃO DE PROTESTO (8h da manhã - SEMPRE ATIVO)
    // ========================================
    console.log('');
    console.log('📢 SERVIÇO DE NOTIFICAÇÃO DE PROTESTO');
    console.log('   📅 Horário: 08:00 (diária) - SEMPRE ATIVO');
    console.log(`   ⚖️ Protesto: ${DIAS_PROTESTO} dias após vencimento`);
    console.log(`   📨 Notificações: ${DIAS_INICIO_NOTIFICACAO} dias antes do protesto (contagem regressiva)`);

    // Agendar notificação diária às 8h
    const agendarNotificacaoProtesto = () => {
        const proxima = calcularTempoAteNotificacaoProtesto();
        console.log(`   ⏰ Próxima verificação protesto: ${proxima.data.toLocaleString('pt-BR')}`);

        setTimeout(async () => {
            await verificarEEnviarNotificacoesProtesto();
            agendarNotificacaoProtesto(); // Reagendar
        }, proxima.ms);
    };
    agendarNotificacaoProtesto();

    // ========================================
    // SERVIÇO 2: COBRANÇA AUTOMÁTICA (12:30 e 18:30 - CONFIGURÁVEL)
    // ========================================
    console.log('');
    console.log('💰 SERVIÇO DE COBRANÇA AUTOMÁTICA');
    console.log(`   📅 Horários: 12:30 e 18:30 (dias úteis)`);
    console.log(`   🔧 Status: ${COBRANCA_AUTOMATICA_ATIVA ? '✅ ATIVADA' : '⏸️ DESATIVADA'}`);
    console.log(`   🔬 Modo Simulação: ${MODO_SIMULACAO_COBRANCA ? '✅ ATIVADO (gera Excel)' : '❌ DESATIVADO (cobrança real)'}`);
    if (MODO_SIMULACAO_COBRANCA) {
        console.log(`   📁 Relatórios: ${DIRETORIO_RELATORIOS_COBRANCA}`);
    }
    console.log('   🚫 Não envia em fins de semana');
    console.log('   ⏳ Intervalo mínimo: 2 dias entre cobranças');

    // Agendar cobranças (só executa se estiver ativo)
    const agendarCobranca = () => {
        const proxima = calcularTempoAteProximaCobranca();

        if (COBRANCA_AUTOMATICA_ATIVA) {
            const modoTexto = MODO_SIMULACAO_COBRANCA ? '(SIMULAÇÃO)' : '(REAL)';
            console.log(`   ⏰ Próxima cobrança: ${proxima.data.toLocaleString('pt-BR')} (${proxima.periodo}) ${modoTexto}`);
        }

        setTimeout(async () => {
            if (COBRANCA_AUTOMATICA_ATIVA) {
                await executarCobrancaAutomatica(proxima.periodo);
            } else {
                console.log(`\n⏸️ [COBRANÇA ${proxima.periodo.toUpperCase()}] Sistema desativado - ignorando execução`);
            }
            agendarCobranca(); // Reagendar
        }, proxima.ms);
    };
    agendarCobranca();

    // ========================================
    // SERVIÇO 3: SINCRONIZAÇÃO DE STATUS COM BB (6h da manhã - SEMPRE ATIVO)
    // ========================================
    console.log('');
    console.log('🔄 SERVIÇO DE SINCRONIZAÇÃO COM API BB');
    console.log('   📅 Horário: 06:00 (diária) - SEMPRE ATIVO');
    console.log('   🔍 Verifica divergências entre status local e API do BB');

    const agendarSincronizacaoBB = () => {
        const proxima = calcularTempoAteSincronizacaoBB();
        console.log(`   ⏰ Próxima sincronização BB: ${proxima.data.toLocaleString('pt-BR')}`);

        setTimeout(async () => {
            await sincronizarStatusBoletosBB();
            agendarSincronizacaoBB(); // Reagendar
        }, proxima.ms);
    };
    agendarSincronizacaoBB();

    console.log('');
    console.log('📋 ENDPOINTS DE CONTROLE:');
    console.log('   POST /api/boletos-energia/cobranca/ativar    - Ativar cobrança');
    console.log('   POST /api/boletos-energia/cobranca/desativar - Desativar cobrança');
    console.log('   POST /api/boletos-energia/cobranca/modo-simulacao/ativar    - Ativar modo simulação');
    console.log('   POST /api/boletos-energia/cobranca/modo-simulacao/desativar - Voltar ao modo real');
    console.log('   GET  /api/boletos-energia/cobranca/modo-simulacao/status    - Ver status simulação');
    console.log('   GET  /api/boletos-energia/cobranca/relatorios - Listar relatórios');
    console.log('   POST /api/boletos-energia/verificar-protesto         - Verificar notificações protesto');
    console.log('   POST /api/boletos-energia/sincronizar-status-bb      - Forçar sincronização BB');
    console.log('   GET  /api/boletos-energia/status-verificacao-vencidos - Ver status geral');
    console.log('====================================\n');
});