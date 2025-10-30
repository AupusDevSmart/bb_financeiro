// ========================================
// 🖥️ SERVIDOR WEB - BANCO DO BRASIL API (VERSÃO HÍBRIDA FUNCIONAL)
// ========================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { gerarPDFBoleto } = require('./pdfGenerator');
const {
    criarTabelaSeNaoExistir,
    inserirOuAtualizarBoleto,
    listarBoletos,
    atualizarStatusBoleto,
    buscarBoleto,
    deletarBoleto,
    buscarBoletoPorNumero,
    atualizarStatusBoletoPorNumero
} = require('./database');

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
const publicPath = path.join(__dirname, 'public');
const hasPublicFolder = fs.existsSync(publicPath);

if (hasPublicFolder) {
    console.log('📁 Servindo arquivos da pasta public/');
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

        const { status, uc, data_inicio, data_fim } = req.query;

        // Buscar do banco de dados com filtros
        const filtros = {};
        if (status) filtros.status = status;
        if (uc) filtros.uc = uc;
        if (data_inicio) filtros.data_inicio = data_inicio;
        if (data_fim) filtros.data_fim = data_fim;

        const resultado = await listarBoletos(filtros);

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

        // Verificar se boleto existe
        const boletoExistente = await buscarBoleto(uc, mes_referencia);
        if (!boletoExistente) {
            return res.status(404).json({
                error: 'Boleto não encontrado',
                message: `Não há boleto para UC ${uc} e mês ${mes_referencia}`
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

        // Atualização completa de dados
        const dadosAtualizados = {
            uc,
            mes_referencia,
            ...boletoExistente,
            ...dados
        };

        const resultado = await inserirOuAtualizarBoleto(dadosAtualizados);

        console.log(`✅ Dados do boleto atualizados`);
        res.json({
            message: 'Dados atualizados com sucesso',
            dados: resultado
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
// Deleta boleto de energia
// ========================================
app.delete('/api/dados-boleto-energia/:uc/:mes_referencia', async (req, res) => {
    try {
        const { uc, mes_referencia } = req.params;

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
        if (dadosBoleto.dadosEnergia) {
            const uc = dadosBoleto.dadosEnergia.uc || 'sem-uc';
            const mesRef = dadosBoleto.dadosEnergia.mes_referencia || 'sem-mes';

            // Buscar nome do cliente de várias fontes possíveis
            const nome = dadosBoleto.nomeSacadoCobranca ||
                         dadosBoleto.pagador?.nome ||
                         dadosBoleto.nome ||
                         'sem-nome';

            // Extrair mês e ano da string de mês de referência (formato: "MM/AAAA")
            const [mes, ano] = mesRef.split('/');
            const mesesExtenso = ['', 'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const mesExtenso = mes ? mesesExtenso[parseInt(mes)] : 'sem-mes';

            nomeArquivo = `Fatura AUPUS - ${uc} - ${nome} - ${mesExtenso} ${ano || 'sem-ano'}.pdf`;
        } else {
            nomeArquivo = `boleto-${dadosBoleto.sequencial || dadosBoleto.numeroTitulo || 'sem-numero'}.pdf`;
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
            'Content-Length': body.length || 0
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
            'Content-Length': body.length || 0
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
    const publicIndexPath = path.join(__dirname, 'public', 'index.html');
    const rootIndexPath = path.join(__dirname, 'index.html');
    
    // Verificar onde está o index.html
    if (fs.existsSync(publicIndexPath)) {
        console.log('📄 Servindo index.html da pasta public/');
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

// ========================================
// 📁 MIDDLEWARE PARA 404 (MANTENDO)
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
            '/proxy-oauth/* - Proxy para OAuth BB (RESTAURADO)',
            '/proxy-api/* - Proxy para API BB (RESTAURADO)'
        ],
        timestamp: new Date().toISOString()
    });
});

// ========================================
// 🛠️ MIDDLEWARE PARA TRATAMENTO DE ERROS (MANTENDO)
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

// PDF generation is now handled by pdfGenerator.js module

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

    console.log('====================================\n');
});