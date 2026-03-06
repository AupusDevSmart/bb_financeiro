import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Form, Table, Badge, Breadcrumb, InputGroup, ListGroup, Spinner, Modal, Nav, Tab, ProgressBar, Alert } from 'react-bootstrap';
import { Folder, File, ArrowLeft, Download, Eye, Calendar, Search, X, FolderOpen, Send, Mail, MessageCircle, CheckCircle, AlertCircle, FileSpreadsheet, RefreshCw, Filter, Upload, FileUp, Trash2, Play, Clock, CheckCircle2, XCircle, Loader } from 'lucide-react';
import api from '../services/api';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function SistemaFaturas({ mostrarAlerta }) {
    const [mesSelecionado, setMesSelecionado] = useState('');
    const [anoSelecionado, setAnoSelecionado] = useState('');
    const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
    const [pastaAtual, setPastaAtual] = useState(null); // null = raiz, 'FATURAS', 'NET', 'PDF COMBINADO'
    const [subpastaAtual, setSubpastaAtual] = useState(null); // Subpasta dentro da pasta principal
    const [pastas, setPastas] = useState([]);
    const [arquivos, setArquivos] = useState([]);
    const [carregando, setCarregando] = useState(false);

    // Estados para busca
    const [termoBusca, setTermoBusca] = useState('');
    const [resultadosBusca, setResultadosBusca] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [mostrarResultados, setMostrarResultados] = useState(false);
    const [arquivoDestacado, setArquivoDestacado] = useState(null); // Nome do arquivo a destacar

    // Estados para envio
    const [modalEnvio, setModalEnvio] = useState(false);
    const [arquivoParaEnvio, setArquivoParaEnvio] = useState(null);
    const [tipoEnvio, setTipoEnvio] = useState('whatsapp'); // 'whatsapp' ou 'email'
    const [destinatario, setDestinatario] = useState('');
    const [destinatarioSecundario, setDestinatarioSecundario] = useState(''); // Email secundário
    const [enviando, setEnviando] = useState(false);
    const [statusEnvio, setStatusEnvio] = useState(null); // { tipo: 'success'|'error'|'warning', mensagem: '' }
    const [forcarReenvio, setForcarReenvio] = useState(false);
    const [pastaEnvio, setPastaEnvio] = useState('NET'); // Pasta de onde enviar: NET ou PDF_COMBINADO

    // Estados para aba e controle de envios
    const [abaAtiva, setAbaAtiva] = useState('arquivos'); // 'arquivos', 'envios' ou 'inserir'
    const [historicoEnvios, setHistoricoEnvios] = useState([]);
    const [carregandoEnvios, setCarregandoEnvios] = useState(false);
    const [filtroEnvios, setFiltroEnvios] = useState({
        tipo: '', // 'whatsapp', 'email' ou ''
        status: '', // 'enviado', 'falha' ou ''
        mes_referencia: ''
    });

    // Estados para aba Inserir Faturas
    const [arquivosUpload, setArquivosUpload] = useState([]);
    const [uploadando, setUploadando] = useState(false);
    const [progressoUpload, setProgressoUpload] = useState(0);
    const [arquivosPendentes, setArquivosPendentes] = useState([]);
    const [carregandoPendentes, setCarregandoPendentes] = useState(false);
    const [selecionadosPendentes, setSelecionadosPendentes] = useState([]);
    const [processandoJobs, setProcessandoJobs] = useState(false);
    const [jobsAtivos, setJobsAtivos] = useState([]);
    const [carregandoJobs, setCarregandoJobs] = useState(false);
    const fileInputRef = useRef(null);
    const [dragAtivo, setDragAtivo] = useState(false);

    // Carregar meses disponíveis ao montar
    useEffect(() => {
        carregarMesesDisponiveis();
    }, []);

    const carregarMesesDisponiveis = async () => {
        try {
            const response = await api.get(`${API_URL}/api/sistema-faturas/meses`);
            setMesesDisponiveis(response.data.meses || []);

            // Selecionar o mês mais recente por padrão
            if (response.data.meses && response.data.meses.length > 0) {
                const mesRecente = response.data.meses[0];
                const [mes, ano] = mesRecente.split('.');
                setMesSelecionado(mes);
                setAnoSelecionado(ano);
            }
        } catch (error) {
            console.error('Erro ao carregar meses:', error);
            mostrarAlerta('Erro ao carregar meses disponíveis', 'danger');
        }
    };

    const carregarArquivos = async (pasta, subpasta = null) => {
        if (!mesSelecionado || !anoSelecionado) {
            mostrarAlerta('Selecione um mês e ano', 'warning');
            return;
        }

        setCarregando(true);
        try {
            const mesReferencia = `${mesSelecionado}.${anoSelecionado}`;
            const params = {
                pasta: pasta,
                mes_referencia: mesReferencia
            };

            if (subpasta) {
                params.subpasta = subpasta;
            }

            const response = await api.get(`${API_URL}/api/sistema-faturas/arquivos`, { params });

            setPastas(response.data.pastas || []);
            setArquivos(response.data.arquivos || []);
            setPastaAtual(pasta);
            setSubpastaAtual(subpasta);
        } catch (error) {
            console.error('Erro ao carregar arquivos:', error);
            mostrarAlerta('Erro ao carregar arquivos', 'danger');
        } finally {
            setCarregando(false);
        }
    };

    const voltarParaRaiz = () => {
        setPastaAtual(null);
        setSubpastaAtual(null);
        setPastas([]);
        setArquivos([]);
        limparBusca();
    };

    // Função de busca recursiva
    const buscarArquivos = async () => {
        if (!pastaAtual || !mesSelecionado || !anoSelecionado || !termoBusca.trim()) {
            return;
        }

        setBuscando(true);
        setMostrarResultados(true);
        try {
            const mesReferencia = `${mesSelecionado}.${anoSelecionado}`;
            const response = await api.get(`${API_URL}/api/sistema-faturas/buscar`, {
                params: {
                    pasta: pastaAtual,
                    mes_referencia: mesReferencia,
                    termo: termoBusca.trim()
                }
            });

            setResultadosBusca(response.data.resultados || []);
        } catch (error) {
            console.error('Erro na busca:', error);
            mostrarAlerta('Erro ao buscar arquivos', 'danger');
        } finally {
            setBuscando(false);
        }
    };

    const limparBusca = () => {
        setTermoBusca('');
        setResultadosBusca([]);
        setMostrarResultados(false);
    };

    // Navegar para a pasta do resultado de busca
    const irParaResultado = (resultado) => {
        // Guardar o nome do arquivo para destacar
        setArquivoDestacado(resultado.nome);

        // Se o resultado está em uma subpasta, navegar para ela
        if (resultado.subpasta) {
            carregarArquivos(pastaAtual, resultado.subpasta);
        } else {
            // Está na pasta raiz, apenas garantir que estamos lá
            carregarArquivos(pastaAtual, null);
        }
        limparBusca();

        // Remover destaque após 10 segundos
        setTimeout(() => {
            setArquivoDestacado(null);
        }, 10000);
    };

    const voltarParaPastaPrincipal = () => {
        setSubpastaAtual(null);
        carregarArquivos(pastaAtual, null);
    };

    const baixarArquivo = async (arquivo) => {
        try {
            const mesReferencia = `${mesSelecionado}.${anoSelecionado}`;
            const token = localStorage.getItem('auth_token');

            let url = `${API_URL}/api/sistema-faturas/download?pasta=${pastaAtual}&mes_referencia=${mesReferencia}&arquivo=${encodeURIComponent(arquivo.nome)}&token=${token}`;

            if (subpastaAtual) {
                url += `&subpasta=${encodeURIComponent(subpastaAtual)}`;
            }

            window.open(url, '_blank');
        } catch (error) {
            console.error('Erro ao baixar arquivo:', error);
            mostrarAlerta('Erro ao baixar arquivo', 'danger');
        }
    };

    const visualizarArquivo = async (arquivo) => {
        try {
            const mesReferencia = `${mesSelecionado}.${anoSelecionado}`;
            const token = localStorage.getItem('auth_token');

            let url = `${API_URL}/api/sistema-faturas/visualizar?pasta=${pastaAtual}&mes_referencia=${mesReferencia}&arquivo=${encodeURIComponent(arquivo.nome)}&token=${token}`;

            if (subpastaAtual) {
                url += `&subpasta=${encodeURIComponent(subpastaAtual)}`;
            }

            window.open(url, '_blank');
        } catch (error) {
            console.error('Erro ao visualizar arquivo:', error);
            mostrarAlerta('Erro ao visualizar arquivo', 'danger');
        }
    };

    const formatarTamanho = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getNomePasta = (pasta) => {
        const nomes = {
            'FATURAS': '01. FATURAS',
            'NET': '02. NET',
            'PDF_COMBINADO': '04. PDF COMBINADO'
        };
        return nomes[pasta] || pasta;
    };

    // Carregar histórico de envios
    const carregarHistoricoEnvios = async () => {
        setCarregandoEnvios(true);
        try {
            const params = {};
            if (filtroEnvios.tipo) params.tipo_envio = filtroEnvios.tipo;
            if (filtroEnvios.status) params.status = filtroEnvios.status;
            if (filtroEnvios.mes_referencia) params.mes_referencia = filtroEnvios.mes_referencia;

            const response = await api.get(`${API_URL}/api/sistema-faturas/historico-envios`, { params });
            setHistoricoEnvios(response.data.envios || []);
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
            mostrarAlerta('Erro ao carregar histórico de envios', 'danger');
        } finally {
            setCarregandoEnvios(false);
        }
    };

    // Carregar envios quando mudar para aba de envios
    useEffect(() => {
        if (abaAtiva === 'envios') {
            carregarHistoricoEnvios();
        }
        if (abaAtiva === 'inserir') {
            carregarArquivosPendentes();
            carregarJobsAtivos();
        }
    }, [abaAtiva]);

    // =====================================================
    // FUNÇÕES PARA ABA INSERIR FATURAS
    // =====================================================

    // Carregar arquivos pendentes
    const carregarArquivosPendentes = async () => {
        setCarregandoPendentes(true);
        try {
            const response = await api.get(`${API_URL}/api/inserir-faturas/pendentes`);
            setArquivosPendentes(response.data.arquivos || []);
            setSelecionadosPendentes([]);
        } catch (error) {
            console.error('Erro ao carregar pendentes:', error);
            mostrarAlerta('Erro ao carregar arquivos pendentes', 'danger');
        } finally {
            setCarregandoPendentes(false);
        }
    };

    // Carregar jobs ativos
    const carregarJobsAtivos = async () => {
        setCarregandoJobs(true);
        try {
            const response = await api.get(`${API_URL}/api/inserir-faturas/jobs`);
            setJobsAtivos(response.data.jobs || []);
        } catch (error) {
            console.error('Erro ao carregar jobs:', error);
        } finally {
            setCarregandoJobs(false);
        }
    };

    // Handler para seleção de arquivos
    const handleArquivosSelecionados = (e) => {
        const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
        if (files.length === 0) {
            mostrarAlerta('Selecione apenas arquivos PDF', 'warning');
            return;
        }
        setArquivosUpload(prev => [...prev, ...files]);
    };

    // Handler para drag and drop
    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragAtivo(true);
        } else if (e.type === 'dragleave') {
            setDragAtivo(false);
        }
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragAtivo(false);

        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
        if (files.length === 0) {
            mostrarAlerta('Selecione apenas arquivos PDF', 'warning');
            return;
        }
        setArquivosUpload(prev => [...prev, ...files]);
    }, []);

    // Remover arquivo da lista de upload
    const removerArquivoUpload = (index) => {
        setArquivosUpload(prev => prev.filter((_, i) => i !== index));
    };

    // Fazer upload dos arquivos (com divisão automática em lotes de 50)
    const fazerUpload = async () => {
        if (arquivosUpload.length === 0) {
            mostrarAlerta('Selecione pelo menos um arquivo PDF', 'warning');
            return;
        }

        setUploadando(true);
        setProgressoUpload(0);

        const BATCH_SIZE = 50;
        const totalArquivos = arquivosUpload.length;
        const totalLotes = Math.ceil(totalArquivos / BATCH_SIZE);
        let totalEnviados = 0;
        let totalErros = 0;

        try {
            // Dividir arquivos em lotes de 50
            for (let lote = 0; lote < totalLotes; lote++) {
                const inicio = lote * BATCH_SIZE;
                const fim = Math.min(inicio + BATCH_SIZE, totalArquivos);
                const arquivosLote = arquivosUpload.slice(inicio, fim);

                console.log(`📤 Enviando lote ${lote + 1}/${totalLotes} (${arquivosLote.length} arquivos)`);

                const formData = new FormData();
                arquivosLote.forEach(file => {
                    formData.append('faturas', file);
                });

                const response = await api.post(`${API_URL}/api/inserir-faturas/upload`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    onUploadProgress: (progressEvent) => {
                        // Calcular progresso total considerando todos os lotes
                        const progressoLote = progressEvent.loaded / progressEvent.total;
                        const progressoTotal = ((lote + progressoLote) / totalLotes) * 100;
                        setProgressoUpload(Math.round(progressoTotal));
                    }
                });

                if (response.data.total) {
                    totalEnviados += response.data.total;
                }
                if (response.data.erros?.length) {
                    totalErros += response.data.erros.length;
                }
            }

            if (totalEnviados > 0) {
                mostrarAlerta(`${totalEnviados} arquivo(s) enviado(s) com sucesso!${totalLotes > 1 ? ` (${totalLotes} lotes)` : ''}`, 'success');
            }
            if (totalErros > 0) {
                mostrarAlerta(`${totalErros} arquivo(s) com erro no upload`, 'warning');
            }

            setArquivosUpload([]);
            carregarArquivosPendentes();
        } catch (error) {
            console.error('Erro no upload:', error);
            mostrarAlerta(error.response?.data?.message || error.response?.data?.erro || 'Erro ao fazer upload', 'danger');
        } finally {
            setUploadando(false);
            setProgressoUpload(0);
        }
    };

    // Toggle seleção de arquivo pendente
    const toggleSelecionadoPendente = (arquivo) => {
        setSelecionadosPendentes(prev => {
            if (prev.includes(arquivo)) {
                return prev.filter(a => a !== arquivo);
            } else {
                return [...prev, arquivo];
            }
        });
    };

    // Selecionar/deselecionar todos
    const toggleSelecionarTodos = () => {
        if (selecionadosPendentes.length === arquivosPendentes.length) {
            setSelecionadosPendentes([]);
        } else {
            setSelecionadosPendentes(arquivosPendentes.map(a => a.nome));
        }
    };

    // Processar arquivos selecionados (criar jobs)
    const processarSelecionados = async () => {
        if (selecionadosPendentes.length === 0) {
            mostrarAlerta('Selecione pelo menos um arquivo para processar', 'warning');
            return;
        }

        setProcessandoJobs(true);
        try {
            const response = await api.post(`${API_URL}/api/inserir-faturas/processar`, {
                arquivos: selecionadosPendentes
            });

            const { jobs_criados, erros } = response.data;

            if (jobs_criados && jobs_criados.length > 0) {
                mostrarAlerta(`${jobs_criados.length} job(s) criado(s) com sucesso!`, 'success');
            }
            if (erros && erros.length > 0) {
                mostrarAlerta(`${erros.length} arquivo(s) com erro`, 'warning');
            }

            setSelecionadosPendentes([]);
            carregarArquivosPendentes();
            carregarJobsAtivos();
        } catch (error) {
            console.error('Erro ao processar:', error);
            mostrarAlerta(error.response?.data?.message || 'Erro ao criar jobs', 'danger');
        } finally {
            setProcessandoJobs(false);
        }
    };

    // Remover arquivo pendente
    const removerArquivoPendente = async (arquivo) => {
        if (!window.confirm(`Deseja remover o arquivo "${arquivo}"?`)) return;

        try {
            await api.delete(`${API_URL}/api/inserir-faturas/pendentes/${encodeURIComponent(arquivo)}`);
            mostrarAlerta('Arquivo removido com sucesso', 'success');
            carregarArquivosPendentes();
        } catch (error) {
            console.error('Erro ao remover:', error);
            mostrarAlerta('Erro ao remover arquivo', 'danger');
        }
    };

    // Formatar tamanho de arquivo
    const formatarTamanhoArquivo = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    // Obter cor do badge do status do job
    const getStatusJobBadge = (status) => {
        switch (status) {
            case 'pendente':
                return { bg: 'warning', text: 'dark', icon: Clock };
            case 'processando':
                return { bg: 'info', text: 'white', icon: Loader };
            case 'concluido':
                return { bg: 'success', text: 'white', icon: CheckCircle2 };
            case 'erro':
                return { bg: 'danger', text: 'white', icon: XCircle };
            default:
                return { bg: 'secondary', text: 'white', icon: Clock };
        }
    };

    // Exportar para Excel
    const exportarExcel = async () => {
        try {
            const params = new URLSearchParams();
            if (filtroEnvios.tipo) params.append('tipo_envio', filtroEnvios.tipo);
            if (filtroEnvios.status) params.append('status', filtroEnvios.status);
            if (filtroEnvios.mes_referencia) params.append('mes_referencia', filtroEnvios.mes_referencia);

            const token = localStorage.getItem('auth_token');
            params.append('token', token);

            window.open(`${API_URL}/api/sistema-faturas/exportar-envios?${params.toString()}`, '_blank');
            mostrarAlerta('Exportação iniciada!', 'success');
        } catch (error) {
            console.error('Erro ao exportar:', error);
            mostrarAlerta('Erro ao exportar planilha', 'danger');
        }
    };

    // Formatar data para exibição
    const formatarData = (data) => {
        if (!data) return '-';
        return new Date(data).toLocaleString('pt-BR');
    };

    // Funções de envio
    const abrirModalEnvio = async (arquivo, tipo) => {
        setArquivoParaEnvio(arquivo);
        setTipoEnvio(tipo);
        setDestinatario('');
        setDestinatarioSecundario('');
        setStatusEnvio(null);
        setForcarReenvio(false);
        setModalEnvio(true);

        // Tentar extrair UC do nome do arquivo e buscar dados do CRM
        // Padrões comuns: "UC_10037094651_01.2026.pdf", "10037094651_01.2026.pdf", "FATURA_10037094651.pdf"
        const ucMatch = arquivo.match(/(\d{8,11})/);
        if (ucMatch) {
            const uc = ucMatch[1];
            try {
                const response = await api.get(`/api/dados-contato-crm/${uc}`);
                if (response.data) {
                    // Preencher automaticamente com dados do CRM
                    if (tipo === 'whatsapp' && response.data.whatsapp) {
                        setDestinatario(response.data.whatsapp);
                    } else if (tipo === 'email') {
                        if (response.data.email) {
                            setDestinatario(response.data.email);
                        }
                        if (response.data.email_secundario) {
                            setDestinatarioSecundario(response.data.email_secundario);
                        }
                    }
                }
            } catch (error) {
                console.log('Não foi possível buscar dados de contato do CRM:', error.message);
                // Não mostrar erro - usuário pode digitar manualmente
            }
        }
    };

    const fecharModalEnvio = () => {
        setModalEnvio(false);
        setArquivoParaEnvio(null);
        setStatusEnvio(null);
        setForcarReenvio(false);
        setDestinatarioSecundario(''); // Limpar email secundário
    };

    const enviarArquivo = async () => {
        if (!destinatario.trim()) {
            setStatusEnvio({ tipo: 'error', mensagem: `Informe o ${tipoEnvio === 'whatsapp' ? 'telefone' : 'email'}` });
            return;
        }

        setEnviando(true);
        setStatusEnvio(null);

        try {
            const mesReferencia = `${mesSelecionado}/${anoSelecionado}`;
            const endpoint = tipoEnvio === 'whatsapp'
                ? '/api/sistema-faturas/enviar-whatsapp'
                : '/api/sistema-faturas/enviar-email';

            const payload = {
                pasta: 'NET', // Sempre enviar da pasta NET
                mes_referencia: mesReferencia,
                arquivo: arquivoParaEnvio.nome,
                subpasta: subpastaAtual || undefined,
                forcar_reenvio: forcarReenvio
            };

            if (tipoEnvio === 'whatsapp') {
                payload.telefone = destinatario;
            } else {
                // Enviar email principal e secundário (se houver)
                payload.email = destinatario;
                if (destinatarioSecundario.trim()) {
                    payload.email_secundario = destinatarioSecundario.trim();
                }
            }

            const response = await api.post(endpoint, payload);

            // Montar mensagem de sucesso
            let mensagemSucesso = `Arquivo enviado com sucesso para ${destinatario}`;
            if (tipoEnvio === 'email' && destinatarioSecundario.trim()) {
                mensagemSucesso += ` e ${destinatarioSecundario}`;
            }
            mensagemSucesso += '!';

            setStatusEnvio({
                tipo: 'success',
                mensagem: mensagemSucesso
            });
            mostrarAlerta(`Arquivo enviado com sucesso via ${tipoEnvio === 'whatsapp' ? 'WhatsApp' : 'Email'}!`, 'success');

            // Fechar modal após 2 segundos
            setTimeout(() => {
                fecharModalEnvio();
            }, 2000);

        } catch (error) {
            console.error('Erro ao enviar arquivo:', error);

            // Verificar se é erro de arquivo já enviado
            if (error.response?.status === 409 && error.response?.data?.ja_enviado) {
                const envioAnterior = error.response.data.envio_anterior;
                setStatusEnvio({
                    tipo: 'warning',
                    mensagem: error.response.data.mensagem,
                    jaEnviado: true,
                    envioAnterior
                });
            } else {
                setStatusEnvio({
                    tipo: 'error',
                    mensagem: error.response?.data?.message || error.message || 'Erro ao enviar arquivo'
                });
            }
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Container fluid className="py-4">
            <Row className="mb-4">
                <Col>
                    <h2>📁 Sistema de Faturas</h2>
                    <p className="text-muted">Navegue pelos arquivos e gerencie envios</p>
                </Col>
            </Row>

            {/* Abas de Navegação */}
            <Nav variant="tabs" className="mb-4" activeKey={abaAtiva} onSelect={(k) => setAbaAtiva(k)}>
                <Nav.Item>
                    <Nav.Link eventKey="arquivos">
                        <FolderOpen size={16} className="me-2" />
                        Arquivos
                    </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                    <Nav.Link eventKey="inserir">
                        <Upload size={16} className="me-2" />
                        Inserir Faturas
                        {arquivosPendentes.length > 0 && (
                            <Badge bg="warning" text="dark" className="ms-2">{arquivosPendentes.length}</Badge>
                        )}
                    </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                    <Nav.Link eventKey="envios">
                        <Send size={16} className="me-2" />
                        Controle de Envios
                        {historicoEnvios.length > 0 && (
                            <Badge bg="secondary" className="ms-2">{historicoEnvios.length}</Badge>
                        )}
                    </Nav.Link>
                </Nav.Item>
            </Nav>

            {/* Conteúdo da Aba de Arquivos */}
            {abaAtiva === 'arquivos' && (
            <>
            {/* Filtro de Mês/Ano */}
            <Row className="mb-4">
                <Col md={8}>
                    <Card>
                        <Card.Body>
                            <Row className="align-items-end">
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label><Calendar size={16} className="me-1" />Mês</Form.Label>
                                        <Form.Select
                                            value={mesSelecionado}
                                            onChange={(e) => setMesSelecionado(e.target.value)}
                                        >
                                            <option value="">Selecione...</option>
                                            <option value="01">Janeiro</option>
                                            <option value="02">Fevereiro</option>
                                            <option value="03">Março</option>
                                            <option value="04">Abril</option>
                                            <option value="05">Maio</option>
                                            <option value="06">Junho</option>
                                            <option value="07">Julho</option>
                                            <option value="08">Agosto</option>
                                            <option value="09">Setembro</option>
                                            <option value="10">Outubro</option>
                                            <option value="11">Novembro</option>
                                            <option value="12">Dezembro</option>
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
                                            <option value="">Selecione...</option>
                                            <option value="2024">2024</option>
                                            <option value="2025">2025</option>
                                            <option value="2026">2026</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <div className="d-flex gap-2 align-items-center">
                                        {mesSelecionado && anoSelecionado && (
                                            <Badge bg="info" style={{ fontSize: '1rem', padding: '8px 16px' }}>
                                                Mês de Referência: {mesSelecionado}.{anoSelecionado}
                                            </Badge>
                                        )}
                                    </div>
                                </Col>
                            </Row>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Breadcrumb de navegação */}
            {pastaAtual && (
                <Row className="mb-3">
                    <Col>
                        <Breadcrumb>
                            <Breadcrumb.Item onClick={voltarParaRaiz} style={{ cursor: 'pointer' }}>
                                <Folder size={16} className="me-1" />
                                Raiz
                            </Breadcrumb.Item>
                            <Breadcrumb.Item
                                onClick={subpastaAtual ? voltarParaPastaPrincipal : null}
                                active={!subpastaAtual}
                                style={subpastaAtual ? { cursor: 'pointer' } : {}}
                            >
                                {getNomePasta(pastaAtual)}
                            </Breadcrumb.Item>
                            <Breadcrumb.Item
                                onClick={subpastaAtual ? voltarParaPastaPrincipal : null}
                                active={!subpastaAtual}
                                style={subpastaAtual ? { cursor: 'pointer' } : {}}
                            >
                                {mesSelecionado}.{anoSelecionado}
                            </Breadcrumb.Item>
                            {subpastaAtual && (
                                <Breadcrumb.Item active>
                                    {subpastaAtual}
                                </Breadcrumb.Item>
                            )}
                        </Breadcrumb>
                    </Col>
                </Row>
            )}

            {/* Navegação de Pastas ou Lista de Arquivos */}
            <Row>
                <Col>
                    <Card>
                        <Card.Body>
                            {!pastaAtual ? (
                                /* Visualização de Pastas (Raiz) */
                                <Row>
                                    <Col md={4} className="mb-3">
                                        <Card
                                            className="h-100"
                                            style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                                            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                            onClick={() => carregarArquivos('FATURAS')}
                                        >
                                            <Card.Body className="text-center py-5">
                                                <Folder size={64} color="#0d6efd" className="mb-3" />
                                                <h5>01. FATURAS</h5>
                                                <p className="text-muted mb-0">Faturas originais das concessionárias</p>
                                            </Card.Body>
                                        </Card>
                                    </Col>
                                    <Col md={4} className="mb-3">
                                        <Card
                                            className="h-100"
                                            style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                                            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                            onClick={() => carregarArquivos('NET')}
                                        >
                                            <Card.Body className="text-center py-5">
                                                <Folder size={64} color="#198754" className="mb-3" />
                                                <h5>02. NET</h5>
                                                <p className="text-muted mb-0">Boletos de energia NET gerados</p>
                                            </Card.Body>
                                        </Card>
                                    </Col>
                                    <Col md={4} className="mb-3">
                                        <Card
                                            className="h-100"
                                            style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                                            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                                            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                            onClick={() => carregarArquivos('PDF_COMBINADO')}
                                        >
                                            <Card.Body className="text-center py-5">
                                                <Folder size={64} color="#dc3545" className="mb-3" />
                                                <h5>04. PDF COMBINADO</h5>
                                                <p className="text-muted mb-0">PDFs combinados (Fatura + Boleto)</p>
                                            </Card.Body>
                                        </Card>
                                    </Col>
                                </Row>
                            ) : (
                                /* Visualização de Pastas/Arquivos */
                                <>
                                    <div className="mb-3 d-flex justify-content-between align-items-center">
                                        <Button
                                            variant="outline-secondary"
                                            size="sm"
                                            onClick={subpastaAtual ? voltarParaPastaPrincipal : voltarParaRaiz}
                                        >
                                            <ArrowLeft size={16} className="me-1" />
                                            {subpastaAtual ? 'Voltar' : 'Voltar para pastas'}
                                        </Button>

                                        {/* Barra de Busca */}
                                        <div style={{ position: 'relative', width: '350px' }}>
                                            <InputGroup size="sm">
                                                <Form.Control
                                                    type="text"
                                                    placeholder="Buscar arquivo por nome..."
                                                    value={termoBusca}
                                                    onChange={(e) => setTermoBusca(e.target.value)}
                                                    onKeyPress={(e) => e.key === 'Enter' && buscarArquivos()}
                                                />
                                                {termoBusca && (
                                                    <Button
                                                        variant="outline-secondary"
                                                        onClick={limparBusca}
                                                        title="Limpar busca"
                                                    >
                                                        <X size={14} />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="primary"
                                                    onClick={buscarArquivos}
                                                    disabled={!termoBusca.trim() || buscando}
                                                >
                                                    {buscando ? <Spinner size="sm" animation="border" /> : <Search size={14} />}
                                                </Button>
                                            </InputGroup>

                                            {/* Resultados da Busca - Dropdown */}
                                            {mostrarResultados && (
                                                <Card
                                                    style={{
                                                        position: 'absolute',
                                                        top: '100%',
                                                        left: 0,
                                                        right: 0,
                                                        zIndex: 1000,
                                                        maxHeight: '400px',
                                                        overflow: 'auto',
                                                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                                    }}
                                                >
                                                    <Card.Header className="py-2 d-flex justify-content-between align-items-center">
                                                        <small className="text-muted">
                                                            {buscando ? 'Buscando...' : `${resultadosBusca.length} resultado(s)`}
                                                        </small>
                                                        <Button
                                                            variant="link"
                                                            size="sm"
                                                            className="p-0"
                                                            onClick={limparBusca}
                                                        >
                                                            <X size={14} />
                                                        </Button>
                                                    </Card.Header>
                                                    <ListGroup variant="flush">
                                                        {resultadosBusca.length === 0 && !buscando ? (
                                                            <ListGroup.Item className="text-muted text-center py-3">
                                                                Nenhum arquivo encontrado
                                                            </ListGroup.Item>
                                                        ) : (
                                                            resultadosBusca.map((resultado, idx) => (
                                                                <ListGroup.Item
                                                                    key={idx}
                                                                    action
                                                                    onClick={() => irParaResultado(resultado)}
                                                                    className="py-2"
                                                                    style={{ cursor: 'pointer' }}
                                                                >
                                                                    <div className="d-flex align-items-start">
                                                                        <File size={16} className="text-danger me-2 mt-1 flex-shrink-0" />
                                                                        <div className="flex-grow-1 min-width-0">
                                                                            <div className="text-truncate fw-medium" title={resultado.nome}>
                                                                                {resultado.nome}
                                                                            </div>
                                                                            {resultado.subpasta && (
                                                                                <small className="text-muted d-flex align-items-center">
                                                                                    <FolderOpen size={12} className="me-1" />
                                                                                    {resultado.subpasta}
                                                                                </small>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </ListGroup.Item>
                                                            ))
                                                        )}
                                                    </ListGroup>
                                                </Card>
                                            )}
                                        </div>
                                    </div>

                                    {carregando ? (
                                        <div className="text-center py-5">
                                            <div className="spinner-border text-primary" role="status">
                                                <span className="visually-hidden">Carregando...</span>
                                            </div>
                                            <p className="mt-2 text-muted">Carregando...</p>
                                        </div>
                                    ) : pastas.length === 0 && arquivos.length === 0 ? (
                                        <div className="text-center py-5">
                                            <File size={48} className="text-muted mb-3" />
                                            <p className="text-muted">Nenhum item encontrado nesta pasta</p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Mostrar subpastas primeiro */}
                                            {pastas.length > 0 && (
                                                <Row className="mb-3">
                                                    {pastas.map((pasta, index) => (
                                                        <Col md={3} key={index} className="mb-3">
                                                            <Card
                                                                style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                                                                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                                                                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                                                onClick={() => carregarArquivos(pastaAtual, pasta.nome)}
                                                            >
                                                                <Card.Body className="text-center py-4">
                                                                    <Folder size={48} color="#0d6efd" className="mb-2" />
                                                                    <h6 className="mb-0">{pasta.nome}</h6>
                                                                </Card.Body>
                                                            </Card>
                                                        </Col>
                                                    ))}
                                                </Row>
                                            )}

                                            {/* Mostrar arquivos */}
                                            {arquivos.length > 0 && (
                                                <Table striped hover>
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '50px' }}></th>
                                                    <th>Nome do Arquivo</th>
                                                    <th style={{ width: '120px' }}>Tamanho</th>
                                                    <th style={{ width: '180px' }}>Data Modificação</th>
                                                    <th style={{ width: '200px' }}>Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {arquivos.map((arquivo, index) => {
                                                    const isDestacado = arquivoDestacado === arquivo.nome;
                                                    return (
                                                    <tr
                                                        key={index}
                                                        id={isDestacado ? 'arquivo-destacado' : undefined}
                                                        ref={isDestacado ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                                                        style={isDestacado ? {
                                                            backgroundColor: '#fff3cd',
                                                            boxShadow: '0 0 0 3px #ffc107',
                                                            animation: 'pulse 1s ease-in-out 3'
                                                        } : {}}
                                                    >
                                                        <td className="text-center">
                                                            {isDestacado ? (
                                                                <Search size={20} color="#ffc107" />
                                                            ) : (
                                                                <File size={20} color="#6c757d" />
                                                            )}
                                                        </td>
                                                        <td>
                                                            {isDestacado && <Badge bg="warning" text="dark" className="me-2">Encontrado</Badge>}
                                                            <span style={isDestacado ? { fontWeight: 'bold' } : {}}>{arquivo.nome}</span>
                                                        </td>
                                                        <td>{formatarTamanho(arquivo.tamanho)}</td>
                                                        <td>{new Date(arquivo.data_modificacao).toLocaleString('pt-BR')}</td>
                                                        <td>
                                                            <div className="d-flex gap-1 flex-wrap">
                                                                <Button
                                                                    variant="outline-primary"
                                                                    size="sm"
                                                                    onClick={() => visualizarArquivo(arquivo)}
                                                                    title="Visualizar"
                                                                >
                                                                    <Eye size={14} />
                                                                </Button>
                                                                <Button
                                                                    variant="outline-success"
                                                                    size="sm"
                                                                    onClick={() => baixarArquivo(arquivo)}
                                                                    title="Baixar"
                                                                >
                                                                    <Download size={14} />
                                                                </Button>
                                                                <Button
                                                                    variant="outline-info"
                                                                    size="sm"
                                                                    onClick={() => abrirModalEnvio(arquivo, 'whatsapp')}
                                                                    title="Enviar por WhatsApp"
                                                                >
                                                                    <MessageCircle size={14} />
                                                                </Button>
                                                                <Button
                                                                    variant="outline-warning"
                                                                    size="sm"
                                                                    onClick={() => abrirModalEnvio(arquivo, 'email')}
                                                                    title="Enviar por Email"
                                                                >
                                                                    <Mail size={14} />
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </Table>
                                            )}
                                        </>
                                    )}

                                    {(pastas.length > 0 || arquivos.length > 0) && (
                                        <div className="mt-3">
                                            {pastas.length > 0 && (
                                                <Badge bg="info" className="me-2">
                                                    {pastas.length} pasta(s)
                                                </Badge>
                                            )}
                                            {arquivos.length > 0 && (
                                                <Badge bg="secondary">
                                                    {arquivos.length} arquivo(s)
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
            </>
            )}

            {/* Conteúdo da Aba Inserir Faturas */}
            {abaAtiva === 'inserir' && (
            <>
                <Row className="mb-4">
                    <Col md={12}>
                        {/* Área de Upload */}
                        <Card className="mb-4">
                            <Card.Header>
                                <h5 className="mb-0">
                                    <FileUp size={20} className="me-2" />
                                    Upload de Faturas PDF
                                </h5>
                            </Card.Header>
                            <Card.Body>
                                {/* Área de Drag and Drop */}
                                <div
                                    className={`border-2 border-dashed rounded p-5 text-center mb-3 ${dragAtivo ? 'border-primary bg-light' : 'border-secondary'}`}
                                    style={{
                                        borderStyle: 'dashed',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
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
                                        Apenas arquivos PDF - Máximo 10MB por arquivo - Até 50 arquivos por vez
                                    </p>
                                </div>

                                {/* Lista de arquivos selecionados para upload */}
                                {arquivosUpload.length > 0 && (
                                    <>
                                        <h6 className="mb-2">
                                            Arquivos selecionados ({arquivosUpload.length})
                                        </h6>
                                        <Table striped bordered hover size="sm" className="mb-3">
                                            <thead>
                                                <tr>
                                                    <th>Nome do Arquivo</th>
                                                    <th style={{ width: '100px' }}>Tamanho</th>
                                                    <th style={{ width: '80px' }}>Ação</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {arquivosUpload.map((file, idx) => (
                                                    <tr key={idx}>
                                                        <td>
                                                            <File size={14} className="text-danger me-2" />
                                                            {file.name}
                                                        </td>
                                                        <td>{formatarTamanhoArquivo(file.size)}</td>
                                                        <td className="text-center">
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

                                        {/* Barra de progresso */}
                                        {uploadando && (
                                            <ProgressBar
                                                now={progressoUpload}
                                                label={`${progressoUpload}%`}
                                                className="mb-3"
                                                animated
                                            />
                                        )}

                                        {/* Botões */}
                                        <div className="d-flex gap-2">
                                            <Button
                                                variant="success"
                                                onClick={fazerUpload}
                                                disabled={uploadando}
                                            >
                                                {uploadando ? (
                                                    <>
                                                        <Spinner size="sm" animation="border" className="me-2" />
                                                        Enviando...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Upload size={16} className="me-2" />
                                                        Enviar {arquivosUpload.length} arquivo(s)
                                                    </>
                                                )}
                                            </Button>
                                            <Button
                                                variant="outline-secondary"
                                                onClick={() => setArquivosUpload([])}
                                                disabled={uploadando}
                                            >
                                                Limpar Lista
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </Card.Body>
                        </Card>

                        {/* Arquivos Pendentes */}
                        <Card className="mb-4">
                            <Card.Header className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0">
                                    <Clock size={20} className="me-2" />
                                    Arquivos Pendentes
                                    {arquivosPendentes.length > 0 && (
                                        <Badge bg="warning" text="dark" className="ms-2">
                                            {arquivosPendentes.length}
                                        </Badge>
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
                                                <>
                                                    <Spinner size="sm" animation="border" className="me-2" />
                                                    Processando...
                                                </>
                                            ) : (
                                                <>
                                                    <Play size={14} className="me-1" />
                                                    Processar {selecionadosPendentes.length} arquivo(s)
                                                </>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </Card.Header>
                            <Card.Body>
                                {carregandoPendentes ? (
                                    <div className="text-center py-4">
                                        <Spinner animation="border" variant="primary" />
                                        <p className="mt-2 text-muted">Carregando arquivos pendentes...</p>
                                    </div>
                                ) : arquivosPendentes.length === 0 ? (
                                    <Alert variant="info" className="mb-0">
                                        <CheckCircle2 size={18} className="me-2" />
                                        Nenhum arquivo pendente de leitura. Faça upload de novas faturas acima.
                                    </Alert>
                                ) : (
                                    <Table striped bordered hover size="sm">
                                        <thead>
                                            <tr>
                                                <th style={{ width: '40px' }}>
                                                    <Form.Check
                                                        type="checkbox"
                                                        checked={selecionadosPendentes.length === arquivosPendentes.length}
                                                        onChange={toggleSelecionarTodos}
                                                    />
                                                </th>
                                                <th>Nome do Arquivo</th>
                                                <th style={{ width: '100px' }}>Tamanho</th>
                                                <th style={{ width: '180px' }}>Data Upload</th>
                                                <th style={{ width: '100px' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {arquivosPendentes.map((arquivo, idx) => (
                                                <tr key={idx}>
                                                    <td className="text-center">
                                                        <Form.Check
                                                            type="checkbox"
                                                            checked={selecionadosPendentes.includes(arquivo.nome)}
                                                            onChange={() => toggleSelecionadoPendente(arquivo.nome)}
                                                        />
                                                    </td>
                                                    <td>
                                                        <File size={14} className="text-danger me-2" />
                                                        {arquivo.nome}
                                                    </td>
                                                    <td>{formatarTamanhoArquivo(arquivo.tamanho)}</td>
                                                    <td>{new Date(arquivo.data_upload).toLocaleString('pt-BR')}</td>
                                                    <td className="text-center">
                                                        <Button
                                                            variant="outline-danger"
                                                            size="sm"
                                                            onClick={() => removerArquivoPendente(arquivo.nome)}
                                                            title="Remover arquivo"
                                                        >
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                )}
                            </Card.Body>
                        </Card>

                        {/* Jobs de Processamento */}
                        <Card>
                            <Card.Header className="d-flex justify-content-between align-items-center">
                                <h5 className="mb-0">
                                    <Loader size={20} className="me-2" />
                                    Jobs de Processamento
                                </h5>
                                <Button
                                    variant="outline-primary"
                                    size="sm"
                                    onClick={carregarJobsAtivos}
                                    disabled={carregandoJobs}
                                >
                                    <RefreshCw size={14} className={carregandoJobs ? 'spin' : ''} />
                                </Button>
                            </Card.Header>
                            <Card.Body>
                                {carregandoJobs ? (
                                    <div className="text-center py-4">
                                        <Spinner animation="border" variant="primary" />
                                        <p className="mt-2 text-muted">Carregando jobs...</p>
                                    </div>
                                ) : jobsAtivos.length === 0 ? (
                                    <Alert variant="secondary" className="mb-0">
                                        Nenhum job de processamento ativo no momento.
                                    </Alert>
                                ) : (
                                    <Table striped bordered hover size="sm">
                                        <thead>
                                            <tr>
                                                <th style={{ width: '120px' }}>Job ID</th>
                                                <th>Arquivo</th>
                                                <th style={{ width: '120px' }}>Status</th>
                                                <th style={{ width: '80px' }}>Tentativas</th>
                                                <th style={{ width: '180px' }}>Criado em</th>
                                                <th style={{ width: '180px' }}>Concluído em</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {jobsAtivos.map((job, idx) => {
                                                const statusInfo = getStatusJobBadge(job.status);
                                                const StatusIcon = statusInfo.icon;
                                                return (
                                                    <tr key={idx}>
                                                        <td>
                                                            <code>{job.job_id?.substring(0, 8) || '-'}</code>
                                                        </td>
                                                        <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {job.payload?.arquivo || job.pdf_url || '-'}
                                                        </td>
                                                        <td>
                                                            <Badge bg={statusInfo.bg} text={statusInfo.text}>
                                                                <StatusIcon size={12} className="me-1" />
                                                                {job.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="text-center">
                                                            {job.tentativas}/{job.max_tentativas}
                                                        </td>
                                                        <td>{new Date(job.criado_em).toLocaleString('pt-BR')}</td>
                                                        <td>{job.concluido_em ? new Date(job.concluido_em).toLocaleString('pt-BR') : '-'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </Table>
                                )}
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            </>
            )}

            {/* Conteúdo da Aba de Controle de Envios */}
            {abaAtiva === 'envios' && (
            <Row>
                <Col>
                    <Card>
                        <Card.Header className="d-flex justify-content-between align-items-center">
                            <h5 className="mb-0">
                                <Send size={20} className="me-2" />
                                Histórico de Envios
                            </h5>
                            <div className="d-flex gap-2">
                                <Button
                                    variant="outline-primary"
                                    size="sm"
                                    onClick={carregarHistoricoEnvios}
                                    disabled={carregandoEnvios}
                                >
                                    <RefreshCw size={14} className={carregandoEnvios ? 'spin' : ''} />
                                </Button>
                                <Button
                                    variant="success"
                                    size="sm"
                                    onClick={exportarExcel}
                                >
                                    <FileSpreadsheet size={14} className="me-1" />
                                    Exportar Excel
                                </Button>
                            </div>
                        </Card.Header>
                        <Card.Body>
                            {/* Filtros */}
                            <Row className="mb-3">
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label><Filter size={14} className="me-1" />Tipo</Form.Label>
                                        <Form.Select
                                            size="sm"
                                            value={filtroEnvios.tipo}
                                            onChange={(e) => setFiltroEnvios({...filtroEnvios, tipo: e.target.value})}
                                        >
                                            <option value="">Todos</option>
                                            <option value="whatsapp">WhatsApp</option>
                                            <option value="email">Email</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label>Status</Form.Label>
                                        <Form.Select
                                            size="sm"
                                            value={filtroEnvios.status}
                                            onChange={(e) => setFiltroEnvios({...filtroEnvios, status: e.target.value})}
                                        >
                                            <option value="">Todos</option>
                                            <option value="enviado">Enviado</option>
                                            <option value="falha">Falha</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={3}>
                                    <Form.Group>
                                        <Form.Label>Mês Referência</Form.Label>
                                        <Form.Control
                                            size="sm"
                                            type="text"
                                            placeholder="Ex: 11/2025"
                                            value={filtroEnvios.mes_referencia}
                                            onChange={(e) => setFiltroEnvios({...filtroEnvios, mes_referencia: e.target.value})}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={3} className="d-flex align-items-end">
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={carregarHistoricoEnvios}
                                        disabled={carregandoEnvios}
                                    >
                                        <Search size={14} className="me-1" />
                                        Filtrar
                                    </Button>
                                </Col>
                            </Row>

                            {/* Tabela de Envios */}
                            {carregandoEnvios ? (
                                <div className="text-center py-5">
                                    <Spinner animation="border" variant="primary" />
                                    <p className="mt-2 text-muted">Carregando...</p>
                                </div>
                            ) : historicoEnvios.length === 0 ? (
                                <div className="text-center py-5">
                                    <Send size={48} className="text-muted mb-3" />
                                    <p className="text-muted">Nenhum envio registrado</p>
                                </div>
                            ) : (
                                <>
                                    <Table striped hover responsive size="sm">
                                        <thead>
                                            <tr>
                                                <th>Data/Hora</th>
                                                <th>Tipo</th>
                                                <th>Arquivo</th>
                                                <th>Destinatário</th>
                                                <th>Mês Ref.</th>
                                                <th>Status</th>
                                                <th>Enviado por</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historicoEnvios.map((envio, idx) => (
                                                <tr key={idx}>
                                                    <td style={{whiteSpace: 'nowrap'}}>{formatarData(envio.data_envio)}</td>
                                                    <td>
                                                        {envio.tipo_envio === 'whatsapp' ? (
                                                            <Badge bg="success" title="WhatsApp"><i className="fab fa-whatsapp me-1"></i>OK</Badge>
                                                        ) : (
                                                            <Badge bg="info" title="Email"><i className="fas fa-envelope me-1"></i>OK</Badge>
                                                        )}
                                                    </td>
                                                    <td style={{maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={envio.arquivo}>
                                                        {envio.arquivo}
                                                    </td>
                                                    <td>{envio.destinatario}</td>
                                                    <td>{envio.mes_referencia}</td>
                                                    <td>
                                                        {envio.status === 'enviado' ? (
                                                            <Badge bg="success"><CheckCircle size={12} className="me-1" />Enviado</Badge>
                                                        ) : (
                                                            <Badge bg="danger"><AlertCircle size={12} className="me-1" />Falha</Badge>
                                                        )}
                                                    </td>
                                                    <td style={{maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={envio.enviado_por}>
                                                        {envio.enviado_por}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                    <div className="text-muted">
                                        <small>Total: {historicoEnvios.length} registro(s)</small>
                                    </div>
                                </>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>
            )}

            {/* Modal de Envio */}
            <Modal show={modalEnvio} onHide={fecharModalEnvio} centered>
                <Modal.Header closeButton>
                    <Modal.Title>
                        {tipoEnvio === 'whatsapp' ? (
                            <><MessageCircle size={20} className="me-2 text-success" />Enviar por WhatsApp</>
                        ) : (
                            <><Mail size={20} className="me-2 text-warning" />Enviar por Email</>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {arquivoParaEnvio && (
                        <>
                            <div className="mb-3 p-3 bg-light rounded">
                                <small className="text-muted d-block">Arquivo selecionado:</small>
                                <strong className="text-break">{arquivoParaEnvio.nome}</strong>
                                <div className="mt-1">
                                    <small className="text-muted">Pasta: 02. NET (Boleto)</small>
                                </div>
                            </div>

                            <Form.Group className="mb-3">
                                <Form.Label>
                                    {tipoEnvio === 'whatsapp' ? 'Telefone (com DDD)' : 'Email Principal'}
                                </Form.Label>
                                <InputGroup>
                                    {tipoEnvio === 'whatsapp' && (
                                        <InputGroup.Text>+55</InputGroup.Text>
                                    )}
                                    <Form.Control
                                        type={tipoEnvio === 'whatsapp' ? 'tel' : 'email'}
                                        placeholder={tipoEnvio === 'whatsapp' ? '62999999999' : 'exemplo@email.com'}
                                        value={destinatario}
                                        onChange={(e) => setDestinatario(e.target.value)}
                                        disabled={enviando}
                                    />
                                </InputGroup>
                                <Form.Text className="text-muted">
                                    {tipoEnvio === 'whatsapp'
                                        ? 'Digite apenas números (DDD + número)'
                                        : 'Informe o email principal do destinatário'}
                                </Form.Text>
                            </Form.Group>

                            {/* Email secundário - apenas para tipo email */}
                            {tipoEnvio === 'email' && (
                                <Form.Group className="mb-3">
                                    <Form.Label>Email Secundário (opcional)</Form.Label>
                                    <Form.Control
                                        type="email"
                                        placeholder="segundo@email.com"
                                        value={destinatarioSecundario}
                                        onChange={(e) => setDestinatarioSecundario(e.target.value)}
                                        disabled={enviando}
                                    />
                                    <Form.Text className="text-muted">
                                        Se preenchido, a fatura será enviada para ambos os emails
                                    </Form.Text>
                                </Form.Group>
                            )}

                            {/* Status de envio */}
                            {statusEnvio && (
                                <div className={`alert alert-${statusEnvio.tipo === 'success' ? 'success' : statusEnvio.tipo === 'warning' ? 'warning' : 'danger'} d-flex align-items-start`}>
                                    {statusEnvio.tipo === 'success' ? (
                                        <CheckCircle size={20} className="me-2 flex-shrink-0" />
                                    ) : (
                                        <AlertCircle size={20} className="me-2 flex-shrink-0" />
                                    )}
                                    <div>
                                        <div>{statusEnvio.mensagem}</div>
                                        {statusEnvio.jaEnviado && (
                                            <Form.Check
                                                type="checkbox"
                                                label="Enviar novamente mesmo assim"
                                                className="mt-2"
                                                checked={forcarReenvio}
                                                onChange={(e) => setForcarReenvio(e.target.checked)}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={fecharModalEnvio} disabled={enviando}>
                        Cancelar
                    </Button>
                    <Button
                        variant={tipoEnvio === 'whatsapp' ? 'success' : 'warning'}
                        onClick={enviarArquivo}
                        disabled={enviando || !destinatario.trim()}
                    >
                        {enviando ? (
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
        </Container>
    );
}

export default SistemaFaturas;
