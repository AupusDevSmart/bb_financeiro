import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Form, Spinner, Badge, ProgressBar } from 'react-bootstrap';
import api from '../services/api';
import { formatarValor } from '../utils/formatters';
import {
    FileText, CheckCircle, AlertTriangle, XCircle, Zap, ZapOff,
    Send, DollarSign, TrendingUp, RefreshCw, ChevronLeft, ChevronRight,
    AlertCircle, Users, Calendar
} from 'lucide-react';

function DashboardFaturas({ mostrarAlerta }) {
    // Estado do mês selecionado
    const [mesReferencia, setMesReferencia] = useState('');
    const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [carregandoDados, setCarregandoDados] = useState(false);

    // Dados do dashboard
    const [resumo, setResumo] = useState({
        total_ucs_ativas: 0,
        faturas_recebidas: 0,
        faturas_faltando: 0,
        faturas_com_erro: 0,
        com_compensacao: 0,
        sem_compensacao: 0,
        geradas: 0,
        enviadas: 0,
        pagas: 0,
        valor_total_boletos: 0,
        valor_total_pago: 0,
        itens_atencao: []
    });

    // Carregar meses disponíveis ao montar
    useEffect(() => {
        carregarMesesDisponiveis();
    }, []);

    // Carregar dados quando mês mudar
    useEffect(() => {
        if (mesReferencia) {
            carregarDadosDashboard();
        }
    }, [mesReferencia]);

    const carregarMesesDisponiveis = async () => {
        try {
            const response = await api.get('/api/meses-disponiveis-boletos');
            const meses = response.data.meses || [];
            setMesesDisponiveis(meses);

            // Definir mês mais recente como padrão
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

    const carregarDadosDashboard = async () => {
        setCarregandoDados(true);
        try {
            const response = await api.get(`/api/dashboard/resumo/${encodeURIComponent(mesReferencia)}`);
            setResumo(response.data);
        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
            mostrarAlerta('Erro ao carregar dados do dashboard', 'danger');
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

    const calcularPercentual = (valor, total) => {
        if (total === 0) return 0;
        return Math.round((valor / total) * 100);
    };

    if (carregando) {
        return (
            <Container fluid className="py-4">
                <div className="text-center">
                    <Spinner animation="border" variant="primary" />
                    <p className="mt-2">Carregando dashboard...</p>
                </div>
            </Container>
        );
    }

    const percentualRecebidas = calcularPercentual(resumo.faturas_recebidas, resumo.total_ucs_ativas);
    const percentualPagas = calcularPercentual(resumo.pagas, resumo.enviadas);

    return (
        <Container fluid className="py-2 dashboard-container">
            {/* Header com seletor de mês - mais compacto */}
            <Card className="mb-2">
                <Card.Body className="py-2">
                    <Row className="align-items-center">
                        <Col md={4}>
                            <h5 className="mb-0 d-flex align-items-center gap-2">
                                <Calendar size={20} />
                                Controle de Faturas
                            </h5>
                        </Col>
                        <Col md={4} className="text-center">
                            <div className="d-flex align-items-center justify-content-center gap-1">
                                <button
                                    className="btn btn-outline-secondary btn-sm py-0 px-1"
                                    onClick={() => navegarMes(1)}
                                    disabled={mesesDisponiveis.indexOf(mesReferencia) >= mesesDisponiveis.length - 1}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <Form.Select
                                    value={mesReferencia}
                                    onChange={(e) => setMesReferencia(e.target.value)}
                                    style={{ width: '130px', textAlign: 'center', fontWeight: 'bold' }}
                                    size="sm"
                                >
                                    {mesesDisponiveis.map(mes => (
                                        <option key={mes} value={mes}>{mes}</option>
                                    ))}
                                </Form.Select>
                                <button
                                    className="btn btn-outline-secondary btn-sm py-0 px-1"
                                    onClick={() => navegarMes(-1)}
                                    disabled={mesesDisponiveis.indexOf(mesReferencia) <= 0}
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </Col>
                        <Col md={4} className="text-end">
                            <button
                                className="btn btn-outline-primary btn-sm py-0"
                                onClick={carregarDadosDashboard}
                                disabled={carregandoDados}
                            >
                                <RefreshCw size={14} className={carregandoDados ? 'spin' : ''} />
                                {' '}Atualizar
                            </button>
                        </Col>
                    </Row>
                </Card.Body>
            </Card>

            {carregandoDados ? (
                <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                    <p className="mt-2">Carregando dados...</p>
                </div>
            ) : (
                <>
                    {/* Linha 1: 5 Cards de Status */}
                    <Row className="mb-3 dashboard-row-5">
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-primary-subtle me-3">
                                        <Users size={22} className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.total_ucs_ativas}</h3>
                                        <small className="text-muted">UCs Ativas</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-success-subtle me-3">
                                        <CheckCircle size={22} className="text-success" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.faturas_recebidas} <small className="text-success fw-normal fs-6">({percentualRecebidas}%)</small></h3>
                                        <small className="text-muted">Recebidas</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className={`dashboard-card h-100 ${(resumo.nao_recebidas || 0) > 0 ? 'border-danger' : ''}`}>
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className={`dashboard-icon me-3 ${(resumo.nao_recebidas || 0) > 0 ? 'bg-danger-subtle' : 'bg-secondary-subtle'}`}>
                                        <XCircle size={22} className={(resumo.nao_recebidas || 0) > 0 ? 'text-danger' : 'text-secondary'} />
                                    </div>
                                    <div>
                                        <h3 className={`mb-0 fw-bold ${(resumo.nao_recebidas || 0) > 0 ? 'text-danger' : ''}`}>{resumo.nao_recebidas || 0}</h3>
                                        <small className="text-muted">Nao Recebidas</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-secondary-subtle me-3">
                                        <AlertCircle size={22} className="text-secondary" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.pendentes || 0}</h3>
                                        <small className="text-muted">Pendentes</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-success-subtle me-3">
                                        <Zap size={22} className="text-success" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.compensado || 0}</h3>
                                        <small className="text-muted">Compensado</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* Linha 2: 5 Cards de Categoria e Status */}
                    <Row className="mb-3 dashboard-row-5">
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-info-subtle me-3">
                                        <Zap size={22} className="text-info" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.comp_simulada || 0}</h3>
                                        <small className="text-muted">Comp. Simulada</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-warning-subtle me-3">
                                        <ZapOff size={22} className="text-warning" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.sem_compensacao || 0}</h3>
                                        <small className="text-muted">Sem Comp.</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className={`dashboard-card h-100 ${(resumo.com_erro || 0) > 0 ? 'border-danger' : ''}`}>
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className={`dashboard-icon me-3 ${(resumo.com_erro || 0) > 0 ? 'bg-danger-subtle' : 'bg-secondary-subtle'}`}>
                                        <XCircle size={22} className={(resumo.com_erro || 0) > 0 ? 'text-danger' : 'text-secondary'} />
                                    </div>
                                    <div>
                                        <h3 className={`mb-0 fw-bold ${(resumo.com_erro || 0) > 0 ? 'text-danger' : ''}`}>{resumo.com_erro || 0}</h3>
                                        <small className="text-muted">Com Erro</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-primary-subtle me-3">
                                        <Send size={22} className="text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.enviadas}</h3>
                                        <small className="text-muted">Enviadas</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-5">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-success-subtle me-3">
                                        <DollarSign size={22} className="text-success" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold">{resumo.pagas}</h3>
                                        <small className="text-muted">Pagas</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* Linha 3: 3 Cards Financeiros */}
                    <Row className="mb-3 dashboard-row-3">
                        <Col className="dashboard-col-3">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-warning-subtle me-3">
                                        <FileText size={22} className="text-warning" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold text-warning">{formatarValor(resumo.valor_total_boletos)}</h3>
                                        <small className="text-muted">Total Boletos</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-3">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-success-subtle me-3">
                                        <DollarSign size={22} className="text-success" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold text-success">{formatarValor(resumo.valor_total_pago)}</h3>
                                        <small className="text-muted">Valor Recebido</small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col className="dashboard-col-3">
                            <Card className="dashboard-card h-100">
                                <Card.Body className="d-flex align-items-center justify-content-center py-3 px-3">
                                    <div className="dashboard-icon bg-info-subtle me-3">
                                        <TrendingUp size={22} className="text-info" />
                                    </div>
                                    <div>
                                        <h3 className="mb-0 fw-bold text-info">
                                            {resumo.geradas > 0 ? `${calcularPercentual(resumo.pagas, resumo.geradas)}%` : '0%'}
                                        </h3>
                                        <small className="text-muted d-block">Taxa Conversao</small>
                                        <small className="text-muted" style={{fontSize: '0.7rem'}}>
                                            {resumo.pagas || 0} pagas / {resumo.geradas || 0} geradas
                                        </small>
                                    </div>
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>

                    {/* Seção de Atenção */}
                    {resumo.itens_atencao && resumo.itens_atencao.length > 0 && (
                        <Card className="border-warning">
                            <Card.Header className="bg-warning-subtle">
                                <h5 className="mb-0 d-flex align-items-center gap-2">
                                    <AlertCircle size={20} className="text-warning" />
                                    Requer Atencao
                                </h5>
                            </Card.Header>
                            <Card.Body>
                                <ul className="mb-0">
                                    {resumo.itens_atencao.map((item, index) => (
                                        <li key={index} className="mb-2">
                                            <Badge bg={item.tipo === 'erro' ? 'danger' : item.tipo === 'aviso' ? 'warning' : 'info'} className="me-2">
                                                {item.tipo === 'erro' ? 'ERRO' : item.tipo === 'aviso' ? 'AVISO' : 'INFO'}
                                            </Badge>
                                            {item.mensagem}
                                            {item.quantidade && <strong> ({item.quantidade})</strong>}
                                        </li>
                                    ))}
                                </ul>
                            </Card.Body>
                        </Card>
                    )}
                </>
            )}

            <style>{`
                /* Container geral */
                .dashboard-container {
                    max-width: 100%;
                }
                /* Grid de 5 colunas */
                .dashboard-row-5 {
                    display: flex;
                    flex-wrap: wrap;
                    margin: 0 -6px;
                }
                .dashboard-col-5 {
                    flex: 0 0 20%;
                    max-width: 20%;
                    padding: 0 6px;
                }
                /* Grid de 3 colunas */
                .dashboard-row-3 {
                    display: flex;
                    flex-wrap: wrap;
                    margin: 0 -6px;
                }
                .dashboard-col-3 {
                    flex: 0 0 33.333%;
                    max-width: 33.333%;
                    padding: 0 6px;
                }
                @media (max-width: 1200px) {
                    .dashboard-col-5 {
                        flex: 0 0 33.333%;
                        max-width: 33.333%;
                        margin-bottom: 12px;
                    }
                }
                @media (max-width: 768px) {
                    .dashboard-col-5, .dashboard-col-3 {
                        flex: 0 0 50%;
                        max-width: 50%;
                        margin-bottom: 12px;
                    }
                }
                @media (max-width: 576px) {
                    .dashboard-col-5, .dashboard-col-3 {
                        flex: 0 0 100%;
                        max-width: 100%;
                    }
                }
                .dashboard-card {
                    transition: transform 0.15s, box-shadow 0.15s;
                    min-height: 70px;
                }
                .dashboard-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }
                .dashboard-card h3 {
                    font-size: 1.4rem;
                    line-height: 1.2;
                }
                .dashboard-card small {
                    font-size: 0.75rem;
                }
                /* Icone */
                .dashboard-icon {
                    width: 44px;
                    height: 44px;
                    min-width: 44px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .bg-primary-subtle { background-color: rgba(0, 48, 135, 0.1); }
                .bg-success-subtle { background-color: rgba(40, 167, 69, 0.1); }
                .bg-warning-subtle { background-color: rgba(255, 193, 7, 0.1); }
                .bg-danger-subtle { background-color: rgba(220, 53, 69, 0.1); }
                .bg-info-subtle { background-color: rgba(23, 162, 184, 0.1); }
                .bg-secondary-subtle { background-color: rgba(108, 117, 125, 0.1); }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                [data-theme="dark"] .bg-primary-subtle { background-color: rgba(74, 144, 226, 0.15); }
                [data-theme="dark"] .bg-success-subtle { background-color: rgba(46, 204, 113, 0.15); }
                [data-theme="dark"] .bg-warning-subtle { background-color: rgba(243, 156, 18, 0.15); }
                [data-theme="dark"] .bg-danger-subtle { background-color: rgba(231, 76, 60, 0.15); }
                [data-theme="dark"] .bg-info-subtle { background-color: rgba(52, 152, 219, 0.15); }
                /* Fix: Requer Atencao - texto escuro no fundo amarelo (dark mode) */
                [data-theme="dark"] .border-warning .card-header.bg-warning-subtle {
                    color: #664d03 !important;
                }
                [data-theme="dark"] .border-warning .card-header.bg-warning-subtle h5 {
                    color: #664d03 !important;
                }
                [data-theme="dark"] .border-warning .card-header.bg-warning-subtle .text-warning {
                    color: #664d03 !important;
                }
            `}</style>
        </Container>
    );
}

export default DashboardFaturas;
