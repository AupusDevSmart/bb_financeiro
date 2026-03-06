import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Badge, Spinner, Modal, Nav, Tab } from 'react-bootstrap';
import api from '../services/api';
import { formatarValor } from '../utils/formatters';
import {
    Search, RefreshCw, Download, Eye, Send, MessageCircle, Mail,
    CheckCircle, XCircle, AlertTriangle, Clock, FileText, Filter,
    ChevronLeft, ChevronRight, ExternalLink, RotateCcw, Zap, DollarSign, Calendar,
    CircleCheck, CirclePlus, PlayCircle
} from 'lucide-react';

function ControleMensal({ mostrarAlerta }) {
    // Estado do mês selecionado
    const [mesReferencia, setMesReferencia] = useState('');
    const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [carregandoDados, setCarregandoDados] = useState(false);

    // Dados da tabela
    const [dados, setDados] = useState([]);

    // Aba ativa
    const [abaAtiva, setAbaAtiva] = useState('compensado');

    // Filtros por aba
    const [filtros, setFiltros] = useState({
        busca: '',
        status: 'Todos',
        envio: 'Todos',
        pagamento: 'Todos'
    });

    // Seleção para ações em lote
    const [selecionados, setSelecionados] = useState([]);

    // Modal de detalhes
    const [modalDetalhes, setModalDetalhes] = useState({ show: false, dados: null });

    // Modal de confirmação para ações
    const [modalConfirmacao, setModalConfirmacao] = useState({
        show: false,
        tipo: null, // 'enviar-boleto' ou 'simular-compensacao'
        item: null,
        processando: false,
        resultado: null // { sucesso: bool, mensagem: string, detalhes?: string }
    });

    // Modal de lançamento em lote de pagamentos EQTL
    const [modalLancamentoLote, setModalLancamentoLote] = useState({
        show: false,
        processando: false,
        total: 0,
        atual: 0,
        sucessos: 0,
        erros: 0,
        resultados: [], // { uc, sucesso, mensagem }
        concluido: false
    });

    // Carregar meses disponíveis ao montar
    useEffect(() => {
        carregarMesesDisponiveis();
    }, []);

    // Carregar dados quando mês mudar
    useEffect(() => {
        if (mesReferencia) {
            carregarDados();
        }
    }, [mesReferencia]);

    // Limpar seleção e resetar filtro de status quando trocar de aba
    useEffect(() => {
        setSelecionados([]);
        setFiltros(prev => ({ ...prev, status: 'Todos' }));
    }, [abaAtiva]);

    const carregarMesesDisponiveis = async () => {
        try {
            const response = await api.get('/api/meses-disponiveis-boletos');
            const meses = response.data.meses || [];
            setMesesDisponiveis(meses);
            if (meses.length > 0) {
                setMesReferencia(meses[0]);
            }
        } catch (error) {
            console.error('Erro ao carregar meses:', error);
            mostrarAlerta('Erro ao carregar meses disponíveis', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    const carregarDados = async () => {
        setCarregandoDados(true);
        try {
            const response = await api.get(`/api/controle-mensal/completo/${encodeURIComponent(mesReferencia)}`);
            setDados(response.data.faturas || []);
            setSelecionados([]);
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
            mostrarAlerta('Erro ao carregar dados do controle mensal', 'danger');
        } finally {
            setCarregandoDados(false);
        }
    };

    // Separar dados por aba
    const dadosCompensado = dados.filter(d =>
        d.status_fatura === 'Compensado' || d.status_fatura === 'Comp. Simulada'
    );
    const dadosNaoCompensado = dados.filter(d =>
        d.status_fatura === 'Sem Compensacao' || d.status_fatura === 'Comp. Terceiros'
    );
    const dadosPendencias = dados.filter(d =>
        d.status_fatura === 'Pendente' || d.status_fatura === 'Com Erro' || d.status_fatura === 'Nao Recebida'
    );

    // Aplicar filtros na aba atual
    const aplicarFiltros = (dadosAba) => {
        let resultado = [...dadosAba];

        // Filtro de busca (UC ou nome)
        if (filtros.busca) {
            const termo = filtros.busca.toLowerCase();
            resultado = resultado.filter(item =>
                item.uc?.toLowerCase().includes(termo) ||
                item.nome_cliente?.toLowerCase().includes(termo)
            );
        }

        // Filtro de status (todas as abas)
        if (filtros.status !== 'Todos') {
            resultado = resultado.filter(item => item.status_fatura === filtros.status);
        }

        // Filtro de envio (só para aba compensado)
        if (abaAtiva === 'compensado' && filtros.envio !== 'Todos') {
            if (filtros.envio === 'Enviado') {
                resultado = resultado.filter(item => item.enviado);
            } else if (filtros.envio === 'Pendente') {
                resultado = resultado.filter(item => !item.enviado);
            }
        }

        // Filtro de pagamento (só para aba compensado) - filtra por Aupus (boletos de energia)
        if (abaAtiva === 'compensado' && filtros.pagamento !== 'Todos') {
            resultado = resultado.filter(item => item.status_pagamento_aupus === filtros.pagamento);
        }

        return resultado;
    };

    const getDadosFiltrados = () => {
        switch (abaAtiva) {
            case 'compensado':
                return aplicarFiltros(dadosCompensado);
            case 'naoCompensado':
                return aplicarFiltros(dadosNaoCompensado);
            case 'pendencias':
                return aplicarFiltros(dadosPendencias);
            default:
                return [];
        }
    };

    const dadosFiltrados = getDadosFiltrados();

    const navegarMes = (direcao) => {
        const indexAtual = mesesDisponiveis.indexOf(mesReferencia);
        const novoIndex = indexAtual + direcao;
        if (novoIndex >= 0 && novoIndex < mesesDisponiveis.length) {
            setMesReferencia(mesesDisponiveis[novoIndex]);
        }
    };

    const toggleSelecao = (uc) => {
        setSelecionados(prev =>
            prev.includes(uc)
                ? prev.filter(u => u !== uc)
                : [...prev, uc]
        );
    };

    const toggleTodos = () => {
        if (selecionados.length === dadosFiltrados.length) {
            setSelecionados([]);
        } else {
            setSelecionados(dadosFiltrados.map(item => item.uc));
        }
    };

    // Lançar pagamentos EQTL em lote
    const iniciarLancamentoLote = () => {
        // Filtrar apenas itens selecionados que estão na aba naoCompensado e têm fatura_id
        const itensParaLancar = dadosFiltrados.filter(item =>
            selecionados.includes(item.uc) &&
            item.fatura_id &&
            item.status_pagamento !== 'Pago' &&
            item.status_pagamento !== 'Lancado'
        );

        if (itensParaLancar.length === 0) {
            mostrarAlerta('Nenhum item válido para lançamento', 'warning');
            return;
        }

        setModalLancamentoLote({
            show: true,
            processando: false,
            total: itensParaLancar.length,
            atual: 0,
            sucessos: 0,
            erros: 0,
            resultados: [],
            concluido: false,
            itens: itensParaLancar
        });
    };

    const executarLancamentoLote = async () => {
        const { itens } = modalLancamentoLote;

        setModalLancamentoLote(prev => ({ ...prev, processando: true }));

        const resultados = [];
        let sucessos = 0;
        let erros = 0;

        for (let i = 0; i < itens.length; i++) {
            const item = itens[i];

            setModalLancamentoLote(prev => ({
                ...prev,
                atual: i + 1,
                resultados: [...resultados]
            }));

            try {
                const response = await api.post(`/api/pagamentos-concessionaria/lancar/${item.fatura_id}`);

                if (response.data.pagamento) {
                    resultados.push({
                        uc: item.uc,
                        nome: item.nome_cliente,
                        sucesso: true,
                        mensagem: `Requisição ${response.data.pagamento.numero_requisicao}`
                    });
                    sucessos++;
                } else {
                    resultados.push({
                        uc: item.uc,
                        nome: item.nome_cliente,
                        sucesso: false,
                        mensagem: response.data.error || 'Erro desconhecido'
                    });
                    erros++;
                }
            } catch (error) {
                resultados.push({
                    uc: item.uc,
                    nome: item.nome_cliente,
                    sucesso: false,
                    mensagem: error.response?.data?.error || error.message
                });
                erros++;
            }

            // Pequeno delay entre requisições para não sobrecarregar
            if (i < itens.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        setModalLancamentoLote(prev => ({
            ...prev,
            processando: false,
            concluido: true,
            sucessos,
            erros,
            resultados
        }));

        // Recarregar dados após conclusão
        if (sucessos > 0) {
            carregarDados();
        }
    };

    const fecharModalLancamentoLote = () => {
        setModalLancamentoLote({
            show: false,
            processando: false,
            total: 0,
            atual: 0,
            sucessos: 0,
            erros: 0,
            resultados: [],
            concluido: false
        });
        setSelecionados([]);
    };

    const getStatusFaturaBadge = (status) => {
        const statusMap = {
            'Compensado': { bg: 'success', icon: CheckCircle },
            'Comp. Simulada': { bg: 'info', icon: Zap },
            'Comp. Terceiros': { bg: 'purple', icon: AlertTriangle, style: { backgroundColor: '#6f42c1' } },
            'Sem Compensacao': { bg: 'warning', icon: AlertTriangle },
            'Pendente': { bg: 'secondary', icon: Clock },
            'Com Erro': { bg: 'danger', icon: XCircle },
            'Nao Recebida': { bg: 'dark', icon: XCircle }
        };
        const config = statusMap[status] || { bg: 'secondary', icon: Clock };
        const Icon = config.icon;
        return (
            <Badge bg={config.bg} className="d-flex align-items-center gap-1" style={{ width: 'fit-content', ...config.style }}>
                <Icon size={12} />
                {status}
            </Badge>
        );
    };

    const getEnvioBadge = (item) => {
        if (!item.enviado) {
            return <span className="text-muted">Nao enviado</span>;
        }
        return (
            <div className="d-flex gap-1">
                {item.enviado_whatsapp && (
                    <Badge bg="success" title={item.data_envio_whatsapp ? `Enviado em ${new Date(item.data_envio_whatsapp).toLocaleString('pt-BR')}` : 'Enviado'}>
                        <i className="fab fa-whatsapp me-1"></i>OK
                    </Badge>
                )}
                {item.enviado_email && (
                    <Badge bg="info" title={item.data_envio_email ? `Enviado em ${new Date(item.data_envio_email).toLocaleString('pt-BR')}` : 'Enviado'}>
                        <i className="fas fa-envelope me-1"></i>OK
                    </Badge>
                )}
                {!item.enviado_whatsapp && !item.enviado_email && (
                    <Badge bg="secondary">Enviado</Badge>
                )}
            </div>
        );
    };

    const getPagamentoBadge = (status) => {
        if (!status || status === '-') return <span className="text-muted">-</span>;
        const statusMap = {
            // Boleto Aupus
            'Pago': { bg: 'success' },
            'Pendente': { bg: 'secondary', text: 'Pendente' },
            'Vencido': { bg: 'danger' },
            // Pagamento EQTL (BB API)
            'Pago EQTL': { bg: 'success', text: 'Pago EQTL' },
            'Lancado': { bg: 'primary', text: 'Lançado' },
            'Aguard. Aprov.': { bg: 'warning', text: 'Aguard. Aprov.' },
            'Proc. Lanc.': { bg: 'secondary', text: 'Proc. Lanc.' },
            'Proc. Pgto.': { bg: 'info', text: 'Proc. Pgto.' },
            'Processando': { bg: 'info', text: 'Processando' },
            'Rejeitado': { bg: 'danger', text: 'Rejeitado' },
            'Vencido': { bg: 'danger', text: 'Vencido' },
            'Devolvido': { bg: 'danger', text: 'Devolvido' }
        };
        const config = statusMap[status] || { bg: 'secondary' };
        return <Badge bg={config.bg}>{config.text || status}</Badge>;
    };

    const getPagamentoEqtlBadge = (status) => {
        if (!status || status === '-') return <span className="text-muted">-</span>;
        const statusMap = {
            'Pago': { bg: 'success', text: 'Pago' },
            'Lancado': { bg: 'primary', text: 'Lançado' },
            'Aguard. Aprov.': { bg: 'warning', text: 'Ag. Aprov.' },
            'Proc. Lanc.': { bg: 'secondary', text: 'Proc. Lanc.' },
            'Proc. Pgto.': { bg: 'info', text: 'Proc. Pgto.' },
            'Processando': { bg: 'info', text: 'Processando' },
            'Rejeitado': { bg: 'danger', text: 'Rejeitado' },
            'Pendente': { bg: 'secondary', text: 'Pendente' },
            'Vencido': { bg: 'danger', text: 'Vencido' },
            'Devolvido': { bg: 'danger', text: 'Devolvido' }
        };
        const config = statusMap[status] || { bg: 'secondary' };
        return <Badge bg={config.bg}>{config.text || status}</Badge>;
    };

    const getPagamentoAupusBadge = (status) => {
        if (!status || status === '-') return <span className="text-muted">-</span>;
        const statusMap = {
            'Pago': { bg: 'success', text: 'Pago' },
            'Pendente': { bg: 'secondary', text: 'Pendente' },
            'Vencido': { bg: 'danger', text: 'Vencido' }
        };
        const config = statusMap[status] || { bg: 'secondary' };
        return <Badge bg={config.bg}>{config.text || status}</Badge>;
    };

    const exportarExcel = async () => {
        try {
            mostrarAlerta('Exportando para Excel...', 'info');
            const response = await api.get(`/api/controle-mensal/exportar/${encodeURIComponent(mesReferencia)}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Controle_Mensal_${mesReferencia.replace('/', '_')}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            mostrarAlerta('Excel exportado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao exportar:', error);
            mostrarAlerta('Erro ao exportar Excel', 'danger');
        }
    };

    const abrirDetalhes = (item) => {
        setModalDetalhes({ show: true, dados: item });
    };

    // Função para download de PDF da fatura
    const downloadPDF = async (uc) => {
        try {
            const response = await api.get(`/api/faturas/pdf/${encodeURIComponent(uc)}/${encodeURIComponent(mesReferencia)}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Fatura_${uc}_${mesReferencia.replace('/', '_')}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Erro ao baixar PDF:', error);
            mostrarAlerta('Erro ao baixar PDF da fatura', 'danger');
        }
    };

    if (carregando) {
        return (
            <Container fluid className="py-4">
                <div className="text-center">
                    <Spinner animation="border" variant="primary" />
                    <p className="mt-2">Carregando...</p>
                </div>
            </Container>
        );
    }

    // Contadores para as abas
    const contadores = {
        compensado: dadosCompensado.length,
        naoCompensado: dadosNaoCompensado.length,
        pendencias: dadosPendencias.length,
        enviados: dadosCompensado.filter(d => d.enviado).length,
        pagos: dadosCompensado.filter(d => d.status_pagamento_aupus === 'Pago').length
    };

    const getTipoCompensacaoBadge = (tipo) => {
        if (!tipo) return <span className="text-muted">-</span>;
        const tipoMap = {
            'Completa': { bg: 'success' },
            'Parcial': { bg: 'warning', text: 'dark' },
            'Corrigida': { bg: 'info' },
            'Simulada': { bg: 'primary' }  // Fatura sem compensacao original, simulada do zero
        };
        const config = tipoMap[tipo] || { bg: 'secondary' };
        return <Badge bg={config.bg} text={config.text}>{tipo}</Badge>;
    };

    // Abrir modal de confirmação para envio de boletos
    const abrirModalEnviarBoletos = (item) => {
        setModalConfirmacao({
            show: true,
            tipo: 'enviar-boleto',
            item: item,
            processando: false,
            resultado: null
        });
    };

    // Abrir modal de confirmação para simular compensação
    const abrirModalSimularCompensacao = (item) => {
        setModalConfirmacao({
            show: true,
            tipo: 'simular-compensacao',
            item: item,
            processando: false,
            resultado: null
        });
    };

    // Abrir modal de confirmação para completar compensação parcial
    const abrirModalCompletarCompensacao = (item) => {
        setModalConfirmacao({
            show: true,
            tipo: 'completar-compensacao',
            item: item,
            processando: false,
            resultado: null
        });
    };

    // Fechar modal de confirmação
    const fecharModalConfirmacao = () => {
        // Se houve resultado de sucesso, recarregar dados
        if (modalConfirmacao.resultado?.sucesso) {
            carregarDados();
        }
        setModalConfirmacao({
            show: false,
            tipo: null,
            item: null,
            processando: false,
            resultado: null
        });
    };

    // Executar ação confirmada
    const executarAcaoConfirmada = async () => {
        const { tipo, item } = modalConfirmacao;

        setModalConfirmacao(prev => ({ ...prev, processando: true }));

        try {
            if (tipo === 'enviar-boleto') {
                const response = await api.post('/api/controle-mensal/enviar-boletos', {
                    uc: item.uc,
                    mes_referencia: mesReferencia
                });

                if (response.data.sucesso) {
                    setModalConfirmacao(prev => ({
                        ...prev,
                        processando: false,
                        resultado: {
                            sucesso: true,
                            mensagem: 'Boleto criado com sucesso!',
                            detalhes: `Valor: R$ ${response.data.valor_boleto?.toFixed(2)}`
                        }
                    }));
                } else {
                    setModalConfirmacao(prev => ({
                        ...prev,
                        processando: false,
                        resultado: {
                            sucesso: false,
                            mensagem: response.data.erro || 'Erro ao criar boleto',
                            detalhes: response.data.detalhes || ''
                        }
                    }));
                }
            } else if (tipo === 'simular-compensacao') {
                const response = await api.post('/api/controle-mensal/simular-compensacao', {
                    uc: item.uc,
                    mes_referencia: mesReferencia
                });

                if (response.data.sucesso) {
                    const dados = response.data.dados;
                    setModalConfirmacao(prev => ({
                        ...prev,
                        processando: false,
                        resultado: {
                            sucesso: true,
                            mensagem: 'Compensação simulada com sucesso!',
                            detalhes: `Consumo compensado: ${dados.consumo_compensado?.toFixed(0)} kWh | Valor: R$ ${dados.valor_consorcio?.toFixed(2)}`
                        }
                    }));
                } else {
                    setModalConfirmacao(prev => ({
                        ...prev,
                        processando: false,
                        resultado: {
                            sucesso: false,
                            mensagem: response.data.erro || 'Erro ao simular compensação',
                            detalhes: response.data.detalhes || ''
                        }
                    }));
                }
            } else if (tipo === 'completar-compensacao') {
                const response = await api.post('/api/controle-mensal/completar-compensacao', {
                    uc: item.uc,
                    mes_referencia: mesReferencia
                });

                if (response.data.sucesso) {
                    const dados = response.data.dados;
                    setModalConfirmacao(prev => ({
                        ...prev,
                        processando: false,
                        resultado: {
                            sucesso: true,
                            mensagem: 'Compensação completada com sucesso!',
                            detalhes: `Compensação adicional: ${dados.compensacao_adicional?.toFixed(0)} kWh | Valor: R$ ${dados.valor_consorcio?.toFixed(2)}`
                        }
                    }));
                } else {
                    setModalConfirmacao(prev => ({
                        ...prev,
                        processando: false,
                        resultado: {
                            sucesso: false,
                            mensagem: response.data.erro || 'Erro ao completar compensação',
                            detalhes: response.data.detalhes || ''
                        }
                    }));
                }
            }
        } catch (error) {
            console.error('Erro na ação:', error);
            const errorData = error.response?.data || {};
            setModalConfirmacao(prev => ({
                ...prev,
                processando: false,
                resultado: {
                    sucesso: false,
                    mensagem: errorData.erro || 'Erro ao executar ação',
                    detalhes: errorData.detalhes || error.message
                }
            }));
        }
    };

    // Renderizar tabela de Compensado Aupus
    const renderTabelaCompensado = () => (
        <div className="table-responsive">
            <Table hover className="mb-0 table-sm">
                <thead className="table-dark">
                    <tr>
                        <th style={{ width: '40px' }}>
                            <Form.Check
                                type="checkbox"
                                checked={selecionados.length === dadosFiltrados.length && dadosFiltrados.length > 0}
                                onChange={toggleTodos}
                            />
                        </th>
                        <th>UC</th>
                        <th>Cliente</th>
                        <th>Status</th>
                        <th>Compensacao</th>
                        <th className="text-end">Valor Boleto</th>
                        <th className="text-center">Boletos</th>
                        <th>Envio</th>
                        <th>Pag. EQTL</th>
                        <th>Pag. Aupus</th>
                        <th className="text-center">Acoes</th>
                    </tr>
                </thead>
                <tbody>
                    {dadosFiltrados.length === 0 ? (
                        <tr>
                            <td colSpan={11} className="text-center py-4 text-muted">
                                Nenhum registro encontrado
                            </td>
                        </tr>
                    ) : (
                        dadosFiltrados.map((item, index) => (
                            <tr key={item.uc || index}>
                                <td>
                                    <Form.Check
                                        type="checkbox"
                                        checked={selecionados.includes(item.uc)}
                                        onChange={() => toggleSelecao(item.uc)}
                                    />
                                </td>
                                <td><strong>{item.uc}</strong></td>
                                <td>
                                    <span className="text-truncate d-inline-block" style={{ maxWidth: '180px' }} title={item.nome_cliente}>
                                        {item.nome_cliente || '-'}
                                    </span>
                                </td>
                                <td>{getStatusFaturaBadge(item.status_fatura)}</td>
                                <td>{getTipoCompensacaoBadge(item.tipo_compensacao)}</td>
                                <td className="text-end">
                                    {item.valor_boleto ? (
                                        <strong>{formatarValor(item.valor_boleto)}</strong>
                                    ) : (
                                        <span className="text-muted">-</span>
                                    )}
                                </td>
                                <td className="text-center">
                                    {item.em_boletos_energia ? (
                                        <CircleCheck size={18} className="text-success" title="Em Boletos de Energia" />
                                    ) : (
                                        <button
                                            className="btn btn-sm btn-link p-0"
                                            onClick={() => abrirModalEnviarBoletos(item)}
                                            title="Enviar para Boletos de Energia"
                                        >
                                            <CirclePlus size={18} className="text-primary" />
                                        </button>
                                    )}
                                </td>
                                <td>{getEnvioBadge(item)}</td>
                                <td>{getPagamentoEqtlBadge(item.status_pagamento_eqtl)}</td>
                                <td>{getPagamentoAupusBadge(item.status_pagamento_aupus)}</td>
                                <td className="text-center">
                                    <div className="d-flex gap-1 justify-content-center">
                                        <button
                                            className="btn btn-sm btn-outline-primary"
                                            onClick={() => abrirDetalhes(item)}
                                            title="Ver detalhes"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            className="btn btn-sm btn-outline-warning"
                                            onClick={() => abrirModalCompletarCompensacao(item)}
                                            title="Completar Compensacao"
                                            disabled={item.tipo_compensacao !== 'Parcial'}
                                        >
                                            <PlayCircle size={14} />
                                        </button>
                                        <button
                                            className="btn btn-sm btn-outline-light"
                                            title="Download PDF"
                                            onClick={() => downloadPDF(item.uc)}
                                            disabled={!item.caminho_pdf}
                                        >
                                            <Download size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </Table>
        </div>
    );

    // Renderizar tabela de Nao Compensado Aupus
    const renderTabelaNaoCompensado = () => (
        <div className="table-responsive">
            <Table hover className="mb-0 table-sm">
                <thead className="table-dark">
                    <tr>
                        <th style={{ width: '40px' }}>
                            <Form.Check
                                type="checkbox"
                                checked={selecionados.length === dadosFiltrados.length && dadosFiltrados.length > 0}
                                onChange={toggleTodos}
                            />
                        </th>
                        <th>UC</th>
                        <th>Cliente</th>
                        <th>Status</th>
                        <th className="text-end">Valor Concessionaria</th>
                        <th>Vencimento</th>
                        <th>Pag. EQTL</th>
                        <th className="text-center">Boletos</th>
                        <th className="text-center">Acoes</th>
                    </tr>
                </thead>
                <tbody>
                    {dadosFiltrados.length === 0 ? (
                        <tr>
                            <td colSpan={9} className="text-center py-4 text-muted">
                                Nenhum registro encontrado
                            </td>
                        </tr>
                    ) : (
                        dadosFiltrados.map((item, index) => (
                            <tr key={item.uc || index}>
                                <td>
                                    <Form.Check
                                        type="checkbox"
                                        checked={selecionados.includes(item.uc)}
                                        onChange={() => toggleSelecao(item.uc)}
                                    />
                                </td>
                                <td><strong>{item.uc}</strong></td>
                                <td>
                                    <span className="text-truncate d-inline-block" style={{ maxWidth: '180px' }} title={item.nome_cliente}>
                                        {item.nome_cliente || '-'}
                                    </span>
                                </td>
                                <td>{getStatusFaturaBadge(item.status_fatura)}</td>
                                <td className="text-end">
                                    {item.valor_concessionaria ? (
                                        <strong>{formatarValor(item.valor_concessionaria)}</strong>
                                    ) : (
                                        <span className="text-muted">-</span>
                                    )}
                                </td>
                                <td>
                                    {item.data_vencimento ? (
                                        <span>{item.data_vencimento}</span>
                                    ) : (
                                        <span className="text-muted">-</span>
                                    )}
                                </td>
                                <td>{getPagamentoEqtlBadge(item.status_pagamento_eqtl)}</td>
                                <td className="text-center">
                                    {item.em_boletos_energia ? (
                                        <CircleCheck size={18} className="text-success" title="Em Boletos de Energia" />
                                    ) : (
                                        <button
                                            className="btn btn-sm btn-link p-0"
                                            onClick={() => abrirModalEnviarBoletos(item)}
                                            title="Enviar para Boletos de Energia"
                                        >
                                            <CirclePlus size={18} className="text-muted" />
                                        </button>
                                    )}
                                </td>
                                <td className="text-center">
                                    <div className="d-flex gap-1 justify-content-center">
                                        <button
                                            className="btn btn-sm btn-outline-primary"
                                            onClick={() => abrirDetalhes(item)}
                                            title="Ver detalhes"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            className="btn btn-sm btn-outline-warning"
                                            onClick={() => abrirModalSimularCompensacao(item)}
                                            title="Simular Compensacao"
                                        >
                                            <PlayCircle size={14} />
                                        </button>
                                        <button
                                            className="btn btn-sm btn-outline-light"
                                            title="Download PDF"
                                            onClick={() => downloadPDF(item.uc)}
                                            disabled={!item.caminho_pdf}
                                        >
                                            <Download size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </Table>
        </div>
    );

    // Renderizar tabela de Pendências
    const renderTabelaPendencias = () => (
        <div className="table-responsive">
            <Table hover className="mb-0 table-sm">
                <thead className="table-dark">
                    <tr>
                        <th>UC</th>
                        <th>Cliente</th>
                        <th>Status</th>
                        <th className="text-center">Acoes</th>
                    </tr>
                </thead>
                <tbody>
                    {dadosFiltrados.length === 0 ? (
                        <tr>
                            <td colSpan={4} className="text-center py-4 text-muted">
                                Nenhuma pendencia encontrada
                            </td>
                        </tr>
                    ) : (
                        dadosFiltrados.map((item, index) => (
                            <tr
                                key={item.uc || index}
                                style={
                                    item.status_fatura === 'Com Erro'
                                        ? { backgroundColor: 'rgba(220, 53, 69, 0.15)' }
                                        : item.status_fatura === 'Nao Recebida'
                                            ? { backgroundColor: 'rgba(255, 193, 7, 0.15)' }
                                            : {}
                                }
                            >
                                <td><strong>{item.uc}</strong></td>
                                <td>
                                    <span className="text-truncate d-inline-block" style={{ maxWidth: '250px' }} title={item.nome_cliente}>
                                        {item.nome_cliente || '-'}
                                    </span>
                                </td>
                                <td>{getStatusFaturaBadge(item.status_fatura)}</td>
                                <td className="text-center">
                                    <div className="d-flex gap-1 justify-content-center">
                                        <button
                                            className="btn btn-sm btn-outline-primary"
                                            onClick={() => abrirDetalhes(item)}
                                            title="Ver detalhes"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            className="btn btn-sm btn-outline-light"
                                            title="Download PDF"
                                            onClick={() => downloadPDF(item.uc)}
                                            disabled={!item.caminho_pdf}
                                        >
                                            <Download size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </Table>
        </div>
    );

    // Opções de status por aba
    const getOpcoesStatus = () => {
        switch (abaAtiva) {
            case 'compensado':
                return [
                    { value: 'Todos', label: 'Status: Todos' },
                    { value: 'Compensado', label: `Compensado (${dadosCompensado.filter(d => d.status_fatura === 'Compensado').length})` },
                    { value: 'Comp. Simulada', label: `Comp. Simulada (${dadosCompensado.filter(d => d.status_fatura === 'Comp. Simulada').length})` }
                ];
            case 'naoCompensado':
                return [
                    { value: 'Todos', label: 'Status: Todos' },
                    { value: 'Sem Compensacao', label: `Sem Compensacao (${dadosNaoCompensado.filter(d => d.status_fatura === 'Sem Compensacao').length})` },
                    { value: 'Comp. Terceiros', label: `Comp. Terceiros (${dadosNaoCompensado.filter(d => d.status_fatura === 'Comp. Terceiros').length})` }
                ];
            case 'pendencias':
                return [
                    { value: 'Todos', label: 'Status: Todos' },
                    { value: 'Pendente', label: `Pendente (${dadosPendencias.filter(d => d.status_fatura === 'Pendente').length})` },
                    { value: 'Com Erro', label: `Com Erro (${dadosPendencias.filter(d => d.status_fatura === 'Com Erro').length})` },
                    { value: 'Nao Recebida', label: `Nao Recebida (${dadosPendencias.filter(d => d.status_fatura === 'Nao Recebida').length})` }
                ];
            default:
                return [{ value: 'Todos', label: 'Status: Todos' }];
        }
    };

    const limparFiltros = () => {
        setFiltros({ busca: '', status: 'Todos', envio: 'Todos', pagamento: 'Todos' });
    };

    // Renderizar filtros específicos por aba
    const renderFiltros = () => {
        const opcoesStatus = getOpcoesStatus();

        if (abaAtiva === 'pendencias') {
            // Pendências: busca + status
            return (
                <Row className="align-items-center g-2">
                    <Col md={3}>
                        <Form.Control
                            type="text"
                            placeholder="Buscar UC ou cliente..."
                            value={filtros.busca}
                            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
                            size="sm"
                        />
                    </Col>
                    <Col md={2}>
                        <Form.Select
                            value={filtros.status}
                            onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
                            size="sm"
                        >
                            {opcoesStatus.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </Form.Select>
                    </Col>
                    <Col md={1}>
                        <button
                            className="btn btn-outline-secondary btn-sm w-100"
                            onClick={limparFiltros}
                        >
                            <RotateCcw size={14} />
                        </button>
                    </Col>
                </Row>
            );
        }

        if (abaAtiva === 'naoCompensado') {
            // Não Compensado: busca + status
            return (
                <Row className="align-items-center g-2">
                    <Col md={3}>
                        <Form.Control
                            type="text"
                            placeholder="Buscar UC ou cliente..."
                            value={filtros.busca}
                            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
                            size="sm"
                        />
                    </Col>
                    <Col md={2}>
                        <Form.Select
                            value={filtros.status}
                            onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
                            size="sm"
                        >
                            {opcoesStatus.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </Form.Select>
                    </Col>
                    <Col md={1}>
                        <button
                            className="btn btn-outline-secondary btn-sm w-100"
                            onClick={limparFiltros}
                        >
                            <RotateCcw size={14} />
                        </button>
                    </Col>
                </Row>
            );
        }

        // Compensado: filtros completos (busca + status + envio + pagamento)
        return (
            <Row className="align-items-center g-2">
                <Col md={3}>
                    <Form.Control
                        type="text"
                        placeholder="Buscar UC ou cliente..."
                        value={filtros.busca}
                        onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
                        size="sm"
                    />
                </Col>
                <Col md={2}>
                    <Form.Select
                        value={filtros.status}
                        onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
                        size="sm"
                    >
                        {opcoesStatus.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </Form.Select>
                </Col>
                <Col md={2}>
                    <Form.Select
                        value={filtros.envio}
                        onChange={(e) => setFiltros({ ...filtros, envio: e.target.value })}
                        size="sm"
                    >
                        <option value="Todos">Envio: Todos</option>
                        <option value="Enviado">Enviados ({contadores.enviados})</option>
                        <option value="Pendente">Pendentes</option>
                    </Form.Select>
                </Col>
                <Col md={2}>
                    <Form.Select
                        value={filtros.pagamento}
                        onChange={(e) => setFiltros({ ...filtros, pagamento: e.target.value })}
                        size="sm"
                    >
                        <option value="Todos">Pag. Aupus: Todos</option>
                        <option value="Pago">Pagos ({contadores.pagos})</option>
                        <option value="Pendente">Pendentes</option>
                        <option value="Vencido">Vencidos</option>
                    </Form.Select>
                </Col>
                <Col md={1}>
                    <button
                        className="btn btn-outline-secondary btn-sm w-100"
                        onClick={limparFiltros}
                    >
                        <RotateCcw size={14} />
                    </button>
                </Col>
            </Row>
        );
    };

    return (
        <Container fluid className="py-3">
            {/* Header */}
            <Card className="mb-3">
                <Card.Body className="py-2">
                    <Row className="align-items-center">
                        <Col md={3}>
                            <h5 className="mb-0">Controle Mensal</h5>
                        </Col>
                        <Col md={4} className="text-center">
                            <div className="d-flex align-items-center justify-content-center gap-2">
                                <button
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={() => navegarMes(1)}
                                    disabled={mesesDisponiveis.indexOf(mesReferencia) >= mesesDisponiveis.length - 1}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <Form.Select
                                    value={mesReferencia}
                                    onChange={(e) => setMesReferencia(e.target.value)}
                                    style={{ width: '140px', textAlign: 'center', fontWeight: 'bold' }}
                                    size="sm"
                                >
                                    {mesesDisponiveis.map(mes => (
                                        <option key={mes} value={mes}>{mes}</option>
                                    ))}
                                </Form.Select>
                                <button
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={() => navegarMes(-1)}
                                    disabled={mesesDisponiveis.indexOf(mesReferencia) <= 0}
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </Col>
                        <Col md={5} className="text-end">
                            <button
                                className="btn btn-outline-success btn-sm me-2"
                                onClick={exportarExcel}
                            >
                                <Download size={14} /> Excel
                            </button>
                            <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={carregarDados}
                                disabled={carregandoDados}
                            >
                                <RefreshCw size={14} className={carregandoDados ? 'spin' : ''} /> Atualizar
                            </button>
                        </Col>
                    </Row>
                </Card.Body>
            </Card>

            {/* Abas */}
            <Tab.Container activeKey={abaAtiva} onSelect={(k) => setAbaAtiva(k)}>
                <Nav variant="tabs" className="mb-3 controle-tabs border-bottom-0">
                    <Nav.Item>
                        <Nav.Link eventKey="compensado" className="d-flex align-items-center gap-2">
                            <CheckCircle size={16} />
                            Compensado Aupus
                            <Badge bg="success" pill>{contadores.compensado}</Badge>
                        </Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="naoCompensado" className="d-flex align-items-center gap-2">
                            <AlertTriangle size={16} />
                            Nao Compensado Aupus
                            <Badge bg="warning" text="dark" pill>{contadores.naoCompensado}</Badge>
                        </Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                        <Nav.Link eventKey="pendencias" className="d-flex align-items-center gap-2">
                            <Clock size={16} />
                            Pendencias
                            <Badge bg="secondary" pill>{contadores.pendencias}</Badge>
                        </Nav.Link>
                    </Nav.Item>
                </Nav>

                {/* Filtros */}
                <Card className="mb-3">
                    <Card.Body className="py-2">
                        {renderFiltros()}
                    </Card.Body>
                </Card>

                {/* Conteúdo das Abas */}
                <Card>
                    <Card.Body className="p-0">
                        {carregandoDados ? (
                            <div className="text-center py-5">
                                <Spinner animation="border" variant="primary" />
                            </div>
                        ) : (
                            <Tab.Content>
                                <Tab.Pane eventKey="compensado">
                                    {renderTabelaCompensado()}
                                </Tab.Pane>
                                <Tab.Pane eventKey="naoCompensado">
                                    {renderTabelaNaoCompensado()}
                                </Tab.Pane>
                                <Tab.Pane eventKey="pendencias">
                                    {renderTabelaPendencias()}
                                </Tab.Pane>
                            </Tab.Content>
                        )}
                    </Card.Body>
                    {dadosFiltrados.length > 0 && (
                        <Card.Footer className="py-2">
                            <Row className="align-items-center">
                                <Col>
                                    <small className="text-muted">
                                        Exibindo {dadosFiltrados.length} registros
                                        {selecionados.length > 0 && ` | ${selecionados.length} selecionados`}
                                    </small>
                                </Col>
                                <Col className="text-end">
                                    {selecionados.length > 0 && abaAtiva === 'compensado' && (
                                        <div className="d-flex gap-2 justify-content-end">
                                            <button className="btn btn-sm btn-success">
                                                <MessageCircle size={14} /> Enviar WhatsApp ({selecionados.length})
                                            </button>
                                            <button className="btn btn-sm btn-primary">
                                                <Mail size={14} /> Enviar Email ({selecionados.length})
                                            </button>
                                        </div>
                                    )}
                                    {selecionados.length > 0 && abaAtiva === 'naoCompensado' && (
                                        <div className="d-flex gap-2 justify-content-end">
                                            <button
                                                className="btn btn-sm btn-success"
                                                onClick={iniciarLancamentoLote}
                                            >
                                                <DollarSign size={14} /> Lancar Pagamentos EQTL ({selecionados.length})
                                            </button>
                                        </div>
                                    )}
                                </Col>
                            </Row>
                        </Card.Footer>
                    )}
                </Card>
            </Tab.Container>

            {/* Modal de Detalhes */}
            <Modal show={modalDetalhes.show} onHide={() => setModalDetalhes({ show: false, dados: null })} size="lg" centered>
                <Modal.Header closeButton>
                    <Modal.Title>
                        Detalhes - UC {modalDetalhes.dados?.uc}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {modalDetalhes.dados && (
                        <Row>
                            <Col md={6}>
                                <h6>Informacoes do Cliente</h6>
                                <Table size="sm" borderless>
                                    <tbody>
                                        <tr><td className="text-muted">UC:</td><td><strong>{modalDetalhes.dados.uc}</strong></td></tr>
                                        <tr><td className="text-muted">Cliente:</td><td>{modalDetalhes.dados.nome_cliente || '-'}</td></tr>
                                        <tr><td className="text-muted">CPF/CNPJ:</td><td>{modalDetalhes.dados.cpf_cnpj || '-'}</td></tr>
                                        <tr><td className="text-muted">Email:</td><td>{modalDetalhes.dados.email || '-'}</td></tr>
                                        <tr><td className="text-muted">WhatsApp:</td><td>{modalDetalhes.dados.whatsapp || '-'}</td></tr>
                                    </tbody>
                                </Table>
                            </Col>
                            <Col md={6}>
                                <h6>Status da Fatura</h6>
                                <Table size="sm" borderless>
                                    <tbody>
                                        <tr><td className="text-muted">Status:</td><td>{getStatusFaturaBadge(modalDetalhes.dados.status_fatura)}</td></tr>
                                        {modalDetalhes.dados.tipo_compensacao && (
                                            <tr><td className="text-muted">Compensacao:</td><td>{getTipoCompensacaoBadge(modalDetalhes.dados.tipo_compensacao)}</td></tr>
                                        )}
                                        <tr><td className="text-muted">Valor Concessionaria:</td><td><strong>{formatarValor(modalDetalhes.dados.valor_concessionaria)}</strong></td></tr>
                                        <tr><td className="text-muted">Valor Boleto:</td><td><strong>{formatarValor(modalDetalhes.dados.valor_boleto)}</strong></td></tr>
                                        <tr><td className="text-muted">Vencimento:</td><td>{modalDetalhes.dados.data_vencimento || '-'}</td></tr>
                                        <tr><td className="text-muted">Pag. EQTL:</td><td>{getPagamentoEqtlBadge(modalDetalhes.dados.status_pagamento_eqtl)}</td></tr>
                                        <tr><td className="text-muted">Pag. Aupus:</td><td>{getPagamentoAupusBadge(modalDetalhes.dados.status_pagamento_aupus)}</td></tr>
                                    </tbody>
                                </Table>
                            </Col>
                            {modalDetalhes.dados.erro_mensagem && (
                                <Col md={12}>
                                    <h6 className="text-danger mt-3">Erro</h6>
                                    <div className="alert alert-danger">{modalDetalhes.dados.erro_mensagem}</div>
                                </Col>
                            )}
                        </Row>
                    )}
                </Modal.Body>
            </Modal>

            {/* Modal de Confirmação de Ação */}
            <Modal
                show={modalConfirmacao.show}
                onHide={fecharModalConfirmacao}
                centered
                backdrop={modalConfirmacao.processando ? 'static' : true}
            >
                <Modal.Header closeButton={!modalConfirmacao.processando}>
                    <Modal.Title>
                        {modalConfirmacao.tipo === 'enviar-boleto' && 'Enviar para Boletos de Energia'}
                        {modalConfirmacao.tipo === 'simular-compensacao' && 'Simular Compensação'}
                        {modalConfirmacao.tipo === 'completar-compensacao' && 'Completar Compensação'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {/* Estado inicial: confirmação */}
                    {!modalConfirmacao.processando && !modalConfirmacao.resultado && (
                        <div>
                            {modalConfirmacao.tipo === 'enviar-boleto' && (
                                <>
                                    <p>Deseja enviar a fatura para <strong>Boletos de Energia</strong>?</p>
                                    <div className="bg-secondary bg-opacity-25 p-2 rounded">
                                        <strong>UC:</strong> {modalConfirmacao.item?.uc}<br />
                                        <strong>Cliente:</strong> {modalConfirmacao.item?.nome_cliente || '-'}<br />
                                        <strong>Mês:</strong> {mesReferencia}
                                    </div>
                                </>
                            )}
                            {modalConfirmacao.tipo === 'simular-compensacao' && (
                                <>
                                    <p>Deseja simular a <strong>compensação completa</strong> para esta fatura?</p>
                                    <div className="bg-secondary bg-opacity-25 p-2 rounded mb-2">
                                        <strong>UC:</strong> {modalConfirmacao.item?.uc}<br />
                                        <strong>Cliente:</strong> {modalConfirmacao.item?.nome_cliente || '-'}<br />
                                        <strong>Mês:</strong> {mesReferencia}
                                    </div>
                                    <small className="text-body-secondary">
                                        A compensação será calculada como se a fatura tivesse sido compensada até a tarifa mínima.
                                    </small>
                                </>
                            )}
                            {modalConfirmacao.tipo === 'completar-compensacao' && (
                                <>
                                    <p>Deseja <strong>completar a compensação</strong> parcial para esta fatura?</p>
                                    <div className="bg-secondary bg-opacity-25 p-2 rounded mb-2">
                                        <strong>UC:</strong> {modalConfirmacao.item?.uc}<br />
                                        <strong>Cliente:</strong> {modalConfirmacao.item?.nome_cliente || '-'}<br />
                                        <strong>Mês:</strong> {mesReferencia}
                                    </div>
                                    <small className="text-body-secondary">
                                        A compensação parcial existente será complementada até a tarifa mínima.
                                    </small>
                                </>
                            )}
                        </div>
                    )}

                    {/* Estado: processando */}
                    {modalConfirmacao.processando && (
                        <div className="text-center py-3">
                            <Spinner animation="border" variant="primary" />
                            <p className="mt-2 mb-0">Processando...</p>
                        </div>
                    )}

                    {/* Estado: resultado */}
                    {modalConfirmacao.resultado && (
                        <div className={`alert ${modalConfirmacao.resultado.sucesso ? 'alert-success' : 'alert-danger'} mb-0`}>
                            <div className="d-flex align-items-start gap-2">
                                {modalConfirmacao.resultado.sucesso ? (
                                    <CheckCircle size={20} className="flex-shrink-0 mt-1" />
                                ) : (
                                    <XCircle size={20} className="flex-shrink-0 mt-1" />
                                )}
                                <div>
                                    <strong>{modalConfirmacao.resultado.mensagem}</strong>
                                    {modalConfirmacao.resultado.detalhes && (
                                        <p className="mb-0 mt-1 small">{modalConfirmacao.resultado.detalhes}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    {/* Botões de confirmação inicial */}
                    {!modalConfirmacao.processando && !modalConfirmacao.resultado && (
                        <>
                            <Button variant="secondary" onClick={fecharModalConfirmacao}>
                                Cancelar
                            </Button>
                            <Button
                                variant={modalConfirmacao.tipo === 'simular-compensacao' || modalConfirmacao.tipo === 'completar-compensacao' ? 'warning' : 'primary'}
                                onClick={executarAcaoConfirmada}
                            >
                                {modalConfirmacao.tipo === 'enviar-boleto' && 'Confirmar Envio'}
                                {modalConfirmacao.tipo === 'simular-compensacao' && 'Simular'}
                                {modalConfirmacao.tipo === 'completar-compensacao' && 'Completar'}
                            </Button>
                        </>
                    )}

                    {/* Botão de fechar após resultado */}
                    {modalConfirmacao.resultado && (
                        <Button
                            variant={modalConfirmacao.resultado.sucesso ? 'success' : 'secondary'}
                            onClick={fecharModalConfirmacao}
                        >
                            Fechar
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>

            {/* Modal de Lançamento em Lote de Pagamentos */}
            <Modal
                show={modalLancamentoLote.show}
                onHide={fecharModalLancamentoLote}
                centered
                backdrop={modalLancamentoLote.processando ? 'static' : true}
                size="lg"
            >
                <Modal.Header closeButton={!modalLancamentoLote.processando}>
                    <Modal.Title>
                        <DollarSign size={20} className="me-2" />
                        Lançar Pagamentos EQTL em Lote
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {/* Estado inicial: confirmação */}
                    {!modalLancamentoLote.processando && !modalLancamentoLote.concluido && (
                        <div>
                            <p>Deseja lançar <strong>{modalLancamentoLote.total} pagamentos</strong> para a EQTL via API Banco do Brasil?</p>
                            <div className="bg-secondary bg-opacity-10 p-3 rounded mb-3">
                                <small className="text-body-secondary">
                                    Cada fatura será enviada para a API de Pagamentos em Lote do BB.
                                    O processamento é sequencial para evitar sobrecarga.
                                </small>
                            </div>
                            {modalLancamentoLote.itens && (
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    <Table size="sm" hover>
                                        <thead>
                                            <tr>
                                                <th>UC</th>
                                                <th>Cliente</th>
                                                <th className="text-end">Valor</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {modalLancamentoLote.itens.map((item, idx) => (
                                                <tr key={idx}>
                                                    <td><code>{item.uc}</code></td>
                                                    <td className="text-truncate" style={{ maxWidth: '200px' }}>{item.nome_cliente || '-'}</td>
                                                    <td className="text-end">{formatarValor(item.valor_concessionaria)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Estado: processando */}
                    {modalLancamentoLote.processando && (
                        <div>
                            <div className="d-flex align-items-center justify-content-between mb-2">
                                <span>Processando...</span>
                                <span className="text-body-secondary">
                                    {modalLancamentoLote.atual} / {modalLancamentoLote.total}
                                </span>
                            </div>
                            <div className="progress mb-3" style={{ height: '20px' }}>
                                <div
                                    className="progress-bar progress-bar-striped progress-bar-animated"
                                    style={{ width: `${(modalLancamentoLote.atual / modalLancamentoLote.total) * 100}%` }}
                                >
                                    {Math.round((modalLancamentoLote.atual / modalLancamentoLote.total) * 100)}%
                                </div>
                            </div>
                            {modalLancamentoLote.resultados.length > 0 && (
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    {modalLancamentoLote.resultados.map((res, idx) => (
                                        <div key={idx} className={`d-flex align-items-center gap-2 py-1 ${idx > 0 ? 'border-top' : ''}`}>
                                            {res.sucesso ? (
                                                <CheckCircle size={16} className="text-success flex-shrink-0" />
                                            ) : (
                                                <XCircle size={16} className="text-danger flex-shrink-0" />
                                            )}
                                            <code className="flex-shrink-0">{res.uc}</code>
                                            <span className="text-truncate">{res.mensagem}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Estado: concluído */}
                    {modalLancamentoLote.concluido && (
                        <div>
                            <div className="d-flex gap-4 mb-3">
                                <div className="text-center">
                                    <div className="display-6 text-success">{modalLancamentoLote.sucessos}</div>
                                    <small className="text-body-secondary">Sucesso</small>
                                </div>
                                <div className="text-center">
                                    <div className="display-6 text-danger">{modalLancamentoLote.erros}</div>
                                    <small className="text-body-secondary">Erros</small>
                                </div>
                            </div>
                            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                {modalLancamentoLote.resultados.map((res, idx) => (
                                    <div key={idx} className={`d-flex align-items-center gap-2 py-2 ${idx > 0 ? 'border-top' : ''}`}>
                                        {res.sucesso ? (
                                            <CheckCircle size={16} className="text-success flex-shrink-0" />
                                        ) : (
                                            <XCircle size={16} className="text-danger flex-shrink-0" />
                                        )}
                                        <code className="flex-shrink-0">{res.uc}</code>
                                        <span className="text-truncate flex-grow-1" title={res.nome}>{res.nome || '-'}</span>
                                        <small className={res.sucesso ? 'text-success' : 'text-danger'}>{res.mensagem}</small>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    {/* Botões de confirmação inicial */}
                    {!modalLancamentoLote.processando && !modalLancamentoLote.concluido && (
                        <>
                            <Button variant="secondary" onClick={fecharModalLancamentoLote}>
                                Cancelar
                            </Button>
                            <Button variant="success" onClick={executarLancamentoLote}>
                                <PlayCircle size={16} className="me-1" />
                                Iniciar Lançamento
                            </Button>
                        </>
                    )}

                    {/* Botão de fechar após conclusão */}
                    {modalLancamentoLote.concluido && (
                        <Button
                            variant={modalLancamentoLote.erros === 0 ? 'success' : 'secondary'}
                            onClick={fecharModalLancamentoLote}
                        >
                            Fechar
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>

            <style>{`
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .table-sm td, .table-sm th { padding: 0.4rem 0.5rem; vertical-align: middle; }
                /* Tabs - tema claro */
                .controle-tabs.nav-tabs { border-bottom: none; }
                .controle-tabs .nav-link {
                    color: #6c757d;
                    background-color: transparent;
                    border: 1px solid transparent;
                    padding: 0.5rem 1rem;
                    margin-right: 0.25rem;
                    border-radius: 6px;
                }
                .controle-tabs .nav-link:hover {
                    color: #495057;
                    background-color: #f8f9fa;
                }
                .controle-tabs .nav-link.active {
                    color: #fff;
                    background-color: #6c757d;
                    border-color: #6c757d;
                    font-weight: 500;
                }
                /* Dark mode - tabs */
                [data-theme="dark"] .controle-tabs .nav-link {
                    color: #6c757d;
                }
                [data-theme="dark"] .controle-tabs .nav-link:hover {
                    color: #adb5bd;
                    background-color: rgba(255,255,255,0.05);
                }
                [data-theme="dark"] .controle-tabs .nav-link.active {
                    color: #fff;
                    background-color: rgba(255,255,255,0.1);
                    border-color: rgba(255,255,255,0.15);
                }
            `}</style>
        </Container>
    );
}

export default ControleMensal;
