import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Badge, Alert, Spinner, Modal, ProgressBar, Tab, Tabs, Dropdown } from 'react-bootstrap';
import api from '../services/api';
import { formatarCPFComMascara, formatarCNPJComMascara, formatarValor } from '../utils/formatters';
import { removerAcentos } from '../utils/formatters';
import { obterProximoSequencial, consultarPixBoleto, obterToken } from '../services/api';
import { Clock, CheckCircle, FileText, Download, Eye, RefreshCw, PackageOpen, Send, XCircle, Play, RotateCcw, CheckSquare, Square, MessageCircle, Mail, AlertCircle, Edit3, PlusCircle, Trash2, Search, ChevronDown, Receipt } from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function GerarBoletoEnergia({ mostrarAlerta }) {
    const [boletos, setBoletos] = useState([]);
    const [filtros, setFiltros] = useState({
        status: 'Todos',
        uc: '',
        mes_referencia: '', // Será definido com o mês mais recente com registros
        compensacao: 'Todos'
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
    const [baixandoTodos, setBaixandoTodos] = useState(false);
    const [progresso, setProgresso] = useState({ atual: 0, total: 0 });
    const [progressoJuncao, setProgressoJuncao] = useState({ atual: 0, total: 0 });
    const [mostrarModalMes, setMostrarModalMes] = useState(false);
    const [mesSelecionado, setMesSelecionado] = useState('');
    const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
    const [mostrarModalJuntar, setMostrarModalJuntar] = useState(false);
    const [juntarComFatura, setJuntarComFatura] = useState(false);
    const [etapaAtual, setEtapaAtual] = useState('geracao'); // 'geracao' ou 'juncao'
    const [mostrarModalDownloadIndividual, setMostrarModalDownloadIndividual] = useState(false);
    const [boletoParaDownload, setBoletoParaDownload] = useState(null);
    const [modalAbatimento, setModalAbatimento] = useState({
        show: false,
        boleto: null,
        valorAbatimento: 0,
        motivoAbatimento: ''
    });

    // Estados para geração em batch de boletos validados
    const [gerandoValidados, setGerandoValidados] = useState(false);
    const [jobAtual, setJobAtual] = useState(null);
    const [mostrarModalJob, setMostrarModalJob] = useState(false);

    // Estados para modal de envio (WhatsApp/Email)
    const [modalEnvio, setModalEnvio] = useState({
        show: false,
        boleto: null,
        tipoEnvio: 'whatsapp', // 'whatsapp', 'email' ou 'ambos'
        tipoArquivo: 'net', // 'net' (boleto simples) ou 'net_combinado' (boleto + fatura EQTL)
        telefone: '',
        email: '',
        emailSecundario: '', // Email secundário (opcional)
        enviando: false,
        statusEnvio: null, // { tipo: 'success'|'error'|'warning', mensagem: '', jaEnviado: false }
        forcarReenvio: false,
        abaAtiva: 'envio', // 'envio' ou 'mensagem'
        mensagemWhatsapp: '',
        mensagemEmail: '',
        assuntoEmail: '',
        mensagemEditada: false
    });

    // Estado para status de envio dos boletos (mapa: arquivo -> {whatsapp: bool, email: bool})
    const [statusEnvios, setStatusEnvios] = useState({});

    // Estado para modal de criação de boleto manual (cogeração)
    const [modalBoletoManual, setModalBoletoManual] = useState({
        show: false,
        salvando: false,
        // Dados do pagador
        uc: '', // Número da UC
        nome: '',
        documento: '',
        endereco: '',
        bairro: '',
        cep: '',
        cidade: '',
        uf: '',
        // Dados do boleto
        mesReferencia: '', // Mês de referência (MM/YYYY)
        dataVencimento: '', // Data de vencimento do boleto
        economiaGerada: '' // Valor direto do boleto
    });

    // Carregar meses disponíveis ao montar componente
    useEffect(() => {
        carregarMesesDisponiveis();
    }, []);

    // Recarregar boletos quando o filtro de mês mudar
    useEffect(() => {
        if (filtros.mes_referencia) {
            carregarBoletos();
        }
    }, [filtros.mes_referencia]);

    // Carregar meses disponíveis para o filtro (busca da tabela boletos_energia)
    const carregarMesesDisponiveis = async () => {
        try {
            console.log('🔄 Carregando meses disponíveis da tabela boletos_energia...');
            const response = await api.get('/api/meses-disponiveis-boletos');
            const meses = response.data.meses || [];
            console.log('✅ Meses recebidos:', meses);
            setMesesDisponiveis(meses);

            // Definir o mês mais recente como padrão (primeiro da lista já vem ordenado desc)
            if (meses.length > 0 && !filtros.mes_referencia) {
                setFiltros(prev => ({ ...prev, mes_referencia: meses[0] }));
            }
        } catch (error) {
            console.error('❌ Erro ao carregar meses disponíveis:', error);
            setMesesDisponiveis([]);
        }
    };

    // Carregar boletos da API
    const carregarBoletos = async () => {
        setCarregando(true);
        try {
            const params = new URLSearchParams();
            if (filtros.status !== 'Todos') params.append('status', filtros.status);
            if (filtros.uc) params.append('uc', filtros.uc);
            if (filtros.mes_referencia) params.append('mes_referencia', filtros.mes_referencia);

            // Adicionar timestamp para evitar cache
            params.append('_t', new Date().getTime());

            const response = await api.get(`/api/dados-boleto-energia?${params.toString()}`);
            console.log('📋 Boletos carregados:', response.data.boletos.length);

            // Log do status de cada boleto
            response.data.boletos.forEach(b => {
                console.log(`Boleto ${b.numero_boleto}: status = ${b.status}`);
            });

            // Forçar atualização do estado com novo array
            setBoletos([...response.data.boletos]);

            // Carregar status de envio para os boletos
            if (filtros.mes_referencia) {
                carregarStatusEnvios(filtros.mes_referencia);
            }
        } catch (error) {
            console.error('Erro ao carregar boletos:', error);
            mostrarAlerta('Erro ao carregar boletos de energia', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    // Carregar status de envios do banco de dados
    const carregarStatusEnvios = async (mesReferencia) => {
        try {
            const response = await api.get(`/api/sistema-faturas/status-envios?mes_referencia=${mesReferencia}`);
            // Usar o mapa de envios por UC retornado pela API
            // Isso permite identificar envios independente do nome exato do arquivo ou pasta
            if (response.data.enviosPorUc) {
                setStatusEnvios(response.data.enviosPorUc);
            } else {
                // Fallback: organizar por arquivo (compatibilidade)
                const envios = {};
                (response.data.envios || []).forEach(envio => {
                    if (!envios[envio.arquivo]) {
                        envios[envio.arquivo] = { whatsapp: false, email: false };
                    }
                    if (envio.tipo_envio === 'whatsapp' && envio.status === 'enviado') {
                        envios[envio.arquivo].whatsapp = true;
                    }
                    if (envio.tipo_envio === 'email' && envio.status === 'enviado') {
                        envios[envio.arquivo].email = true;
                    }
                });
                setStatusEnvios(envios);
            }
        } catch (error) {
            console.error('Erro ao carregar status de envios:', error);
        }
    };

    // Obter status de envio de um boleto
    const getStatusEnvio = (boleto) => {
        // Se não tem numero_boleto (nunca foi gerado), não se aplica
        if (!boleto.numero_boleto) {
            return { tipo: 'na', label: 'N/A', cor: '#6c757d' };
        }

        // Buscar pelo UC diretamente (novo método - mais confiável)
        const statusPorUc = statusEnvios[boleto.uc];
        if (statusPorUc) {
            if (statusPorUc.whatsapp && statusPorUc.email) {
                return { tipo: 'ambos', label: 'WhatsApp + Email', cor: '#198754' };
            }
            if (statusPorUc.whatsapp) {
                return { tipo: 'whatsapp', label: 'WhatsApp', cor: '#25D366' };
            }
            if (statusPorUc.email) {
                return { tipo: 'email', label: 'Email', cor: '#0d6efd' };
            }
        }

        return { tipo: 'nao_enviado', label: 'Não enviado', cor: '#dc3545' };
    };

    // Calcular vencimento automático baseado no vencimento_consorcio (dia do mês definido no CRM)
    const calcularVencimento = (mesReferencia, vencimentoConsorcio) => {
        // OBRIGATÓRIO: vencimento_consorcio deve estar definido no CRM
        if (!vencimentoConsorcio || vencimentoConsorcio === 'nan' || isNaN(parseInt(vencimentoConsorcio))) {
            // Retorna objeto de erro se não tiver dia de vencimento configurado
            return { erro: 'Dia de vencimento não configurado no CRM para este cliente.' };
        }

        const dia = parseInt(vencimentoConsorcio);
        const [mes, ano] = mesReferencia.split('/');
        const mesVencimento = (parseInt(mes) % 12) + 1;
        const anoVencimento = mesVencimento === 1 ? parseInt(ano) + 1 : parseInt(ano);
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const dataVencimento = new Date(anoVencimento, mesVencimento - 1, dia);

        // Se a data calculada já passou, precisa entrada manual
        if (dataVencimento < hoje) {
            return null; // Indicará que precisa entrada manual
        }

        return `${String(dia).padStart(2, '0')}/${String(mesVencimento).padStart(2, '0')}/${anoVencimento}`;
    };

    // Verificar se precisa entrada manual de vencimento
    const verificarVencimento = (dadosEnergia) => {
        const vencimento = calcularVencimento(dadosEnergia.mes_referencia, dadosEnergia.vencimento_consorcio);

        // Se retornou erro (vencimento_consorcio não configurado)
        if (vencimento && vencimento.erro) {
            mostrarAlerta(`${vencimento.erro} (UC: ${dadosEnergia.uc})`, 'danger');
            return { erro: vencimento.erro };
        }

        if (!vencimento) {
            // Data já passou, precisa entrada manual
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
        // Detectar tipo de pessoa baseado no documento
        const doc = boleto.documento || boleto.cpf_cnpj || '';
        const docLimpo = String(doc).replace(/\D/g, '');
        const tipoPessoaDetectado = docLimpo.length > 11 ? 'CNPJ' : 'CPF';

        return {
            ...boleto,
            tipoPessoa: boleto.tipoPessoa || boleto.tipo_pessoa || tipoPessoaDetectado,
            nomeCompleto: boleto.nomeCompleto || boleto.nome_completo,
            documento: boleto.documento || boleto.cpf_cnpj, // Mapear cpf_cnpj para documento
            valorBoleto: boleto.valorBoleto ?? boleto.valor_boleto,
            energiaTotal: boleto.energiaTotal ?? boleto.energia_total,
            energiaCompensado: boleto.energiaCompensado ?? boleto.energia_compensado,
            energiaNaoCompensado: boleto.energiaNaoCompensado ?? boleto.energia_nao_compensado,
            // Novos campos de compensação completa (normalizados para camelCase)
            energiaCompensadoOriginal: boleto.energia_compensado_original ?? boleto.energiaCompensadoOriginal,
            energiaNaoCompensadoOriginal: boleto.energia_nao_compensado_original ?? boleto.energiaNaoCompensadoOriginal,
            energiaCompensadoCorrigido: boleto.energia_compensado_corrigido ?? boleto.energiaCompensadoCorrigido,
            energiaNaoCompensadoCorrigido: boleto.energia_nao_compensado_corrigido ?? boleto.energiaNaoCompensadoCorrigido,
            compensacaoCompletaAplicada: boleto.compensacao_completa_aplicada || boleto.compensacaoCompletaAplicada || false,
            vencimentoConsorcio: boleto.vencimentoConsorcio || boleto.vencimento_consorcio,
            dataVencimento: boleto.dataVencimento || boleto.data_vencimento,
            valorAupus: boleto.valorAupus ?? boleto.valor_aupus,
            valorConsorcio: boleto.valorConsorcio ?? boleto.valor_consorcio ?? boleto.valorBoleto ?? boleto.valor_boleto,
            valorEconomia: boleto.valorEconomia ?? boleto.valor_economia,
            valor_economia: boleto.valor_economia ?? boleto.valorEconomia,
            valorEnergiaCompensada: boleto.valorEnergiaCompensada ?? boleto.valor_energia_compensada,
            valorBandeiraCompensada: boleto.valorBandeiraCompensada ?? boleto.valor_bandeira_compensada,
            valorComDesconto: boleto.valorComDesconto ?? boleto.valor_com_desconto,
            valor_com_desconto: boleto.valor_com_desconto ?? boleto.valorComDesconto,
            valorBandeiraComDesconto: boleto.valorBandeiraComDesconto ?? boleto.valor_bandeira_com_desconto,
            valor_bandeira_com_desconto: boleto.valor_bandeira_com_desconto ?? boleto.valorBandeiraComDesconto,
            valorComDescontoAupus: boleto.valorComDescontoAupus ?? boleto.valor_com_desconto_aupus,
            valor_com_desconto_aupus: boleto.valor_com_desconto_aupus ?? boleto.valorComDescontoAupus,
            tarifaMinimaConcessionaria: boleto.tarifaMinimaConcessionaria ?? boleto.tarifa_minima_concessionaria
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

            // 1. Verificar/calcular vencimento baseado no vencimento_consorcio do CRM
            let dataVencimento = dataVencimentoManual;
            if (!dataVencimento) {
                dataVencimento = verificarVencimento(dadosEnergia);
                // Se retornou erro (vencimento_consorcio não configurado)
                if (dataVencimento && dataVencimento.erro) {
                    setProcessando(prev => ({ ...prev, [chave]: false }));
                    return; // Alerta já foi mostrado
                }
                // Se retornou null (data já passou, modal será exibido)
                if (!dataVencimento) {
                    setProcessando(prev => ({ ...prev, [chave]: false }));
                    return;
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

            // Formatar CEP (RETORNA STRING ou undefined se inválido!)
            const cepLimpo = String(dadosEnergia.cep || '').replace(/\D/g, '');
            const cepFormatado = cepLimpo.length === 8 ? cepLimpo : undefined;

            // 5. OBTER PRÓXIMO SEQUENCIAL E TENTAR GERAR BOLETO (COM RETRY)
            console.log('🔢 Obtendo próximo sequencial automaticamente...');
            let sequencial = await obterProximoSequencial();
            console.log(`🔢 Sequencial inicial obtido: ${sequencial}`);

            // Sistema de retry: tenta até 5 vezes se o número já foi usado
            let response;
            let token = await obterToken();
            const maxTentativas = 5;

            for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
                // Gerar número título cliente de 20 dígitos usando SEQUENCIAL atual
                // Formato: 000 + CONVENIO (7 dígitos) + SEQUENCIAL (10 dígitos)
                const convenioStr = '3648981'.padStart(7, '0');
                const sequencialStr = sequencial.toString().padStart(10, '0');
                const numeroTituloCliente20Digitos = `000${convenioStr}${sequencialStr}`;

                console.log(`🔄 Tentativa ${tentativa}/${maxTentativas} - Sequencial: ${sequencial} - Número: ${numeroTituloCliente20Digitos}`);

                // Calcular valor final considerando abatimento
                const valorAbatimento = parseFloat(dadosEnergia.valor_abatimento || dadosEnergia.valorAbatimento || 0);
                const valorOriginalSemAbatimento = parseFloat(dadosEnergia.valorBoleto || 0);
                const valorFinalComAbatimento = valorOriginalSemAbatimento; // O banco já armazena o valor final

                console.log(`💰 Valor do boleto: R$ ${valorFinalComAbatimento.toFixed(2)} ${valorAbatimento > 0 ? `(abatimento de R$ ${valorAbatimento.toFixed(2)} já aplicado)` : ''}`);

                // Preparar dados para API do BB (ESTRUTURA IGUAL ao CriarBoleto que funciona!)
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
                    valorOriginal: valorFinalComAbatimento,
                    numeroTituloCliente: numeroTituloCliente20Digitos,
                    descricaoTitulo: descricao,
                    indicadorAceiteTituloVencido: 'S',
                    numeroDiasLimiteRecebimento: 300,
                    quantidadeDiasProtesto: 45,
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
                    // IMPORTANTE: API do BB não aceita campos vazios - só incluir se tiver valor
                    pagador: {
                        tipoInscricao: tipoInscricao,
                        numeroInscricao: documentoFormatado,  // STRING com zeros!
                        nome: removerAcentos((dadosEnergia.nomeCompleto || 'CLIENTE').toUpperCase()).substring(0, 60),
                        endereco: removerAcentos((endereco || 'ENDERECO NAO INFORMADO').toUpperCase()).substring(0, 100),
                        ...(cepFormatado && { cep: cepFormatado }),  // Só inclui se CEP válido
                        ...(dadosEnergia.cidade && { cidade: removerAcentos(dadosEnergia.cidade.toUpperCase()).substring(0, 30) }),
                        ...(dadosEnergia.bairro && { bairro: removerAcentos(dadosEnergia.bairro.toUpperCase()).substring(0, 30) }),
                        uf: (dadosEnergia.uf || 'GO').toUpperCase()
                        // telefone e email removidos - API não aceita vazios
                    },

                    // PIX
                    indicadorPix: 'S'
                };

                try {
                    // Tentar criar boleto na API do BB
                    response = await api.post(
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

                    // Se chegou aqui, boleto foi criado com sucesso!
                    console.log(`✅ Boleto criado com sucesso na tentativa ${tentativa}`);
                    break; // Sai do loop de retry

                } catch (error) {
                    // Se erro 401, renovar token e tentar novamente
                    if (error.response?.status === 401) {
                        console.log('⚠️ Token expirado, renovando...');
                        localStorage.removeItem('bb_token');
                        localStorage.removeItem('bb_token_expiry');
                        token = await obterToken();

                        // Tentar novamente com o mesmo sequencial (não incrementa)
                        try {
                            response = await api.post(
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
                            console.log(`✅ Boleto criado após renovação de token (tentativa ${tentativa})`);
                            break; // Sai do loop de retry
                        } catch (retryError) {
                            // Se mesmo após renovar o token falhar, trata como erro normal
                            error = retryError;
                        }
                    }

                    // Logar estrutura completa do erro para debug
                    console.log('🔍 Estrutura do erro:', {
                        status: error.response?.status,
                        data: error.response?.data,
                        message: error.message
                    });

                    // Verificar se é erro de número já utilizado (BUSCAR EM TODOS OS CAMPOS)
                    const erroData = error.response?.data || {};
                    const erroMensagem = (
                        erroData.erros?.[0]?.mensagem ||
                        erroData.message ||
                        erroData.mensagem ||
                        erroData.error ||
                        JSON.stringify(erroData) ||
                        error.message ||
                        ''
                    ).toLowerCase();

                    console.log('📝 Mensagem de erro extraída:', erroMensagem);

                    // Detectar se devemos tentar com próximo sequencial
                    // IMPORTANTE: Alguns erros 400 são de conflito de número, então tentamos sempre
                    const isErro400PossivelConflito = error.response?.status === 400;

                    // Detectar erro de número já utilizado (várias variações)
                    const isNumeroJaUtilizado = (
                        // Padrão 1: "numero" + "utilizado/duplicado/existente"
                        (erroMensagem.includes('numero') || erroMensagem.includes('número')) &&
                        (erroMensagem.includes('utilizado') ||
                         erroMensagem.includes('duplicad') ||
                         erroMensagem.includes('existente') ||
                         erroMensagem.includes('já existe') ||
                         erroMensagem.includes('ja existe'))
                    ) || (
                        // Padrão 2: "titulo" + "utilizado/duplicado/existente"
                        (erroMensagem.includes('titulo') || erroMensagem.includes('título')) &&
                        (erroMensagem.includes('utilizado') ||
                         erroMensagem.includes('duplicad') ||
                         erroMensagem.includes('existente') ||
                         erroMensagem.includes('já existe') ||
                         erroMensagem.includes('ja existe'))
                    ) || (
                        // Padrão 3: "identificador" + "duplicado"
                        erroMensagem.includes('identificador') &&
                        (erroMensagem.includes('duplicad') || erroMensagem.includes('existente'))
                    );

                    // Se é erro 400 E ainda tem tentativas, tenta com próximo número
                    // (Mesmo que não seja erro explícito de duplicata, pode ser conflito)
                    if (isErro400PossivelConflito && tentativa < maxTentativas) {
                        if (isNumeroJaUtilizado) {
                            console.warn(`⚠️ Número ${numeroTituloCliente20Digitos} já utilizado. Tentando próximo sequencial...`);
                        } else {
                            console.warn(`⚠️ Erro 400 detectado (${erroMensagem.substring(0, 50)}...). Tentando próximo sequencial...`);
                        }
                        sequencial++; // Incrementa e tenta novamente
                        continue; // Próxima iteração do loop
                    }

                    // Se não é erro 400 OU já esgotou tentativas, lança o erro
                    if (tentativa === maxTentativas) {
                        console.error(`❌ Falha após ${maxTentativas} tentativas`);
                    }
                    throw error;
                }
            }

            // Se após todas as tentativas não tem response, algo deu muito errado
            if (!response) {
                throw new Error('Não foi possível gerar o boleto após todas as tentativas');
            }

            const numeroBoleto = response.data.numero || response.data.numeroBoletoBB;

            // 7. Atualizar status no backend
            await api.patch(
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
            const mensagemLower = mensagemErro.toLowerCase();

            // Detectar erros relacionados a data de vencimento
            const errosDeData = [
                'vencimento', 'data', 'date', 'invalida', 'invalid',
                'passado', 'past', 'expirada', 'expired', 'prazo'
            ];
            const erroRelacionadoAData = errosDeData.some(termo => mensagemLower.includes(termo));

            if (erroRelacionadoAData) {
                // Mostrar modal para nova data de vencimento
                mostrarAlerta(`Erro de data: ${mensagemErro}. Por favor, informe uma nova data.`, 'warning');
                setModalVencimento({
                    show: true,
                    boleto: dadosEnergia,
                    dataVencimento: ''
                });
            } else {
                mostrarAlerta(`Erro ao gerar boleto: ${mensagemErro}`, 'danger');
            }
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };

    // Função obterToken agora vem importada de api.js (requisição direta ao BB)

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

        // Converter formato yyyy-mm-dd (input date) para dd/mm/yyyy (esperado pelo gerarBoleto)
        const [ano, mes, dia] = modalVencimento.dataVencimento.split('-');
        const dataFormatada = `${dia}/${mes}/${ano}`;

        gerarBoleto(modalVencimento.boleto, dataFormatada);
    };

    // Abrir modal para perguntar se quer juntar com fatura
    const abrirModalDownloadIndividual = (boleto) => {
        setBoletoParaDownload(boleto);
        setMostrarModalDownloadIndividual(true);
    };

    // Gerar PDF do boleto de energia
    const gerarPDFBoleto = async (boleto, juntarComFatura = false) => {
        try {
            console.log('📄 Gerando PDF do boleto de energia...', boleto);
            console.log('📋 Número do boleto:', boleto.numero_boleto);
            console.log('🔗 Juntar com fatura:', juntarComFatura);

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

            let dadosBoletoBB = {};
            let dadosPix = null;

            try {
                const response = await api.get(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Application-Key': '549827f7531a4cdd880437df70bf3d86'
                    }
                });

                console.log('✅ Dados do boleto obtidos com sucesso:', response.status);
                dadosBoletoBB = response.data;

                // Buscar dados do PIX separadamente (igual ao ListarBoletos)
                try {
                    console.log('📱 Buscando PIX para o PDF...');
                    dadosPix = await consultarPixBoleto(boleto.numero_boleto);
                    console.log('✅ PIX carregado para PDF:', dadosPix);
                } catch (pixError) {
                    console.log('ℹ️ Boleto sem PIX ou erro ao buscar:', pixError.message);
                }
            } catch (bbError) {
                console.warn('⚠️ BB API indisponível para este boleto (pode ser antigo/pago).', bbError.message);

                // FALLBACK 1: Buscar dados BB salvos no banco local
                try {
                    console.log('🔄 Tentando dados BB salvos no banco...');
                    const savedResponse = await api.get(`${API_URL}/api/boleto-dados-bb/${boleto.numero_boleto}`);
                    if (savedResponse.data?.success && savedResponse.data?.dados_bb) {
                        console.log('✅ Usando dados BB salvos do banco');
                        dadosBoletoBB = savedResponse.data.dados_bb;
                        dadosPix = savedResponse.data.dados_pix || null;
                    } else {
                        throw new Error('Sem dados BB salvos');
                    }
                } catch (savedError) {
                    console.warn('⚠️ Sem dados BB salvos. Usando dados locais mínimos.', savedError.message);

                    // FALLBACK 2: Construir dados mínimos a partir do banco local (sem barcode/PIX)
                    dadosBoletoBB = {
                        numeroBoletoBB: boleto.numero_boleto,
                        dataVencimento: boleto.data_vencimento,
                        valorOriginal: parseFloat(boleto.valor_boleto) || 0,
                        nomeSacadoCobranca: boleto.nome_completo || '',
                        enderecoPagador: boleto.endereco || '',
                        bairroPagador: boleto.bairro || '',
                        cidadePagador: boleto.cidade || '',
                        ufPagador: boleto.uf || '',
                        cepPagador: boleto.cep || '',
                        cpfCnpjPagador: boleto.documento || '',
                        _geradoComDadosLocais: true
                    };
                }
            }

            // Preparar dados para o PDF incluindo informações de energia
            // Mapear campos do banco de dados (camelCase from Sistema_Faturas) para o que pdfGenerator espera (snake_case)
            const dadosCompletos = boleto.dados_completos || {};

            const dadosParaPDF = {
                ...dadosBoletoBB,
                dadosPix: dadosPix,  // Incluir dados do PIX para gerar QR Code
                numeroTitulo: boleto.numero_boleto,
                tipo_boleto: boleto.tipo_boleto, // Identificar se é economia gerada
                valorBoleto: parseFloat(boleto.valor_boleto) || 0, // Valor do boleto para economia gerada
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

                    // Abatimento
                    valor_abatimento: parseFloat(boleto.valor_abatimento) || 0,
                    motivo_abatimento: boleto.motivo_abatimento || '',

                    // Valores finais (o banco já armazena com abatimento aplicado)
                    valor_boleto: parseFloat(boleto.valor_boleto) || parseFloat(dadosCompletos.valorBoleto) || 0,
                    // valor_aupus = valor_com_desconto + valor_bandeira_com_desconto (soma das duas parcelas com desconto)
                    valor_aupus: (parseFloat(boleto.valor_com_desconto) || 0) + (parseFloat(boleto.valor_bandeira_com_desconto) || 0) ||
                                 parseFloat(boleto.valor_com_desconto_aupus) || parseFloat(dadosCompletos.valorComDescontoAupus) || 0,
                    valor_consorcio: parseFloat(boleto.valor_boleto) || parseFloat(dadosCompletos.valorBoleto) || 0,

                    // Economia = valor original - valor com desconto
                    valor_economia: ((parseFloat(boleto.valor_energia_compensada) || 0) + (parseFloat(boleto.valor_bandeira_compensada) || 0)) -
                                   ((parseFloat(boleto.valor_com_desconto) || 0) + (parseFloat(boleto.valor_bandeira_com_desconto) || 0))
                }
            };

            // Se deve juntar com fatura, usar endpoint de download individual com junção
            if (juntarComFatura) {
                console.log('🔗 Enviando para backend processar com junção de fatura...');

                const response = await api.post(
                    `${API_URL}/baixar-boleto-individual`,
                    {
                        boleto: {
                            uc: boleto.uc,
                            mes_referencia: boleto.mes_referencia,
                            numero_boleto: boleto.numero_boleto,
                            nome_completo: boleto.nome_completo || boleto.nomeSacadoCobranca || 'Sem Nome',
                            dados_completos: boleto.dados_completos || {}
                        },
                        dadosParaPDF: dadosParaPDF,
                        oauth_token: token,
                        juntar_com_fatura: true
                    },
                    {
                        responseType: 'blob',
                        timeout: 60000
                    }
                );

                // Download do arquivo (pode ser boleto ou PDF combinado)
                const blob = new Blob([response.data], { type: 'application/pdf' });
                const pdfUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = pdfUrl;

                const contentDisposition = response.headers['content-disposition'];
                let fileName = `Fatura_AUPUS_${boleto.uc}.pdf`;
                if (contentDisposition) {
                    const fileNameMatch = contentDisposition.match(/filename="(.+)"/);
                    if (fileNameMatch && fileNameMatch[1]) {
                        fileName = fileNameMatch[1];
                    }
                }

                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(pdfUrl);

                mostrarAlerta('PDF salvo e combinado com sucesso!', 'success');
            } else {
                // Download simples (só o boleto)
                const pdfResponse = await api.post(
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
            }

        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            mostrarAlerta('Erro ao gerar PDF do boleto', 'danger');
        }
    };

    // Gerar mensagem padrão para WhatsApp (igual ao servidor - o link será inserido pelo backend entre a primeira linha e "Qualquer dúvida")
    const gerarMensagemWhatsappPadrao = (boleto) => {
        const [mes, ano] = (boleto.mes_referencia || '').split('/');
        return `Olá! Segue sua fatura de energia referente ao mês ${mes}/${ano}.

📄 *Baixar Fatura:*
[LINK SERÁ INSERIDO AUTOMATICAMENTE]

Qualquer dúvida, estamos à disposição!

*AUPUS Energia*`;
    };

    // Gerar mensagem padrão para Email (igual ao servidor - arquivo vai como anexo)
    const gerarMensagemEmailPadrao = (boleto) => {
        const [mes, ano] = (boleto.mes_referencia || '').split('/');
        return `Prezado(a) Cliente,

Segue em anexo sua fatura de energia referente ao mês ${mes}/${ano}.

Qualquer dúvida, estamos à disposição.

Atenciosamente,
AUPUS Energia`;
    };

    // Gerar assunto padrão para Email
    const gerarAssuntoEmailPadrao = (boleto) => {
        const [mes, ano] = (boleto.mes_referencia || '').split('/');
        return `Fatura de Energia - ${mes}/${ano} - AUPUS Energia`;
    };

    // Abrir modal de envio (WhatsApp/Email)
    const abrirModalEnvio = async (boleto) => {
        // Inicializar modal com dados do boleto
        setModalEnvio({
            show: true,
            boleto: boleto,
            tipoEnvio: 'whatsapp',
            tipoArquivo: 'net', // Padrão: boleto simples
            telefone: boleto.telefone || '',
            email: boleto.email || '',
            emailSecundario: '', // Será preenchido com dados do CRM
            enviando: false,
            statusEnvio: null,
            forcarReenvio: false,
            abaAtiva: 'envio',
            mensagemWhatsapp: gerarMensagemWhatsappPadrao(boleto),
            mensagemEmail: gerarMensagemEmailPadrao(boleto),
            assuntoEmail: gerarAssuntoEmailPadrao(boleto),
            mensagemEditada: false
        });

        // Buscar dados de contato atualizados do CRM (em background)
        // IMPORTANTE: Priorizar dados do CRM sobre os do boleto (CRM sempre mais atualizado)
        try {
            const response = await api.get(`/api/dados-contato-crm/${boleto.uc}`);
            if (response.data) {
                setModalEnvio(prev => ({
                    ...prev,
                    // Priorizar CRM, usar boleto apenas como fallback
                    telefone: response.data.whatsapp || prev.telefone || '',
                    email: response.data.email || prev.email || '',
                    emailSecundario: response.data.email_secundario || ''
                }));
            }
        } catch (error) {
            console.log('Não foi possível buscar dados de contato do CRM:', error.message);
            // Não mostrar erro - usar dados do boleto como fallback
        }
    };

    // Fechar modal de envio
    const fecharModalEnvio = () => {
        setModalEnvio({
            show: false,
            boleto: null,
            tipoEnvio: 'whatsapp',
            tipoArquivo: 'net',
            telefone: '',
            email: '',
            enviando: false,
            statusEnvio: null,
            forcarReenvio: false,
            abaAtiva: 'envio',
            mensagemWhatsapp: '',
            mensagemEmail: '',
            assuntoEmail: '',
            mensagemEditada: false
        });
    };

    // Executar envio real (WhatsApp e/ou Email)
    const executarEnvio = async () => {
        const { boleto, tipoEnvio, tipoArquivo, telefone, email, emailSecundario, forcarReenvio, mensagemWhatsapp, mensagemEmail, assuntoEmail } = modalEnvio;

        // Validações
        if ((tipoEnvio === 'whatsapp' || tipoEnvio === 'ambos') && !telefone) {
            setModalEnvio(prev => ({ ...prev, statusEnvio: { tipo: 'error', mensagem: 'Informe o telefone para envio por WhatsApp' } }));
            return;
        }
        if ((tipoEnvio === 'email' || tipoEnvio === 'ambos') && !email) {
            setModalEnvio(prev => ({ ...prev, statusEnvio: { tipo: 'error', mensagem: 'Informe o email para envio por Email' } }));
            return;
        }

        setModalEnvio(prev => ({ ...prev, enviando: true, statusEnvio: null }));

        try {
            // Gerar o PDF (NET simples ou NET Combinado)
            const juntarComFatura = tipoArquivo === 'net_combinado';
            console.log(`📄 Gerando PDF... (${juntarComFatura ? 'NET Combinado' : 'NET simples'})`);
            await gerarPDFBoleto(boleto, juntarComFatura);

            // Gerar nome do arquivo do boleto (formato usado no sistema)
            // Remover acentos para corresponder ao nome salvo pelo servidor
            const nomeFormatado = (boleto.nome_completo || 'Sem Nome')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
                .toLowerCase()
                .split(' ')
                .map(palavra => palavra.charAt(0).toUpperCase() + palavra.slice(1))
                .join(' ');

            // Nome do arquivo depende do tipo escolhido
            const nomeArquivo = juntarComFatura
                ? `Fatura AUPUS - ${boleto.uc} - ${nomeFormatado}.pdf`
                : `Boleto Aupus - ${boleto.uc} - ${nomeFormatado}.pdf`;
            const pasta = juntarComFatura ? 'NET Completo' : 'NET';
            const mesReferencia = boleto.mes_referencia;

            let resultados = [];

            // Enviar por WhatsApp
            if (tipoEnvio === 'whatsapp' || tipoEnvio === 'ambos') {
                try {
                    await api.post('/api/sistema-faturas/enviar-whatsapp', {
                        pasta: pasta,
                        mes_referencia: mesReferencia,
                        arquivo: nomeArquivo,
                        telefone: telefone,
                        forcar_reenvio: forcarReenvio,
                        mensagem_customizada: mensagemWhatsapp
                    });
                    resultados.push({ tipo: 'WhatsApp', sucesso: true });
                } catch (error) {
                    if (error.response?.status === 409 && error.response?.data?.ja_enviado) {
                        setModalEnvio(prev => ({
                            ...prev,
                            enviando: false,
                            statusEnvio: {
                                tipo: 'warning',
                                mensagem: `WhatsApp: ${error.response.data.mensagem}`,
                                jaEnviado: true
                            }
                        }));
                        return;
                    }
                    resultados.push({ tipo: 'WhatsApp', sucesso: false, erro: error.response?.data?.error || error.message });
                }
            }

            // Enviar por Email
            if (tipoEnvio === 'email' || tipoEnvio === 'ambos') {
                try {
                    const payloadEmail = {
                        pasta: pasta,
                        mes_referencia: mesReferencia,
                        arquivo: nomeArquivo,
                        email: email,
                        forcar_reenvio: forcarReenvio,
                        assunto_customizado: assuntoEmail,
                        mensagem_customizada: mensagemEmail
                    };
                    // Adicionar email secundário se preenchido
                    if (emailSecundario && emailSecundario.trim()) {
                        payloadEmail.email_secundario = emailSecundario.trim();
                    }
                    await api.post('/api/sistema-faturas/enviar-email', payloadEmail);
                    resultados.push({ tipo: 'Email', sucesso: true, emailSecundario: !!emailSecundario });
                } catch (error) {
                    if (error.response?.status === 409 && error.response?.data?.ja_enviado) {
                        setModalEnvio(prev => ({
                            ...prev,
                            enviando: false,
                            statusEnvio: {
                                tipo: 'warning',
                                mensagem: `Email: ${error.response.data.mensagem}`,
                                jaEnviado: true
                            }
                        }));
                        return;
                    }
                    resultados.push({ tipo: 'Email', sucesso: false, erro: error.response?.data?.error || error.message });
                }
            }

            // Verificar resultados
            const sucessos = resultados.filter(r => r.sucesso);
            const falhas = resultados.filter(r => !r.sucesso);

            if (falhas.length === 0) {
                setModalEnvio(prev => ({
                    ...prev,
                    enviando: false,
                    statusEnvio: { tipo: 'success', mensagem: `Enviado com sucesso via ${sucessos.map(s => s.tipo).join(' e ')}!` }
                }));
                mostrarAlerta(`Boleto enviado com sucesso!`, 'success');
                // Recarregar status de envios para atualizar a tabela
                if (filtros.mes_referencia) {
                    carregarStatusEnvios(filtros.mes_referencia);
                }
                setTimeout(() => fecharModalEnvio(), 2000);
            } else if (sucessos.length > 0) {
                setModalEnvio(prev => ({
                    ...prev,
                    enviando: false,
                    statusEnvio: { tipo: 'warning', mensagem: `${sucessos.map(s => s.tipo).join(', ')}: OK | ${falhas.map(f => `${f.tipo}: ${f.erro}`).join(', ')}` }
                }));
                // Atualizar status mesmo com envio parcial (ex: WhatsApp ok, Email falhou)
                if (filtros.mes_referencia) {
                    carregarStatusEnvios(filtros.mes_referencia);
                }
            } else {
                setModalEnvio(prev => ({
                    ...prev,
                    enviando: false,
                    statusEnvio: { tipo: 'error', mensagem: falhas.map(f => `${f.tipo}: ${f.erro}`).join(' | ') }
                }));
            }

        } catch (error) {
            console.error('Erro ao enviar:', error);
            setModalEnvio(prev => ({
                ...prev,
                enviando: false,
                statusEnvio: { tipo: 'error', mensagem: error.message || 'Erro desconhecido ao enviar' }
            }));
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

            const response = await api.post(
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

    // Recalcular boleto com dados atualizados do CRM
    const recalcularBoleto = async (boleto) => {
        const chave = `${boleto.uc}_${boleto.mes_referencia}`;
        setProcessando(prev => ({ ...prev, [chave]: true }));

        try {
            console.log('🔄 Recalculando boleto para UC:', boleto.uc);

            // Buscar o ID da fatura correspondente
            const responseFaturas = await api.get('/api/microservicos/gerenciar/faturas', {
                params: { mes_referencia: boleto.mes_referencia }
            });

            const fatura = responseFaturas.data.faturas.find(f => f.uc === boleto.uc);

            if (!fatura) {
                mostrarAlerta(`Fatura não encontrada para UC ${boleto.uc} no mês ${boleto.mes_referencia}`, 'warning');
                return;
            }

            if (fatura.boleto_gerado) {
                mostrarAlerta('Não é possível recalcular: boleto já foi gerado', 'danger');
                return;
            }

            // Chamar endpoint de recálculo
            const response = await api.post('/api/microservicos/gerenciar/recalcular', {
                fatura_ids: [fatura.id]
            });

            if (response.data.sucesso && response.data.atualizadas > 0) {
                mostrarAlerta('Fatura recalculada com sucesso! Dados do CRM atualizados.', 'success');
                // Recarregar lista de boletos
                await carregarBoletos();
            } else if (response.data.bloqueadas > 0) {
                mostrarAlerta('Recálculo bloqueado: boleto já foi gerado', 'warning');
            } else {
                mostrarAlerta('Nenhuma alteração realizada no recálculo', 'info');
            }

        } catch (error) {
            console.error('❌ Erro ao recalcular:', error);
            mostrarAlerta(`Erro ao recalcular: ${error.message}`, 'danger');
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };

    // Salvar boleto manual (economia gerada)
    const salvarBoletoManual = async () => {
        const {
            uc, nome, documento, endereco, bairro, cep, cidade, uf,
            mesReferencia, dataVencimento, economiaGerada
        } = modalBoletoManual;

        // Validações
        if (!uc.trim()) {
            mostrarAlerta('Informe o número da UC', 'warning');
            return;
        }
        if (!nome.trim()) {
            mostrarAlerta('Informe o nome do pagador', 'warning');
            return;
        }
        if (!documento.trim()) {
            mostrarAlerta('Informe o CPF ou CNPJ', 'warning');
            return;
        }
        if (!endereco.trim() || !bairro.trim() || !cep.trim() || !cidade.trim() || !uf.trim()) {
            mostrarAlerta('Preencha todos os campos de endereço', 'warning');
            return;
        }
        if (!mesReferencia.trim()) {
            mostrarAlerta('Informe o mês de referência', 'warning');
            return;
        }
        if (!dataVencimento) {
            mostrarAlerta('Informe a data de vencimento', 'warning');
            return;
        }

        const valorTotal = parseFloat(economiaGerada) || 0;

        if (valorTotal <= 0) {
            mostrarAlerta('A Economia Gerada deve ser maior que zero', 'warning');
            return;
        }

        setModalBoletoManual(prev => ({ ...prev, salvando: true }));

        try {
            const payload = {
                // Número da UC
                uc: uc.trim(),
                // Dados do pagador
                nome: nome.trim(),
                documento: documento.replace(/[^\d]/g, ''), // Apenas números
                endereco: endereco.trim(),
                bairro: bairro.trim(),
                cep: cep.replace(/[^\d]/g, ''),
                cidade: cidade.trim(),
                uf: uf.trim().toUpperCase(),
                // Dados do boleto
                data_vencimento: dataVencimento,
                mes_referencia: mesReferencia,
                valor_boleto: valorTotal,
                // Marcador de boleto manual
                tipo_boleto: 'manual_cogeracao'
            };

            console.log('📝 Criando boleto manual:', payload);

            const response = await api.post('/api/boletos-energia/manual', payload);

            if (response.data.sucesso) {
                mostrarAlerta('Boleto de Economia Gerada criado com sucesso!', 'success');

                // Limpar e fechar modal
                setModalBoletoManual({
                    show: false,
                    salvando: false,
                    uc: '',
                    nome: '',
                    documento: '',
                    endereco: '',
                    bairro: '',
                    cep: '',
                    cidade: '',
                    uf: '',
                    mesReferencia: '',
                    dataVencimento: '',
                    economiaGerada: ''
                });

                // Recarregar lista de boletos
                await carregarBoletos();
            } else {
                mostrarAlerta(response.data.mensagem || 'Erro ao criar boleto', 'danger');
            }

        } catch (error) {
            console.error('❌ Erro ao criar boleto manual:', error);
            mostrarAlerta(`Erro ao criar boleto: ${error.response?.data?.error || error.message}`, 'danger');
        } finally {
            setModalBoletoManual(prev => ({ ...prev, salvando: false }));
        }
    };

    // Excluir boleto não gerado
    const excluirBoleto = async (boleto) => {
        // Verificar se o boleto pode ser excluído
        if (boleto.numero_boleto || boleto.status === 'Boleto gerado') {
            mostrarAlerta('Não é possível excluir um boleto que já foi gerado', 'warning');
            return;
        }

        const nomeCliente = boleto.nome_completo || boleto.nome || 'Cliente';
        if (!window.confirm(`Deseja realmente excluir o boleto de "${nomeCliente}" (UC: ${boleto.uc})?\n\nEsta ação não pode ser desfeita.`)) {
            return;
        }

        const chave = `${boleto.uc}_${boleto.mes_referencia}`;
        setProcessando(prev => ({ ...prev, [chave]: true }));

        try {
            console.log('🗑️ Excluindo boleto:', boleto.uc, boleto.mes_referencia);

            // Usar query params para evitar problema com "/" no mes_referencia
            await api.delete(`/api/boletos-energia/excluir`, {
                params: {
                    uc: boleto.uc,
                    mes_referencia: boleto.mes_referencia
                }
            });

            mostrarAlerta('Boleto excluído com sucesso!', 'success');

            // Recarregar lista de boletos
            await carregarBoletos();

        } catch (error) {
            console.error('❌ Erro ao excluir boleto:', error);
            mostrarAlerta(`Erro ao excluir: ${error.response?.data?.message || error.message}`, 'danger');
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };

    // Recalcular TODOS os boletos pendentes
    const [recalculandoTodos, setRecalculandoTodos] = useState(false);
    const [progressoRecalculo, setProgressoRecalculo] = useState({ atual: 0, total: 0 });

    const recalcularTodosPendentes = async () => {
        // Validar que há um mês selecionado
        if (!filtros.mes_referencia) {
            mostrarAlerta('Selecione um mês de referência para recalcular', 'warning');
            return;
        }

        // Filtrar apenas boletos pendentes (sem numero_boleto) do mês filtrado
        const boletosPendentes = boletos.filter(b =>
            b.status === 'Pendente' &&
            !b.numero_boleto &&
            b.mes_referencia === filtros.mes_referencia
        );

        if (boletosPendentes.length === 0) {
            mostrarAlerta('Não há boletos pendentes para recalcular neste mês', 'info');
            return;
        }

        if (!window.confirm(`Deseja recalcular ${boletosPendentes.length} boletos pendentes do mês ${filtros.mes_referencia}?`)) {
            return;
        }

        setRecalculandoTodos(true);
        setProgressoRecalculo({ atual: 0, total: boletosPendentes.length });

        try {
            // Pegar as UCs dos boletos pendentes visíveis na tabela
            const ucsPendentes = boletosPendentes.map(b => b.uc);
            console.log(`🔄 Recalculando ${ucsPendentes.length} boletos pendentes do mês ${filtros.mes_referencia}...`);

            // Chamar endpoint de recálculo com UCs específicas
            const response = await api.post('/api/microservicos/gerenciar/recalcular', {
                mes_referencia: filtros.mes_referencia,
                ucs: ucsPendentes  // Apenas as UCs dos boletos pendentes
            });

            const { atualizadas = 0, bloqueadas = 0, erros = 0 } = response.data;

            setProgressoRecalculo({ atual: atualizadas, total: boletosPendentes.length });

            let mensagem = `Recálculo concluído: ${atualizadas} atualizadas`;
            if (bloqueadas > 0) mensagem += `, ${bloqueadas} bloqueadas`;
            if (erros > 0) mensagem += `, ${erros} erros`;

            mostrarAlerta(mensagem, atualizadas > 0 ? 'success' : 'warning');

            // Recarregar lista de boletos
            await carregarBoletos();

        } catch (error) {
            console.error('❌ Erro ao recalcular todos:', error);
            mostrarAlerta(`Erro ao recalcular: ${error.message}`, 'danger');
        } finally {
            setRecalculandoTodos(false);
            setProgressoRecalculo({ atual: 0, total: 0 });
        }
    };

    // ========================================
    // VALIDAÇÃO DE BOLETOS
    // ========================================

    // Alternar validação de um boleto individual
    const toggleValidacao = async (boleto) => {
        const chave = `${boleto.uc}_${boleto.mes_referencia}`;
        setProcessando(prev => ({ ...prev, [chave]: true }));

        try {
            const novoValor = !boleto.validado;
            console.log(`✅ Alterando validação: UC ${boleto.uc} -> ${novoValor}`);

            await api.patch(
                `${API_URL}/api/boleto-energia/validar/${boleto.uc}/${encodeURIComponent(boleto.mes_referencia)}`,
                { validado: novoValor }
            );

            // Atualizar estado local
            setBoletos(prev => prev.map(b =>
                b.uc === boleto.uc && b.mes_referencia === boleto.mes_referencia
                    ? { ...b, validado: novoValor }
                    : b
            ));

        } catch (error) {
            console.error('❌ Erro ao alterar validação:', error);
            mostrarAlerta(`Erro ao alterar validação: ${error.message}`, 'danger');
        } finally {
            setProcessando(prev => ({ ...prev, [chave]: false }));
        }
    };

    // Validar todos os boletos pendentes visíveis
    const validarTodosPendentes = async () => {
        const pendentes = boletos.filter(b =>
            b.status === 'Pendente' &&
            !b.numero_boleto &&
            b.mes_referencia === filtros.mes_referencia &&
            !b.validado
        );

        if (pendentes.length === 0) {
            mostrarAlerta('Não há boletos pendentes para validar', 'info');
            return;
        }

        try {
            console.log(`✅ Validando ${pendentes.length} boletos pendentes...`);

            await api.post(`${API_URL}/api/boleto-energia/validar-lote`, {
                boletos: pendentes.map(b => ({ uc: b.uc, mes_referencia: b.mes_referencia })),
                validado: true
            });

            // Atualizar estado local
            setBoletos(prev => prev.map(b =>
                pendentes.some(p => p.uc === b.uc && p.mes_referencia === b.mes_referencia)
                    ? { ...b, validado: true }
                    : b
            ));

            mostrarAlerta(`${pendentes.length} boletos validados com sucesso`, 'success');

        } catch (error) {
            console.error('❌ Erro ao validar em lote:', error);
            mostrarAlerta(`Erro ao validar boletos: ${error.message}`, 'danger');
        }
    };

    // Desmarcar todos os boletos validados
    const desmarcarTodosValidados = async () => {
        const validados = boletos.filter(b =>
            b.status === 'Pendente' &&
            !b.numero_boleto &&
            b.mes_referencia === filtros.mes_referencia &&
            b.validado
        );

        if (validados.length === 0) {
            mostrarAlerta('Não há boletos validados para desmarcar', 'info');
            return;
        }

        try {
            console.log(`❌ Desmarcando ${validados.length} boletos validados...`);

            await api.post(`${API_URL}/api/boleto-energia/validar-lote`, {
                boletos: validados.map(b => ({ uc: b.uc, mes_referencia: b.mes_referencia })),
                validado: false
            });

            // Atualizar estado local
            setBoletos(prev => prev.map(b =>
                validados.some(v => v.uc === b.uc && v.mes_referencia === b.mes_referencia)
                    ? { ...b, validado: false }
                    : b
            ));

            mostrarAlerta(`${validados.length} boletos desmarcados`, 'success');

        } catch (error) {
            console.error('❌ Erro ao desmarcar em lote:', error);
            mostrarAlerta(`Erro ao desmarcar boletos: ${error.message}`, 'danger');
        }
    };

    // ========================================
    // GERAÇÃO EM BATCH DE BOLETOS VALIDADOS
    // ========================================

    // Iniciar geração de boletos validados
    const gerarBoletosValidados = async () => {
        const validados = boletos.filter(b =>
            b.status === 'Pendente' &&
            !b.numero_boleto &&
            b.mes_referencia === filtros.mes_referencia &&
            b.validado
        );

        if (validados.length === 0) {
            mostrarAlerta('Não há boletos validados para gerar. Marque os boletos com o checkbox primeiro.', 'warning');
            return;
        }

        if (!window.confirm(`Deseja gerar ${validados.length} boletos validados? Este processo pode demorar alguns minutos.`)) {
            return;
        }

        setGerandoValidados(true);

        try {
            console.log(`🚀 Iniciando geração de ${validados.length} boletos validados...`);

            const response = await api.post(`${API_URL}/api/boleto-energia/gerar-validados`, {
                mes_referencia: filtros.mes_referencia
            });

            if (response.data.success) {
                const jobId = response.data.jobId;
                setJobAtual({
                    id: jobId,
                    status: 'processando',
                    total: response.data.total,
                    processados: 0,
                    sucesso: 0,
                    erros: 0,
                    detalhes: []
                });
                setMostrarModalJob(true);

                // Iniciar polling do status do job
                monitorarJob(jobId);
            }

        } catch (error) {
            console.error('❌ Erro ao iniciar geração:', error);
            mostrarAlerta(`Erro ao iniciar geração: ${error.response?.data?.message || error.message}`, 'danger');
            setGerandoValidados(false);
        }
    };

    // Monitorar status do job de geração
    const monitorarJob = async (jobId) => {
        const intervalo = setInterval(async () => {
            try {
                const response = await api.get(`${API_URL}/api/boleto-energia/job-status/${jobId}`);
                const job = response.data;

                setJobAtual(job);

                if (job.status === 'concluido') {
                    clearInterval(intervalo);
                    setGerandoValidados(false);

                    // Mostrar resultado
                    mostrarAlerta(
                        `Geração concluída: ${job.sucesso} boletos gerados, ${job.erros} erros`,
                        job.erros > 0 ? 'warning' : 'success'
                    );

                    // Recarregar lista de boletos
                    await carregarBoletos();
                }

            } catch (error) {
                console.error('Erro ao monitorar job:', error);
                clearInterval(intervalo);
                setGerandoValidados(false);
            }
        }, 2000); // Verificar a cada 2 segundos
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
            await api.post(
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

            // 2. Atualizar status no banco de dados - voltar para Pendente para permitir novo boleto
            await api.patch(
                `${API_URL}/api/dados-boleto-energia/${boleto.uc}/${encodeURIComponent(boleto.mes_referencia)}`,
                {
                    status: 'Pendente',
                    numero_boleto: null  // Limpar número do boleto cancelado para permitir gerar novo
                }
            );

            console.log('✅ Status atualizado no banco de dados - boleto voltou para Pendente');

            // 3. Recarregar lista
            await carregarBoletos();

            mostrarAlerta(`Boleto ${boleto.numero_boleto} cancelado com sucesso! Agora você pode gerar um novo boleto.`, 'success');

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

    // Abrir modal de abatimento
    const abrirModalAbatimento = (boleto) => {
        setModalAbatimento({
            show: true,
            boleto: boleto,
            valorAbatimento: boleto.valor_abatimento || boleto.valorAbatimento || 0,
            motivoAbatimento: boleto.motivo_abatimento || boleto.motivoAbatimento || ''
        });
    };

    // Salvar abatimento
    const salvarAbatimento = async () => {
        try {
            const { boleto, valorAbatimento, motivoAbatimento } = modalAbatimento;

            if (!valorAbatimento || parseFloat(valorAbatimento) < 0) {
                mostrarAlerta('Valor de abatimento inválido', 'danger');
                return;
            }

            await api.patch(
                `${API_URL}/api/dados-boleto-energia/${boleto.uc}/${encodeURIComponent(boleto.mes_referencia)}`,
                {
                    valor_abatimento: parseFloat(valorAbatimento),
                    motivo_abatimento: motivoAbatimento
                }
            );

            mostrarAlerta('Abatimento salvo com sucesso!', 'success');
            setModalAbatimento({ show: false, boleto: null, valorAbatimento: 0, motivoAbatimento: '' });
            setModalDetalhes({ show: false, boleto: null, editando: false, dadosEditados: null });
            await carregarBoletos();

        } catch (error) {
            console.error('Erro ao salvar abatimento:', error);
            mostrarAlerta('Erro ao salvar abatimento', 'danger');
        }
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

            // Debug: ver valores antes de enviar
            console.log('📝 Debug valor_economia:', {
                'dados.valor_economia': dados.valor_economia,
                'dados.valorEconomia': dados.valorEconomia,
                'tipo valor_economia': typeof dados.valor_economia,
                'tipo valorEconomia': typeof dados.valorEconomia,
                'resultado ??': dados.valor_economia ?? dados.valorEconomia
            });

            await api.patch(
                `${API_URL}/api/dados-boleto-energia/${dados.uc}/${encodeURIComponent(dados.mes_referencia)}`,
                {
                    // Flag para permitir zeragem intencional de campos
                    permitir_zeragem: true,
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
                    valor_economia: dados.valor_economia ?? dados.valorEconomia,
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

    // Abrir modal para selecionar mês
    const abrirModalSelecaoMes = () => {
        // Extrair meses únicos dos boletos gerados
        const boletosGerados = boletos.filter(b => {
            const boleto = normalizarBoleto(b);
            return boleto.status === 'Boleto gerado' && boleto.numero_boleto;
        });

        if (boletosGerados.length === 0) {
            mostrarAlerta('Nenhum boleto gerado encontrado para download', 'warning');
            return;
        }

        const mesesUnicos = [...new Set(boletosGerados.map(b => {
            const boleto = normalizarBoleto(b);
            return boleto.mes_referencia;
        }))].sort();

        setMesesDisponiveis(mesesUnicos);
        setMesSelecionado(mesesUnicos[0] || '');
        setMostrarModalMes(true);
    };

    // Confirmar seleção de mês e abrir modal de juntar
    const confirmarMesEAbrirModalJuntar = () => {
        setMostrarModalMes(false);
        setMostrarModalJuntar(true);
    };

    // Baixar todos os boletos gerados e criar ZIP
    const baixarTodosBoletosZip = async (juntar = false) => {
        // Armazenar referências dos intervalos fora do try para acesso no catch
        let intervaloGeracao = null;
        let intervaloJuncao = null;

        try {
            setMostrarModalJuntar(false);
            setBaixandoTodos(true);
            console.log('📦 Iniciando download em massa de boletos...');

            // Filtrar apenas boletos com status "Boleto gerado" e do mês selecionado
            const boletosGerados = boletos.filter(b => {
                const boleto = normalizarBoleto(b);
                return boleto.status === 'Boleto gerado' &&
                       boleto.numero_boleto &&
                       boleto.mes_referencia === mesSelecionado;
            });

            if (boletosGerados.length === 0) {
                mostrarAlerta('Nenhum boleto gerado encontrado para o mês selecionado', 'warning');
                setBaixandoTodos(false);
                return;
            }

            setProgresso({ atual: 0, total: boletosGerados.length });
            setProgressoJuncao({ atual: 0, total: juntar ? boletosGerados.length : 0 });
            setEtapaAtual('geracao');
            console.log(`📥 Baixando ${boletosGerados.length} boletos...`);

            // Simular progresso - ETAPA 1: Geração de boletos (estimativa: 2-3s por boleto)
            const tempoEstimadoPorBoleto = 2500; // ms
            let totalGerado = 0;
            intervaloGeracao = setInterval(() => {
                setProgresso(prev => {
                    if (prev.atual < prev.total) {
                        totalGerado = prev.atual + 1;
                        return { ...prev, atual: totalGerado };
                    } else if (juntar && etapaAtual === 'geracao') {
                        // Terminou geração, iniciar junção
                        clearInterval(intervaloGeracao);
                        setEtapaAtual('juncao');
                        iniciarProgressoJuncao(boletosGerados.length);
                    }
                    return prev;
                });
            }, tempoEstimadoPorBoleto);

            // Função para simular progresso de junção
            const iniciarProgressoJuncao = (total) => {
                const tempoEstimadoPorJuncao = 1500; // 1.5s por PDF (junção é mais rápida)
                intervaloJuncao = setInterval(() => {
                    setProgressoJuncao(prev => {
                        if (prev.atual < prev.total) {
                            return { ...prev, atual: Math.min(prev.atual + 1, prev.total) };
                        } else {
                            clearInterval(intervaloJuncao);
                        }
                        return prev;
                    });
                }, tempoEstimadoPorJuncao);
            };

            // RENOVAR TOKEN antes do download em massa (igual ao download individual)
            console.log('🔄 Renovando token OAuth antes do download em massa...');
            localStorage.removeItem('bb_token');
            const token = await obterToken();
            console.log('✅ Token renovado para download em massa');

            // Enviar requisição para backend gerar ZIP com todos os boletos
            const response = await api.post(
                `${API_URL}/baixar-todos-boletos-zip`,
                {
                    boletos: boletosGerados.map(b => {
                        const boleto = normalizarBoleto(b);
                        // Enviar boleto completo com todos os campos necessários para gerar PDF correto
                        return boleto;
                    }),
                    oauth_token: token, // Enviar token renovado do frontend
                    mes_referencia: mesSelecionado,
                    juntar_com_fatura: juntar
                },
                {
                    timeout: 900000,  // 15 minutos (para junção de PDFs)
                    responseType: 'blob',
                    onDownloadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                            console.log(`📊 Progresso: ${percentCompleted}%`);
                        }
                    }
                }
            );

            // Limpar intervalos de simulação
            if (intervaloGeracao) clearInterval(intervaloGeracao);
            if (intervaloJuncao) clearInterval(intervaloJuncao);

            // Marcar ambos os progressos como completos
            setProgresso({ atual: boletosGerados.length, total: boletosGerados.length });
            if (juntar) {
                setProgressoJuncao({ atual: boletosGerados.length, total: boletosGerados.length });
                setEtapaAtual('juncao');
            }

            // Download do ZIP
            const blob = new Blob([response.data], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const nomeZip = juntar
                ? `Faturas-Combinadas-${mesSelecionado.replace('/', '-')}.zip`
                : `Boletos-Energia-${mesSelecionado.replace('/', '-')}.zip`;
            link.download = nomeZip;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            mostrarAlerta(`${boletosGerados.length} boletos baixados com sucesso!`, 'success');
            console.log('✅ Download em massa concluído!');

        } catch (error) {
            console.error('❌ Erro ao baixar boletos:', error);
            mostrarAlerta(`Erro ao baixar boletos: ${error.message}`, 'danger');
            // Limpar intervalos em caso de erro
            if (intervaloGeracao) clearInterval(intervaloGeracao);
            if (intervaloJuncao) clearInterval(intervaloJuncao);
        } finally {
            setBaixandoTodos(false);
            setProgresso({ atual: 0, total: 0 });
            setProgressoJuncao({ atual: 0, total: 0 });
            setEtapaAtual('geracao');
        }
    };

    return (
        <Container fluid className="mt-4">
            <Row>
                <Col>
                    <Card>
                        <Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
                            <h4 className="mb-0">Gerar Boletos de Energia Automaticamente</h4>
                            {boletos.filter(b => normalizarBoleto(b).status === 'Boleto gerado').length > 0 && (
                                <Button
                                    variant="light"
                                    size="sm"
                                    onClick={abrirModalSelecaoMes}
                                    disabled={baixandoTodos}
                                    className="d-flex align-items-center gap-2"
                                >
                                    <PackageOpen size={16} />
                                    <span>Baixar Todos</span>
                                </Button>
                            )}
                        </Card.Header>
                        <Card.Body>
                            {/* Filtros */}
                            <Form className="mb-4">
                                <Row className="g-2">
                                    <Col xs={6} md={2}>
                                        <Form.Group>
                                            <Form.Label>Status</Form.Label>
                                            <Form.Select
                                                value={filtros.status}
                                                onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
                                                size="sm"
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
                                    <Col xs={6} md={2}>
                                        <Form.Group>
                                            <Form.Label>UC</Form.Label>
                                            <Form.Control
                                                type="text"
                                                placeholder="Digite a UC"
                                                value={filtros.uc}
                                                onChange={(e) => setFiltros({ ...filtros, uc: e.target.value })}
                                                size="sm"
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col xs={6} md={2}>
                                        <Form.Group>
                                            <Form.Label>Mês Referência</Form.Label>
                                            <Form.Select
                                                value={filtros.mes_referencia}
                                                onChange={(e) => setFiltros({ ...filtros, mes_referencia: e.target.value })}
                                                size="sm"
                                            >
                                                <option value="">Todos os meses</option>
                                                {mesesDisponiveis.map(mes => (
                                                    <option key={mes} value={mes}>{mes}</option>
                                                ))}
                                            </Form.Select>
                                        </Form.Group>
                                    </Col>
                                    <Col xs={6} md={2}>
                                        <Form.Group>
                                            <Form.Label>Compensação</Form.Label>
                                            <Form.Select
                                                value={filtros.compensacao}
                                                onChange={(e) => setFiltros({ ...filtros, compensacao: e.target.value })}
                                                size="sm"
                                            >
                                                <option value="Todos">Todos</option>
                                                <option value="compensou_tudo">Compensou tudo</option>
                                                <option value="nao_compensou_tudo">Não compensou tudo</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </Col>
                                    <Col xs={12} md={4} className="d-flex align-items-end gap-2 flex-wrap">
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={carregarBoletos}
                                            disabled={carregando}
                                            title="Buscar"
                                            className="d-flex align-items-center"
                                        >
                                            {carregando ? <Spinner animation="border" size="sm" /> : <Search size={14} />}
                                        </Button>
                                        <Button
                                            variant="warning"
                                            size="sm"
                                            onClick={recalcularTodosPendentes}
                                            disabled={recalculandoTodos || !filtros.mes_referencia || boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto).length === 0}
                                            title="Recalcular pendentes"
                                            className="d-flex align-items-center"
                                        >
                                            {recalculandoTodos ? (
                                                <>
                                                    <Spinner size="sm" className="me-1" />
                                                    {progressoRecalculo.atual}/{progressoRecalculo.total}
                                                </>
                                            ) : (
                                                <>
                                                    <RotateCcw size={14} className="me-1" />
                                                    Recalcular ({boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto).length})
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            variant="info"
                                            size="sm"
                                            onClick={() => setModalBoletoManual(prev => ({ ...prev, show: true }))}
                                            title="Criar boleto manual de cogeração"
                                            className="d-flex align-items-center"
                                        >
                                            <PlusCircle size={14} />
                                        </Button>
                                    </Col>
                                </Row>

                                {/* Barra de Validação e Geração em Batch */}
                                {boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto).length > 0 && (
                                    <Row className="mt-3">
                                        <Col className="d-flex align-items-center gap-2 flex-wrap">
                                            <span className="text-muted me-2" style={{ fontSize: '0.9rem' }}>
                                                Validação:
                                            </span>
                                            <Button
                                                variant="outline-success"
                                                size="sm"
                                                onClick={validarTodosPendentes}
                                                disabled={boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto && !b.validado).length === 0}
                                            >
                                                <CheckSquare size={14} className="me-1" />
                                                Marcar Todos ({boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto && !b.validado).length})
                                            </Button>
                                            <Button
                                                variant="outline-secondary"
                                                size="sm"
                                                onClick={desmarcarTodosValidados}
                                                disabled={boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto && b.validado).length === 0}
                                            >
                                                <Square size={14} className="me-1" />
                                                Desmarcar ({boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto && b.validado).length})
                                            </Button>

                                            <div style={{ width: '1px', height: '24px', backgroundColor: '#dee2e6', margin: '0 8px' }}></div>

                                            <Button
                                                variant="success"
                                                size="sm"
                                                onClick={gerarBoletosValidados}
                                                disabled={gerandoValidados || boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto && b.validado).length === 0}
                                            >
                                                {gerandoValidados ? (
                                                    <>
                                                        <Spinner size="sm" className="me-1" />
                                                        Gerando...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play size={14} className="me-1" fill="currentColor" />
                                                        Gerar Validados ({boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto && b.validado).length})
                                                    </>
                                                )}
                                            </Button>
                                        </Col>
                                    </Row>
                                )}
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
                                        <thead>
                                            <tr>
                                                <th style={{ padding: '12px 8px', textAlign: 'center', width: '50px' }}>
                                                    <span title="Validar fatura antes de gerar boleto">OK</span>
                                                </th>
                                                <th style={{ padding: '12px 8px' }}>Status</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Envio</th>
                                                <th style={{ padding: '12px 8px' }}>UC</th>
                                                <th style={{ padding: '12px 8px' }}>Mês</th>
                                                <th style={{ padding: '12px 8px' }}>Cliente</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Consumo N.C.</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Consumo Comp.</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Economia</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor Boleto</th>
                                                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {boletos
                                                .filter((boletoOriginal) => {
                                                    if (filtros.compensacao === 'Todos') return true;
                                                    const b = normalizarBoleto(boletoOriginal);
                                                    // compensacaoCompletaAplicada = true significa que precisou de correção (não compensou tudo naturalmente)
                                                    // compensou_tudo = NÃO precisou de correção
                                                    // nao_compensou_tudo = precisou de correção
                                                    if (filtros.compensacao === 'compensou_tudo') {
                                                        return b.compensacaoCompletaAplicada !== true;
                                                    }
                                                    if (filtros.compensacao === 'nao_compensou_tudo') {
                                                        return b.compensacaoCompletaAplicada === true;
                                                    }
                                                    return true;
                                                })
                                                .map((boletoOriginal) => {
                                                const boleto = normalizarBoleto(boletoOriginal);
                                                const chave = `${boleto.uc}_${boleto.mes_referencia}`;
                                                const isBoletoManual = boleto.tipo_boleto === 'manual_cogeracao' || boleto.uc?.startsWith('MAN');
                                                return (
                                                    <tr
                                                        key={chave}
                                                        style={{
                                                            borderBottom: '1px solid #e0e0e0',
                                                            backgroundColor: isBoletoManual ? '#e3f2fd' : 'inherit' // Azul claro para boletos manuais
                                                        }}
                                                    >
                                                        {/* Checkbox de Validação */}
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
                                                            {boleto.status === 'Pendente' && !boleto.numero_boleto ? (
                                                                <Button
                                                                    variant="link"
                                                                    size="sm"
                                                                    onClick={() => toggleValidacao(boletoOriginal)}
                                                                    disabled={processando[chave]}
                                                                    style={{ padding: 0 }}
                                                                    title={boletoOriginal.validado ? 'Desmarcar validação' : 'Marcar como validado'}
                                                                >
                                                                    {processando[chave] ? (
                                                                        <Spinner animation="border" size="sm" style={{ width: '18px', height: '18px' }} />
                                                                    ) : boletoOriginal.validado ? (
                                                                        <CheckSquare size={20} className="text-success" />
                                                                    ) : (
                                                                        <Square size={20} className="text-muted" />
                                                                    )}
                                                                </Button>
                                                            ) : (
                                                                <span className="text-muted">-</span>
                                                            )}
                                                        </td>
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
                                                        {/* Coluna Status de Envio */}
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
                                                            {isBoletoManual ? (
                                                                <span style={{ color: '#999' }}>-</span>
                                                            ) : (() => {
                                                                const envioStatus = getStatusEnvio(boleto);
                                                                if (envioStatus.tipo === 'na') {
                                                                    return <span className="text-muted">-</span>;
                                                                }
                                                                if (envioStatus.tipo === 'nao_enviado') {
                                                                    return <span className="text-muted">Nao enviado</span>;
                                                                }
                                                                return (
                                                                    <div className="d-flex gap-1 justify-content-center">
                                                                        {(envioStatus.tipo === 'whatsapp' || envioStatus.tipo === 'ambos') && (
                                                                            <Badge bg="success" title="WhatsApp enviado">
                                                                                <i className="fab fa-whatsapp me-1"></i>OK
                                                                            </Badge>
                                                                        )}
                                                                        {(envioStatus.tipo === 'email' || envioStatus.tipo === 'ambos') && (
                                                                            <Badge bg="info" title="Email enviado">
                                                                                <i className="fas fa-envelope me-1"></i>OK
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
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
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'right', fontWeight: '500' }}>
                                                            {/* Mostrar valor original riscado se houve correção */}
                                                            {boleto.compensacaoCompletaAplicada &&
                                                             boleto.energiaNaoCompensadoOriginal &&
                                                             parseFloat(boleto.energiaNaoCompensadoOriginal) !== parseFloat(boleto.energiaNaoCompensado) && (
                                                                <span style={{ color: '#999', textDecoration: 'line-through', marginRight: '6px', fontSize: '0.85em' }}>
                                                                    {parseFloat(boleto.energiaNaoCompensadoOriginal).toFixed(0)}
                                                                </span>
                                                            )}
                                                            <span style={{ color: boleto.compensacaoCompletaAplicada ? '#198754' : 'inherit' }}>
                                                                {boleto.energiaNaoCompensado || 0} kWh
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'right', fontWeight: '500', color: '#198754' }}>
                                                            {boleto.energiaCompensado || 0} kWh
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'right', fontWeight: '500', color: '#198754' }}>
                                                            R$ {parseFloat(boleto.valor_economia || boleto.valorEconomia || 0).toFixed(2)}
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle', textAlign: 'right', fontWeight: '600', color: '#0d6efd' }}>
                                                            R$ {parseFloat(boleto.valorBoleto || boleto.valor_boleto || 0).toFixed(2)}
                                                        </td>
                                                        <td style={{ padding: '10px 8px', verticalAlign: 'middle' }}>
                                                            <div className="d-flex gap-1 justify-content-center align-items-center">
                                                                {/* Botão Gerar - só visível quando status é Pendente */}
                                                                <Button
                                                                    variant={boleto.status === 'Pendente' ? 'success' : 'secondary'}
                                                                    size="sm"
                                                                    onClick={() => gerarBoleto(boleto)}
                                                                    disabled={boleto.status !== 'Pendente' || processando[chave]}
                                                                    title={boleto.status === 'Pendente' ? 'Gerar boleto' : 'Boleto já gerado'}
                                                                    style={{
                                                                        width: '32px',
                                                                        height: '32px',
                                                                        padding: '0',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        opacity: boleto.status === 'Pendente' ? 1 : 0.3,
                                                                        border: 'none'
                                                                    }}
                                                                >
                                                                    {processando[chave] && boleto.status === 'Pendente' ? (
                                                                        <Spinner animation="border" size="sm" style={{ width: '14px', height: '14px' }} />
                                                                    ) : (
                                                                        <Receipt size={14} />
                                                                    )}
                                                                </Button>

                                                                {/* Botão Cancelar - habilitado quando tem boleto (qualquer status exceto Pendente) */}
                                                                <Button
                                                                    variant="outline-danger"
                                                                    size="sm"
                                                                    onClick={() => cancelarBoleto(boleto)}
                                                                    disabled={boleto.status === 'Pendente' || !boleto.numero_boleto || processando[chave]}
                                                                    title={boleto.numero_boleto ? 'Cancelar boleto' : 'Boleto não gerado'}
                                                                    style={{
                                                                        width: '32px',
                                                                        height: '32px',
                                                                        padding: '0',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        opacity: boleto.numero_boleto && boleto.status !== 'Pendente' ? 1 : 0.3,
                                                                        borderWidth: '1px'
                                                                    }}
                                                                >
                                                                    {processando[chave] && boleto.numero_boleto ? (
                                                                        <Spinner animation="border" size="sm" style={{ width: '14px', height: '14px' }} />
                                                                    ) : (
                                                                        <Trash2 size={14} />
                                                                    )}
                                                                </Button>

                                                                {/* Dropdown Mais Ações */}
                                                                <Dropdown>
                                                                    <Dropdown.Toggle
                                                                        variant="outline-secondary"
                                                                        size="sm"
                                                                        id={`dropdown-acoes-${chave}`}
                                                                        style={{
                                                                            height: '32px',
                                                                            padding: '0 8px',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            gap: '4px'
                                                                        }}
                                                                        title="Mais ações"
                                                                    >
                                                                        <ChevronDown size={14} />
                                                                    </Dropdown.Toggle>
                                                                    <Dropdown.Menu>
                                                                        <Dropdown.Item onClick={() => visualizarDetalhes(boleto)}>
                                                                            <Eye size={14} className="me-2" /> Ver detalhes
                                                                        </Dropdown.Item>
                                                                        <Dropdown.Item
                                                                            onClick={() => abrirModalDownloadIndividual(boleto)}
                                                                            disabled={!boleto.numero_boleto}
                                                                        >
                                                                            <Download size={14} className="me-2" /> Baixar PDF
                                                                        </Dropdown.Item>
                                                                        {!isBoletoManual && (
                                                                            <Dropdown.Item
                                                                                onClick={() => abrirModalEnvio(boleto)}
                                                                                disabled={!boleto.numero_boleto}
                                                                            >
                                                                                <Send size={14} className="me-2" /> Enviar
                                                                            </Dropdown.Item>
                                                                        )}
                                                                        <Dropdown.Divider />
                                                                        {!isBoletoManual && (
                                                                            <Dropdown.Item
                                                                                onClick={() => recalcularBoleto(boleto)}
                                                                                disabled={boleto.status !== 'Pendente' || processando[chave]}
                                                                            >
                                                                                <RotateCcw size={14} className="me-2" /> Recalcular
                                                                            </Dropdown.Item>
                                                                        )}
                                                                    </Dropdown.Menu>
                                                                </Dropdown>

                                                                {/* Badge para boletos manuais */}
                                                                {isBoletoManual && (
                                                                    <Badge bg="info" style={{ fontSize: '0.65rem', padding: '4px 6px' }} title="Boleto de Cogeração">
                                                                        COG
                                                                    </Badge>
                                                                )}
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
                                    <Alert variant="info" className="mb-0 py-2">
                                        <strong>Total:</strong> {boletos.length}
                                        {' | '}
                                        <strong>Pendentes:</strong> {boletos.filter(b => b.status === 'Pendente' && !b.numero_boleto).length}
                                        {' | '}
                                        <strong>Gerados:</strong> {boletos.filter(b => b.status === 'Boleto gerado' || b.numero_boleto).length}
                                    </Alert>
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Modal de detalhes do boleto - REDESENHADO */}
            <Modal show={modalDetalhes.show} onHide={() => setModalDetalhes({ show: false, boleto: null, editando: false, dadosEditados: null })} size="xl" scrollable centered>
                <Modal.Header closeButton style={modalDetalhes.boleto?.tipo_boleto === 'manual_cogeracao' ? { backgroundColor: '#17a2b8', color: 'white' } : {}}>
                    <Modal.Title style={{ fontSize: '1.1rem' }}>
                        {modalDetalhes.editando
                            ? 'Editar Dados da Fatura'
                            : modalDetalhes.boleto?.tipo_boleto === 'manual_cogeracao'
                                ? 'Detalhes do Boleto de Cogeração'
                                : 'Detalhes do Boleto de Energia'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    {modalDetalhes.boleto && (
                        <div>
                            {/* Card de Status e Info Principal */}
                            <Card className="mb-2">
                                <Card.Body className="py-2">
                                    <Row>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <small className="text-muted">UC</small>
                                                <h6 className="mb-0">{modalDetalhes.boleto.uc}</h6>
                                            </div>
                                        </Col>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <small className="text-muted">Mês Referência</small>
                                                <h6 className="mb-0">{modalDetalhes.boleto.mes_referencia}</h6>
                                            </div>
                                        </Col>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <small className="text-muted">Status</small>
                                                <div>
                                                    <Badge bg={getBadgeStatus(modalDetalhes.boleto.status)} style={{ fontSize: '0.85rem', padding: '4px 12px' }}>
                                                        {modalDetalhes.boleto.status}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </Col>
                                        <Col md={3}>
                                            <div className="text-center">
                                                <small className="text-muted">Vencimento</small>
                                                {modalDetalhes.editando && modalDetalhes.boleto.status !== 'Boleto gerado' ? (
                                                    <Form.Control
                                                        size="sm"
                                                        type="text"
                                                        placeholder="DD/MM/AAAA"
                                                        value={modalDetalhes.dadosEditados.dataVencimento || modalDetalhes.dadosEditados.data_vencimento || ''}
                                                        onChange={(e) => atualizarCampoEditado('dataVencimento', e.target.value)}
                                                        style={{ textAlign: 'center' }}
                                                    />
                                                ) : (
                                                    <h6 className="text-danger mb-0">{modalDetalhes.boleto.dataVencimento || modalDetalhes.boleto.data_vencimento || '-'}</h6>
                                                )}
                                            </div>
                                        </Col>
                                    </Row>
                                </Card.Body>
                            </Card>

                            <Row>
                                {/* Coluna Esquerda - Dados do Cliente */}
                                <Col md={6}>
                                    <Card className="mb-2">
                                        <Card.Header className="py-2">
                                            <strong style={{ fontSize: '0.95rem' }}>Dados do Pagador</strong>
                                        </Card.Header>
                                        <Card.Body className="py-2">
                                            {modalDetalhes.editando ? (
                                                <>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Nome</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="text"
                                                            value={modalDetalhes.dadosEditados.nomeCompleto || ''}
                                                            onChange={(e) => atualizarCampoEditado('nomeCompleto', e.target.value)}
                                                        />
                                                    </Form.Group>
                                                    <Row>
                                                        <Col md={8}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">Documento (CPF/CNPJ)</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.documento || ''}
                                                                    onChange={(e) => atualizarCampoEditado('documento', e.target.value)}
                                                                    placeholder="00000000000 ou 00000000000000"
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={4}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">Tipo</small></Form.Label>
                                                                <Form.Select
                                                                    size="sm"
                                                                    value={modalDetalhes.dadosEditados.tipoPessoa || '1'}
                                                                    onChange={(e) => atualizarCampoEditado('tipoPessoa', e.target.value)}
                                                                >
                                                                    <option value="1">CPF</option>
                                                                    <option value="2">CNPJ</option>
                                                                </Form.Select>
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Endereço</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="text"
                                                            value={modalDetalhes.dadosEditados.endereco || ''}
                                                            onChange={(e) => atualizarCampoEditado('endereco', e.target.value)}
                                                        />
                                                    </Form.Group>
                                                    <Row>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">Bairro</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.bairro || ''}
                                                                    onChange={(e) => atualizarCampoEditado('bairro', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">CEP</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.cep || ''}
                                                                    onChange={(e) => atualizarCampoEditado('cep', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                    </Row>
                                                    <Row>
                                                        <Col md={8}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">Cidade</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
                                                                    type="text"
                                                                    value={modalDetalhes.dadosEditados.cidade || ''}
                                                                    onChange={(e) => atualizarCampoEditado('cidade', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={4}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">UF</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
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
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">Email</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
                                                                    type="email"
                                                                    value={modalDetalhes.dadosEditados.email || ''}
                                                                    onChange={(e) => atualizarCampoEditado('email', e.target.value)}
                                                                />
                                                            </Form.Group>
                                                        </Col>
                                                        <Col md={6}>
                                                            <Form.Group className="mb-2">
                                                                <Form.Label><small className="text-muted">Telefone</small></Form.Label>
                                                                <Form.Control
                                                                    size="sm"
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

                                {/* Coluna Direita - Consumo ou Economia Gerada */}
                                <Col md={6}>
                                    {/* Seção de Economia Gerada para boletos manuais */}
                                    {modalDetalhes.boleto.tipo_boleto === 'manual_cogeracao' ? (
                                        <Card className="mb-2">
                                            <Card.Header className="py-2" style={{ backgroundColor: '#17a2b8', color: 'white' }}>
                                                <strong style={{ fontSize: '0.95rem' }}>Economia Gerada</strong>
                                            </Card.Header>
                                            <Card.Body className="py-3 text-center">
                                                <small className="text-muted d-block mb-2">Este boleto foi criado manualmente</small>
                                                <div className="p-3 rounded" style={{ backgroundColor: '#e3f2fd' }}>
                                                    <small className="text-muted">Valor da Economia Gerada</small>
                                                    <h2 className="mb-0 text-info">
                                                        R$ {parseFloat(modalDetalhes.boleto.valor_boleto || 0).toFixed(2).replace('.', ',')}
                                                    </h2>
                                                </div>
                                            </Card.Body>
                                        </Card>
                                    ) : (
                                    <Card className="mb-2">
                                        <Card.Header className="py-2">
                                            <strong style={{ fontSize: '0.95rem' }}>Consumo de Energia</strong>
                                        </Card.Header>
                                        <Card.Body className="py-2">
                                            {modalDetalhes.editando ? (
                                                <>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Compensado (kWh)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.energiaCompensado ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('energiaCompensado', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Não Compensado (kWh)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.energiaNaoCompensado ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('energiaNaoCompensado', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Total (kWh)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.energiaTotal ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('energiaTotal', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                </>
                                            ) : (
                                                <>
                                                    {/* Indicador de Compensação Completa Aplicada */}
                                                    {modalDetalhes.boleto.compensacaoCompletaAplicada && (
                                                        <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '0.8rem' }}>
                                                            <strong>✓ Compensação Completa Aplicada</strong>
                                                            <span className="ms-2 text-muted">Valores ajustados para tarifa mínima</span>
                                                        </div>
                                                    )}
                                                    <Row>
                                                        <Col xs={6}>
                                                            <div className="text-center p-2 border rounded">
                                                                <small className="text-muted">Compensado</small>
                                                                {/* Mostrar valor original riscado se houve correção */}
                                                                {modalDetalhes.boleto.compensacaoCompletaAplicada &&
                                                                 modalDetalhes.boleto.energiaCompensadoOriginal &&
                                                                 parseFloat(modalDetalhes.boleto.energiaCompensadoOriginal) !== parseFloat(modalDetalhes.boleto.energiaCompensado) && (
                                                                    <div style={{ fontSize: '0.8rem', color: '#6c757d', textDecoration: 'line-through' }}>
                                                                        {parseFloat(modalDetalhes.boleto.energiaCompensadoOriginal).toFixed(2)} kWh
                                                                    </div>
                                                                )}
                                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: modalDetalhes.boleto.compensacaoCompletaAplicada ? '#198754' : 'inherit' }}>
                                                                    {modalDetalhes.boleto.energiaCompensado || 0} kWh
                                                                </div>
                                                            </div>
                                                        </Col>
                                                        <Col xs={6}>
                                                            <div className="text-center p-2 border rounded">
                                                                <small className="text-muted">Não Compensado</small>
                                                                {/* Mostrar valor original riscado se houve correção */}
                                                                {modalDetalhes.boleto.compensacaoCompletaAplicada &&
                                                                 modalDetalhes.boleto.energiaNaoCompensadoOriginal &&
                                                                 parseFloat(modalDetalhes.boleto.energiaNaoCompensadoOriginal) !== parseFloat(modalDetalhes.boleto.energiaNaoCompensado) && (
                                                                    <div style={{ fontSize: '0.8rem', color: '#6c757d', textDecoration: 'line-through' }}>
                                                                        {parseFloat(modalDetalhes.boleto.energiaNaoCompensadoOriginal).toFixed(2)} kWh
                                                                    </div>
                                                                )}
                                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: modalDetalhes.boleto.compensacaoCompletaAplicada ? '#198754' : 'inherit' }}>
                                                                    {modalDetalhes.boleto.energiaNaoCompensado || 0} kWh
                                                                </div>
                                                            </div>
                                                        </Col>
                                                    </Row>
                                                    <div className="text-center mt-2 p-2 border rounded">
                                                        <small className="text-muted">Total</small>
                                                        <div className="text-primary" style={{ fontSize: '1.1rem', fontWeight: '600' }}>{modalDetalhes.boleto.energiaTotal || 0} kWh</div>
                                                    </div>
                                                </>
                                            )}
                                        </Card.Body>
                                    </Card>
                                    )}
                                </Col>
                            </Row>

                            {/* Card de Valores Financeiros */}
                            <Card className="mb-2">
                                <Card.Header className="py-2" style={modalDetalhes.boleto.tipo_boleto === 'manual_cogeracao' ? { backgroundColor: '#17a2b8', color: 'white' } : {}}>
                                    <strong style={{ fontSize: '0.95rem' }}>
                                        {modalDetalhes.boleto.tipo_boleto === 'manual_cogeracao' ? 'Valor do Boleto' : 'Valores Financeiros'}
                                    </strong>
                                </Card.Header>
                                <Card.Body className="py-2">
                                    {/* Para boletos de cogeração, mostrar apenas o valor do boleto */}
                                    {modalDetalhes.boleto.tipo_boleto === 'manual_cogeracao' ? (
                                        <div className="text-center py-3">
                                            <div className="p-3 border border-info rounded" style={{ backgroundColor: '#e3f2fd' }}>
                                                <small className="text-muted">Valor Total do Boleto</small>
                                                <div className="text-info" style={{ fontSize: '2rem', fontWeight: '700' }}>
                                                    R$ {parseFloat(modalDetalhes.boleto.valor_boleto || 0).toFixed(2).replace('.', ',')}
                                                </div>
                                            </div>
                                        </div>
                                    ) : modalDetalhes.editando ? (
                                        <>
                                            <Row>
                                                <Col md={4}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Valor Energia Compensada (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valorEnergiaCompensada ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valorEnergiaCompensada', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-success">✓ Com Desconto AUPUS (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_com_desconto ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_com_desconto', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={4}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Valor Bandeira Compensada (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valorBandeiraCompensada ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valorBandeiraCompensada', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-success">✓ Com Desconto AUPUS (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_bandeira_com_desconto ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_bandeira_com_desconto', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={4}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Tarifa Mínima Concessionária (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.tarifaMinimaConcessionaria ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('tarifaMinimaConcessionaria', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-muted">Valor sem Desconto (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_s_desconto ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_s_desconto', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                            </Row>

                                            <hr className="my-2" />

                                            <Row>
                                                <Col md={6}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-primary">Valor Total do Boleto (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valorBoleto ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valorBoleto', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                            style={{ fontWeight: 'bold' }}
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={6}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label><small className="text-success">Economia Total (R$)</small></Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            step="0.01"
                                                            value={modalDetalhes.dadosEditados.valor_economia ?? modalDetalhes.dadosEditados.valorEconomia ?? 0}
                                                            onChange={(e) => atualizarCampoEditado('valor_economia', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                            style={{ fontWeight: 'bold' }}
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

                                            <hr className="my-2" />

                                            {/* Seção de Valores com Abatimento */}
                                            {modalDetalhes.boleto.valor_abatimento && parseFloat(modalDetalhes.boleto.valor_abatimento) > 0 ? (
                                                <>
                                                    <Alert variant="warning" className="mb-2 py-2">
                                                        <Row>
                                                            <Col>
                                                                <strong>⚠️ Abatimento Aplicado</strong>
                                                                <p className="mb-0 mt-1" style={{ fontSize: '0.9rem' }}>
                                                                    <strong>Motivo:</strong> {modalDetalhes.boleto.motivo_abatimento || 'Não informado'}
                                                                </p>
                                                            </Col>
                                                        </Row>
                                                    </Alert>
                                                    <Row>
                                                        <Col md={4}>
                                                            <div className="p-2 text-center border border-secondary rounded">
                                                                <small className="text-muted">Valor Original</small>
                                                                <div style={{ fontSize: '1rem', fontWeight: '600', textDecoration: 'line-through', color: '#6c757d' }}>
                                                                    {formatarValor(parseFloat(modalDetalhes.boleto.valorBoleto) + parseFloat(modalDetalhes.boleto.valor_abatimento))}
                                                                </div>
                                                            </div>
                                                        </Col>
                                                        <Col md={4}>
                                                            <div className="p-2 text-center border border-danger rounded">
                                                                <small className="text-muted">Abatimento</small>
                                                                <div className="text-danger" style={{ fontSize: '1rem', fontWeight: '700' }}>
                                                                    - {formatarValor(modalDetalhes.boleto.valor_abatimento)}
                                                                </div>
                                                            </div>
                                                        </Col>
                                                        <Col md={4}>
                                                            <div className="p-2 text-center border border-primary rounded" style={{ backgroundColor: '#e7f3ff' }}>
                                                                <small className="text-muted">Valor Final</small>
                                                                <div className="text-primary" style={{ fontSize: '1.2rem', fontWeight: '700' }}>
                                                                    {formatarValor(modalDetalhes.boleto.valorBoleto)}
                                                                </div>
                                                            </div>
                                                        </Col>
                                                    </Row>
                                                    <Row className="mt-2">
                                                        <Col>
                                                            <div className="p-2 text-center border border-success rounded">
                                                                <small className="text-muted">Economia Total</small>
                                                                <div className="text-success" style={{ fontSize: '1.2rem', fontWeight: '700' }}>
                                                                    {formatarValor(modalDetalhes.boleto.valor_economia || modalDetalhes.boleto.valorEconomia)}
                                                                </div>
                                                            </div>
                                                        </Col>
                                                    </Row>
                                                </>
                                            ) : (
                                                <Row>
                                                    <Col md={4}>
                                                        <div className="p-2 text-center border border-info rounded">
                                                            <small className="text-muted">Valor AUPUS</small>
                                                            <div className="text-info" style={{ fontSize: '1.1rem', fontWeight: '600' }}>{formatarValor(modalDetalhes.boleto.valorAupus || modalDetalhes.boleto.valor_aupus || modalDetalhes.boleto.valor_com_desconto_aupus)}</div>
                                                        </div>
                                                    </Col>
                                                    <Col md={4}>
                                                        <div className="p-2 text-center border border-primary rounded" style={{ backgroundColor: '#e7f3ff' }}>
                                                            <small className="text-muted">Valor Total Boleto</small>
                                                            <div className="text-primary" style={{ fontSize: '1.2rem', fontWeight: '700' }}>{formatarValor(modalDetalhes.boleto.valorConsorcio || modalDetalhes.boleto.valor_consorcio || modalDetalhes.boleto.valorBoleto)}</div>
                                                        </div>
                                                    </Col>
                                                    <Col md={4}>
                                                        <div className="p-2 text-center border border-success rounded">
                                                            <small className="text-muted">Economia Total</small>
                                                            <div className="text-success" style={{ fontSize: '1.1rem', fontWeight: '600' }}>{formatarValor(modalDetalhes.boleto.valor_economia || modalDetalhes.boleto.valorEconomia)}</div>
                                                        </div>
                                                    </Col>
                                                </Row>
                                            )}
                                        </>
                                    )}
                                </Card.Body>
                            </Card>

                            {/* Card de Informações do Sistema */}
                            {(modalDetalhes.boleto.numero_boleto || modalDetalhes.boleto.data_recebimento || modalDetalhes.boleto.data_geracao_boleto) && (
                                <Card className="mb-2">
                                    <Card.Header className="py-2">
                                        <strong style={{ fontSize: '0.95rem' }}>Informações do Sistema</strong>
                                    </Card.Header>
                                    <Card.Body className="py-2">
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
                                variant="warning"
                                onClick={() => abrirModalAbatimento(modalDetalhes.boleto)}
                                disabled={modalDetalhes.boleto?.status === 'Boleto gerado'}
                                title={modalDetalhes.boleto?.status === 'Boleto gerado' ? 'Não é possível adicionar abatimento após gerar boleto' : 'Adicionar abatimento'}
                            >
                                Abatimento
                            </Button>
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
            <Modal show={modalVencimento.show} onHide={() => setModalVencimento({ show: false, boleto: null, dataVencimento: '' })} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Informar Data de Vencimento</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Alert variant="warning">
                        A data de vencimento padrão (dia {modalVencimento.boleto?.vencimentoConsorcio || modalVencimento.boleto?.vencimento_consorcio || 20} do mês seguinte) já passou.
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

            {/* Modal de Abatimento */}
            <Modal show={modalAbatimento.show} onHide={() => setModalAbatimento({ show: false, boleto: null, valorAbatimento: 0, motivoAbatimento: '' })} centered>
                <Modal.Header closeButton>
                    <Modal.Title>
                        {modalAbatimento.boleto && parseFloat(modalAbatimento.boleto.valor_abatimento || 0) > 0
                            ? 'Editar Abatimento'
                            : 'Adicionar Abatimento'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {modalAbatimento.boleto && (
                        <div>
                            <div className="mb-3">
                                <strong>UC:</strong> {modalAbatimento.boleto.uc}<br/>
                                <strong>Mês:</strong> {modalAbatimento.boleto.mes_referencia}
                            </div>

                            <Row className="mb-3">
                                <Col>
                                    <Form.Group>
                                        <Form.Label><strong>Valor Total Original</strong></Form.Label>
                                        <Form.Control
                                            type="text"
                                            value={formatarValor(modalAbatimento.boleto.valorBoleto || 0)}
                                            disabled
                                            style={{ fontWeight: 'bold', backgroundColor: '#e9ecef' }}
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>

                            <Row className="mb-3">
                                <Col>
                                    <Form.Group>
                                        <Form.Label><strong>Valor do Abatimento</strong></Form.Label>
                                        <Form.Control
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max={modalAbatimento.boleto.valorBoleto || 0}
                                            value={modalAbatimento.valorAbatimento}
                                            onChange={(e) => setModalAbatimento({
                                                ...modalAbatimento,
                                                valorAbatimento: e.target.value
                                            })}
                                            placeholder="0.00"
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>

                            <Row className="mb-3">
                                <Col>
                                    <Alert variant="info" className="mb-0">
                                        <strong>Novo Valor do Boleto:</strong> {' '}
                                        <span style={{ fontSize: '1.2em', color: '#0d6efd' }}>
                                            {formatarValor((modalAbatimento.boleto.valorBoleto || 0) - (parseFloat(modalAbatimento.valorAbatimento) || 0))}
                                        </span>
                                    </Alert>
                                </Col>
                            </Row>

                            <Row>
                                <Col>
                                    <Form.Group>
                                        <Form.Label><strong>Motivo do Abatimento</strong></Form.Label>
                                        <Form.Control
                                            as="textarea"
                                            rows={3}
                                            value={modalAbatimento.motivoAbatimento}
                                            onChange={(e) => setModalAbatimento({
                                                ...modalAbatimento,
                                                motivoAbatimento: e.target.value
                                            })}
                                            placeholder="Descreva o motivo do abatimento..."
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setModalAbatimento({ show: false, boleto: null, valorAbatimento: 0, motivoAbatimento: '' })}>
                        Cancelar
                    </Button>
                    <Button variant="success" onClick={salvarAbatimento}>
                        Salvar Abatimento
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Modal de Seleção de Mês */}
            <Modal show={mostrarModalMes} onHide={() => setMostrarModalMes(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>
                        <PackageOpen className="me-2" size={24} />
                        Selecione o Mês de Referência
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form.Group>
                        <Form.Label>Mês/Ano</Form.Label>
                        <Form.Select
                            value={mesSelecionado}
                            onChange={(e) => setMesSelecionado(e.target.value)}
                            size="lg"
                        >
                            {mesesDisponiveis.map(mes => {
                                const qtd = boletos.filter(b => {
                                    const boleto = normalizarBoleto(b);
                                    return boleto.status === 'Boleto gerado' &&
                                           boleto.numero_boleto &&
                                           boleto.mes_referencia === mes;
                                }).length;
                                return (
                                    <option key={mes} value={mes}>
                                        {mes} ({qtd} boleto{qtd !== 1 ? 's' : ''})
                                    </option>
                                );
                            })}
                        </Form.Select>
                    </Form.Group>
                    <div className="mt-3 text-muted">
                        <small>
                            Serão baixados apenas os boletos do mês selecionado.
                        </small>
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setMostrarModalMes(false)}>
                        Cancelar
                    </Button>
                    <Button variant="primary" onClick={confirmarMesEAbrirModalJuntar}>
                        <Download size={16} className="me-2" />
                        Continuar
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Modal de Juntar com Fatura Original */}
            <Modal show={mostrarModalJuntar} onHide={() => setMostrarModalJuntar(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>
                        <PackageOpen className="me-2" size={24} />
                        Juntar com Fatura Original?
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="mb-3">
                        Deseja combinar os boletos com as faturas originais da concessionária?
                    </p>
                    <div className="alert alert-info mb-0">
                        <strong>📋 Se SIM:</strong>
                        <ul className="mb-2 mt-2">
                            <li>Cada PDF conterá: <strong>Fatura Original (com marca PAGO) + Boleto Aupus</strong></li>
                            <li>Arquivos salvos em: <code>04. PDF COMBINADO/{mesSelecionado}</code></li>
                            <li>Nome: <code>Fatura AUPUS - UC - Nome.pdf</code></li>
                        </ul>
                        <strong>📄 Se NÃO:</strong>
                        <ul className="mb-0 mt-2">
                            <li>ZIP conterá apenas os <strong>Boletos Aupus</strong></li>
                            <li>Arquivos já salvos em: <code>02. NET/{mesSelecionado}</code></li>
                        </ul>
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => baixarTodosBoletosZip(false)}>
                        <Download size={16} className="me-2" />
                        Não, Apenas Boletos
                    </Button>
                    <Button variant="success" onClick={() => baixarTodosBoletosZip(true)}>
                        <Download size={16} className="me-2" />
                        Sim, Juntar com Fatura
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Modal de Download Individual */}
            <Modal show={mostrarModalDownloadIndividual} onHide={() => setMostrarModalDownloadIndividual(false)} centered>
                <Modal.Header closeButton style={boletoParaDownload?.tipo_boleto === 'manual_cogeracao' ? { backgroundColor: '#17a2b8', color: 'white' } : {}}>
                    <Modal.Title>
                        <Download className="me-2" size={24} />
                        {boletoParaDownload?.tipo_boleto === 'manual_cogeracao' ? 'Baixar Boleto - Economia Gerada' : 'Baixar Boleto'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {boletoParaDownload?.tipo_boleto === 'manual_cogeracao' ? (
                        /* Modal simplificado para boletos de economia gerada */
                        <div className="text-center">
                            <div className="alert alert-info mb-3">
                                <strong>📄 Boleto de Economia Gerada</strong>
                                <p className="mb-0 mt-2">
                                    Download do PDF do boleto registrado no Banco do Brasil
                                </p>
                            </div>
                            <p className="text-muted small">
                                UC: {boletoParaDownload?.uc} | Valor: R$ {parseFloat(boletoParaDownload?.valor_boleto || 0).toFixed(2).replace('.', ',')}
                            </p>
                        </div>
                    ) : (
                        /* Modal normal para boletos de energia */
                        <>
                            <p className="mb-3">
                                Como deseja baixar este boleto?
                            </p>
                            <div className="alert alert-info mb-0">
                                <strong>📄 Apenas Boleto:</strong>
                                <ul className="mb-2 mt-2">
                                    <li>Download direto do <strong>Boleto Aupus</strong></li>
                                    <li>Não salva no servidor</li>
                                </ul>
                                <strong>📋 Salvar e Juntar:</strong>
                                <ul className="mb-0 mt-2">
                                    <li>Salva boleto em: <code>02. NET/ANO/MES.ANO/</code></li>
                                    <li>Cria PDF combinado: <strong>Boleto NET + Fatura Original (PAGO)</strong></li>
                                    <li>Salva em: <code>04. PDF COMBINADO/ANO/MES.ANO/</code></li>
                                    <li>Faz download do PDF combinado</li>
                                </ul>
                            </div>
                        </>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    {boletoParaDownload?.tipo_boleto === 'manual_cogeracao' ? (
                        /* Boleto de economia gerada - usa o mesmo PDF normal (já tem dados do BB) */
                        <Button
                            variant="info"
                            onClick={() => {
                                setMostrarModalDownloadIndividual(false);
                                gerarPDFBoleto(boletoParaDownload, false);
                            }}
                        >
                            <Download size={16} className="me-2" />
                            Baixar PDF
                        </Button>
                    ) : (
                        /* Botões normais */
                        <>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setMostrarModalDownloadIndividual(false);
                                    gerarPDFBoleto(boletoParaDownload, false);
                                }}
                            >
                                <Download size={16} className="me-2" />
                                Apenas Boleto
                            </Button>
                            <Button
                                variant="success"
                                onClick={() => {
                                    setMostrarModalDownloadIndividual(false);
                                    gerarPDFBoleto(boletoParaDownload, true);
                                }}
                            >
                                <PackageOpen size={16} className="me-2" />
                                Salvar e Juntar
                            </Button>
                        </>
                    )}
                </Modal.Footer>
            </Modal>

            {/* Modal de Progresso do Download em Massa */}
            <Modal show={baixandoTodos} backdrop="static" keyboard={false} centered size="lg">
                <Modal.Header>
                    <Modal.Title>
                        <PackageOpen className="me-2" size={24} />
                        {etapaAtual === 'geracao' ? 'Gerando Boletos' : 'Juntando com Faturas'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {/* ETAPA 1: Geração de Boletos */}
                    <div className="mb-4">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <h6 className="mb-0">
                                {etapaAtual === 'geracao' ? '⏳' : '✅'} Etapa 1: Gerando Boletos
                            </h6>
                            <span className="badge bg-primary">
                                {progresso.atual} / {progresso.total}
                            </span>
                        </div>
                        <ProgressBar
                            now={(progresso.atual / progresso.total) * 100}
                            label={`${Math.round((progresso.atual / progresso.total) * 100)}%`}
                            animated={etapaAtual === 'geracao'}
                            striped
                            variant={etapaAtual === 'geracao' ? 'primary' : 'success'}
                            style={{ height: '25px', fontSize: '14px' }}
                        />
                        {etapaAtual === 'geracao' && (
                            <div className="mt-2 text-muted small">
                                <Spinner animation="border" size="sm" className="me-2" />
                                Buscando dados do BB e gerando PDFs...
                            </div>
                        )}
                    </div>

                    {/* ETAPA 2: Junção com Faturas (só aparece se usuário escolheu juntar) */}
                    {progressoJuncao.total > 0 && (
                        <div className="mb-3">
                            <div className="d-flex justify-content-between align-items-center mb-2">
                                <h6 className="mb-0">
                                    {etapaAtual === 'juncao' ? '⏳' : etapaAtual === 'geracao' ? '⏸️' : '✅'} Etapa 2: Juntando com Faturas Originais
                                </h6>
                                <span className={`badge ${etapaAtual === 'juncao' ? 'bg-warning' : 'bg-secondary'}`}>
                                    {progressoJuncao.atual} / {progressoJuncao.total}
                                </span>
                            </div>
                            <ProgressBar
                                now={(progressoJuncao.atual / progressoJuncao.total) * 100}
                                label={`${Math.round((progressoJuncao.atual / progressoJuncao.total) * 100)}%`}
                                animated={etapaAtual === 'juncao'}
                                striped
                                variant={etapaAtual === 'juncao' ? 'warning' : (progressoJuncao.atual === progressoJuncao.total ? 'success' : 'secondary')}
                                style={{ height: '25px', fontSize: '14px' }}
                            />
                            {etapaAtual === 'juncao' && (
                                <div className="mt-2 text-muted small">
                                    <Spinner animation="border" size="sm" variant="warning" className="me-2" />
                                    Adicionando marca PAGO e combinando PDFs...
                                </div>
                            )}
                        </div>
                    )}

                    {/* Status Geral */}
                    <div className="text-center mt-4 pt-3 border-top">
                        <small className="text-muted">
                            {etapaAtual === 'geracao'
                                ? 'Aguarde enquanto geramos os boletos do Banco do Brasil...'
                                : 'Aguarde enquanto juntamos os boletos com as faturas originais...'}
                        </small>
                    </div>
                </Modal.Body>
            </Modal>

            {/* Modal de Progresso do Job de Geração */}
            <Modal show={mostrarModalJob} onHide={() => !gerandoValidados && setMostrarModalJob(false)} centered backdrop="static">
                <Modal.Header closeButton={!gerandoValidados}>
                    <Modal.Title>
                        <Play className="me-2" size={24} />
                        Geração de Boletos em Lote
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {jobAtual && (
                        <div>
                            <div className="mb-3">
                                <div className="d-flex justify-content-between mb-1">
                                    <span>Progresso</span>
                                    <span>{jobAtual.processados} / {jobAtual.total}</span>
                                </div>
                                <ProgressBar
                                    now={(jobAtual.processados / jobAtual.total) * 100}
                                    variant={jobAtual.status === 'concluido' ? (jobAtual.erros > 0 ? 'warning' : 'success') : 'primary'}
                                    animated={jobAtual.status === 'processando'}
                                    label={`${Math.round((jobAtual.processados / jobAtual.total) * 100)}%`}
                                />
                            </div>

                            <Row className="text-center mb-3">
                                <Col>
                                    <div className="p-2 bg-light rounded">
                                        <div className="text-success fw-bold" style={{ fontSize: '1.5em' }}>{jobAtual.sucesso}</div>
                                        <small className="text-muted">Sucesso</small>
                                    </div>
                                </Col>
                                <Col>
                                    <div className="p-2 bg-light rounded">
                                        <div className="text-danger fw-bold" style={{ fontSize: '1.5em' }}>{jobAtual.erros}</div>
                                        <small className="text-muted">Erros</small>
                                    </div>
                                </Col>
                                <Col>
                                    <div className="p-2 bg-light rounded">
                                        <div className="text-primary fw-bold" style={{ fontSize: '1.5em' }}>
                                            {jobAtual.total - jobAtual.processados}
                                        </div>
                                        <small className="text-muted">Restantes</small>
                                    </div>
                                </Col>
                            </Row>

                            {jobAtual.status === 'processando' && (
                                <Alert variant="info" className="mb-0">
                                    <Spinner size="sm" className="me-2" />
                                    Gerando boletos... Não feche esta janela.
                                </Alert>
                            )}

                            {jobAtual.status === 'concluido' && (
                                <Alert variant={jobAtual.erros > 0 ? 'warning' : 'success'} className="mb-0">
                                    <CheckCircle size={18} className="me-2" />
                                    {jobAtual.erros > 0
                                        ? `Geração concluída com ${jobAtual.erros} erro(s). Verifique os detalhes.`
                                        : 'Todos os boletos foram gerados com sucesso!'}
                                </Alert>
                            )}

                            {/* Detalhes dos erros */}
                            {jobAtual.status === 'concluido' && jobAtual.detalhes.filter(d => d.status === 'erro').length > 0 && (
                                <div className="mt-3" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    <strong className="text-danger">Erros:</strong>
                                    <ul className="mb-0 ps-3 mt-1">
                                        {jobAtual.detalhes.filter(d => d.status === 'erro').map((detalhe, idx) => (
                                            <li key={idx} className="text-danger small">
                                                UC {detalhe.uc}: {detalhe.mensagem}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button
                        variant={jobAtual?.status === 'concluido' ? 'success' : 'secondary'}
                        onClick={() => setMostrarModalJob(false)}
                        disabled={gerandoValidados}
                    >
                        {jobAtual?.status === 'concluido' ? 'Fechar' : 'Aguarde...'}
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Modal de Envio (WhatsApp/Email) */}
            <Modal show={modalEnvio.show} onHide={fecharModalEnvio} centered size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>
                        <Send size={20} className="me-2" />
                        Enviar Boleto
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {modalEnvio.boleto && (
                        <>
                            <div className="mb-3 p-3 rounded" style={{ backgroundColor: 'var(--bg-tertiary, #f8f9fa)', border: '1px solid var(--border-color, #dee2e6)' }}>
                                <div className="d-flex justify-content-between">
                                    <div>
                                        <small style={{ color: 'var(--text-secondary)' }}>Cliente:</small>
                                        <div><strong>{modalEnvio.boleto.nome_completo}</strong></div>
                                    </div>
                                    <div className="text-end">
                                        <small style={{ color: 'var(--text-secondary)' }}>UC:</small>
                                        <div><strong>{modalEnvio.boleto.uc}</strong></div>
                                    </div>
                                </div>
                                <div className="mt-2 d-flex justify-content-between">
                                    <div>
                                        <small style={{ color: 'var(--text-secondary)' }}>Boleto:</small>
                                        <div>{modalEnvio.boleto.numero_boleto}</div>
                                    </div>
                                    <div className="text-end">
                                        <small style={{ color: 'var(--text-secondary)' }}>Valor:</small>
                                        <div><strong>R$ {parseFloat(modalEnvio.boleto.valor_boleto || 0).toFixed(2).replace('.', ',')}</strong></div>
                                    </div>
                                </div>
                            </div>

                            <Tabs
                                activeKey={modalEnvio.abaAtiva}
                                onSelect={(k) => setModalEnvio(prev => ({ ...prev, abaAtiva: k }))}
                                className="mb-3"
                            >
                                {/* Aba de Configurações de Envio */}
                                <Tab eventKey="envio" title={<><Send size={14} className="me-1" />Envio</>}>
                                    {/* Tipo de arquivo (NET ou NET Combinado) */}
                                    <Form.Group className="mb-3">
                                        <Form.Label>Arquivo a enviar:</Form.Label>
                                        <div className="d-flex gap-2">
                                            <Button
                                                variant={modalEnvio.tipoArquivo === 'net' ? 'info' : 'outline-info'}
                                                size="sm"
                                                onClick={() => setModalEnvio(prev => ({ ...prev, tipoArquivo: 'net' }))}
                                                disabled={modalEnvio.enviando}
                                                style={{ flex: 1 }}
                                            >
                                                <FileText size={14} className="me-1" />
                                                NET (Boleto Aupus)
                                            </Button>
                                            <Button
                                                variant={modalEnvio.tipoArquivo === 'net_combinado' ? 'info' : 'outline-info'}
                                                size="sm"
                                                onClick={() => setModalEnvio(prev => ({ ...prev, tipoArquivo: 'net_combinado' }))}
                                                disabled={modalEnvio.enviando}
                                                style={{ flex: 1 }}
                                            >
                                                <FileText size={14} className="me-1" />
                                                NET + Fatura EQTL
                                            </Button>
                                        </div>
                                        <small className="text-muted d-block mt-1">
                                            {modalEnvio.tipoArquivo === 'net'
                                                ? 'Apenas o boleto Aupus será enviado'
                                                : 'Boleto Aupus + Fatura da concessionária com marca PAGO'}
                                        </small>
                                    </Form.Group>

                                    {/* Tipo de envio */}
                                    <Form.Group className="mb-3">
                                        <Form.Label>Enviar por:</Form.Label>
                                        <div className="d-flex gap-2">
                                            <Button
                                                variant={modalEnvio.tipoEnvio === 'whatsapp' ? 'success' : 'outline-success'}
                                                size="sm"
                                                onClick={() => setModalEnvio(prev => ({ ...prev, tipoEnvio: 'whatsapp' }))}
                                                disabled={modalEnvio.enviando}
                                            >
                                                <MessageCircle size={14} className="me-1" />
                                                WhatsApp
                                            </Button>
                                            <Button
                                                variant={modalEnvio.tipoEnvio === 'email' ? 'warning' : 'outline-warning'}
                                                size="sm"
                                                onClick={() => setModalEnvio(prev => ({ ...prev, tipoEnvio: 'email' }))}
                                                disabled={modalEnvio.enviando}
                                            >
                                                <Mail size={14} className="me-1" />
                                                Email
                                            </Button>
                                            <Button
                                                variant={modalEnvio.tipoEnvio === 'ambos' ? 'primary' : 'outline-primary'}
                                                size="sm"
                                                onClick={() => setModalEnvio(prev => ({ ...prev, tipoEnvio: 'ambos' }))}
                                                disabled={modalEnvio.enviando}
                                            >
                                                <Send size={14} className="me-1" />
                                                Ambos
                                            </Button>
                                        </div>
                                    </Form.Group>

                                    {/* Campo Telefone */}
                                    {(modalEnvio.tipoEnvio === 'whatsapp' || modalEnvio.tipoEnvio === 'ambos') && (
                                        <Form.Group className="mb-3">
                                            <Form.Label>
                                                <MessageCircle size={14} className="me-1" />
                                                Telefone (com DDD)
                                            </Form.Label>
                                            <Form.Control
                                                type="tel"
                                                placeholder="62999999999"
                                                value={modalEnvio.telefone}
                                                onChange={(e) => setModalEnvio(prev => ({ ...prev, telefone: e.target.value }))}
                                                disabled={modalEnvio.enviando}
                                            />
                                        </Form.Group>
                                    )}

                                    {/* Campo Email Principal */}
                                    {(modalEnvio.tipoEnvio === 'email' || modalEnvio.tipoEnvio === 'ambos') && (
                                        <Form.Group className="mb-3">
                                            <Form.Label>
                                                <Mail size={14} className="me-1" />
                                                Email Principal
                                            </Form.Label>
                                            <Form.Control
                                                type="email"
                                                placeholder="email@exemplo.com"
                                                value={modalEnvio.email}
                                                onChange={(e) => setModalEnvio(prev => ({ ...prev, email: e.target.value }))}
                                                disabled={modalEnvio.enviando}
                                            />
                                        </Form.Group>
                                    )}

                                    {/* Campo Email Secundário */}
                                    {(modalEnvio.tipoEnvio === 'email' || modalEnvio.tipoEnvio === 'ambos') && (
                                        <Form.Group className="mb-3">
                                            <Form.Label>
                                                <Mail size={14} className="me-1" />
                                                Email Secundário <small className="text-muted">(opcional)</small>
                                            </Form.Label>
                                            <Form.Control
                                                type="email"
                                                placeholder="segundo@exemplo.com"
                                                value={modalEnvio.emailSecundario}
                                                onChange={(e) => setModalEnvio(prev => ({ ...prev, emailSecundario: e.target.value }))}
                                                disabled={modalEnvio.enviando}
                                            />
                                            <Form.Text className="text-muted">
                                                Se preenchido, a fatura será enviada para ambos os emails
                                            </Form.Text>
                                        </Form.Group>
                                    )}
                                </Tab>

                                {/* Aba de Mensagem */}
                                <Tab eventKey="mensagem" title={<><Edit3 size={14} className="me-1" />Mensagem {modalEnvio.mensagemEditada && <Badge bg="warning" className="ms-1">Editada</Badge>}</>}>
                                    {/* Mensagem WhatsApp */}
                                    {(modalEnvio.tipoEnvio === 'whatsapp' || modalEnvio.tipoEnvio === 'ambos') && (
                                        <Form.Group className="mb-3">
                                            <Form.Label>
                                                <MessageCircle size={14} className="me-1 text-success" />
                                                Mensagem WhatsApp <Badge bg="success" className="ms-1">Com link de download</Badge>
                                            </Form.Label>
                                            <Form.Control
                                                as="textarea"
                                                rows={6}
                                                value={modalEnvio.mensagemWhatsapp}
                                                onChange={(e) => setModalEnvio(prev => ({
                                                    ...prev,
                                                    mensagemWhatsapp: e.target.value,
                                                    mensagemEditada: true
                                                }))}
                                                disabled={modalEnvio.enviando}
                                                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                                            />
                                            <div className="d-flex justify-content-between mt-1">
                                                <small className="text-muted">
                                                    *negrito* | O link de download será inserido automaticamente
                                                </small>
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    className="p-0 text-secondary"
                                                    onClick={() => setModalEnvio(prev => ({
                                                        ...prev,
                                                        mensagemWhatsapp: gerarMensagemWhatsappPadrao(modalEnvio.boleto),
                                                        mensagemEditada: false
                                                    }))}
                                                >
                                                    <RefreshCw size={12} className="me-1" />
                                                    Restaurar padrão
                                                </Button>
                                            </div>
                                        </Form.Group>
                                    )}

                                    {/* Mensagem Email */}
                                    {(modalEnvio.tipoEnvio === 'email' || modalEnvio.tipoEnvio === 'ambos') && (
                                        <>
                                            <Form.Group className="mb-3">
                                                <Form.Label>
                                                    <Mail size={14} className="me-1 text-warning" />
                                                    Assunto do Email
                                                </Form.Label>
                                                <Form.Control
                                                    type="text"
                                                    value={modalEnvio.assuntoEmail}
                                                    onChange={(e) => setModalEnvio(prev => ({
                                                        ...prev,
                                                        assuntoEmail: e.target.value,
                                                        mensagemEditada: true
                                                    }))}
                                                    disabled={modalEnvio.enviando}
                                                />
                                            </Form.Group>
                                            <Form.Group className="mb-3">
                                                <Form.Label>
                                                    <Mail size={14} className="me-1 text-warning" />
                                                    Corpo do Email <Badge bg="warning" text="dark" className="ms-1">Arquivo em anexo</Badge>
                                                </Form.Label>
                                                <Form.Control
                                                    as="textarea"
                                                    rows={6}
                                                    value={modalEnvio.mensagemEmail}
                                                    onChange={(e) => setModalEnvio(prev => ({
                                                        ...prev,
                                                        mensagemEmail: e.target.value,
                                                        mensagemEditada: true
                                                    }))}
                                                    disabled={modalEnvio.enviando}
                                                    style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                                                />
                                                <div className="d-flex justify-content-between mt-1">
                                                    <small className="text-muted">
                                                        O PDF será enviado como anexo
                                                    </small>
                                                    <Button
                                                        variant="link"
                                                        size="sm"
                                                        className="p-0 text-secondary"
                                                        onClick={() => setModalEnvio(prev => ({
                                                            ...prev,
                                                            assuntoEmail: gerarAssuntoEmailPadrao(modalEnvio.boleto),
                                                            mensagemEmail: gerarMensagemEmailPadrao(modalEnvio.boleto),
                                                            mensagemEditada: false
                                                        }))}
                                                    >
                                                        <RefreshCw size={12} className="me-1" />
                                                        Restaurar padrão
                                                    </Button>
                                                </div>
                                            </Form.Group>
                                        </>
                                    )}

                                    {modalEnvio.tipoEnvio === 'ambos' && (
                                        <Alert variant="info" className="mt-2">
                                            <small>
                                                <strong>Nota:</strong> WhatsApp envia com link de download. Email envia com arquivo anexo.
                                            </small>
                                        </Alert>
                                    )}
                                </Tab>
                            </Tabs>

                            {/* Status de envio */}
                            {modalEnvio.statusEnvio && (
                                <Alert
                                    variant={modalEnvio.statusEnvio.tipo === 'success' ? 'success' : modalEnvio.statusEnvio.tipo === 'warning' ? 'warning' : 'danger'}
                                    className="d-flex align-items-start"
                                >
                                    {modalEnvio.statusEnvio.tipo === 'success' ? (
                                        <CheckCircle size={18} className="me-2 flex-shrink-0" />
                                    ) : (
                                        <AlertCircle size={18} className="me-2 flex-shrink-0" />
                                    )}
                                    <div>
                                        <div>{modalEnvio.statusEnvio.mensagem}</div>
                                        {modalEnvio.statusEnvio.jaEnviado && (
                                            <Form.Check
                                                type="checkbox"
                                                label="Enviar novamente mesmo assim"
                                                className="mt-2"
                                                checked={modalEnvio.forcarReenvio}
                                                onChange={(e) => setModalEnvio(prev => ({ ...prev, forcarReenvio: e.target.checked }))}
                                            />
                                        )}
                                    </div>
                                </Alert>
                            )}
                        </>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={fecharModalEnvio} disabled={modalEnvio.enviando}>
                        Cancelar
                    </Button>
                    <Button
                        variant="success"
                        onClick={executarEnvio}
                        disabled={modalEnvio.enviando}
                    >
                        {modalEnvio.enviando ? (
                            <>
                                <Spinner size="sm" animation="border" className="me-2" />
                                Enviando...
                            </>
                        ) : (
                            <>
                                <Send size={16} className="me-2" />
                                Enviar
                            </>
                        )}
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Modal de Criação de Boleto Manual (Economia Gerada) */}
            <Modal
                show={modalBoletoManual.show}
                onHide={() => setModalBoletoManual(prev => ({ ...prev, show: false }))}
                size="lg"
                centered
            >
                <Modal.Header closeButton style={{ backgroundColor: '#17a2b8', color: 'white' }}>
                    <Modal.Title>
                        <PlusCircle size={20} className="me-2" />
                        Novo Boleto - Economia Gerada
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {/* UC e Nome */}
                    <Row className="mb-3">
                        <Col md={4}>
                            <Form.Group>
                                <Form.Label className="mb-1">Número da UC *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="Ex: 123456789"
                                    value={modalBoletoManual.uc}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, uc: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={8}>
                            <Form.Group>
                                <Form.Label className="mb-1">Nome Completo *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="Nome do pagador"
                                    value={modalBoletoManual.nome}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, nome: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                    </Row>

                    {/* CPF/CNPJ e Endereço */}
                    <Row className="mb-3">
                        <Col md={4}>
                            <Form.Group>
                                <Form.Label className="mb-1">CPF ou CNPJ *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="000.000.000-00"
                                    value={modalBoletoManual.documento}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, documento: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={8}>
                            <Form.Group>
                                <Form.Label className="mb-1">Endereço *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="Rua, número, complemento"
                                    value={modalBoletoManual.endereco}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, endereco: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                    </Row>

                    {/* Bairro, Cidade, UF, CEP */}
                    <Row className="mb-3">
                        <Col md={4}>
                            <Form.Group>
                                <Form.Label className="mb-1">Bairro *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="Bairro"
                                    value={modalBoletoManual.bairro}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, bairro: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={4}>
                            <Form.Group>
                                <Form.Label className="mb-1">Cidade *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="Cidade"
                                    value={modalBoletoManual.cidade}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, cidade: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={2}>
                            <Form.Group>
                                <Form.Label className="mb-1">UF *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="GO"
                                    maxLength={2}
                                    value={modalBoletoManual.uf}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, uf: e.target.value.toUpperCase() }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={2}>
                            <Form.Group>
                                <Form.Label className="mb-1">CEP *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="00000-000"
                                    value={modalBoletoManual.cep}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, cep: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                    </Row>

                    <hr className="my-3" />

                    {/* Mês Referência, Vencimento e Valor */}
                    <Row>
                        <Col md={3}>
                            <Form.Group>
                                <Form.Label className="mb-1">Mês Referência *</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="MM/AAAA"
                                    value={modalBoletoManual.mesReferencia}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, mesReferencia: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={3}>
                            <Form.Group>
                                <Form.Label className="mb-1">Vencimento *</Form.Label>
                                <Form.Control
                                    type="date"
                                    value={modalBoletoManual.dataVencimento}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, dataVencimento: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={3}>
                            <Form.Group>
                                <Form.Label className="mb-1 text-success fw-bold">Economia Gerada (R$) *</Form.Label>
                                <Form.Control
                                    type="number"
                                    step="0.01"
                                    placeholder="0,00"
                                    value={modalBoletoManual.economiaGerada}
                                    onChange={(e) => setModalBoletoManual(prev => ({ ...prev, economiaGerada: e.target.value }))}
                                    disabled={modalBoletoManual.salvando}
                                    style={{ fontWeight: 'bold', fontSize: '1.1rem' }}
                                />
                            </Form.Group>
                        </Col>
                        <Col md={3} className="d-flex align-items-end">
                            {parseFloat(modalBoletoManual.economiaGerada) > 0 && (
                                <div className="p-2 rounded text-center w-100" style={{ backgroundColor: '#d4edda' }}>
                                    <small className="text-muted">Valor do Boleto</small>
                                    <div className="text-success fw-bold" style={{ fontSize: '1.2rem' }}>
                                        R$ {parseFloat(modalBoletoManual.economiaGerada).toFixed(2).replace('.', ',')}
                                    </div>
                                </div>
                            )}
                        </Col>
                    </Row>
                </Modal.Body>
                <Modal.Footer>
                    <Button
                        variant="secondary"
                        onClick={() => setModalBoletoManual({
                            show: false,
                            salvando: false,
                            uc: '',
                            nome: '',
                            documento: '',
                            endereco: '',
                            bairro: '',
                            cep: '',
                            cidade: '',
                            uf: '',
                            mesReferencia: '',
                            dataVencimento: '',
                            economiaGerada: ''
                        })}
                        disabled={modalBoletoManual.salvando}
                    >
                        Cancelar
                    </Button>
                    <Button
                        variant="info"
                        onClick={salvarBoletoManual}
                        disabled={modalBoletoManual.salvando}
                    >
                        {modalBoletoManual.salvando ? (
                            <>
                                <Spinner size="sm" animation="border" className="me-2" />
                                Criando...
                            </>
                        ) : (
                            <>
                                <PlusCircle size={16} className="me-2" />
                                Criar Boleto
                            </>
                        )}
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
}

export default GerarBoletoEnergia;
