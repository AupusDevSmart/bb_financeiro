import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Form, Badge, Spinner, Accordion, ProgressBar, Button } from 'react-bootstrap';
import api from '../services/api';
import {
    Sun, Zap, DollarSign, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight,
    CheckCircle, XCircle, TrendingUp, Factory, Users, Download, FileText
} from 'lucide-react';

function PainelUGs({ mostrarAlerta }) {
    // Estado do mês selecionado
    const [mesReferencia, setMesReferencia] = useState('');
    const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [carregandoDados, setCarregandoDados] = useState(false);

    // Dados
    const [resumo, setResumo] = useState({
        total_ugs: 0,
        energia_injetada_total: 0,
        energia_cobrada_total: 0,
        energia_descartada_total: 0,
        ugs_nao_autorizadas: []
    });
    const [ugsPorGeradora, setUgsPorGeradora] = useState([]);
    const [ugsLista, setUgsLista] = useState([]);
    const [ugsEstatisticas, setUgsEstatisticas] = useState({ total: 0, baixadas: 0, nao_baixadas: 0 });

    // Carregar meses ao montar
    useEffect(() => {
        carregarMesesDisponiveis();
    }, []);

    // Carregar dados quando mês mudar
    useEffect(() => {
        if (mesReferencia) {
            carregarDados();
        }
    }, [mesReferencia]);

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
            // Carregar resumo de energia
            const responseResumo = await api.get(`/api/ugs/resumo/${encodeURIComponent(mesReferencia)}`);
            setResumo(responseResumo.data.resumo || {
                total_ugs: 0,
                energia_injetada_total: 0,
                energia_cobrada_total: 0,
                energia_descartada_total: 0,
                ugs_nao_autorizadas: []
            });
            setUgsPorGeradora(responseResumo.data.ugs_detalhado || []);

            // Carregar lista de UGs com status de fatura
            const responseLista = await api.get(`/api/ugs/lista/${encodeURIComponent(mesReferencia)}`);
            setUgsLista(responseLista.data.ugs || []);
            setUgsEstatisticas(responseLista.data.estatisticas || { total: 0, baixadas: 0, nao_baixadas: 0 });
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
            mostrarAlerta('Erro ao carregar dados de UGs', 'danger');
        } finally {
            setCarregandoDados(false);
        }
    };

    const navegarMes = (direcao) => {
        const indexAtual = mesesDisponiveis.indexOf(mesReferencia);
        const novoIndex = indexAtual + direcao;
        if (novoIndex >= 0 && novoIndex < mesesDisponiveis.length) {
            setMesReferencia(mesesDisponiveis[novoIndex]);
        }
    };

    const formatarEnergia = (valor) => {
        if (!valor) return '0 kWh';
        return `${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
    };

    const calcularPercentual = (parte, total) => {
        if (!total || total === 0) return 0;
        return Math.round((parte / total) * 100);
    };

    const baixarFaturaUG = async (uc, caminho_pdf) => {
        try {
            if (!caminho_pdf) {
                mostrarAlerta('Fatura não disponível para download', 'warning');
                return;
            }
            // Extrair nome do arquivo do caminho
            const nomeArquivo = caminho_pdf.split('/').pop();
            const response = await api.get(`/api/faturas/download/${encodeURIComponent(caminho_pdf)}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Fatura_UG_${uc}_${mesReferencia.replace('/', '_')}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            mostrarAlerta('Download iniciado!', 'success');
        } catch (error) {
            console.error('Erro ao baixar fatura:', error);
            mostrarAlerta('Erro ao baixar fatura', 'danger');
        }
    };

    const exportarExcel = async () => {
        try {
            mostrarAlerta('Gerando Excel...', 'info');
            const response = await api.get(`/api/ugs/exportar/${encodeURIComponent(mesReferencia)}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Controle_UGs_Geradoras_${mesReferencia.replace('/', '_')}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            mostrarAlerta('Excel exportado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao exportar Excel:', error);
            mostrarAlerta('Erro ao exportar Excel', 'danger');
        }
    };

    const getStatusBadge = (status) => {
        const statusMap = {
            'Baixada': { bg: 'success', icon: CheckCircle },
            'Nao Baixada': { bg: 'danger', icon: XCircle },
            'Pendente': { bg: 'warning', icon: AlertTriangle },
            'Com Erro': { bg: 'danger', icon: XCircle }
        };
        const config = statusMap[status] || { bg: 'secondary', icon: AlertTriangle };
        const Icon = config.icon;
        return (
            <Badge bg={config.bg} className="d-flex align-items-center gap-1" style={{ width: 'fit-content' }}>
                <Icon size={12} />
                {status}
            </Badge>
        );
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

    const percentualCobrado = calcularPercentual(resumo.energia_cobrada_total, resumo.energia_injetada_total);
    const percentualDescartado = calcularPercentual(resumo.energia_descartada_total, resumo.energia_injetada_total);

    return (
        <Container fluid className="py-3">
            {/* Header */}
            <Card className="mb-3">
                <Card.Body className="py-2">
                    <Row className="align-items-center">
                        <Col md={3}>
                            <h5 className="mb-0 d-flex align-items-center gap-2">
                                <Sun size={22} />
                                Painel de UGs
                            </h5>
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
                                className="btn btn-success btn-sm me-2"
                                onClick={exportarExcel}
                                disabled={carregandoDados}
                                title="Exportar para Excel"
                            >
                                <Download size={14} /> Exportar Excel
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

            {carregandoDados ? (
                <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                </div>
            ) : (
                <>
                    {/* Cards de Resumo */}
                    <Row className="mb-4">
                        <Col md={3}>
                            <Card className="h-100 dashboard-card">
                                <Card.Body className="text-center">
                                    <div className="dashboard-icon bg-warning-subtle">
                                        <Factory size={28} className="text-warning" />
                                    </div>
                                    <h2 className="mb-1">{resumo.total_ugs}</h2>
                                    <p className="text-muted mb-0">UGs Cadastradas</p>
                                    <small className="text-muted">Usinas geradoras</small>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col md={3}>
                            <Card className="h-100 dashboard-card">
                                <Card.Body className="text-center">
                                    <div className="dashboard-icon bg-info-subtle">
                                        <Zap size={28} className="text-info" />
                                    </div>
                                    <h3 className="mb-1">{formatarEnergia(resumo.energia_injetada_total)}</h3>
                                    <p className="text-muted mb-0">Total Injetado</p>
                                    <small className="text-info">Energia gerada no mes</small>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col md={3}>
                            <Card className="h-100 dashboard-card">
                                <Card.Body className="text-center">
                                    <div className="dashboard-icon bg-success-subtle">
                                        <DollarSign size={28} className="text-success" />
                                    </div>
                                    <h3 className="mb-1">{formatarEnergia(resumo.energia_cobrada_total)}</h3>
                                    <p className="text-muted mb-0">Total Cobrado</p>
                                    <ProgressBar now={percentualCobrado} variant="success" className="mt-2" style={{ height: '6px' }} />
                                    <small className="text-success">{percentualCobrado}% autorizado</small>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col md={3}>
                            <Card className="h-100 dashboard-card">
                                <Card.Body className="text-center">
                                    <div className={`dashboard-icon ${resumo.energia_descartada_total > 0 ? 'bg-danger-subtle' : 'bg-secondary-subtle'}`}>
                                        <AlertTriangle size={28} className={resumo.energia_descartada_total > 0 ? 'text-danger' : 'text-secondary'} />
                                    </div>
                                    <h3 className={`mb-1 ${resumo.energia_descartada_total > 0 ? 'text-danger' : ''}`}>
                                        {formatarEnergia(resumo.energia_descartada_total)}
                                    </h3>
                                    <p className="text-muted mb-0">Descartado</p>
                                    {resumo.energia_descartada_total > 0 && (
                                        <>
                                            <ProgressBar now={percentualDescartado} variant="danger" className="mt-2" style={{ height: '6px' }} />
                                            <small className="text-danger">{percentualDescartado}% nao autorizado</small>
                                        </>
                                    )}
                                    {resumo.energia_descartada_total === 0 && (
                                        <small className="text-muted">Nenhum descarte</small>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* Alertas de UGs não autorizadas */}
                    {resumo.ugs_nao_autorizadas && resumo.ugs_nao_autorizadas.length > 0 && (
                        <Card className="mb-4 border-danger">
                            <Card.Header className="bg-danger text-white">
                                <h6 className="mb-0 d-flex align-items-center gap-2">
                                    <AlertTriangle size={18} />
                                    UGs Nao Autorizadas Detectadas
                                </h6>
                            </Card.Header>
                            <Card.Body>
                                <Table size="sm" className="mb-0">
                                    <thead>
                                        <tr>
                                            <th>UC Geradora</th>
                                            <th>UC Destino</th>
                                            <th>Cliente</th>
                                            <th className="text-end">Energia Descartada</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {resumo.ugs_nao_autorizadas.map((ug, index) => (
                                            <tr key={index} className="table-danger">
                                                <td>
                                                    <Badge bg="danger">{ug.uc_geradora}</Badge>
                                                </td>
                                                <td>{ug.uc_destino}</td>
                                                <td>{ug.nome_cliente || '-'}</td>
                                                <td className="text-end text-danger">
                                                    <strong>{formatarEnergia(ug.energia_descartada)}</strong>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card.Body>
                        </Card>
                    )}

                    {/* Detalhamento por UG */}
                    <Card>
                        <Card.Header>
                            <h6 className="mb-0 d-flex align-items-center gap-2">
                                <TrendingUp size={18} />
                                Detalhamento por Usina Geradora
                            </h6>
                        </Card.Header>
                        <Card.Body className="p-0">
                            {ugsPorGeradora.length === 0 ? (
                                <div className="text-center py-4 text-muted">
                                    Nenhum dado de UG encontrado para este mes
                                </div>
                            ) : (
                                <Accordion>
                                    {ugsPorGeradora.map((ug, index) => (
                                        <Accordion.Item key={ug.uc_geradora || index} eventKey={String(index)}>
                                            <Accordion.Header>
                                                <div className="d-flex justify-content-between align-items-center w-100 me-3">
                                                    <div className="d-flex align-items-center gap-2">
                                                        <Sun size={18} className="text-warning" />
                                                        <strong>{ug.nome_ug || 'UG ' + ug.uc_geradora}</strong>
                                                        <Badge bg="secondary">{ug.uc_geradora}</Badge>
                                                    </div>
                                                    <div className="d-flex align-items-center gap-3">
                                                        <span className="text-muted">
                                                            <Users size={14} /> {ug.total_ucs || 0} UCs
                                                        </span>
                                                        <span className="text-info">
                                                            <Zap size={14} /> {formatarEnergia(ug.energia_injetada_total)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </Accordion.Header>
                                            <Accordion.Body className="p-0">
                                                <Table size="sm" hover className="mb-0">
                                                    <thead className="table-dark">
                                                        <tr>
                                                            <th>UC Destino</th>
                                                            <th>Cliente</th>
                                                            <th className="text-end">Injetado</th>
                                                            <th className="text-end">Cobrado</th>
                                                            <th className="text-end">Descartado</th>
                                                            <th className="text-center">Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {ug.destinatarios && ug.destinatarios.map((dest, idx) => (
                                                            <tr key={idx} className={!dest.autorizada ? 'table-danger' : ''}>
                                                                <td>
                                                                    <strong>{dest.uc_destino}</strong>
                                                                </td>
                                                                <td>{dest.nome_cliente || '-'}</td>
                                                                <td className="text-end">{formatarEnergia(dest.energia_injetada)}</td>
                                                                <td className="text-end text-success">
                                                                    {formatarEnergia(dest.energia_cobrada)}
                                                                </td>
                                                                <td className="text-end text-danger">
                                                                    {dest.energia_descartada > 0 ? formatarEnergia(dest.energia_descartada) : '-'}
                                                                </td>
                                                                <td className="text-center">
                                                                    {dest.autorizada ? (
                                                                        <Badge bg="success"><CheckCircle size={10} /> OK</Badge>
                                                                    ) : (
                                                                        <Badge bg="danger"><XCircle size={10} /> Nao Autorizada</Badge>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {/* Linha de totais da UG */}
                                                        <tr className="table-secondary fw-bold">
                                                            <td colSpan={2}>TOTAL {ug.nome_ug || ug.uc_geradora}</td>
                                                            <td className="text-end">{formatarEnergia(ug.energia_injetada_total)}</td>
                                                            <td className="text-end text-success">{formatarEnergia(ug.energia_cobrada_total)}</td>
                                                            <td className="text-end text-danger">
                                                                {ug.energia_descartada_total > 0 ? formatarEnergia(ug.energia_descartada_total) : '-'}
                                                            </td>
                                                            <td></td>
                                                        </tr>
                                                    </tbody>
                                                </Table>
                                            </Accordion.Body>
                                        </Accordion.Item>
                                    ))}
                                </Accordion>
                            )}
                        </Card.Body>
                    </Card>

                    {/* Tabela de UGs com Status de Fatura */}
                    <Card className="mt-4">
                        <Card.Header>
                            <div className="d-flex justify-content-between align-items-center">
                                <h6 className="mb-0 d-flex align-items-center gap-2">
                                    <FileText size={18} />
                                    Faturas das Usinas Geradoras
                                    <Badge bg="success" className="ms-2">{ugsEstatisticas.baixadas} Baixadas</Badge>
                                    <Badge bg="danger">{ugsEstatisticas.nao_baixadas} Nao Baixadas</Badge>
                                </h6>
                            </div>
                        </Card.Header>
                        <Card.Body className="p-0">
                            <Table hover className="mb-0">
                                <thead className="table-dark">
                                    <tr>
                                        <th>Numero UC</th>
                                        <th>Nome da UG</th>
                                        <th className="text-center">Status</th>
                                        <th className="text-center">Acao</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ugsLista.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="text-center text-muted py-4">
                                                Nenhuma UG cadastrada
                                            </td>
                                        </tr>
                                    ) : (
                                        ugsLista.map((ug, index) => (
                                            <tr key={index}>
                                                <td>
                                                    <strong>{ug.uc}</strong>
                                                </td>
                                                <td>{ug.nome_ug}</td>
                                                <td className="text-center">
                                                    {getStatusBadge(ug.status)}
                                                </td>
                                                <td className="text-center">
                                                    {ug.status === 'Baixada' && ug.caminho_pdf ? (
                                                        <Button
                                                            variant="outline-primary"
                                                            size="sm"
                                                            onClick={() => baixarFaturaUG(ug.uc, ug.caminho_pdf)}
                                                        >
                                                            <Download size={14} /> Baixar
                                                        </Button>
                                                    ) : (
                                                        <span className="text-muted">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                </>
            )}

            <style>{`
                .dashboard-card {
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .dashboard-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }
                .dashboard-icon {
                    width: 56px;
                    height: 56px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 12px;
                }
                .bg-warning-subtle { background-color: rgba(255, 193, 7, 0.1); }
                .bg-info-subtle { background-color: rgba(23, 162, 184, 0.1); }
                .bg-success-subtle { background-color: rgba(40, 167, 69, 0.1); }
                .bg-danger-subtle { background-color: rgba(220, 53, 69, 0.1); }
                .bg-secondary-subtle { background-color: rgba(108, 117, 125, 0.1); }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                /* Dark mode - Accordion */
                [data-theme="dark"] .accordion-item {
                    background-color: transparent;
                    border-color: #1a3a5c;
                }
                [data-theme="dark"] .accordion-button {
                    background-color: #0d2137;
                    color: #fff;
                }
                [data-theme="dark"] .accordion-button:not(.collapsed) {
                    background-color: #1a3a5c;
                    color: #fff;
                }
                [data-theme="dark"] .accordion-button::after {
                    filter: invert(1);
                }
                [data-theme="dark"] .accordion-body {
                    background-color: #0a1929;
                }
                /* Dark mode - table secondary row */
                [data-theme="dark"] .table-secondary {
                    background-color: #333 !important;
                }
                [data-theme="dark"] .table-secondary td {
                    background-color: #333 !important;
                    color: #fff !important;
                }
            `}</style>
        </Container>
    );
}

export default PainelUGs;
