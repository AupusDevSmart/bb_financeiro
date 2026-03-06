import React, { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Table, Button, Form, Badge, Alert, Spinner, Modal, ProgressBar, Tab, Tabs } from 'react-bootstrap';
import api from '../services/api';
import { formatarCPFComMascara, formatarCNPJComMascara, formatarValor } from '../utils/formatters';
import { removerAcentos } from '../utils/formatters';
import {
    Clock, CheckCircle, FileText, Download, Eye, RefreshCw, PackageOpen, Send,
    XCircle, Play, RotateCcw, CheckSquare, Square, MessageCircle, Mail, AlertCircle,
    Edit3, Upload, File, Trash2, Search, Filter, FileUp, CheckCircle2, AlertTriangle,
    ZapOff, Database
} from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function ControleEnergia({ mostrarAlerta }) {
    // Estado da aba ativa
    const [abaAtiva, setAbaAtiva] = useState('boletos');

    // Filtro global de mês (compartilhado entre abas)
    const [mesReferencia, setMesReferencia] = useState('');
    const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
    const [carregandoMeses, setCarregandoMeses] = useState(true);

    // =============================================
    // ESTADOS ABA BOLETOS DE ENERGIA
    // =============================================
    const [boletos, setBoletos] = useState([]);
    const [filtrosBoletos, setFiltrosBoletos] = useState({
        status: 'Todos',
        uc: '',
        compensacao: 'Todos'
    });
    const [carregandoBoletos, setCarregandoBoletos] = useState(false);

    // =============================================
    // ESTADOS ABA SEM COMPENSAÇÃO
    // =============================================
    const [faturasSemCompensacao, setFaturasSemCompensacao] = useState([]);
    const [carregandoSemCompensacao, setCarregandoSemCompensacao] = useState(false);
    const [filtroSemCompensacao, setFiltroSemCompensacao] = useState('');

    // =============================================
    // ESTADOS ABA UCS NÃO BAIXADAS
    // =============================================
    const [ucsNaoBaixadas, setUcsNaoBaixadas] = useState([]);
    const [carregandoNaoBaixadas, setCarregandoNaoBaixadas] = useState(false);
    const [filtroNaoBaixadas, setFiltroNaoBaixadas] = useState('');

    // =============================================
    // ESTADOS ABA PENDENTES (Upload + Processamento)
    // =============================================
    const [arquivosPendentes, setArquivosPendentes] = useState([]);
    const [carregandoPendentes, setCarregandoPendentes] = useState(false);
    const [arquivosUpload, setArquivosUpload] = useState([]);
    const [uploadando, setUploadando] = useState(false);
    const [progressoUpload, setProgressoUpload] = useState(0);
    const [dragAtivo, setDragAtivo] = useState(false);
    const [selecionadosPendentes, setSelecionadosPendentes] = useState([]);
    const [processandoJobs, setProcessandoJobs] = useState(false);
    const fileInputRef = useRef(null);

    // =============================================
    // CARREGAR MESES DISPONÍVEIS
    // =============================================
    useEffect(() => {
        carregarMesesDisponiveis();
    }, []);

    // Recarregar dados quando mês mudar
    useEffect(() => {
        if (mesReferencia) {
            if (abaAtiva === 'boletos') carregarBoletos();
            if (abaAtiva === 'sem-compensacao') carregarFaturasSemCompensacao();
            if (abaAtiva === 'nao-baixadas') carregarUcsNaoBaixadas();
            if (abaAtiva === 'pendentes') carregarArquivosPendentes();
        }
    }, [mesReferencia]);

    // Recarregar ao trocar de aba
    useEffect(() => {
        if (mesReferencia) {
            if (abaAtiva === 'boletos') carregarBoletos();
            if (abaAtiva === 'sem-compensacao') carregarFaturasSemCompensacao();
            if (abaAtiva === 'nao-baixadas') carregarUcsNaoBaixadas();
            if (abaAtiva === 'pendentes') carregarArquivosPendentes();
        }
    }, [abaAtiva]);

    const carregarMesesDisponiveis = async () => {
        setCarregandoMeses(true);
        try {
            const response = await api.get('/api/meses-disponiveis-boletos');
            const meses = response.data.meses || [];
            setMesesDisponiveis(meses);

            // Definir mês mais recente como padrão
            if (meses.length > 0 && !mesReferencia) {
                setMesReferencia(meses[0]);
            }
        } catch (error) {
            console.error('Erro ao carregar meses:', error);
            mostrarAlerta('Erro ao carregar meses disponíveis', 'danger');
        } finally {
            setCarregandoMeses(false);
        }
    };

    // =============================================
    // FUNÇÕES ABA BOLETOS DE ENERGIA
    // =============================================
    const carregarBoletos = async () => {
        if (!mesReferencia) return;
        setCarregandoBoletos(true);
        try {
            const params = new URLSearchParams();
            if (filtrosBoletos.status !== 'Todos') params.append('status', filtrosBoletos.status);
            if (filtrosBoletos.uc) params.append('uc', filtrosBoletos.uc);
            params.append('mes_referencia', mesReferencia);
            params.append('_t', Date.now());

            const response = await api.get(`/api/dados-boleto-energia?${params.toString()}`);
            setBoletos(response.data.boletos || []);
        } catch (error) {
            console.error('Erro ao carregar boletos:', error);
            mostrarAlerta('Erro ao carregar boletos', 'danger');
        } finally {
            setCarregandoBoletos(false);
        }
    };

    const getStatusBadge = (status) => {
        const statusMap = {
            'Pendente': { bg: 'warning', text: 'dark' },
            'Boleto gerado': { bg: 'success', text: 'white' },
            'Pago': { bg: 'info', text: 'white' },
            'Cancelado': { bg: 'secondary', text: 'white' },
            'Vencido': { bg: 'danger', text: 'white' },
            'Erro': { bg: 'danger', text: 'white' }
        };
        const config = statusMap[status] || { bg: 'secondary', text: 'white' };
        return <Badge bg={config.bg} text={config.text}>{status}</Badge>;
    };

    // =============================================
    // FUNÇÕES ABA SEM COMPENSAÇÃO
    // =============================================
    const carregarFaturasSemCompensacao = async () => {
        if (!mesReferencia) return;
        setCarregandoSemCompensacao(true);
        try {
            const response = await api.get(`/api/controle/sem-compensacao?mes_referencia=${mesReferencia}`);
            setFaturasSemCompensacao(response.data.faturas || []);
        } catch (error) {
            console.error('Erro ao carregar faturas sem compensação:', error);
            mostrarAlerta('Erro ao carregar faturas sem compensação', 'danger');
        } finally {
            setCarregandoSemCompensacao(false);
        }
    };

    const faturasSemCompensacaoFiltradas = faturasSemCompensacao.filter(f =>
        !filtroSemCompensacao ||
        f.uc?.includes(filtroSemCompensacao) ||
        f.nome_cliente?.toLowerCase().includes(filtroSemCompensacao.toLowerCase())
    );

    // =============================================
    // FUNÇÕES ABA UCS NÃO BAIXADAS
    // =============================================
    const carregarUcsNaoBaixadas = async () => {
        if (!mesReferencia) return;
        setCarregandoNaoBaixadas(true);
        try {
            const response = await api.get(`/api/controle/ucs-nao-baixadas?mes_referencia=${mesReferencia}`);
            setUcsNaoBaixadas(response.data.ucs || []);
        } catch (error) {
            console.error('Erro ao carregar UCs não baixadas:', error);
            mostrarAlerta('Erro ao carregar UCs não baixadas', 'danger');
        } finally {
            setCarregandoNaoBaixadas(false);
        }
    };

    const ucsNaoBaixadasFiltradas = ucsNaoBaixadas.filter(uc =>
        !filtroNaoBaixadas ||
        uc.numero_unidade?.includes(filtroNaoBaixadas) ||
        uc.nome_cliente?.toLowerCase().includes(filtroNaoBaixadas.toLowerCase())
    );

    // =============================================
    // FUNÇÕES ABA PENDENTES
    // =============================================
    const carregarArquivosPendentes = async () => {
        setCarregandoPendentes(true);
        try {
            const response = await api.get('/api/sistema-faturas/arquivos-pendentes');
            setArquivosPendentes(response.data.arquivos || []);
        } catch (error) {
            console.error('Erro ao carregar pendentes:', error);
            mostrarAlerta('Erro ao carregar arquivos pendentes', 'danger');
        } finally {
            setCarregandoPendentes(false);
        }
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragAtivo(true);
        } else if (e.type === 'dragleave') {
            setDragAtivo(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragAtivo(false);

        const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
        if (files.length > 0) {
            setArquivosUpload(prev => [...prev, ...files].slice(0, 50));
        }
    };

    const handleArquivosSelecionados = (e) => {
        const files = [...e.target.files].filter(f => f.type === 'application/pdf');
        setArquivosUpload(prev => [...prev, ...files].slice(0, 50));
    };

    const removerArquivoUpload = (idx) => {
        setArquivosUpload(prev => prev.filter((_, i) => i !== idx));
    };

    const formatarTamanhoArquivo = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const fazerUpload = async () => {
        if (arquivosUpload.length === 0) return;

        setUploadando(true);
        setProgressoUpload(0);

        try {
            for (let i = 0; i < arquivosUpload.length; i++) {
                const formData = new FormData();
                formData.append('arquivo', arquivosUpload[i]);

                await api.post('/api/sistema-faturas/upload-fatura', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });

                setProgressoUpload(Math.round(((i + 1) / arquivosUpload.length) * 100));
            }

            mostrarAlerta(`${arquivosUpload.length} arquivo(s) enviado(s) com sucesso!`, 'success');
            setArquivosUpload([]);
            carregarArquivosPendentes();
        } catch (error) {
            console.error('Erro no upload:', error);
            mostrarAlerta('Erro ao fazer upload dos arquivos', 'danger');
        } finally {
            setUploadando(false);
            setProgressoUpload(0);
        }
    };

    const toggleSelecionarTodos = () => {
        if (selecionadosPendentes.length === arquivosPendentes.length) {
            setSelecionadosPendentes([]);
        } else {
            setSelecionadosPendentes(arquivosPendentes.map(a => a.nome));
        }
    };

    const toggleSelecionarPendente = (nome) => {
        setSelecionadosPendentes(prev =>
            prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome]
        );
    };

    const processarSelecionados = async () => {
        if (selecionadosPendentes.length === 0) return;

        setProcessandoJobs(true);
        try {
            const response = await api.post('/api/sistema-faturas/processar-pendentes', {
                arquivos: selecionadosPendentes
            });

            mostrarAlerta(`${response.data.processados || selecionadosPendentes.length} arquivo(s) enviado(s) para processamento`, 'success');
            setSelecionadosPendentes([]);
            carregarArquivosPendentes();
        } catch (error) {
            console.error('Erro ao processar:', error);
            mostrarAlerta('Erro ao processar arquivos', 'danger');
        } finally {
            setProcessandoJobs(false);
        }
    };

    // =============================================
    // CONTADORES PARA AS ABAS
    // =============================================
    const contadorBoletos = boletos.length;
    const contadorSemCompensacao = faturasSemCompensacao.length;
    const contadorNaoBaixadas = ucsNaoBaixadas.length;
    const contadorPendentes = arquivosPendentes.length;

    // =============================================
    // RENDER
    // =============================================
    return (
        <Container fluid className="mt-4">
            {/* Filtro Global de Mês */}
            <Card className="mb-3">
                <Card.Body className="py-2">
                    <Row className="align-items-center">
                        <Col md={2}>
                            <strong><Filter size={16} className="me-2" />Mês de Referência:</strong>
                        </Col>
                        <Col md={3}>
                            <Form.Select
                                value={mesReferencia}
                                onChange={(e) => setMesReferencia(e.target.value)}
                                disabled={carregandoMeses}
                            >
                                {carregandoMeses ? (
                                    <option>Carregando...</option>
                                ) : (
                                    <>
                                        <option value="">Selecione o mês</option>
                                        {mesesDisponiveis.map(mes => (
                                            <option key={mes} value={mes}>{mes}</option>
                                        ))}
                                    </>
                                )}
                            </Form.Select>
                        </Col>
                        <Col md={7} className="text-end text-muted">
                            <small>
                                Filtro aplicado em todas as abas
                            </small>
                        </Col>
                    </Row>
                </Card.Body>
            </Card>

            {/* Abas */}
            <Card>
                <Card.Header>
                    <h4 className="mb-0">
                        <Database size={24} className="me-2" />
                        Controle de Faturas e Boletos
                    </h4>
                </Card.Header>
                <Card.Body>
                    <Tabs
                        activeKey={abaAtiva}
                        onSelect={(k) => setAbaAtiva(k)}
                        className="mb-3"
                    >
                        {/* ABA BOLETOS DE ENERGIA */}
                        <Tab
                            eventKey="boletos"
                            title={
                                <span>
                                    <CheckCircle size={16} className="me-1" />
                                    Boletos de Energia
                                    {contadorBoletos > 0 && (
                                        <Badge bg="primary" className="ms-2">{contadorBoletos}</Badge>
                                    )}
                                </span>
                            }
                        >
                            {/* Filtros adicionais */}
                            <Form className="mb-3">
                                <Row>
                                    <Col md={2}>
                                        <Form.Group>
                                            <Form.Label>Status</Form.Label>
                                            <Form.Select
                                                value={filtrosBoletos.status}
                                                onChange={(e) => setFiltrosBoletos({...filtrosBoletos, status: e.target.value})}
                                            >
                                                <option value="Todos">Todos</option>
                                                <option value="Pendente">Pendente</option>
                                                <option value="Boleto gerado">Boleto gerado</option>
                                                <option value="Pago">Pago</option>
                                                <option value="Cancelado">Cancelado</option>
                                                <option value="Vencido">Vencido</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </Col>
                                    <Col md={2}>
                                        <Form.Group>
                                            <Form.Label>UC</Form.Label>
                                            <Form.Control
                                                type="text"
                                                placeholder="Filtrar UC"
                                                value={filtrosBoletos.uc}
                                                onChange={(e) => setFiltrosBoletos({...filtrosBoletos, uc: e.target.value})}
                                            />
                                        </Form.Group>
                                    </Col>
                                    <Col md={2}>
                                        <Form.Group>
                                            <Form.Label>Compensação</Form.Label>
                                            <Form.Select
                                                value={filtrosBoletos.compensacao}
                                                onChange={(e) => setFiltrosBoletos({...filtrosBoletos, compensacao: e.target.value})}
                                            >
                                                <option value="Todos">Todos</option>
                                                <option value="compensou_tudo">Compensou tudo</option>
                                                <option value="nao_compensou_tudo">Não compensou tudo</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </Col>
                                    <Col md={2} className="d-flex align-items-end">
                                        <Button
                                            variant="primary"
                                            onClick={carregarBoletos}
                                            disabled={carregandoBoletos || !mesReferencia}
                                        >
                                            {carregandoBoletos ? <Spinner size="sm" /> : <Search size={16} />}
                                            <span className="ms-1">Buscar</span>
                                        </Button>
                                    </Col>
                                </Row>
                            </Form>

                            {/* Tabela de Boletos */}
                            {carregandoBoletos ? (
                                <div className="text-center py-5">
                                    <Spinner animation="border" />
                                    <p className="mt-2">Carregando boletos...</p>
                                </div>
                            ) : boletos.length === 0 ? (
                                <Alert variant="info">
                                    Nenhum boleto encontrado para o mês {mesReferencia}
                                </Alert>
                            ) : (
                                <Table striped bordered hover responsive size="sm">
                                    <thead className="table-dark">
                                        <tr>
                                            <th>UC</th>
                                            <th>Cliente</th>
                                            <th>Valor</th>
                                            <th>Vencimento</th>
                                            <th>Status</th>
                                            <th>Energia Comp.</th>
                                            <th>Energia Não Comp.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {boletos.map((boleto, idx) => (
                                            <tr key={idx}>
                                                <td>{boleto.uc}</td>
                                                <td>{boleto.nome_completo}</td>
                                                <td className="text-end">R$ {formatarValor(boleto.valor_boleto)}</td>
                                                <td>{boleto.data_vencimento}</td>
                                                <td>{getStatusBadge(boleto.status)}</td>
                                                <td className="text-end">{(parseFloat(boleto.energia_compensado) || 0).toFixed(2)} kWh</td>
                                                <td className="text-end">{(parseFloat(boleto.energia_nao_compensado) || 0).toFixed(2)} kWh</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Tab>

                        {/* ABA SEM COMPENSAÇÃO */}
                        <Tab
                            eventKey="sem-compensacao"
                            title={
                                <span>
                                    <ZapOff size={16} className="me-1" />
                                    Sem Compensação
                                    {contadorSemCompensacao > 0 && (
                                        <Badge bg="warning" text="dark" className="ms-2">{contadorSemCompensacao}</Badge>
                                    )}
                                </span>
                            }
                        >
                            <Row className="mb-3">
                                <Col md={4}>
                                    <Form.Control
                                        type="text"
                                        placeholder="Filtrar por UC ou nome..."
                                        value={filtroSemCompensacao}
                                        onChange={(e) => setFiltroSemCompensacao(e.target.value)}
                                    />
                                </Col>
                                <Col md={2}>
                                    <Button
                                        variant="outline-primary"
                                        onClick={carregarFaturasSemCompensacao}
                                        disabled={carregandoSemCompensacao}
                                    >
                                        <RefreshCw size={16} className={carregandoSemCompensacao ? 'spin' : ''} />
                                    </Button>
                                </Col>
                            </Row>

                            <Alert variant="info" className="mb-3">
                                <AlertCircle size={16} className="me-2" />
                                Faturas lidas que foram classificadas como <strong>sem compensação</strong> (valor de energia compensada = 0 ou categoria diferente de compensação).
                            </Alert>

                            {carregandoSemCompensacao ? (
                                <div className="text-center py-5">
                                    <Spinner animation="border" />
                                    <p className="mt-2">Carregando faturas sem compensação...</p>
                                </div>
                            ) : faturasSemCompensacaoFiltradas.length === 0 ? (
                                <Alert variant="success">
                                    <CheckCircle2 size={16} className="me-2" />
                                    Nenhuma fatura sem compensação para o mês {mesReferencia}
                                </Alert>
                            ) : (
                                <Table striped bordered hover responsive size="sm">
                                    <thead className="table-dark">
                                        <tr>
                                            <th>UC</th>
                                            <th>Cliente</th>
                                            <th>Categoria</th>
                                            <th>Valor Fatura</th>
                                            <th>Motivo</th>
                                            <th>Data Leitura</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {faturasSemCompensacaoFiltradas.map((fatura, idx) => (
                                            <tr key={idx}>
                                                <td>{fatura.uc}</td>
                                                <td>{fatura.nome_cliente}</td>
                                                <td>{fatura.categoria || '-'}</td>
                                                <td className="text-end">R$ {formatarValor(fatura.valor_fatura)}</td>
                                                <td>
                                                    <Badge bg="secondary">{fatura.motivo || 'Sem compensação'}</Badge>
                                                </td>
                                                <td>{fatura.data_leitura ? new Date(fatura.data_leitura).toLocaleDateString('pt-BR') : '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Tab>

                        {/* ABA UCS NÃO BAIXADAS */}
                        <Tab
                            eventKey="nao-baixadas"
                            title={
                                <span>
                                    <AlertTriangle size={16} className="me-1" />
                                    UCs Não Baixadas
                                    {contadorNaoBaixadas > 0 && (
                                        <Badge bg="danger" className="ms-2">{contadorNaoBaixadas}</Badge>
                                    )}
                                </span>
                            }
                        >
                            <Row className="mb-3">
                                <Col md={4}>
                                    <Form.Control
                                        type="text"
                                        placeholder="Filtrar por UC ou nome..."
                                        value={filtroNaoBaixadas}
                                        onChange={(e) => setFiltroNaoBaixadas(e.target.value)}
                                    />
                                </Col>
                                <Col md={2}>
                                    <Button
                                        variant="outline-primary"
                                        onClick={carregarUcsNaoBaixadas}
                                        disabled={carregandoNaoBaixadas}
                                    >
                                        <RefreshCw size={16} className={carregandoNaoBaixadas ? 'spin' : ''} />
                                    </Button>
                                </Col>
                            </Row>

                            <Alert variant="warning" className="mb-3">
                                <AlertTriangle size={16} className="me-2" />
                                UCs ativas no CRM que <strong>ainda não tiveram fatura baixada</strong> para o mês {mesReferencia}.
                                Essas UCs precisam ter suas faturas inseridas manualmente ou aguardar o buscador automático.
                            </Alert>

                            {carregandoNaoBaixadas ? (
                                <div className="text-center py-5">
                                    <Spinner animation="border" />
                                    <p className="mt-2">Carregando UCs não baixadas...</p>
                                </div>
                            ) : ucsNaoBaixadasFiltradas.length === 0 ? (
                                <Alert variant="success">
                                    <CheckCircle2 size={16} className="me-2" />
                                    Todas as UCs do CRM já tiveram suas faturas baixadas para o mês {mesReferencia}!
                                </Alert>
                            ) : (
                                <Table striped bordered hover responsive size="sm">
                                    <thead className="table-dark">
                                        <tr>
                                            <th>UC</th>
                                            <th>Cliente</th>
                                            <th>CPF/CNPJ</th>
                                            <th>Sigla</th>
                                            <th>Última Tentativa</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ucsNaoBaixadasFiltradas.map((uc, idx) => (
                                            <tr key={idx}>
                                                <td><strong>{uc.numero_unidade}</strong></td>
                                                <td>{uc.nome_cliente}</td>
                                                <td>{uc.cpf_cnpj || '-'}</td>
                                                <td><Badge bg="info">{uc.sigla || 'CLA'}</Badge></td>
                                                <td>{uc.ultima_tentativa ? new Date(uc.ultima_tentativa).toLocaleString('pt-BR') : 'Nunca'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Tab>

                        {/* ABA PENDENTES */}
                        <Tab
                            eventKey="pendentes"
                            title={
                                <span>
                                    <Clock size={16} className="me-1" />
                                    Pendentes
                                    {contadorPendentes > 0 && (
                                        <Badge bg="secondary" className="ms-2">{contadorPendentes}</Badge>
                                    )}
                                </span>
                            }
                        >
                            {/* Upload de Faturas */}
                            <Card className="mb-4">
                                <Card.Header>
                                    <h5 className="mb-0">
                                        <FileUp size={20} className="me-2" />
                                        Upload de Faturas PDF
                                    </h5>
                                </Card.Header>
                                <Card.Body>
                                    <div
                                        className={`border rounded p-4 text-center mb-3`}
                                        style={{
                                            borderStyle: 'dashed',
                                            borderWidth: '2px',
                                            borderColor: dragAtivo ? '#0d6efd' : '#dee2e6',
                                            backgroundColor: dragAtivo ? '#f8f9fa' : 'transparent',
                                            cursor: 'pointer'
                                        }}
                                        onDragEnter={handleDrag}
                                        onDragLeave={handleDrag}
                                        onDragOver={handleDrag}
                                        onDrop={handleDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="d-none"
                                            accept=".pdf"
                                            multiple
                                            onChange={handleArquivosSelecionados}
                                        />
                                        <Upload size={48} className={`mb-3 ${dragAtivo ? 'text-primary' : 'text-muted'}`} />
                                        <h5 className={dragAtivo ? 'text-primary' : 'text-muted'}>
                                            {dragAtivo ? 'Solte os arquivos aqui' : 'Arraste PDFs aqui ou clique para selecionar'}
                                        </h5>
                                        <p className="text-muted mb-0">
                                            Apenas arquivos PDF - Até 50 arquivos por vez
                                        </p>
                                    </div>

                                    {arquivosUpload.length > 0 && (
                                        <>
                                            <h6>Arquivos selecionados ({arquivosUpload.length})</h6>
                                            <Table striped bordered size="sm" className="mb-3">
                                                <thead>
                                                    <tr>
                                                        <th>Nome</th>
                                                        <th style={{width: '100px'}}>Tamanho</th>
                                                        <th style={{width: '80px'}}>Ação</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {arquivosUpload.map((file, idx) => (
                                                        <tr key={idx}>
                                                            <td><File size={14} className="text-danger me-2" />{file.name}</td>
                                                            <td>{formatarTamanhoArquivo(file.size)}</td>
                                                            <td>
                                                                <Button
                                                                    variant="outline-danger"
                                                                    size="sm"
                                                                    onClick={() => removerArquivoUpload(idx)}
                                                                >
                                                                    <Trash2 size={14} />
                                                                </Button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </Table>

                                            {uploadando && (
                                                <ProgressBar now={progressoUpload} label={`${progressoUpload}%`} className="mb-3" animated />
                                            )}

                                            <div className="d-flex gap-2">
                                                <Button variant="success" onClick={fazerUpload} disabled={uploadando}>
                                                    {uploadando ? (
                                                        <><Spinner size="sm" className="me-2" />Enviando...</>
                                                    ) : (
                                                        <><Upload size={16} className="me-2" />Enviar {arquivosUpload.length} arquivo(s)</>
                                                    )}
                                                </Button>
                                                <Button variant="outline-secondary" onClick={() => setArquivosUpload([])} disabled={uploadando}>
                                                    Limpar
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </Card.Body>
                            </Card>

                            {/* Arquivos Pendentes de Processamento */}
                            <Card>
                                <Card.Header className="d-flex justify-content-between align-items-center">
                                    <h5 className="mb-0">
                                        <Clock size={20} className="me-2" />
                                        Arquivos Pendentes de Processamento
                                        {arquivosPendentes.length > 0 && (
                                            <Badge bg="warning" text="dark" className="ms-2">{arquivosPendentes.length}</Badge>
                                        )}
                                    </h5>
                                    <div className="d-flex gap-2">
                                        <Button
                                            variant="outline-primary"
                                            size="sm"
                                            onClick={carregarArquivosPendentes}
                                            disabled={carregandoPendentes}
                                        >
                                            <RefreshCw size={14} className={carregandoPendentes ? 'spin' : ''} />
                                        </Button>
                                        {selecionadosPendentes.length > 0 && (
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={processarSelecionados}
                                                disabled={processandoJobs}
                                            >
                                                {processandoJobs ? (
                                                    <><Spinner size="sm" className="me-2" />Processando...</>
                                                ) : (
                                                    <><Play size={14} className="me-1" />Processar {selecionadosPendentes.length}</>
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                </Card.Header>
                                <Card.Body>
                                    {carregandoPendentes ? (
                                        <div className="text-center py-4">
                                            <Spinner animation="border" />
                                            <p className="mt-2">Carregando arquivos pendentes...</p>
                                        </div>
                                    ) : arquivosPendentes.length === 0 ? (
                                        <Alert variant="info">
                                            <CheckCircle2 size={18} className="me-2" />
                                            Nenhum arquivo pendente de processamento.
                                        </Alert>
                                    ) : (
                                        <Table striped bordered hover size="sm">
                                            <thead>
                                                <tr>
                                                    <th style={{width: '40px'}}>
                                                        <Form.Check
                                                            type="checkbox"
                                                            checked={selecionadosPendentes.length === arquivosPendentes.length}
                                                            onChange={toggleSelecionarTodos}
                                                        />
                                                    </th>
                                                    <th>Nome do Arquivo</th>
                                                    <th style={{width: '100px'}}>Tamanho</th>
                                                    <th style={{width: '180px'}}>Data Upload</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {arquivosPendentes.map((arquivo, idx) => (
                                                    <tr key={idx}>
                                                        <td>
                                                            <Form.Check
                                                                type="checkbox"
                                                                checked={selecionadosPendentes.includes(arquivo.nome)}
                                                                onChange={() => toggleSelecionarPendente(arquivo.nome)}
                                                            />
                                                        </td>
                                                        <td><File size={14} className="text-danger me-2" />{arquivo.nome}</td>
                                                        <td>{formatarTamanhoArquivo(arquivo.tamanho)}</td>
                                                        <td>{arquivo.data_upload ? new Date(arquivo.data_upload).toLocaleString('pt-BR') : '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </Table>
                                    )}
                                </Card.Body>
                            </Card>
                        </Tab>
                    </Tabs>
                </Card.Body>
            </Card>
        </Container>
    );
}

export default ControleEnergia;
