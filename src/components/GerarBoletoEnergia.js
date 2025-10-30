import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Badge, Alert, Spinner, Modal } from 'react-bootstrap';
import axios from 'axios';
import { formatarCPFComMascara, formatarCNPJComMascara, formatarValor } from '../utils/formatters';
import { removerAcentos } from '../utils/formatters';
import { obterProximoSequencial, obterToken, consultarPixBoleto } from '../services/api';
import { Clock, CheckCircle, FileText, Download, Eye, RefreshCw } from 'lucide-react';

const API_URL = 'http://localhost:3001';

function GerarBoletoEnergia({ mostrarAlerta }) {
    const [boletos, setBoletos] = useState([]);
    const [filtros, setFiltros] = useState({
        status: 'Todos',
        uc: '',
        data_inicio: '',
        data_fim: ''
    });
    const [carregando, setCarregando] = useState(false);
    const [processando, setProcessando] = useState({});
    const [modalVencimento, setModalVencimento] = useState({
        show: false,
        boleto: null,
        dataVencimento: ''
    });
    const [modalDetalhes, setModalDetalhes] = useState({
        show: false,
        boleto: null,
        editando: false,
        dadosEditados: null
    });

    // Carregar boletos ao montar componente
    useEffect(() => {
        carregarBoletos();
    }, []);

    // Carregar boletos da API
    const carregarBoletos = async () => {
        setCarregando(true);
        try {
            const params = new URLSearchParams();
            if (filtros.status !== 'Todos') params.append('status', filtros.status);
            if (filtros.uc) params.append('uc', filtros.uc);
            if (filtros.data_inicio) params.append('data_inicio', filtros.data_inicio);
            if (filtros.data_fim) params.append('data_fim', filtros.data_fim);

            // Adicionar timestamp para evitar cache
            params.append('_t', new Date().getTime());

            const response = await axios.get(`${API_URL}/api/dados-boleto-energia?${params.toString()}`);
            console.log('📋 Boletos carregados:', response.data.boletos.length);

            // Log do status de cada boleto
            response.data.boletos.forEach(b => {
                console.log(`Boleto ${b.numero_boleto}: status = ${b.status}`);
            });

            // Forçar atualização do estado com novo array
            setBoletos([...response.data.boletos]);
        } catch (error) {
            console.error('Erro ao carregar boletos:', error);
            mostrarAlerta('Erro ao carregar boletos de energia', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    // Calcular vencimento automático
    const calcularVencimento = (mesReferencia, vencimentoConsorcio) => {
        // Se vencimento_consorcio for válido, usar ele
        if (vencimentoConsorcio && vencimentoConsorcio !== 'nan' && !isNaN(parseInt(vencimentoConsorcio))) {
            const dia = parseInt(vencimentoConsorcio);
            const [mes, ano] = mesReferencia.split('/');
            const mesVencimento = (parseInt(mes) % 12) + 1;
            const anoVencimento = mesVencimento === 1 ? parseInt(ano) + 1 : parseInt(ano);

            return `${String(dia).padStart(2, '0')}/${String(mesVencimento).padStart(2, '0')}/${anoVencimento}`;
        }

        // Se não, usar dia 20 do mês seguinte
        const [mes, ano] = mesReferencia.split('/');
        const mesVencimento = (parseInt(mes) % 12) + 1;
        const anoVencimento = mesVencimento === 1 ? parseInt(ano) + 1 : parseInt(ano);

        const dataVencimento = new Date(anoVencimento, mesVencimento - 1, 20);
        const hoje = new Date();

        // Se o dia 20 do mês seguinte já passou, precisa entrada manual
        if (dataVencimento < hoje) {
            return null; // Indicará que precisa entrada manual
        }

        return `20/${String(mesVencimento).padStart(2, '0')}/${anoVencimento}`;
    };

    // Verificar se precisa entrada manual de vencimento
    const verificarVencimento = (dadosEnergia) => {
        const vencimento = calcularVencimento(dadosEnergia.mes_referencia, dadosEnergia.vencimento_consorcio);

        if (!vencimento) {
            // Precisa entrada manual
            setModalVencimento({
                show: true,
                boleto: dadosEnergia,
                dataVencimento: ''
            });
            return null;
        }

        return vencimento;
    };

    // Normalizar campos do boleto (suporta snake_case e camelCase)
    const normalizarBoleto = (boleto) => {
        return {
            ...boleto,
            tipoPessoa: boleto.tipoPessoa || boleto.tipo_pessoa,
            nomeCompleto: boleto.nomeCompleto || boleto.nome_completo,
            valorBoleto: boleto.valorBoleto || boleto.valor_boleto,
            energiaTotal: boleto.energiaTotal || boleto.energia_total,
            energiaCompensado: boleto.energiaCompensado || boleto.energia_compensado,
            energiaNaoCompensado: boleto.energiaNaoCompensado || boleto.energia_nao_compensado,
            vencimentoConsorcio: boleto.vencimentoConsorcio || boleto.vencimento_consorcio,
            dataVencimento: boleto.dataVencimento || boleto.data_vencimento,
            valorAupus: boleto.valorAupus || boleto.valor_aupus,
            valorConsorcio: boleto.valorConsorcio || boleto.valor_consorcio || boleto.valorBoleto || boleto.valor_boleto,
            valorEconomia: boleto.valorEconomia || boleto.valor_economia,
            valorEnergiaCompensada: boleto.valorEnergiaCompensada || boleto.valor_energia_compensada,
            valorBandeiraCompensada: boleto.valorBandeiraCompensada || boleto.valor_bandeira_compensada,
            valorComDesconto: boleto.valorComDesconto || boleto.valor_com_desconto,
            valorBandeiraComDesconto: boleto.valorBandeiraComDesconto || boleto.valor_bandeira_com_desconto,
            tarifaMinimaConcessionaria: boleto.tarifaMinimaConcessionaria || boleto.tarifa_minima_concessionaria
        };
    };

    // Gerar boleto automaticamente
    const gerarBoleto = async (dadosEnergiaOriginal, dataVencimentoManual = null) => {
        // Normalizar campos
        const dadosEnergia = normalizarBoleto(dadosEnergiaOriginal);

        const chave = `${dadosEnergia.uc}_${dadosEnergia.mes_referencia}`;
        setProcessando(prev => ({ ...prev, [chave]: true }));

        try {
            // 0. Verificar se boleto já foi gerado
            if (dadosEnergia.status === 'Boleto gerado' && dadosEnergia.numero_boleto) {
                mostrarAlerta(`Boleto ${dadosEnergia.numero_boleto} já foi gerado para esta fatura!`, 'warning');
                setProcessando(prev => ({ ...prev, [chave]: false }));
                return;
            }

            // 1. Verificar/calcular vencimento
            let dataVencimento = dataVencimentoManual;
            if (!dataVencimento) {
                dataVencimento = verificarVencimento(dadosEnergia);
                if (!dataVencimento) {
                    setProcessando(prev => ({ ...prev, [chave]: false }));
                    return; // Modal será exibido
                }
            }

            // 2. Usar descrição que veio do Python (ou gerar padrão)
            const descricao = dadosEnergia.descricao || `Boleto referente ao arrendamento de energia do mês ${dadosEnergia.mes_referencia}`;

            // 3. Usar endereço que veio do Python
            const endereco = dadosEnergia.endereco || '';

            // 4. Preparar documento (IGUAL ao CriarBoleto que funciona!)
            const tipoPessoa = (dadosEnergia.tipoPessoa || 'CPF').toUpperCase();
            const tipoInscricao = tipoPessoa === 'CPF' ? 1 : 2;

            // Formatar CPF/CNPJ mantendo zeros à esquerda (RETORNA STRING!)
            const documentoLimpo = String(dadosEnergia.documento || '').replace(/\D/g, '');
            const documentoFormatado = tipoInscricao === 1
                ? documentoLimpo.padStart(11, '0')  // CPF com 11 dígitos
                : documentoLimpo.padStart(14, '0'); // CNPJ com 14 dígitos

            // Formatar CEP (RETORNA INTEGER!)
            const cepFormatado = parseInt(String(dadosEnergia.cep || '').replace(/\D/g, ''), 10);

            // 5. OBTER PRÓXIMO SEQUENCIAL AUTOMATICAMENTE (IGUAL ao CriarBoleto!)
            console.log('🔢 Obtendo próximo sequencial automaticamente...');
            const sequencial = await obterProximoSequencial();
            console.log(`🔢 Sequencial obtido: ${sequencial}`);

            // Gerar número título cliente de 20 dígitos usando SEQUENCIAL
            // Formato: 000 + CONVENIO (7 dígitos) + SEQUENCIAL (10 dígitos)
            const convenioStr = '3648981'.padStart(7, '0');
            const sequencialStr = sequencial.toString().padStart(10, '0');
            const numeroTituloCliente20Digitos = `000${convenioStr}${sequencialStr}`;

            // 5. Preparar dados para API do BB (ESTRUTURA IGUAL ao CriarBoleto que funciona!)
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
                valorOriginal: parseFloat(dadosEnergia.valorBoleto),
                numeroTituloCliente: numeroTituloCliente20Digitos,
                descricaoTitulo: descricao,
                indicadorAceiteTituloVencido: 'S',
                numeroDiasLimiteRecebimento: 30,
                codigoAceite: 'N',
                codigoTipoTitulo: 2,
                descricaoTipoTitulo: 'DM',
                indicadorPermissaoRecebimentoParcial: 'N',

                // Juros e multa (ESTRUTURA IGUAL ao CriarBoleto!)
                jurosMora: {
                    tipo: 2,
                    porcentagem: 1.00
                },
                multa: {
                    tipo: 2,
                    data: calcularDataMulta(dataVencimento),
                    porcentagem: 2.00
                },

                // Dados do pagador (ESTRUTURA IGUAL ao CriarBoleto!)
                pagador: {
                    tipoInscricao: tipoInscricao,
                    numeroInscricao: documentoFormatado,  // STRING com zeros!
                    nome: removerAcentos((dadosEnergia.nomeCompleto || '').toUpperCase()),
                    endereco: removerAcentos((endereco || '').toUpperCase()),
                    cep: cepFormatado,  // INTEGER
                    cidade: removerAcentos((dadosEnergia.cidade || '').toUpperCase()),
                    bairro: removerAcentos((dadosEnergia.bairro || '').toUpperCase()),
                    uf: (dadosEnergia.uf || 'GO').toUpperCase(),
                    telefone: '',
                    email: ''
                },

                // PIX
                indicadorPix: 'S'
            };

            // 6. Criar boleto na API do BB
            let token = await obterToken();
            let response;

            try {
                response = await axios.post(
                    `${API_URL}/proxy-api/cobrancas/v2/boletos`,
                    dadosBoleto,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'X-Application-Key': '549827f7531a4cdd880437df70bf3d86',
                            'Content-Type': 'application/json'
                        }
                    }
                );
            } catch (error) {
                // Se erro 401, renovar token e tentar novamente
                if (error.response?.status === 401) {
                    console.log('⚠️ Token expirado, renovando...');
                    localStorage.removeItem('bb_token');
                    localStorage.removeItem('bb_token_expiry');
                    token = await obterToken();

                    response = await axios.post(
                        `${API_URL}/proxy-api/cobrancas/v2/boletos`,
                        dadosBoleto,
                        {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'X-Application-Key': '549827f7531a4cdd880437df70bf3d86',
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                } else {
                    throw error;
                }
            }

            const numeroBoleto = response.data.numero || response.data.numeroBoletoBB;

            // 7. Atualizar status no backend
            await axios.patch(
                `${API_URL}/api/dados-boleto-energia/${dadosEnergia.uc}/${encodeURIComponent(dadosEnergia.mes_referencia)}`,
                {
                    status: 'Boleto gerado',
                    numero_boleto: numeroBoleto,
                    data_vencimento: dataVencimento
                }
            );

            // 8. Recarregar lista
            await carregarBoletos();

            mostrarAlerta(`Boleto ${numeroBoleto} gerado com sucesso!`, 'success');

            // Fechar modal se estava aberto
            if (modalVencimento.show) {
                setModalVencimento({ show: false, boleto: null, dataVencimento: '' });
            }

        } catch (error) {
            console.error('Erro ao gerar boleto:', error);
            const mensagemErro = error.response?.data?.message || error.message || 'Erro desconhecido';
            mostrarAlerta(`Erro ao gerar boleto: ${mensagemErro}`, 'danger');
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };

    // Obter token OAuth
    const obterToken = async () => {
        const tokenCache = localStorage.getItem('bb_token');
        const tokenExpiry = localStorage.getItem('bb_token_expiry');

        if (tokenCache && tokenExpiry && new Date().getTime() < parseInt(tokenExpiry)) {
            return tokenCache;
        }

        const clientId = 'eyJpZCI6ImMzIiwiY29kaWdvUHVibGljYWRvciI6MCwiY29kaWdvU29mdHdhcmUiOjEyMTQ4NSwic2VxdWVuY2lhbEluc3RhbGFjYW8iOjF9';
        const clientSecret = 'eyJpZCI6IjFiNTMxZjktMjZmYi00ZThjLThkZDItN2E1NDU1ODU5ODUzNmNjNjNlNCIsImNvZGlnb1B1YmxpY2Fkb3IiOjAsImNvZGlnb1NvZnR3YXJlIjoxMjE0ODUsInNlcXVlbmNpYWxJbnN0YWxhY2FvIjoxLCJzZXF1ZW5jaWFsQ3JlZGVuY2lhbCI6NCwiYW1iaWVudGUiOiJwcm9kdWNhbyIsImlhdCI6MTc2MTY4NDExNzI3N30';
        const basicAuth = btoa(`${clientId}:${clientSecret}`);

        const response = await axios.post(
            `${API_URL}/proxy-oauth/oauth/token`,
            'grant_type=client_credentials',
            {
                headers: {
                    'Authorization': `Basic ${basicAuth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const token = response.data.access_token;
        const expiry = new Date().getTime() + 50 * 60 * 1000;

        localStorage.setItem('bb_token', token);
        localStorage.setItem('bb_token_expiry', expiry.toString());

        return token;
    };

    // Calcular data de multa (vencimento + 1 dia)
    const calcularDataMulta = (dataVencimento) => {
        const [dia, mes, ano] = dataVencimento.split('/');
        const data = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
        data.setDate(data.getDate() + 1);
        return data.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '.');
    };

    // Formatar documento (já vem limpo do Python)
    const formatarDocumento = (documento, tipo) => {
        if (!documento) return '';
        if (tipo === 'CPF') {
            return formatarCPFComMascara(documento);
        } else {
            return formatarCNPJComMascara(documento);
        }
    };

    // Formatar data
    const formatarData = (dataISO) => {
        if (!dataISO) return '';
        const data = new Date(dataISO);
        return data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR');
    };

    // Badge de status
    const getBadgeStatus = (status) => {
        const badges = {
            'Pendente': 'warning',
            'Boleto gerado': 'success',
            'Cancelado': 'secondary',
            'Pago': 'primary',
            'Vencido': 'danger',
            'Erro': 'danger'
        };
        return badges[status] || 'secondary';
    };

    // Confirmar vencimento manual
    const confirmarVencimentoManual = () => {
        if (!modalVencimento.dataVencimento) {
            mostrarAlerta('Por favor, informe a data de vencimento', 'warning');
            return;
        }

        gerarBoleto(modalVencimento.boleto, modalVencimento.dataVencimento);
    };

    // Gerar PDF do boleto de energia
    const gerarPDFBoleto = async (boleto) => {
        try {
            console.log('📄 Gerando PDF do boleto de energia...', boleto);
            console.log('📋 Número do boleto:', boleto.numero_boleto);

            // SEMPRE renovar o token antes de buscar dados do BB para garantir que está válido
            console.log('🔄 Renovando token OAuth antes de buscar dados do boleto...');

            // Forçar renovação do token
            localStorage.removeItem('bb_token');

            const token = await obterToken();
            console.log('✅ Token renovado:', token ? token.substring(0, 30) + '...' : 'ERRO - Token vazio!');
            localStorage.setItem('bb_token', token);

            // Buscar dados completos do boleto na API do BB com token renovado
            const url = `${API_URL}/proxy-api/cobrancas/v2/boletos/${boleto.numero_boleto}?numeroConvenio=3648981`;
            console.log('📡 URL da requisição:', url);
            console.log('🔑 Token sendo usado:', token.substring(0, 30) + '...');

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Application-Key': '549827f7531a4cdd880437df70bf3d86'
                }
            });

            console.log('✅ Dados do boleto obtidos com sucesso:', response.status);
            const dadosBoletoBB = response.data;

            // Buscar dados do PIX separadamente (igual ao ListarBoletos)
            let dadosPix = null;
            try {
                console.log('📱 Buscando PIX para o PDF...');
                dadosPix = await consultarPixBoleto(boleto.numero_boleto);
                console.log('✅ PIX carregado para PDF:', dadosPix);
            } catch (error) {
                console.log('ℹ️ Boleto sem PIX ou erro ao buscar:', error.message);
            }

            // Preparar dados para o PDF incluindo informações de energia
            // Mapear campos do banco de dados (camelCase from Sistema_Faturas) para o que pdfGenerator espera (snake_case)
            const dadosCompletos = boleto.dados_completos || {};

            const dadosParaPDF = {
                ...dadosBoletoBB,
                dadosPix: dadosPix,  // Incluir dados do PIX para gerar QR Code
                numeroTitulo: boleto.numero_boleto,
                dadosEnergia: {
                    uc: boleto.uc,
                    mes_referencia: boleto.mes_referencia,

                    // Consumo (energia)
                    consumo: parseFloat(boleto.energia_total) || parseFloat(dadosCompletos.energiaTotal) || 0,
                    consumo_comp: parseFloat(boleto.energia_compensado) || parseFloat(dadosCompletos.energiaCompensado) || 0,
                    consumo_n_comp: parseFloat(boleto.energia_nao_compensado) || parseFloat(dadosCompletos.energiaNaoCompensado) || 0,

                    // Valores concessionária
                    valor_comp: parseFloat(boleto.valor_energia_compensada) || parseFloat(dadosCompletos.valorEnergiaCompensada) || 0,
                    valor_band_comp: parseFloat(boleto.valor_bandeira_compensada) || parseFloat(dadosCompletos.valorBandeiraCompensada) || 0,
                    valor_concessionaria: (parseFloat(boleto.valor_energia_compensada) || 0) + (parseFloat(boleto.valor_bandeira_compensada) || 0),

                    // Descontos (fixos ou calculados - podem ser 0 se não houver)
                    desconto_fatura: 0.30, // 30% de desconto padrão AUPUS
                    desconto_bandeira: 1.00, // 100% de desconto na bandeira
                    valor_iluminacao: 0, // Iluminação pública (não disponível nos dados atuais)

                    // Valores com desconto (do banco de dados)
                    valor_com_desconto: parseFloat(boleto.valor_com_desconto) || parseFloat(dadosCompletos.valorComDesconto) || 0,
                    valor_bandeira_com_desconto: parseFloat(boleto.valor_bandeira_com_desconto) || parseFloat(dadosCompletos.valorBandeiraComDesconto) || 0,
                    valor_s_desconto: parseFloat(boleto.valor_s_desconto) || parseFloat(dadosCompletos.valorSDesconto) || 0,

                    // Tarifa mínima
                    valor_tarifa_minima: parseFloat(boleto.tarifa_minima_concessionaria) || parseFloat(dadosCompletos.tarifaMinimaConcessionaria) || 0,
                    tarifa_minima_concessionaria: parseFloat(boleto.tarifa_minima_concessionaria) || parseFloat(dadosCompletos.tarifaMinimaConcessionaria) || 0,

                    // Valores finais
                    valor_boleto: parseFloat(boleto.valor_boleto) || parseFloat(dadosCompletos.valorBoleto) || 0,
                    valor_aupus: parseFloat(boleto.valor_com_desconto_aupus) || parseFloat(dadosCompletos.valorComDescontoAupus) || 0,
                    valor_consorcio: parseFloat(boleto.valor_boleto) || parseFloat(dadosCompletos.valorBoleto) || 0,

                    // Economia = valor original - valor com desconto
                    valor_economia: ((parseFloat(boleto.valor_energia_compensada) || 0) + (parseFloat(boleto.valor_bandeira_compensada) || 0)) -
                                   (parseFloat(boleto.valor_com_desconto_aupus) || 0)
                }
            };

            // Enviar para o backend gerar o PDF
            const pdfResponse = await axios.post(
                `${API_URL}/gerar-pdf-boleto`,
                dadosParaPDF,
                {
                    responseType: 'blob'
                }
            );

            // Download do PDF
            const blob = new Blob([pdfResponse.data], { type: 'application/pdf' });
            const pdfUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = pdfUrl;

            // Extrair nome do arquivo do header Content-Disposition
            const contentDisposition = pdfResponse.headers['content-disposition'];
            console.log('📄 Content-Disposition header:', contentDisposition);
            console.log('📄 Todos os headers:', pdfResponse.headers);

            let fileName = `boleto_energia_${boleto.uc}_${boleto.mes_referencia.replace('/', '-')}.pdf`;
            if (contentDisposition) {
                const fileNameMatch = contentDisposition.match(/filename="(.+)"/);
                if (fileNameMatch && fileNameMatch[1]) {
                    fileName = fileNameMatch[1];
                    console.log('✅ Nome extraído do header:', fileName);
                }
            } else {
                console.log('⚠️ Header content-disposition não encontrado, usando nome padrão');
            }

            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(pdfUrl);

            mostrarAlerta('PDF gerado com sucesso!', 'success');

        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            mostrarAlerta('Erro ao gerar PDF do boleto', 'danger');
        }
    };

    // Sincronizar status do boleto com a API do BB
    const sincronizarStatus = async (boleto, isRetry = false) => {
        const chave = `${boleto.uc}_${boleto.mes_referencia}`;
        setProcessando(prev => ({ ...prev, [chave]: true }));

        try {
            console.log('🔄 Sincronizando status do boleto:', boleto.numero_boleto);

            // SEMPRE renovar o token antes de sincronizar
            console.log('🔄 Renovando token OAuth...');
            localStorage.removeItem('bb_token');
            localStorage.removeItem('bb_token_expiry');
            const token = await obterToken();
            console.log('✅ Token renovado com sucesso:', token.substring(0, 30) + '...');

            const response = await axios.post(
                `${API_URL}/api/sincronizar-status-boleto`,
                {
                    numeroBoleto: boleto.numero_boleto,
                    token: token
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('✅ Status sincronizado:', response.data);

            // Recarregar lista
            await carregarBoletos();

            if (response.data.sincronizado) {
                mostrarAlerta(
                    `Status atualizado: ${response.data.statusAnterior} → ${response.data.statusAtual}`,
                    'success'
                );
            } else {
                mostrarAlerta('Status já está sincronizado com o BB', 'info');
            }

        } catch (error) {
            console.error('❌ Erro ao sincronizar status:', error);

            // Se foi erro de token expirado e não é retry, tentar novamente uma vez
            if (error.response?.status === 401 && error.response?.data?.tokenExpired && !isRetry) {
                console.log('⚠️ Token expirado, tentando novamente com token novo...');
                // Aguardar 1 segundo e tentar novamente
                await new Promise(resolve => setTimeout(resolve, 1000));
                return sincronizarStatus(boleto, true);
            }

            const mensagemErro = error.response?.data?.error || error.response?.data?.message || error.message || 'Erro desconhecido';
            const detalhes = error.response?.data?.details ? `\nDetalhes: ${error.response.data.details}` : '';
            mostrarAlerta(`Erro ao sincronizar status: ${mensagemErro}${detalhes}`, 'danger');
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };

    // Cancelar boleto (baixa na API do BB e muda status no DB)
    const cancelarBoleto = async (boleto) => {
        if (!window.confirm(`Tem certeza que deseja cancelar o boleto ${boleto.numero_boleto}?`)) {
            return;
        }

        const chave = `${boleto.uc}_${boleto.mes_referencia}`;
        setProcessando(prev => ({ ...prev, [chave]: true }));

        try {
            console.log('🚫 Iniciando cancelamento do boleto:', boleto.numero_boleto);

            // 1. Baixar boleto na API do BB
            const token = await obterToken();

            const payload = {
                numeroConvenio: 3648981,
                tipoDescricaoMotivoMovimento: 'ACERTOS'
            };

            console.log('📤 Enviando requisição de baixa para API do BB...');
            await axios.post(
                `${API_URL}/proxy-api/cobrancas/v2/boletos/${boleto.numero_boleto}/baixar`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Application-Key': '549827f7531a4cdd880437df70bf3d86',
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('✅ Boleto baixado com sucesso na API do BB');

            // 2. Atualizar status no banco de dados
            await axios.patch(
                `${API_URL}/api/dados-boleto-energia/${boleto.uc}/${encodeURIComponent(boleto.mes_referencia)}`,
                {
                    status: 'Cancelado',
                    numero_boleto: boleto.numero_boleto
                }
            );

            console.log('✅ Status atualizado no banco de dados');

            // 3. Recarregar lista
            await carregarBoletos();

            mostrarAlerta(`Boleto ${boleto.numero_boleto} cancelado com sucesso!`, 'success');

        } catch (error) {
            console.error('❌ Erro ao cancelar boleto:', error);
            const mensagemErro = error.response?.data?.message || error.message || 'Erro desconhecido';
            mostrarAlerta(`Erro ao cancelar boleto: ${mensagemErro}`, 'danger');
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };


    // Abrir modal de visualização
    const visualizarDetalhes = (boleto) => {
        setModalDetalhes({
            show: true,
            boleto: normalizarBoleto(boleto),
            editando: false,
            dadosEditados: null
        });
    };

    // Habilitar modo de edição
    const habilitarEdicao = () => {
        setModalDetalhes(prev => ({
            ...prev,
            editando: true,
            dadosEditados: { ...prev.boleto }
        }));
    };

    // Cancelar edição
    const cancelarEdicao = () => {
        setModalDetalhes(prev => ({
            ...prev,
            editando: false,
            dadosEditados: null
        }));
    };

    // Atualizar campo editado
    const atualizarCampoEditado = (campo, valor) => {
        setModalDetalhes(prev => ({
            ...prev,
            dadosEditados: {
                ...prev.dadosEditados,
                [campo]: valor
            }
        }));
    };

    // Salvar edições
    const salvarEdicoes = async () => {
        try {
            const dados = modalDetalhes.dadosEditados;

            await axios.patch(
                `${API_URL}/api/dados-boleto-energia/${dados.uc}/${encodeURIComponent(dados.mes_referencia)}`,
                {
                    // Dados do pagador
                    nome_completo: dados.nomeCompleto,
                    documento: dados.documento,
                    tipo_pessoa: dados.tipoPessoa,
                    endereco: dados.endereco,
                    bairro: dados.bairro,
                    cep: dados.cep,
                    cidade: dados.cidade,
                    uf: dados.uf,
                    email: dados.email,
                    telefone: dados.telefone,
                    // Consumo
                    energia_compensado: dados.energiaCompensado,
                    energia_nao_compensado: dados.energiaNaoCompensado,
                    energia_total: dados.energiaTotal,
                    // Valores
                    valor_energia_compensada: dados.valorEnergiaCompensada,
                    valor_bandeira_compensada: dados.valorBandeiraCompensada,
                    tarifa_minima_concessionaria: dados.tarifaMinimaConcessionaria,
                    valor_boleto: dados.valorBoleto,
                    valor_economia: dados.valor_economia || dados.valorEconomia,
                    valor_com_desconto: dados.valor_com_desconto,
                    valor_bandeira_com_desconto: dados.valor_bandeira_com_desconto,
                    valor_s_desconto: dados.valor_s_desconto,
                    data_vencimento: dados.dataVencimento || dados.data_vencimento
                }
            );

            mostrarAlerta('Dados atualizados com sucesso!', 'success');

            // Recarregar lista
            await carregarBoletos();

            // Fechar modal
            setModalDetalhes({ show: false, boleto: null, editando: false, dadosEditados: null });

        } catch (error) {
            console.error('Erro ao salvar edições:', error);
            mostrarAlerta('Erro ao salvar edições', 'danger');
        }
    };

    return (
        <Container fluid className="mt-4">
            <Row>
                <Col>
                    <Card>
                        <Card.Header className="bg-primary text-white">
                            <h4 className="mb-0">Gerar Boletos de Energia Automaticamente</h4>
                        </Card.Header>
                        <Card.Body>
                            {/* Filtros */}
                            <Form className="mb-4">
                                <Row>
                                    <Col md={3}>
                                        <Form.Group>
                                            <Form.Label>Status</Form.Label>
                                            <Form.Select
                                                value={filtros.status}
                                                onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
                                            >
                                                <option value="Todos">Todos</option>
                                                <option value="Pendente">Pendente</option>
                                                <option value="Boleto gerado">Boleto gerado</option>
                                                <option value="Pago">Pago</option>
                                                <option value="Cancelado">Cancelado</option>
                                                <option value="Vencido">Vencido</option>
                                                <option value="Erro">Erro</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </Col>
                                    <Col md={3}>
                                        <Form.Group>
                                            <Form.Label>UC</Form.Label>
                                            <Form.Control
                                                type="text"
                                                placeholder="Digite a UC"
                                                value={filtros.uc}
                                                onChange={(e) => setFiltros({ ...filtros, uc: e.target.value })}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={2}>
                                        <Form.Group>
                                            <Form.Label>Data Início</Form.Label>
                                            <Form.Control
                                                type="date"
                                                value={filtros.data_inicio}
                                                onChange={(e) => setFiltros({ ...filtros, data_inicio: e.target.value })}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={2}>
                                        <Form.Group>
                                            <Form.Label>Data Fim</Form.Label>
                                            <Form.Control
                                                type="date"
                                                value={filtros.data_fim}
                                                onChange={(e) => setFiltros({ ...filtros, data_fim: e.target.value })}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={2} className="d-flex align-items-end">
                                        <Button
                                            variant="primary"
                                            onClick={carregarBoletos}
                                            disabled={carregando}
                                            className="w-100"
                                        >
                                            {carregando ? <Spinner animation="border" size="sm" /> : 'Buscar'}
                                        </Button>
                                    </Col>
                                </Row>
                            </Form>

                            {/* Tabela */}
                            {carregando ? (
                                <div className="text-center py-5">
                                    <Spinner animation="border" variant="primary" />
                                    <p className="mt-2">Carregando boletos...</p>
                                </div>
                            ) : boletos.length === 0 ? (
                                <Alert variant="info">
                                    Nenhum boleto de energia encontrado. Os dados serão recebidos automaticamente do Sistema_Faturas.
                                </Alert>
                            ) : (
                                <div className="table-responsive">
                                    <Table hover size="sm" style={{ fontSize: '0.9rem' }}>
                                        <thead style={{ backgroundColor: '#1b1f3b', color: 'white', borderBottom: '3px solid #00ff00' }}>
                                            <tr>
                                                <th style={{ padding: '12px 8px' }}>Status</th>
                                                <th style={{ padding: '12px 8px' }}>UC</th>
                                                <th style={{ padding: '12px 8px' }}>Mês</th>
                                                <th style={{ padding: '12px 8px' }}>Cliente</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Economia</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {boletos.map((boletoOriginal) => {
                                                const boleto = normalizarBoleto(boletoOriginal);
                                                const chave = `${boleto.uc}_${boleto.mes_referencia}`;
                                                return (
                                                    <tr key={chave} style={{ borderBottom: '1px solid #e0e0e0' }}>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle' }}>
                                                            <Badge
                                                                bg={getBadgeStatus(boleto.status)}
                                                                style={{ fontSize: '0.75rem', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                            >
                                                                {boleto.status === 'Pendente' && (
                                                                    <>
                                                                        <Clock size={14} /> Pendente
                                                                    </>
                                                                )}
                                                                {boleto.status === 'Boleto gerado' && (
                                                                    <>
                                                                        <CheckCircle size={14} /> Gerado
                                                                    </>
                                                                )}
                                                                {boleto.status === 'Cancelado' && (
                                                                    <>
                                                                        <RefreshCw size={14} /> Cancelado
                                                                    </>
                                                                )}
                                                                {boleto.status === 'Pago' && (
                                                                    <>
                                                                        <CheckCircle size={14} /> Pago
                                                                    </>
                                                                )}
                                                                {boleto.status === 'Vencido' && (
                                                                    <>
                                                                        <Clock size={14} /> Vencido
                                                                    </>
                                                                )}
                                                                {boleto.status === 'Erro' && (
                                                                    <>
                                                                        <FileText size={14} /> Erro
                                                                    </>
                                                                )}
                                                            </Badge>
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', fontWeight: '500' }}>
                                                            {boleto.uc}
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle' }}>
                                                            {boleto.mes_referencia}
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle' }}>
                                                            <div>
                                                                <div style={{ fontWeight: '500', marginBottom: '2px' }}>
                                                                    {boleto.nomeCompleto}
                                                                </div>
                                                                <small style={{ color: '#666' }}>
                                                                    {formatarDocumento(boleto.documento, boleto.tipoPessoa)}
                                                                </small>
                                                            </div>
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'right', fontWeight: '600' }}>
                                                            {formatarValor(boleto.valorBoleto)}
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'right', color: '#00aa00', fontWeight: '600' }}>
                                                            {formatarValor(boleto.valorEconomia || 0)}
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle' }}>
                                                            <div className="d-flex gap-1 justify-content-center flex-wrap">
                                                                {boleto.status === 'Pendente' && (
                                                                    <Button
                                                                        variant="success"
                                                                        size="sm"
                                                                        onClick={() => gerarBoleto(boleto)}
                                                                        disabled={processando[chave]}
                                                                        style={{ minWidth: '70px' }}
                                                                    >
                                                                        {processando[chave] ? (
                                                                            <>
                                                                                <Spinner animation="border" size="sm" className="me-1" />
                                                                                ...
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <FileText size={16} className="me-1" />
                                                                                Gerar
                                                                            </>
                                                                        )}
                                                                    </Button>
                                                                )}
                                                                {boleto.status === 'Boleto gerado' && boleto.numero_boleto && (
                                                                    <>
                                                                        <Button
                                                                            variant="success"
                                                                            size="sm"
                                                                            onClick={() => gerarPDFBoleto(boleto)}
                                                                            title="Gerar PDF do boleto"
                                                                            style={{ minWidth: '60px' }}
                                                                        >
                                                                            <Download size={16} className="me-1" />
                                                                            PDF
                                                                        </Button>
                                                                        <Button
                                                                            variant="warning"
                                                                            size="sm"
                                                                            onClick={() => cancelarBoleto(boleto)}
                                                                            disabled={processando[chave]}
                                                                            title="Cancelar boleto (baixa no BB)"
                                                                            style={{ minWidth: '80px' }}
                                                                        >
                                                                            {processando[chave] ? (
                                                                                <>
                                                                                    <Spinner animation="border" size="sm" className="me-1" />
                                                                                    ...
                                                                                </>
                                                                            ) : (
                                                                                'Cancelar'
                                                                            )}
                                                                        </Button>
                                                                    </>
                                                                )}
                                                                <Button
                                                                    variant="outline-info"
                                                                    size="sm"
                                                                    onClick={() => visualizarDetalhes(boleto)}
                                                                    title="Ver detalhes"
                                                                    style={{ minWidth: '50px' }}
                                                                >
                                                                    <Eye size={16} />
                                                                </Button>
                                                                <Button
                                                                    variant="outline-secondary"
                                                                    size="sm"
                                                                    onClick={() => sincronizarStatus(boleto)}
                                                                    disabled={processando[chave]}
                                                                    title="Sincronizar status com BB"
                                                                >
                                                                    {processando[chave] ? (
                                                                        <Spinner animation="border" size="sm" />
                                                                    ) : (
                                                                        <RefreshCw size={16} />
                                                                    )}
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </Table>
                                </div>
                            )}

                            {/* Informações adicionais */}
                            <Row className="mt-3">
                                <Col>
                                    <Alert variant="info">
                                        <strong>Total de boletos:</strong> {boletos.length}
                                        {' | '}
                                        <strong>Pendentes:</strong> {boletos.filter(b => b.status === 'Pendente').length}
                                        {' | '}
                                        <strong>Gerados:</strong> {boletos.filter(b => b.status === 'Boleto gerado').length}
                                    </Alert>
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Modal de detalhes do boleto - REDESENHADO */}
            <Modal show={modalDetalhes.show} onHide={() => setModalDetalhes({ show: false, boleto: null, editando: false, dadosEditados: null })} size="xl">
                <Modal.Header
                    closeButton
                    closeVariant="white"
                    style={{ backgroundColor: '#1b1f3b', color: 'white' }}
                >
                    <Modal.Title>
                        {modalDetalhes.editando ? 'Editar Dados da Fatura' : 'Detalhes do Boleto de Energia'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ backgroundColor: '#f8f9fa' }}>
                    {modalDetalhes.boleto && (
                        <div>
                            {/* Card de Status e Info Principal */}
                            <Card className="mb-3" style={{ border: '2px solid #00ff00' }}>
                                <Card.Body>
                                    <Row>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <h6 className="text-muted mb-1">UC</h6>
                                                <h4 style={{ color: '#1b1f3b' }}>{modalDetalhes.boleto.uc}</h4>
                                            </div>
                                        </Col>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <h6 className="text-muted mb-1">Mês Referência</h6>
                                                <h5>{modalDetalhes.boleto.mes_referencia}</h5>
                                            </div>
                                        </Col>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <h6 className="text-muted mb-1">Status</h6>
                                                <Badge bg={getBadgeStatus(modalDetalhes.boleto.status)} style={{ fontSize: '1rem', padding: '8px 16px' }}>
                                                    {modalDetalhes.boleto.status}
                                                </Badge>
                                            </div>
                                        </Col>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <h6 className="text-muted mb-1">Vencimento</h6>
                                                <h5 className="text-danger">{modalDetalhes.boleto.dataVencimento || modalDetalhes.boleto.data_vencimento || '-'}</h5>
                                            </div>
                                        </Col>
                                    </Row>
                                </Card.Body>
                            </Card>

                            <Row>
                                {/* Coluna Esquerda - Dados do Cliente */}
                                <Col md={6}>
                                    <Card className="mb-3">
                                        <Card.Header style={{ backgroundColor: '#1b1f3b', color: 'white' }}>
                                            <strong>Dados do Pagador</strong>
                                        </Card.Header>
                                        <Card.Body>
                                            {modalDetalhes.editando ? (
                                                <>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Nome</small></Form.Label>
                                                        <Form.Control
                                                            type="text"
                                                            value={modalDetalhes.dadosEditados.nomeCompleto || ''}
                                                            onChange={(e) => atualizarCampoEditado('nomeCompleto', e.target.value)}
                                                        />
                                                    </Form.Group>
                                                    <Row>
                                                        <Col md={8}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">Documento (CPF/CNPJ)</small></Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.documento || ''}
                                                                    onChange={(e) => atualizarCampoEditado('documento', e.target.value)}
                                                                    placeholder="00000000000 ou 00000000000000"
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={4}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">Tipo</small></Form.Label>
                                                                <Form.Select
                                                                    value={modalDetalhes.dadosEditados.tipoPessoa || '1'}
                                                                    onChange={(e) => atualizarCampoEditado('tipoPessoa', e.target.value)}
                                                                >
                                                                    <option value="1">CPF</option>
                                                                    <option value="2">CNPJ</option>
                                                                </Form.Select>
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Endereço</small></Form.Label>
                                                        <Form.Control
                                                            type="text"
                                                            value={modalDetalhes.dadosEditados.endereco || ''}
                                                            onChange={(e) => atualizarCampoEditado('endereco', e.target.value)}
                                                        />
                                                    </Form.Group>
                                                    <Row>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">Bairro</small></Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.bairro || ''}
                                                                    onChange={(e) => atualizarCampoEditado('bairro', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">CEP</small></Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.cep || ''}
                                                                    onChange={(e) => atualizarCampoEditado('cep', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                    <Row>
                                                        <Col md={8}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">Cidade</small></Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.cidade || ''}
                                                                    onChange={(e) => atualizarCampoEditado('cidade', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={4}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">UF</small></Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.uf || ''}
                                                                    onChange={(e) => atualizarCampoEditado('uf', e.target.value)}
                                                                    maxLength={2}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                    <Row>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">Email</small></Form.Label>
                                                                <Form.Control
                                                                    type="email"
                                                                    value={modalDetalhes.dadosEditados.email || ''}
                                                                    onChange={(e) => atualizarCampoEditado('email', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-3">
                                                                <Form.Label><small className="text-muted">Telefone</small></Form.Label>
                                                                <Form.Control
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.telefone || ''}
                                                                    onChange={(e) => atualizarCampoEditado('telefone', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="mb-2">
                                                        <small className="text-muted">Nome</small>
                                                        <div><strong>{modalDetalhes.boleto.nomeCompleto}</strong></div>
                                                    </div>
                                                    <div className="mb-2">
                                                        <small className="text-muted">Documento</small>
                                                        <div>{formatarDocumento(modalDetalhes.boleto.documento, modalDetalhes.boleto.tipoPessoa)}</div>
                                                    </div>
                                                    <div className="mb-2">
                                                        <small className="text-muted">Endereço</small>
                                                        <div>{modalDetalhes.boleto.endereco}</div>
                                                    </div>
                                                    <Row>
                                                        <Col md={6}>
                                                            <small className="text-muted">Bairro</small>
                                                            <div>{modalDetalhes.boleto.bairro}</div>
                                                        </Col>
                                                        <Col md={6}>
                                                            <small className="text-muted">CEP</small>
                                                            <div>{modalDetalhes.boleto.cep}</div>
                                                        </Col>
                                                    </Row>
                                                    <div className="mt-2">
                                                        <small className="text-muted">Cidade/UF</small>
                                                        <div>{modalDetalhes.boleto.cidade} - {modalDetalhes.boleto.uf}</div>
                                                    </div>
                                                    {(modalDetalhes.boleto.email || modalDetalhes.boleto.telefone) && (
                                                        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #dee2e6' }}>
                                                            {modalDetalhes.boleto.email && (
                                                                <div className="mb-2">
                                                                    <small className="text-muted">Email</small>
                                                                    <div>{modalDetalhes.boleto.email}</div>
                                                                </div>
                                                            )}
                                                            {modalDetalhes.boleto.telefone && (
                                                                <div>
                                                                    <small className="text-muted">Telefone</small>
                                                                    <div>{modalDetalhes.boleto.telefone}</div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </Card.Body>
                                    </Card>
                                </Col>

                                {/* Coluna Direita - Consumo */}
                                <Col md={6}>
                                    <Card className="mb-3">
                                        <Card.Header style={{ backgroundColor: '#1b1f3b', color: 'white' }}>
                                            <strong>Consumo de Energia</strong>
                                        </Card.Header>
                                        <Card.Body>
                                            {modalDetalhes.editando ? (
                                                <>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Compensado (kWh)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.energiaCompensado || 0}
                                                            onChange={(e) => atualizarCampoEditado('energiaCompensado', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Não Compensado (kWh)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.energiaNaoCompensado || 0}
                                                            onChange={(e) => atualizarCampoEditado('energiaNaoCompensado', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Total (kWh)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.energiaTotal || 0}
                                                            onChange={(e) => atualizarCampoEditado('energiaTotal', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                </>
                                            ) : (
                                                <>
                                                    <Row>
                                                        <Col xs={6}>
                                                            <div className="text-center p-2" style={{ backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
                                                                <small className="text-muted">Compensado</small>
                                                                <h5 className="mb-0">{modalDetalhes.boleto.energiaCompensado || 0} kWh</h5>
                                                            </div>
                                                        </Col>
                                                        <Col xs={6}>
                                                            <div className="text-center p-2" style={{ backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
                                                                <small className="text-muted">Não Compensado</small>
                                                                <h5 className="mb-0">{modalDetalhes.boleto.energiaNaoCompensado || 0} kWh</h5>
                                                            </div>
                                                        </Col>
                                                    </Row>
                                                    <div className="text-center mt-3 p-2" style={{ backgroundColor: '#e3f2fd', borderRadius: '5px' }}>
                                                        <small className="text-muted">Total</small>
                                                        <h4 className="mb-0 text-primary">{modalDetalhes.boleto.energiaTotal || 0} kWh</h4>
                                                    </div>
                                                </>
                                            )}
                                        </Card.Body>
                                    </Card>
                                </Col>
                            </Row>

                            {/* Card de Valores Financeiros */}
                            <Card className="mb-3">
                                <Card.Header style={{ backgroundColor: '#1b1f3b', color: 'white' }}>
                                    <strong>Valores Financeiros</strong>
                                </Card.Header>
                                <Card.Body>
                                    {modalDetalhes.editando ? (
                                        <>
                                            <Row>
                                                <Col md={4}>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Valor Energia Compensada (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valorEnergiaCompensada || 0}
                                                            onChange={(e) => atualizarCampoEditado('valorEnergiaCompensada', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-success">✓ Com Desconto AUPUS (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_com_desconto || 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_com_desconto', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={4}>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Valor Bandeira Compensada (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valorBandeiraCompensada || 0}
                                                            onChange={(e) => atualizarCampoEditado('valorBandeiraCompensada', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-success">✓ Com Desconto AUPUS (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_bandeira_com_desconto || 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_bandeira_com_desconto', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={4}>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Tarifa Mínima Concessionária (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.tarifaMinimaConcessionaria || 0}
                                                            onChange={(e) => atualizarCampoEditado('tarifaMinimaConcessionaria', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-muted">Valor sem Desconto (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_s_desconto || 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_s_desconto', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                            </Row>

                                            <hr />

                                            <Row>
                                                <Col md={6}>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-primary">Valor Total do Boleto (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valorBoleto || 0}
                                                            onChange={(e) => atualizarCampoEditado('valorBoleto', parseFloat(e.target.value) || 0)}
                                                            style={{ fontWeight: 'bold', fontSize: '1.1rem' }}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={6}>
                                                    <Form.Group className="mb-3">
                                                        <Form.Label><small className="text-success">Economia Total (R$)</small></Form.Label>
                                                        <Form.Control
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_economia || modalDetalhes.dadosEditados.valorEconomia || 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_economia', parseFloat(e.target.value) || 0)}
                                                            style={{ fontWeight: 'bold', fontSize: '1.1rem' }}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                            </Row>
                                        </>
                                    ) : (
                                        <>
                                            <Row>
                                                <Col md={4}>
                                                    <div className="mb-3">
                                                        <small className="text-muted">Valor Energia Compensada</small>
                                                        <h6>{formatarValor(modalDetalhes.boleto.valorEnergiaCompensada)}</h6>
                                                    </div>
                                                    {modalDetalhes.boleto.valor_com_desconto && (
                                                        <div className="mb-3">
                                                            <small className="text-success">✓ Com Desconto AUPUS</small>
                                                            <h6 className="text-success">{formatarValor(modalDetalhes.boleto.valor_com_desconto)}</h6>
                                                        </div>
                                                    )}
                                                </Col>
                                                <Col md={4}>
                                                    <div className="mb-3">
                                                        <small className="text-muted">Valor Bandeira Compensada</small>
                                                        <h6>{formatarValor(modalDetalhes.boleto.valorBandeiraCompensada)}</h6>
                                                    </div>
                                                    {modalDetalhes.boleto.valor_bandeira_com_desconto && (
                                                        <div className="mb-3">
                                                            <small className="text-success">✓ Com Desconto AUPUS</small>
                                                            <h6 className="text-success">{formatarValor(modalDetalhes.boleto.valor_bandeira_com_desconto)}</h6>
                                                        </div>
                                                    )}
                                                </Col>
                                                <Col md={4}>
                                                    <div className="mb-3">
                                                        <small className="text-muted">Tarifa Mínima Concessionária</small>
                                                        <h6 className="text-danger">{formatarValor(modalDetalhes.boleto.tarifaMinimaConcessionaria)}</h6>
                                                    </div>
                                                    {modalDetalhes.boleto.valor_s_desconto && (
                                                        <div className="mb-3">
                                                            <small className="text-muted">Valor sem Desconto</small>
                                                            <h6 className="text-muted"><s>{formatarValor(modalDetalhes.boleto.valor_s_desconto)}</s></h6>
                                                        </div>
                                                    )}
                                                </Col>
                                            </Row>

                                            <hr />

                                            <Row>
                                                <Col md={6}>
                                                    <div className="p-3 text-center" style={{ backgroundColor: '#e3f2fd', borderRadius: '8px', border: '2px solid #2196f3' }}>
                                                        <small className="text-muted">Valor Total do Boleto</small>
                                                        <h3 className="mb-0 text-primary">{formatarValor(modalDetalhes.boleto.valorBoleto)}</h3>
                                                    </div>
                                                </Col>
                                                <Col md={6}>
                                                    <div className="p-3 text-center" style={{ backgroundColor: '#e8f5e9', borderRadius: '8px', border: '2px solid #4caf50' }}>
                                                        <small className="text-muted">Economia Total</small>
                                                        <h3 className="mb-0 text-success">{formatarValor(modalDetalhes.boleto.valor_economia || modalDetalhes.boleto.valorEconomia)}</h3>
                                                    </div>
                                                </Col>
                                            </Row>
                                        </>
                                    )}
                                </Card.Body>
                            </Card>

                            {/* Card de Informações do Sistema */}
                            {(modalDetalhes.boleto.numero_boleto || modalDetalhes.boleto.data_recebimento || modalDetalhes.boleto.data_geracao_boleto) && (
                                <Card>
                                    <Card.Header style={{ backgroundColor: '#6c757d', color: 'white' }}>
                                        <strong>Informações do Sistema</strong>
                                    </Card.Header>
                                    <Card.Body>
                                        <Row>
                                            {modalDetalhes.boleto.numero_boleto && (
                                                <Col md={4}>
                                                    <small className="text-muted">Número do Boleto BB</small>
                                                    <div><code>{modalDetalhes.boleto.numero_boleto}</code></div>
                                                </Col>
                                            )}
                                            {modalDetalhes.boleto.data_recebimento && (
                                                <Col md={4}>
                                                    <small className="text-muted">Data de Recebimento</small>
                                                    <div>{formatarData(modalDetalhes.boleto.data_recebimento)}</div>
                                                </Col>
                                            )}
                                            {modalDetalhes.boleto.data_geracao_boleto && (
                                                <Col md={4}>
                                                    <small className="text-muted">Data de Geração</small>
                                                    <div>{formatarData(modalDetalhes.boleto.data_geracao_boleto)}</div>
                                                </Col>
                                            )}
                                        </Row>
                                    </Card.Body>
                                </Card>
                            )}
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    {modalDetalhes.editando ? (
                        <>
                            <Button variant="secondary" onClick={cancelarEdicao}>
                                Cancelar
                            </Button>
                            <Button variant="success" onClick={salvarEdicoes}>
                                Salvar Alterações
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                variant="primary"
                                onClick={habilitarEdicao}
                                disabled={modalDetalhes.boleto?.status === 'Boleto gerado'}
                                title={modalDetalhes.boleto?.status === 'Boleto gerado' ? 'Não é possível editar boleto já gerado' : 'Editar dados da fatura'}
                            >
                                Editar
                            </Button>
                            <Button variant="secondary" onClick={() => setModalDetalhes({ show: false, boleto: null, editando: false, dadosEditados: null })}>
                                Fechar
                            </Button>
                        </>
                    )}
                </Modal.Footer>
            </Modal>

            {/* Modal para entrada manual de vencimento */}
            <Modal show={modalVencimento.show} onHide={() => setModalVencimento({ show: false, boleto: null, dataVencimento: '' })}>
                <Modal.Header closeButton>
                    <Modal.Title>Informar Data de Vencimento</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Alert variant="warning">
                        A data de vencimento padrão (dia 20 do mês seguinte) já passou.
                        Por favor, informe uma nova data de vencimento.
                    </Alert>
                    {modalVencimento.boleto && (
                        <div className="mb-3">
                            <strong>UC:</strong> {modalVencimento.boleto.uc}<br/>
                            <strong>Mês:</strong> {modalVencimento.boleto.mes_referencia}<br/>
                            <strong>Valor:</strong> {formatarValor(modalVencimento.boleto.valorBoleto)}
                        </div>
                    )}
                    <Form.Group>
                        <Form.Label>Data de Vencimento</Form.Label>
                        <Form.Control
                            type="date"
                            value={modalVencimento.dataVencimento}
                            onChange={(e) => setModalVencimento({
                                ...modalVencimento,
                                dataVencimento: e.target.value
                            })}
                            min={new Date().toISOString().split('T')[0]}
                        />
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setModalVencimento({ show: false, boleto: null, dataVencimento: '' })}>
                        Cancelar
                    </Button>
                    <Button variant="primary" onClick={confirmarVencimentoManual}>
                        Confirmar e Gerar Boleto
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
}

export default GerarBoletoEnergia;
