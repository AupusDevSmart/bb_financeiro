import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Form, Table, Badge, Tabs, Tab, Spinner, ProgressBar, Modal } from 'react-bootstrap';
import {
    Activity, Server, Mail, FileText, Calculator, Database,
    RefreshCw, Play, AlertTriangle, CheckCircle, XCircle,
    Clock, Download, Eye, Search, Trash2, RotateCcw,
    BarChart2, TrendingUp, Users, Zap, FileSpreadsheet,
    Calendar, Filter, ChevronRight, ExternalLink, Settings,
    Lock, Unlock, Check, AlertCircle
} from 'lucide-react';
import api from '../services/api';

// API_URL não é necessário pois api.js já tem baseURL configurado

function MicroservicosPanel({ mostrarAlerta }) {
    const [activeTab, setActiveTab] = useState('gerenciar');
    const [carregando, setCarregando] = useState(false);

    // Dashboard State
    const [dashboardData, setDashboardData] = useState(null);
    const [servicosStatus, setServicosStatus] = useState({});

    // Jobs State
    const [jobs, setJobs] = useState([]);
    const [jobsFiltro, setJobsFiltro] = useState('todos');
    const [jobsPagina, setJobsPagina] = useState(1);

    // Relatorios State
    const [relatorios, setRelatorios] = useState([]);
    const [relatorioSelecionado, setRelatorioSelecionado] = useState(null);
    const [modalRelatorio, setModalRelatorio] = useState(false);
    const [faturasMes, setFaturasMes] = useState([]);
    const [mesSelecionado, setMesSelecionado] = useState('');
    const [anoSelecionado, setAnoSelecionado] = useState('2025');
    const [dadosRelatorio, setDadosRelatorio] = useState(null);
    const [totaisRelatorio, setTotaisRelatorio] = useState(null);

    // Busca Email State
    const [buscaStatus, setBuscaStatus] = useState(null);
    const [buscaEmAndamento, setBuscaEmAndamento] = useState(false);
    const [dataInicioBusca, setDataInicioBusca] = useState('');
    const [dataFimBusca, setDataFimBusca] = useState('');
    const [limiteBusca, setLimiteBusca] = useState(50);
    const [execucoesRecentes, setExecucoesRecentes] = useState([]);

    // Logs State
    const [logs, setLogs] = useState([]);
    const [logsFiltro, setLogsFiltro] = useState('todos');
    const [logsServico, setLogsServico] = useState('todos');

    // Gerenciar Faturas State
    const [gerenciarMes, setGerenciarMes] = useState('');
    const [gerenciarAno, setGerenciarAno] = useState('2025');
    const [faturasGerenciar, setFaturasGerenciar] = useState([]);
    // eslint-disable-next-line no-unused-vars
    const [faturasSelecionadas, setFaturasSelecionadas] = useState([]);
    const [recalculando, setRecalculando] = useState(false);
    const [resultadoRecalculo, setResultadoRecalculo] = useState(null);
    const [modalDetalhes, setModalDetalhes] = useState(false);
    const [faturaDetalhes, setFaturaDetalhes] = useState(null);

    // Carregar dados iniciais
    useEffect(() => {
        if (activeTab === 'dashboard') {
            carregarDashboard();
        } else if (activeTab === 'jobs') {
            carregarJobs();
        } else if (activeTab === 'relatorios') {
            carregarRelatorios();
        } else if (activeTab === 'busca') {
            carregarExecucoes();
        } else if (activeTab === 'logs') {
            carregarLogs();
        } else if (activeTab === 'gerenciar') {
            // Limpar seleções ao entrar na aba
            setFaturasSelecionadas([]);
            setResultadoRecalculo(null);
        }
    }, [activeTab]);

    // Auto-refresh dashboard
    useEffect(() => {
        if (activeTab === 'dashboard') {
            const interval = setInterval(carregarDashboard, 30000);
            return () => clearInterval(interval);
        }
    }, [activeTab]);

    // ==================== API CALLS ====================

    const carregarDashboard = async () => {
        try {
            const response = await api.get('/api/microservicos/dashboard');
            setDashboardData(response.data);
            setServicosStatus(response.data.servicos || {});
        } catch (error) {
            console.error('Erro ao carregar dashboard:', error);
        }
    };

    const carregarJobs = async () => {
        setCarregando(true);
        try {
            const response = await api.get('/api/microservicos/jobs', {
                params: { status: jobsFiltro, pagina: jobsPagina }
            });
            setJobs(response.data.jobs || []);
        } catch (error) {
            console.error('Erro ao carregar jobs:', error);
            mostrarAlerta('Erro ao carregar jobs', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    const carregarRelatorios = async () => {
        setCarregando(true);
        try {
            const response = await api.get('/api/microservicos/relatorios');
            setRelatorios(response.data.relatorios || []);
        } catch (error) {
            console.error('Erro ao carregar relatórios:', error);
        } finally {
            setCarregando(false);
        }
    };

    const carregarFaturasMes = async () => {
        if (!mesSelecionado || !anoSelecionado) return;

        setCarregando(true);
        try {
            const mesRef = `${mesSelecionado}/${anoSelecionado}`;
            const response = await api.get('/api/microservicos/faturas', {
                params: { mes_referencia: mesRef }
            });
            setFaturasMes(response.data.faturas || []);
            setRelatorioSelecionado({ mes_referencia: mesRef });
            setModalRelatorio(true);
        } catch (error) {
            console.error('Erro ao carregar faturas:', error);
            mostrarAlerta('Erro ao carregar faturas do mês', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    const carregarDadosRelatorio = async () => {
        if (!mesSelecionado || !anoSelecionado) return;

        setCarregando(true);
        try {
            const mesRef = `${mesSelecionado}/${anoSelecionado}`;
            const response = await api.get('/api/microservicos/relatorios/dados', {
                params: { mes_referencia: mesRef }
            });
            if (response.data.sucesso) {
                setDadosRelatorio(response.data.faturas || []);
                setTotaisRelatorio(response.data.totais || null);
                setRelatorioSelecionado({ mes_referencia: mesRef });
            }
        } catch (error) {
            console.error('Erro ao carregar dados do relatório:', error);
            mostrarAlerta('Erro ao carregar dados do relatório', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    const exportarRelatorio = async (mesRef) => {
        try {
            const token = localStorage.getItem('auth_token');
            const baseUrl = process.env.REACT_APP_API_URL || '';
            window.open(`${baseUrl}/api/microservicos/relatorios/exportar?mes_referencia=${mesRef}&token=${token}`, '_blank');
        } catch (error) {
            mostrarAlerta('Erro ao exportar relatório', 'danger');
        }
    };

    const exportarPrimeiraCompensacao = async (mesRef) => {
        try {
            const token = localStorage.getItem('auth_token');
            const baseUrl = process.env.REACT_APP_API_URL || '';
            window.open(`${baseUrl}/api/microservicos/relatorios/primeira-compensacao?mes_referencia=${mesRef}&token=${token}`, '_blank');
        } catch (error) {
            mostrarAlerta('Erro ao exportar relatório de primeira compensação', 'danger');
        }
    };

    const carregarExecucoes = async () => {
        setCarregando(true);
        try {
            const response = await api.get('/api/microservicos/execucoes');
            setExecucoesRecentes(response.data.execucoes || []);
        } catch (error) {
            console.error('Erro ao carregar execuções:', error);
        } finally {
            setCarregando(false);
        }
    };

    const executarBuscaEmail = async () => {
        setBuscaEmAndamento(true);
        try {
            const response = await api.post('/api/microservicos/buscar-emails', {
                data_inicio: dataInicioBusca,
                data_fim: dataFimBusca,
                limite: limiteBusca
            });

            setBuscaStatus(response.data);
            mostrarAlerta(`Busca iniciada! ID: ${response.data.execucao_id}`, 'success');

            // Recarregar execuções após alguns segundos
            setTimeout(carregarExecucoes, 3000);
        } catch (error) {
            console.error('Erro ao executar busca:', error);
            mostrarAlerta('Erro ao executar busca de emails', 'danger');
        } finally {
            setBuscaEmAndamento(false);
        }
    };

    const carregarLogs = async () => {
        setCarregando(true);
        try {
            const response = await api.get('/api/microservicos/logs', {
                params: {
                    nivel: logsFiltro !== 'todos' ? logsFiltro : undefined,
                    servico: logsServico !== 'todos' ? logsServico : undefined
                }
            });
            setLogs(response.data.logs || []);
        } catch (error) {
            console.error('Erro ao carregar logs:', error);
        } finally {
            setCarregando(false);
        }
    };

    const reprocessarJob = async (jobId) => {
        try {
            await api.post(`/api/microservicos/jobs/${jobId}/reprocessar`);
            mostrarAlerta('Job enviado para reprocessamento', 'success');
            carregarJobs();
        } catch (error) {
            mostrarAlerta('Erro ao reprocessar job', 'danger');
        }
    };

    // ==================== GERENCIAR FATURAS ====================

    const carregarFaturasGerenciar = async () => {
        if (!gerenciarMes || !gerenciarAno) return;

        setCarregando(true);
        setFaturasSelecionadas([]);
        setResultadoRecalculo(null);

        try {
            const mesRef = `${gerenciarMes}/${gerenciarAno}`;
            const response = await api.get('/api/microservicos/gerenciar/faturas', {
                params: { mes_referencia: mesRef }
            });
            setFaturasGerenciar(response.data.faturas || []);
        } catch (error) {
            console.error('Erro ao carregar faturas:', error);
            mostrarAlerta('Erro ao carregar faturas', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    // Ver detalhes da fatura no modal (já temos os dados carregados)
    const verDetalhesFatura = (fatura) => {
        setFaturaDetalhes(fatura);
        setModalDetalhes(true);
    };

    // ==================== RENDER FUNCTIONS ====================

    const renderStatusBadge = (status) => {
        const configs = {
            'online': { bg: 'success', icon: CheckCircle, text: 'Online' },
            'offline': { bg: 'danger', icon: XCircle, text: 'Offline' },
            'pendente': { bg: 'warning', icon: Clock, text: 'Pendente' },
            'processando': { bg: 'info', icon: RefreshCw, text: 'Processando' },
            'processado': { bg: 'success', icon: CheckCircle, text: 'Processado' },
            'baixado': { bg: 'info', icon: Download, text: 'Baixado' },
            'concluido': { bg: 'success', icon: CheckCircle, text: 'Concluído' },
            'erro': { bg: 'danger', icon: XCircle, text: 'Erro' },
            'sucesso': { bg: 'success', icon: CheckCircle, text: 'Sucesso' }
        };

        const config = configs[status] || { bg: 'secondary', icon: Clock, text: status };
        const Icon = config.icon;

        return (
            <Badge bg={config.bg} className="d-flex align-items-center gap-1" style={{ width: 'fit-content' }}>
                <Icon size={12} />
                {config.text}
            </Badge>
        );
    };

    const renderDashboard = () => (
        <div>
            {/* Cards de Resumo */}
            <Row className="mb-4">
                <Col md={3}>
                    <Card className="h-100 border-0 shadow-sm">
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <p className="text-muted mb-1">Faturas Hoje</p>
                                    <h3 className="mb-0">{dashboardData?.faturas_hoje || 0}</h3>
                                </div>
                                <div className="bg-primary bg-opacity-10 p-2 rounded">
                                    <FileText size={24} className="text-primary" />
                                </div>
                            </div>
                            <small className="text-success">
                                <TrendingUp size={14} className="me-1" />
                                {dashboardData?.faturas_processadas || 0} processadas
                            </small>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={3}>
                    <Card className="h-100 border-0 shadow-sm">
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <p className="text-muted mb-1">Jobs Pendentes</p>
                                    <h3 className="mb-0">{dashboardData?.jobs_pendentes || 0}</h3>
                                </div>
                                <div className="bg-warning bg-opacity-10 p-2 rounded">
                                    <Clock size={24} className="text-warning" />
                                </div>
                            </div>
                            <small className="text-muted">
                                {dashboardData?.jobs_processando || 0} em processamento
                            </small>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={3}>
                    <Card className="h-100 border-0 shadow-sm">
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <p className="text-muted mb-1">UCs Ativas</p>
                                    <h3 className="mb-0">{dashboardData?.total_ucs || 0}</h3>
                                </div>
                                <div className="bg-success bg-opacity-10 p-2 rounded">
                                    <Users size={24} className="text-success" />
                                </div>
                            </div>
                            <small className="text-danger">
                                <AlertTriangle size={14} className="me-1" />
                                {dashboardData?.ucs_sem_fatura || 0} sem fatura este mês
                            </small>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={3}>
                    <Card className="h-100 border-0 shadow-sm">
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <p className="text-muted mb-1">Alertas</p>
                                    <h3 className="mb-0">{dashboardData?.alertas_pendentes || 0}</h3>
                                </div>
                                <div className="bg-danger bg-opacity-10 p-2 rounded">
                                    <AlertTriangle size={24} className="text-danger" />
                                </div>
                            </div>
                            <small className="text-muted">
                                Duplicatas pendentes de análise
                            </small>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Status dos Serviços */}
            <Row className="mb-4">
                <Col>
                    <Card className="border-0 shadow-sm">
                        <Card.Header className="bg-transparent border-0">
                            <div className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0">
                                    <Server size={20} className="me-2" />
                                    Status dos Serviços
                                </h5>
                                <Button variant="outline-primary" size="sm" onClick={carregarDashboard}>
                                    <RefreshCw size={14} className="me-1" />
                                    Atualizar
                                </Button>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            <Row>
                                {Object.entries(servicosStatus).map(([nome, status]) => (
                                    <Col md={4} lg={2} key={nome} className="mb-3">
                                        <Card className={`text-center h-100 ${status === 'online' ? 'border-success' : 'border-danger'}`}>
                                            <Card.Body className="py-3">
                                                <div className={`mb-2 ${status === 'online' ? 'text-success' : 'text-danger'}`}>
                                                    {status === 'online' ? <CheckCircle size={32} /> : <XCircle size={32} />}
                                                </div>
                                                <h6 className="mb-1 text-capitalize">{nome.replace(/-/g, ' ')}</h6>
                                                {renderStatusBadge(status)}
                                            </Card.Body>
                                        </Card>
                                    </Col>
                                ))}
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Estatísticas do Mês */}
            <Row>
                <Col md={6}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Header className="bg-transparent border-0">
                            <h5 className="mb-0">
                                <BarChart2 size={20} className="me-2" />
                                Estatísticas do Mês
                            </h5>
                        </Card.Header>
                        <Card.Body>
                            <Table borderless size="sm">
                                <tbody>
                                    <tr>
                                        <td>Total de Faturas</td>
                                        <td className="text-end fw-bold">{dashboardData?.estatisticas_mes?.total_faturas || 0}</td>
                                    </tr>
                                    <tr>
                                        <td>Faturas Únicas</td>
                                        <td className="text-end fw-bold">{dashboardData?.estatisticas_mes?.faturas_unicas || 0}</td>
                                    </tr>
                                    <tr>
                                        <td>Duplicatas Detectadas</td>
                                        <td className="text-end fw-bold text-warning">{dashboardData?.estatisticas_mes?.duplicatas || 0}</td>
                                    </tr>
                                    <tr>
                                        <td>Com Erro</td>
                                        <td className="text-end fw-bold text-danger">{dashboardData?.estatisticas_mes?.com_erro || 0}</td>
                                    </tr>
                                    <tr>
                                        <td>Tempo Médio Processamento</td>
                                        <td className="text-end fw-bold">{dashboardData?.estatisticas_mes?.tempo_medio_ms || 0} ms</td>
                                    </tr>
                                </tbody>
                            </Table>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={6}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Header className="bg-transparent border-0">
                            <h5 className="mb-0">
                                <Activity size={20} className="me-2" />
                                Últimas Execuções
                            </h5>
                        </Card.Header>
                        <Card.Body>
                            {dashboardData?.ultimas_execucoes?.length > 0 ? (
                                <Table borderless size="sm">
                                    <tbody>
                                        {dashboardData.ultimas_execucoes.slice(0, 5).map((exec, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <small className="text-muted">
                                                        {new Date(exec.data_execucao).toLocaleString('pt-BR')}
                                                    </small>
                                                </td>
                                                <td>{renderStatusBadge(exec.status)}</td>
                                                <td className="text-end">
                                                    <small>{exec.total_pdfs_baixados} PDFs</small>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            ) : (
                                <p className="text-muted text-center mb-0">Nenhuma execução recente</p>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </div>
    );

    const renderJobs = () => (
        <div>
            <Row className="mb-4">
                <Col>
                    <Card className="border-0 shadow-sm">
                        <Card.Header className="bg-transparent border-0">
                            <div className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0">
                                    <Activity size={20} className="me-2" />
                                    Fila de Jobs
                                </h5>
                                <div className="d-flex gap-2">
                                    <Form.Select
                                        size="sm"
                                        style={{ width: '150px' }}
                                        value={jobsFiltro}
                                        onChange={(e) => { setJobsFiltro(e.target.value); setJobsPagina(1); }}
                                    >
                                        <option value="todos">Todos</option>
                                        <option value="pendente">Pendentes</option>
                                        <option value="processando">Processando</option>
                                        <option value="concluido">Concluídos</option>
                                        <option value="erro">Com Erro</option>
                                    </Form.Select>
                                    <Button variant="outline-primary" size="sm" onClick={carregarJobs}>
                                        <RefreshCw size={14} />
                                    </Button>
                                </div>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            {carregando ? (
                                <div className="text-center py-4">
                                    <Spinner animation="border" variant="primary" />
                                </div>
                            ) : jobs.length === 0 ? (
                                <div className="text-center py-4 text-muted">
                                    <Activity size={48} className="mb-2 opacity-50" />
                                    <p>Nenhum job encontrado</p>
                                </div>
                            ) : (
                                <Table hover responsive>
                                    <thead>
                                        <tr>
                                            <th>Job ID</th>
                                            <th>Tipo</th>
                                            <th>Status</th>
                                            <th>Criado em</th>
                                            <th>Tempo</th>
                                            <th>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {jobs.map((job) => (
                                            <tr key={job.job_id}>
                                                <td>
                                                    <code className="small">{job.job_id.substring(0, 8)}...</code>
                                                </td>
                                                <td>{job.tipo_job}</td>
                                                <td>{renderStatusBadge(job.status)}</td>
                                                <td>
                                                    <small>{new Date(job.criado_em).toLocaleString('pt-BR')}</small>
                                                </td>
                                                <td>
                                                    {job.tempo_execucao_ms ? `${job.tempo_execucao_ms} ms` : '-'}
                                                </td>
                                                <td>
                                                    <div className="d-flex gap-1">
                                                        {job.status === 'erro' && (
                                                            <Button
                                                                variant="outline-warning"
                                                                size="sm"
                                                                onClick={() => reprocessarJob(job.job_id)}
                                                                title="Reprocessar"
                                                            >
                                                                <RotateCcw size={14} />
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="outline-info"
                                                            size="sm"
                                                            title="Ver detalhes"
                                                        >
                                                            <Eye size={14} />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </div>
    );

    const renderRelatorios = () => (
        <div>
            {/* Seleção de Mês */}
            <Row className="mb-4">
                <Col md={8}>
                    <Card className="border-0 shadow-sm">
                        <Card.Header className="bg-transparent border-0">
                            <h5 className="mb-0">
                                <FileSpreadsheet size={20} className="me-2" />
                                Relatório Detalhado por Mês
                            </h5>
                        </Card.Header>
                        <Card.Body>
                            <Row className="align-items-end">
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label>Mês</Form.Label>
                                        <Form.Select
                                            value={mesSelecionado}
                                            onChange={(e) => setMesSelecionado(e.target.value)}
                                        >
                                            <option value="">Selecione...</option>
                                            {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label>Ano</Form.Label>
                                        <Form.Select
                                            value={anoSelecionado}
                                            onChange={(e) => setAnoSelecionado(e.target.value)}
                                        >
                                            <option value="2024">2024</option>
                                            <option value="2025">2025</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={3}>
                                    <Button
                                        variant="primary"
                                        onClick={carregarDadosRelatorio}
                                        disabled={!mesSelecionado || carregando}
                                    >
                                        {carregando ? <Spinner size="sm" /> : <Eye size={16} className="me-1" />}
                                        Carregar
                                    </Button>
                                </Col>
                                <Col md={6}>
                                    <div className="d-flex gap-2">
                                        <Button
                                            variant="success"
                                            onClick={() => exportarRelatorio(`${mesSelecionado}/${anoSelecionado}`)}
                                            disabled={!mesSelecionado}
                                        >
                                            <FileSpreadsheet size={16} className="me-1" />
                                            Excel
                                        </Button>
                                        <Button
                                            variant="info"
                                            onClick={() => exportarPrimeiraCompensacao(`${mesSelecionado}/${anoSelecionado}`)}
                                            disabled={!mesSelecionado}
                                            title="Exportar UCs que tiveram primeira compensação neste mês"
                                        >
                                            <TrendingUp size={16} className="me-1" />
                                            1ª Compensação
                                        </Button>
                                    </div>
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={4}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Header className="bg-transparent border-0">
                            <h5 className="mb-0">
                                <Calendar size={20} className="me-2" />
                                Meses Disponíveis
                            </h5>
                        </Card.Header>
                        <Card.Body className="py-2">
                            <div className="d-flex flex-wrap gap-1">
                                {relatorios.map((rel, idx) => (
                                    <Badge
                                        key={idx}
                                        bg={`${mesSelecionado}/${anoSelecionado}` === rel.mes_referencia ? 'primary' : 'light'}
                                        text={`${mesSelecionado}/${anoSelecionado}` === rel.mes_referencia ? 'white' : 'dark'}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => {
                                            const [m, a] = rel.mes_referencia.split('/');
                                            setMesSelecionado(m);
                                            setAnoSelecionado(a);
                                        }}
                                    >
                                        {rel.mes_referencia} ({rel.total_faturas})
                                    </Badge>
                                ))}
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Totais - Cards de Resumo */}
            {totaisRelatorio && (
                <Row className="mb-4">
                    <Col md={2}>
                        <Card className="h-100 border-0 shadow-sm text-center">
                            <Card.Body className="py-3">
                                <h3 className="mb-0 text-primary">{totaisRelatorio.total_faturas}</h3>
                                <small className="text-muted">Total Faturas</small>
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={2}>
                        <Card className="h-100 border-0 shadow-sm text-center">
                            <Card.Body className="py-3">
                                <h3 className="mb-0 text-success">{totaisRelatorio.com_boleto}</h3>
                                <small className="text-muted">Com Boleto</small>
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={2}>
                        <Card className="h-100 border-0 shadow-sm text-center">
                            <Card.Body className="py-3">
                                <h3 className="mb-0 text-warning">{totaisRelatorio.sem_boleto}</h3>
                                <small className="text-muted">Sem Boleto</small>
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={2}>
                        <Card className="h-100 border-0 shadow-sm text-center">
                            <Card.Body className="py-3">
                                <h5 className="mb-0 text-info">R$ {totaisRelatorio.valor_total_concessionaria?.toFixed(2)}</h5>
                                <small className="text-muted">Valor Conc.</small>
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={2}>
                        <Card className="h-100 border-0 shadow-sm text-center">
                            <Card.Body className="py-3">
                                <h5 className="mb-0 text-primary">R$ {totaisRelatorio.valor_total_aupus?.toFixed(2)}</h5>
                                <small className="text-muted">Valor AUPUS</small>
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={2}>
                        <Card className="h-100 border-0 shadow-sm text-center bg-success bg-opacity-10">
                            <Card.Body className="py-3">
                                <h5 className="mb-0 text-success">R$ {totaisRelatorio.economia_total?.toFixed(2)}</h5>
                                <small className="text-muted">Economia Total</small>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Tabela de Dados Detalhados */}
            {dadosRelatorio && dadosRelatorio.length > 0 && (
                <Row>
                    <Col>
                        <Card className="border-0 shadow-sm">
                            <Card.Header className="bg-transparent border-0">
                                <div className="d-flex justify-content-between align-items-center">
                                    <h5 className="mb-0">
                                        <BarChart2 size={20} className="me-2" />
                                        Dados do Mês {relatorioSelecionado?.mes_referencia}
                                    </h5>
                                    <Badge bg="secondary">{dadosRelatorio.length} registros</Badge>
                                </div>
                            </Card.Header>
                            <Card.Body>
                                <div style={{ maxHeight: '500px', overflow: 'auto' }}>
                                    <Table striped hover size="sm" className="table-responsive">
                                        <thead className="table-dark" style={{ position: 'sticky', top: 0 }}>
                                            <tr>
                                                <th>UC</th>
                                                <th>Cliente</th>
                                                <th>Categoria</th>
                                                <th className="text-end">Consumo (kWh)</th>
                                                <th className="text-end">Compensado</th>
                                                <th className="text-end">Injetada</th>
                                                <th className="text-end">Valor Conc.</th>
                                                <th className="text-end">Valor AUPUS</th>
                                                <th className="text-end">Economia</th>
                                                <th className="text-center">Desc.</th>
                                                <th className="text-center">Boleto</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dadosRelatorio.map((fatura, idx) => (
                                                <tr key={idx}>
                                                    <td><code className="small">{fatura.uc}</code></td>
                                                    <td className="text-truncate" style={{ maxWidth: '150px' }} title={fatura.nome_cliente}>
                                                        {fatura.nome_cliente || <span className="text-muted">-</span>}
                                                    </td>
                                                    <td>
                                                        <small className="text-muted">{fatura.categoria || '-'}</small>
                                                    </td>
                                                    <td className="text-end">{(fatura.consumo || 0).toFixed(0)}</td>
                                                    <td className="text-end">{(fatura.consumo_compensado || 0).toFixed(0)}</td>
                                                    <td className="text-end">{(fatura.energia_injetada || 0).toFixed(0)}</td>
                                                    <td className="text-end">R$ {(fatura.valor_concessionaria || 0).toFixed(2)}</td>
                                                    <td className="text-end fw-bold text-primary">R$ {(fatura.valor_aupus || 0).toFixed(2)}</td>
                                                    <td className="text-end text-success fw-bold">R$ {(fatura.economia || 0).toFixed(2)}</td>
                                                    <td className="text-center">
                                                        <small>{((fatura.desconto_fatura || 0) * 100).toFixed(0)}%</small>
                                                    </td>
                                                    <td className="text-center">
                                                        {fatura.numero_boleto ? (
                                                            <Badge bg="success" title={fatura.numero_boleto}>
                                                                <CheckCircle size={12} />
                                                            </Badge>
                                                        ) : (
                                                            <Badge bg="warning" text="dark">
                                                                <Clock size={12} />
                                                            </Badge>
                                                        )}
                                                    </td>
                                                    <td>{renderStatusBadge(fatura.status)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Mensagem inicial */}
            {!dadosRelatorio && (
                <Row>
                    <Col>
                        <Card className="border-0 shadow-sm">
                            <Card.Body className="text-center py-5">
                                <FileSpreadsheet size={48} className="text-muted mb-3" />
                                <h5 className="text-muted">Selecione um mês e clique em "Carregar"</h5>
                                <p className="text-muted">Os dados do relatório serão exibidos aqui</p>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Modal de Visualização Simples (mantido para compatibilidade) */}
            <Modal show={modalRelatorio} onHide={() => setModalRelatorio(false)} size="xl" centered>
                <Modal.Header closeButton>
                    <Modal.Title>
                        Faturas - {relatorioSelecionado?.mes_referencia}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ maxHeight: '70vh', overflow: 'auto' }}>
                    {faturasMes.length === 0 ? (
                        <p className="text-center text-muted">Nenhuma fatura encontrada</p>
                    ) : (
                        <Table striped hover size="sm">
                            <thead>
                                <tr>
                                    <th>UC</th>
                                    <th>Cliente</th>
                                    <th>Consumo</th>
                                    <th>Valor Conc.</th>
                                    <th>Valor AUPUS</th>
                                    <th>Economia</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {faturasMes.map((fatura, idx) => (
                                    <tr key={idx}>
                                        <td><code>{fatura.uc}</code></td>
                                        <td>{fatura.nome_cliente || '-'}</td>
                                        <td>{fatura.consumo || 0} kWh</td>
                                        <td>R$ {(fatura.valor_concessionaria || 0).toFixed(2)}</td>
                                        <td>R$ {(fatura.valor_aupus || 0).toFixed(2)}</td>
                                        <td className="text-success">
                                            R$ {(fatura.economia || 0).toFixed(2)}
                                        </td>
                                        <td>{renderStatusBadge(fatura.status)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setModalRelatorio(false)}>
                        Fechar
                    </Button>
                    <Button
                        variant="success"
                        onClick={() => exportarRelatorio(relatorioSelecionado?.mes_referencia)}
                    >
                        <Download size={16} className="me-1" />
                        Exportar Excel
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );

    const renderBuscaEmail = () => (
        <div>
            <Row className="mb-4">
                <Col md={6}>
                    <Card className="border-0 shadow-sm">
                        <Card.Header className="bg-transparent border-0">
                            <h5 className="mb-0">
                                <Mail size={20} className="me-2" />
                                Buscar Novas Faturas
                            </h5>
                        </Card.Header>
                        <Card.Body>
                            <Form>
                                <Row className="mb-3">
                                    <Col md={6}>
                                        <Form.Group>
                                            <Form.Label>Data Início</Form.Label>
                                            <Form.Control
                                                type="date"
                                                value={dataInicioBusca}
                                                onChange={(e) => setDataInicioBusca(e.target.value)}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={6}>
                                        <Form.Group>
                                            <Form.Label>Data Fim</Form.Label>
                                            <Form.Control
                                                type="date"
                                                value={dataFimBusca}
                                                onChange={(e) => setDataFimBusca(e.target.value)}
                                            />
                                        </Form.Group>
                                    </Col>
                                </Row>
                                <Row className="mb-3">
                                    <Col md={6}>
                                        <Form.Group>
                                            <Form.Label>Limite de Emails</Form.Label>
                                            <Form.Control
                                                type="number"
                                                value={limiteBusca}
                                                onChange={(e) => setLimiteBusca(parseInt(e.target.value))}
                                                min={1}
                                                max={200}
                                            />
                                        </Form.Group>
                                    </Col>
                                </Row>
                                <Button
                                    variant="primary"
                                    onClick={executarBuscaEmail}
                                    disabled={buscaEmAndamento}
                                >
                                    {buscaEmAndamento ? (
                                        <>
                                            <Spinner size="sm" className="me-1" />
                                            Buscando...
                                        </>
                                    ) : (
                                        <>
                                            <Play size={16} className="me-1" />
                                            Executar Busca
                                        </>
                                    )}
                                </Button>
                            </Form>

                            {buscaStatus && (
                                <div className="mt-4 p-3 bg-light rounded">
                                    <h6>Resultado da Busca</h6>
                                    <Table size="sm" borderless>
                                        <tbody>
                                            <tr>
                                                <td>Emails Verificados:</td>
                                                <td className="fw-bold">{buscaStatus.estatisticas?.emails_verificados || 0}</td>
                                            </tr>
                                            <tr>
                                                <td>PDFs Baixados:</td>
                                                <td className="fw-bold text-success">{buscaStatus.estatisticas?.pdfs_baixados || 0}</td>
                                            </tr>
                                            <tr>
                                                <td>Duplicatas:</td>
                                                <td className="fw-bold text-warning">{buscaStatus.estatisticas?.duplicatas_detectadas || 0}</td>
                                            </tr>
                                            <tr>
                                                <td>Erros:</td>
                                                <td className="fw-bold text-danger">{buscaStatus.estatisticas?.erros || 0}</td>
                                            </tr>
                                        </tbody>
                                    </Table>
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={6}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Header className="bg-transparent border-0">
                            <div className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0">
                                    <Clock size={20} className="me-2" />
                                    Execuções Recentes
                                </h5>
                                <Button variant="outline-primary" size="sm" onClick={carregarExecucoes}>
                                    <RefreshCw size={14} />
                                </Button>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            {execucoesRecentes.length === 0 ? (
                                <p className="text-muted text-center">Nenhuma execução recente</p>
                            ) : (
                                <Table hover size="sm">
                                    <thead>
                                        <tr>
                                            <th>Data</th>
                                            <th>Tipo</th>
                                            <th>PDFs</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {execucoesRecentes.map((exec, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <small>{new Date(exec.data_execucao).toLocaleString('pt-BR')}</small>
                                                </td>
                                                <td><small>{exec.tipo_execucao}</small></td>
                                                <td>{exec.total_pdfs_baixados}</td>
                                                <td>{renderStatusBadge(exec.status)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </div>
    );

    const renderLogs = () => (
        <div>
            <Row className="mb-4">
                <Col>
                    <Card className="border-0 shadow-sm">
                        <Card.Header className="bg-transparent border-0">
                            <div className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0">
                                    <FileText size={20} className="me-2" />
                                    Logs do Sistema
                                </h5>
                                <div className="d-flex gap-2">
                                    <Form.Select
                                        size="sm"
                                        style={{ width: '130px' }}
                                        value={logsFiltro}
                                        onChange={(e) => setLogsFiltro(e.target.value)}
                                    >
                                        <option value="todos">Todos</option>
                                        <option value="info">Info</option>
                                        <option value="warning">Warning</option>
                                        <option value="error">Error</option>
                                    </Form.Select>
                                    <Form.Select
                                        size="sm"
                                        style={{ width: '150px' }}
                                        value={logsServico}
                                        onChange={(e) => setLogsServico(e.target.value)}
                                    >
                                        <option value="todos">Todos Serviços</option>
                                        <option value="orquestrador">Orquestrador</option>
                                        <option value="leitor-pdf">Leitor PDF</option>
                                        <option value="calculadora">Calculadora</option>
                                        <option value="buscador">Buscador Email</option>
                                    </Form.Select>
                                    <Button variant="outline-primary" size="sm" onClick={carregarLogs}>
                                        <RefreshCw size={14} />
                                    </Button>
                                </div>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            {carregando ? (
                                <div className="text-center py-4">
                                    <Spinner animation="border" variant="primary" />
                                </div>
                            ) : logs.length === 0 ? (
                                <div className="text-center py-4 text-muted">
                                    <FileText size={48} className="mb-2 opacity-50" />
                                    <p>Nenhum log encontrado</p>
                                </div>
                            ) : (
                                <div style={{ maxHeight: '500px', overflow: 'auto' }}>
                                    <Table hover size="sm" className="font-monospace small">
                                        <thead>
                                            <tr>
                                                <th style={{ width: '160px' }}>Data/Hora</th>
                                                <th style={{ width: '80px' }}>Nível</th>
                                                <th style={{ width: '120px' }}>Serviço</th>
                                                <th>Mensagem</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {logs.map((log, idx) => (
                                                <tr key={idx}>
                                                    <td className="text-muted">
                                                        {new Date(log.timestamp).toLocaleString('pt-BR')}
                                                    </td>
                                                    <td>
                                                        <Badge bg={
                                                            log.nivel === 'error' ? 'danger' :
                                                            log.nivel === 'warning' ? 'warning' :
                                                            'info'
                                                        }>
                                                            {log.nivel}
                                                        </Badge>
                                                    </td>
                                                    <td>{log.servico}</td>
                                                    <td className="text-truncate" style={{ maxWidth: '500px' }}>
                                                        {log.mensagem}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
        </div>
    );

    // Filtros para Gerenciar
    const [filtroStatus, setFiltroStatus] = useState('todos');
    const [filtroCategoria, setFiltroCategoria] = useState('todos');
    const [filtroBoleto, setFiltroBoleto] = useState('todos');

    // Faturas filtradas
    const faturasFiltradas = faturasGerenciar.filter(f => {
        if (filtroStatus !== 'todos' && f.status !== filtroStatus) return false;
        if (filtroCategoria !== 'todos' && f.categoria !== filtroCategoria) return false;
        if (filtroBoleto === 'gerado' && !f.boleto_gerado) return false;
        if (filtroBoleto === 'pendente' && f.boleto_gerado) return false;
        return true;
    });

    // Categorias únicas das faturas
    const categoriasUnicas = [...new Set(faturasGerenciar.map(f => f.categoria).filter(Boolean))];

    // Recalcular fatura individual (do modal)
    const recalcularFaturaIndividual = async (faturaId) => {
        setRecalculando(true);
        try {
            const response = await api.post('/api/microservicos/gerenciar/recalcular', {
                fatura_ids: [faturaId]
            });

            if (response.data.sucesso) {
                mostrarAlerta('success', `Recálculo concluído: ${response.data.atualizadas} atualizada(s)`);
                setResultadoRecalculo(response.data);
                // Recarregar faturas
                carregarFaturasGerenciar();
                setModalDetalhes(false);
            } else {
                mostrarAlerta('warning', 'Nenhuma fatura foi atualizada');
            }
        } catch (error) {
            console.error('Erro ao recalcular:', error);
            mostrarAlerta('danger', 'Erro ao recalcular fatura');
        } finally {
            setRecalculando(false);
        }
    };

    const renderGerenciar = () => (
        <div>
            {/* Seleção de Mês */}
            <Row className="mb-4">
                <Col md={8}>
                    <Card className="border-0 shadow-sm">
                        <Card.Header className="bg-transparent border-0">
                            <h5 className="mb-0">
                                <Settings size={20} className="me-2" />
                                Gerenciar Faturas
                            </h5>
                        </Card.Header>
                        <Card.Body>
                            <p className="text-muted mb-3">
                                Visualize e gerencie faturas. Clique no <Eye size={14} className="mx-1" /> para ver detalhes e recalcular.
                            </p>
                            <Row className="align-items-end">
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label>Mês</Form.Label>
                                        <Form.Select
                                            value={gerenciarMes}
                                            onChange={(e) => setGerenciarMes(e.target.value)}
                                        >
                                            <option value="">Selecione...</option>
                                            {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label>Ano</Form.Label>
                                        <Form.Select
                                            value={gerenciarAno}
                                            onChange={(e) => setGerenciarAno(e.target.value)}
                                        >
                                            <option value="2024">2024</option>
                                            <option value="2025">2025</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={3}>
                                    <Button
                                        variant="primary"
                                        onClick={carregarFaturasGerenciar}
                                        disabled={!gerenciarMes || carregando}
                                    >
                                        {carregando ? <Spinner size="sm" /> : <Search size={16} className="me-1" />}
                                        Carregar
                                    </Button>
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={4}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Body className="d-flex flex-column justify-content-center">
                            <div className="text-center">
                                <h6 className="text-muted mb-2">Resumo</h6>
                                <div className="d-flex justify-content-around">
                                    <div>
                                        <h3 className="mb-0 text-primary">{faturasGerenciar.length}</h3>
                                        <small className="text-muted">Total</small>
                                    </div>
                                    <div>
                                        <h3 className="mb-0 text-success">{faturasGerenciar.filter(f => !f.boleto_gerado).length}</h3>
                                        <small className="text-muted">Sem Boleto</small>
                                    </div>
                                    <div>
                                        <h3 className="mb-0 text-danger">{faturasGerenciar.filter(f => f.boleto_gerado).length}</h3>
                                        <small className="text-muted">Com Boleto</small>
                                    </div>
                                </div>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Resultado do Recálculo */}
            {resultadoRecalculo && (
                <Row className="mb-4">
                    <Col>
                        <Card className={`border-0 shadow-sm ${resultadoRecalculo.erros > 0 ? 'border-warning' : 'border-success'}`}>
                            <Card.Body>
                                <div className="d-flex justify-content-between align-items-center">
                                    <h6 className="mb-0">
                                        <Check size={18} className="me-2 text-success" />
                                        Último Recálculo
                                    </h6>
                                    <Button variant="link" size="sm" onClick={() => setResultadoRecalculo(null)}>
                                        <XCircle size={16} />
                                    </Button>
                                </div>
                                <Row className="mt-2">
                                    <Col md={3}>
                                        <div className="text-center p-2 bg-light rounded">
                                            <h5 className="mb-0">{resultadoRecalculo.total_processadas}</h5>
                                            <small>Processadas</small>
                                        </div>
                                    </Col>
                                    <Col md={3}>
                                        <div className="text-center p-2 bg-success bg-opacity-10 rounded">
                                            <h5 className="mb-0 text-success">{resultadoRecalculo.atualizadas}</h5>
                                            <small>Atualizadas</small>
                                        </div>
                                    </Col>
                                    <Col md={3}>
                                        <div className="text-center p-2 bg-warning bg-opacity-10 rounded">
                                            <h5 className="mb-0 text-warning">{resultadoRecalculo.bloqueadas}</h5>
                                            <small>Bloqueadas</small>
                                        </div>
                                    </Col>
                                    <Col md={3}>
                                        <div className="text-center p-2 bg-danger bg-opacity-10 rounded">
                                            <h5 className="mb-0 text-danger">{resultadoRecalculo.erros}</h5>
                                            <small>Erros</small>
                                        </div>
                                    </Col>
                                </Row>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Lista de Faturas */}
            {faturasGerenciar.length > 0 && (
                <Row>
                    <Col>
                        <Card className="border-0 shadow-sm">
                            <Card.Header className="bg-transparent border-0">
                                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                                    <h5 className="mb-0">
                                        Faturas de {gerenciarMes}/{gerenciarAno}
                                        <Badge bg="secondary" className="ms-2">{faturasFiltradas.length}</Badge>
                                    </h5>
                                    {/* Filtros */}
                                    <div className="d-flex gap-2 flex-wrap">
                                        <Form.Select
                                            size="sm"
                                            style={{ width: '140px' }}
                                            value={filtroStatus}
                                            onChange={(e) => setFiltroStatus(e.target.value)}
                                        >
                                            <option value="todos">Status: Todos</option>
                                            <option value="processado">Processado</option>
                                            <option value="pendente">Pendente</option>
                                            <option value="baixado">Baixado</option>
                                            <option value="erro">Erro</option>
                                        </Form.Select>
                                        <Form.Select
                                            size="sm"
                                            style={{ width: '200px' }}
                                            value={filtroCategoria}
                                            onChange={(e) => setFiltroCategoria(e.target.value)}
                                        >
                                            <option value="todos">Categoria: Todas</option>
                                            {categoriasUnicas.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </Form.Select>
                                        <Form.Select
                                            size="sm"
                                            style={{ width: '150px' }}
                                            value={filtroBoleto}
                                            onChange={(e) => setFiltroBoleto(e.target.value)}
                                        >
                                            <option value="todos">Boleto: Todos</option>
                                            <option value="gerado">Com Boleto</option>
                                            <option value="pendente">Sem Boleto</option>
                                        </Form.Select>
                                    </div>
                                </div>
                            </Card.Header>
                            <Card.Body>
                                <div style={{ maxHeight: '500px', overflow: 'auto', position: 'relative', zIndex: 1 }}>
                                    <Table hover size="sm">
                                        <thead className="table-dark" style={{ position: 'sticky', top: 0 }}>
                                            <tr>
                                                <th>UC</th>
                                                <th>Nome Cliente</th>
                                                <th>CPF/CNPJ</th>
                                                <th>Status</th>
                                                <th>Boleto</th>
                                                <th style={{ width: '60px' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {faturasFiltradas.map((fatura) => (
                                                <tr
                                                    key={fatura.id}
                                                    className={fatura.boleto_gerado ? 'table-light' : ''}
                                                >
                                                    <td><code className="small">{fatura.uc}</code></td>
                                                    <td className="text-truncate" style={{ maxWidth: '200px' }}>
                                                        {fatura.nome_cliente || <span className="text-muted">-</span>}
                                                    </td>
                                                    <td className="small">
                                                        {fatura.cpf_cnpj || <span className="text-muted">-</span>}
                                                    </td>
                                                    <td>{renderStatusBadge(fatura.status)}</td>
                                                    <td>
                                                        {fatura.boleto_gerado ? (
                                                            <Badge bg="danger" className="d-flex align-items-center gap-1" style={{ width: 'fit-content' }}>
                                                                <Lock size={10} />
                                                                Gerado
                                                            </Badge>
                                                        ) : (
                                                            <Badge bg="success" className="d-flex align-items-center gap-1" style={{ width: 'fit-content' }}>
                                                                <Unlock size={10} />
                                                                Pendente
                                                            </Badge>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <Button
                                                            variant="outline-info"
                                                            size="sm"
                                                            onClick={() => verDetalhesFatura(fatura)}
                                                            title="Ver detalhes"
                                                        >
                                                            <Eye size={14} />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </div>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Modal de Detalhes Completo */}
            <Modal show={modalDetalhes} onHide={() => setModalDetalhes(false)} size="lg" centered>
                <Modal.Header closeButton className="bg-primary text-white">
                    <Modal.Title>
                        <Eye size={20} className="me-2" />
                        Detalhes da Fatura - UC {faturaDetalhes?.uc}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {faturaDetalhes && (
                        <div>
                            {/* Info Geral + Status */}
                            <Row className="mb-4">
                                <Col md={6}>
                                    <Card className="h-100">
                                        <Card.Header className="bg-primary text-white py-2">
                                            <small className="fw-bold">Informações Gerais</small>
                                        </Card.Header>
                                        <Card.Body className="py-2">
                                            <Table size="sm" borderless className="mb-0">
                                                <tbody>
                                                    <tr><td className="text-muted" style={{width:'40%'}}>UC:</td><td><strong>{faturaDetalhes.uc}</strong></td></tr>
                                                    <tr><td className="text-muted">Mês Referência:</td><td>{faturaDetalhes.mes_referencia}</td></tr>
                                                    <tr><td className="text-muted">Status:</td><td>{renderStatusBadge(faturaDetalhes.status)}</td></tr>
                                                    <tr><td className="text-muted">Categoria:</td><td><Badge bg="info">{faturaDetalhes.categoria || 'N/A'}</Badge></td></tr>
                                                </tbody>
                                            </Table>
                                        </Card.Body>
                                    </Card>
                                </Col>
                                <Col md={6}>
                                    <Card className="h-100">
                                        <Card.Header className={`py-2 ${faturaDetalhes.boleto_gerado ? 'bg-danger' : 'bg-success'} text-white`}>
                                            <small className="fw-bold">Status do Boleto</small>
                                        </Card.Header>
                                        <Card.Body className="py-2">
                                            <Table size="sm" borderless className="mb-0">
                                                <tbody>
                                                    <tr>
                                                        <td className="text-muted" style={{width:'40%'}}>Status:</td>
                                                        <td>
                                                            {faturaDetalhes.boleto_gerado ? (
                                                                <Badge bg="danger"><Lock size={12} className="me-1" />Boleto Gerado</Badge>
                                                            ) : (
                                                                <Badge bg="success"><Unlock size={12} className="me-1" />Pendente</Badge>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {faturaDetalhes.numero_boleto && (
                                                        <tr><td className="text-muted">Número:</td><td><code>{faturaDetalhes.numero_boleto}</code></td></tr>
                                                    )}
                                                    <tr>
                                                        <td className="text-muted">Pode Recalcular:</td>
                                                        <td>{faturaDetalhes.pode_recalcular ? <CheckCircle size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />}</td>
                                                    </tr>
                                                </tbody>
                                            </Table>
                                        </Card.Body>
                                    </Card>
                                </Col>
                            </Row>

                            {/* Dados do Cliente (CRM) */}
                            <Row className="mb-4">
                                <Col>
                                    <Card>
                                        <Card.Header className="bg-info text-white py-2">
                                            <small className="fw-bold">Dados do Cliente (CRM)</small>
                                        </Card.Header>
                                        <Card.Body className="py-2">
                                            <Row>
                                                <Col md={6}>
                                                    <Table size="sm" borderless className="mb-0">
                                                        <tbody>
                                                            <tr><td className="text-muted" style={{width:'40%'}}>Nome:</td><td><strong>{faturaDetalhes.nome_cliente || '-'}</strong></td></tr>
                                                            <tr><td className="text-muted">CPF/CNPJ:</td><td>{faturaDetalhes.cpf_cnpj || '-'}</td></tr>
                                                        </tbody>
                                                    </Table>
                                                </Col>
                                                <Col md={6}>
                                                    <Table size="sm" borderless className="mb-0">
                                                        <tbody>
                                                            <tr><td className="text-muted" style={{width:'40%'}}>Desconto Fatura:</td><td>{faturaDetalhes.desconto_fatura_crm || '-'}</td></tr>
                                                            <tr><td className="text-muted">Desconto Bandeira:</td><td>{faturaDetalhes.desconto_bandeira_crm || '-'}</td></tr>
                                                        </tbody>
                                                    </Table>
                                                </Col>
                                            </Row>
                                        </Card.Body>
                                    </Card>
                                </Col>
                            </Row>

                            {/* Dados Lidos do PDF */}
                            <Row className="mb-4">
                                <Col>
                                    <Card>
                                        <Card.Header className="bg-secondary text-white py-2">
                                            <small className="fw-bold">Dados Lidos do PDF</small>
                                        </Card.Header>
                                        <Card.Body className="py-2">
                                            <Row>
                                                <Col md={4}>
                                                    <Table size="sm" borderless className="mb-0">
                                                        <tbody>
                                                            <tr><td className="text-muted">Consumo:</td><td><strong>{faturaDetalhes.dados_leitura?.consumo || '-'} kWh</strong></td></tr>
                                                            <tr><td className="text-muted">Valor Conc.:</td><td>R$ {faturaDetalhes.dados_leitura?.valor_concessionaria ? parseFloat(faturaDetalhes.dados_leitura.valor_concessionaria).toFixed(2) : '-'}</td></tr>
                                                        </tbody>
                                                    </Table>
                                                </Col>
                                                <Col md={4}>
                                                    <Table size="sm" borderless className="mb-0">
                                                        <tbody>
                                                            <tr><td className="text-muted">Energia Injetada:</td><td>{faturaDetalhes.dados_leitura?.energia_injetada || '-'} kWh</td></tr>
                                                            <tr><td className="text-muted">Energia Compensada:</td><td>{faturaDetalhes.dados_leitura?.energia_compensado || '-'} kWh</td></tr>
                                                        </tbody>
                                                    </Table>
                                                </Col>
                                                <Col md={4}>
                                                    <Table size="sm" borderless className="mb-0">
                                                        <tbody>
                                                            <tr><td className="text-muted">Saldo Anterior:</td><td>{faturaDetalhes.dados_leitura?.saldo_anterior || '-'} kWh</td></tr>
                                                            <tr><td className="text-muted">Saldo Atual:</td><td>{faturaDetalhes.dados_leitura?.saldo_atual || '-'} kWh</td></tr>
                                                        </tbody>
                                                    </Table>
                                                </Col>
                                            </Row>
                                        </Card.Body>
                                    </Card>
                                </Col>
                            </Row>

                            {/* Valores Calculados */}
                            {faturaDetalhes.dados_calculados?.valores_calculados && (
                                <Row className="mb-4">
                                    <Col>
                                        <Card>
                                            <Card.Header className="bg-warning py-2">
                                                <small className="fw-bold">Valores Calculados</small>
                                            </Card.Header>
                                            <Card.Body className="py-2">
                                                <Row>
                                                    <Col md={3}>
                                                        <div className="text-center p-2 bg-primary bg-opacity-10 rounded">
                                                            <small className="text-muted d-block">Valor AUPUS</small>
                                                            <h5 className="mb-0 text-primary">
                                                                R$ {faturaDetalhes.dados_calculados.valores_calculados.valor_aupus ? parseFloat(faturaDetalhes.dados_calculados.valores_calculados.valor_aupus).toFixed(2) : '-'}
                                                            </h5>
                                                        </div>
                                                    </Col>
                                                    <Col md={3}>
                                                        <div className="text-center p-2 bg-success bg-opacity-10 rounded">
                                                            <small className="text-muted d-block">Economia</small>
                                                            <h5 className="mb-0 text-success">
                                                                R$ {faturaDetalhes.dados_calculados.valores_calculados.valor_economia ? parseFloat(faturaDetalhes.dados_calculados.valores_calculados.valor_economia).toFixed(2) : '-'}
                                                            </h5>
                                                        </div>
                                                    </Col>
                                                    <Col md={3}>
                                                        <div className="text-center p-2 bg-light rounded">
                                                            <small className="text-muted d-block">Desc. Fatura</small>
                                                            <h5 className="mb-0">
                                                                {(parseFloat(faturaDetalhes.dados_calculados.descontos_aplicados?.desconto_fatura_percentual || 0) * 100).toFixed(0)}%
                                                            </h5>
                                                        </div>
                                                    </Col>
                                                    <Col md={3}>
                                                        <div className="text-center p-2 bg-light rounded">
                                                            <small className="text-muted d-block">Desc. Bandeira</small>
                                                            <h5 className="mb-0">
                                                                {(parseFloat(faturaDetalhes.dados_calculados.descontos_aplicados?.desconto_bandeira_percentual || 0) * 100).toFixed(0)}%
                                                            </h5>
                                                        </div>
                                                    </Col>
                                                </Row>
                                            </Card.Body>
                                        </Card>
                                    </Col>
                                </Row>
                            )}
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setModalDetalhes(false)}>
                        Fechar
                    </Button>
                    {faturaDetalhes?.pode_recalcular ? (
                        <Button
                            variant="warning"
                            onClick={() => recalcularFaturaIndividual(faturaDetalhes.id)}
                            disabled={recalculando}
                        >
                            {recalculando ? <Spinner size="sm" className="me-1" /> : <RotateCcw size={16} className="me-1" />}
                            Recalcular Esta Fatura
                        </Button>
                    ) : (
                        <Button variant="secondary" disabled>
                            <Lock size={16} className="me-1" />
                            Recálculo Bloqueado
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>
        </div>
    );

    return (
        <Container fluid className="py-4">
            <Row className="mb-4">
                <Col>
                    <h2>
                        <Zap size={28} className="me-2" />
                        Microserviços de Faturas
                    </h2>
                    <p className="text-muted">
                        Gerenciamento e monitoramento do sistema de processamento de faturas
                    </p>
                </Col>
            </Row>

            <Tabs
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k)}
                className="mb-4"
            >
                <Tab eventKey="gerenciar" title={<><Settings size={16} className="me-1" />Gerenciar</>}>
                    {renderGerenciar()}
                </Tab>
                <Tab eventKey="dashboard" title={<><Activity size={16} className="me-1" />Dashboard</>}>
                    {renderDashboard()}
                </Tab>
                <Tab eventKey="relatorios" title={<><BarChart2 size={16} className="me-1" />Relatórios</>}>
                    {renderRelatorios()}
                </Tab>
                <Tab eventKey="busca" title={<><Mail size={16} className="me-1" />Busca de Emails</>}>
                    {renderBuscaEmail()}
                </Tab>
                <Tab eventKey="jobs" title={<><Clock size={16} className="me-1" />Jobs</>}>
                    {renderJobs()}
                </Tab>
                <Tab eventKey="logs" title={<><FileText size={16} className="me-1" />Logs</>}>
                    {renderLogs()}
                </Tab>
            </Tabs>
        </Container>
    );
}

export default MicroservicosPanel;
