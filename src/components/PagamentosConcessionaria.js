import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Form, Row, Col, Badge, Spinner, Alert, Modal, ButtonGroup, OverlayTrigger, Tooltip, Tabs, Tab } from 'react-bootstrap';
import { formatarValor } from '../utils/formatters';
import { Send, Banknote, MessageCircle, Mail, CheckCircle, XCircle, Edit3, Trash2, Settings, RotateCcw, Upload } from 'lucide-react';

function PagamentosConcessionaria() {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  // Dados
  const [pagamentos, setPagamentos] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [ugs, setUgs] = useState([]); // UGs autorizadas com faturas

  // Filtros
  const [mesReferencia, setMesReferencia] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroUC, setFiltroUC] = useState('');
  const [mesesDisponiveis, setMesesDisponiveis] = useState([]);
  const [abaAtiva, setAbaAtiva] = useState('lote'); // 'lote' ou 'enviar'

  // Modal de código de barras
  const [showModalCodigo, setShowModalCodigo] = useState(false);
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState(null);
  const [codigoBarras, setCodigoBarras] = useState('');
  const [pixCopaCola, setPixCopaCola] = useState('');

  // Modal de confirmação de lançamento de pagamento
  const [showModalLancar, setShowModalLancar] = useState(false);
  const [pagamentoParaLancar, setPagamentoParaLancar] = useState(null);
  const [lancandoPagamento, setLancandoPagamento] = useState(false);
  const [novaDataPagamento, setNovaDataPagamento] = useState('');
  const [vencimentoPassou, setVencimentoPassou] = useState(false);

  // Modal de envio de fatura original EQTL
  const [modalEnvioFatura, setModalEnvioFatura] = useState({
    show: false,
    pagamento: null,
    tipoEnvio: 'whatsapp', // 'whatsapp', 'email' ou 'ambos'
    telefone: '',
    email: '',
    emailSecundario: '',
    enviando: false,
    statusEnvio: null, // { tipo: 'success'|'error'|'warning', mensagem: '' }
    forcarReenvio: false,
    abaAtiva: 'envio',
    mensagemWhatsapp: '',
    mensagemEmail: '',
    assuntoEmail: '',
    mensagemEditada: false
  });

  // Seleção para lançamento em lote
  const [selecionados, setSelecionados] = useState([]);

  // Modal de lançamento em lote (BB)
  const [modalLancamentoLote, setModalLancamentoLote] = useState({
    show: false,
    processando: false,
    total: 0,
    atual: 0,
    sucessos: 0,
    erros: 0,
    resultados: [],
    concluido: false,
    itens: []
  });

  // Modal de lançamento individual no Control
  const [showModalLancarControl, setShowModalLancarControl] = useState(false);

  // Modal de lançamento em lote (Control)
  const [modalLancamentoControl, setModalLancamentoControl] = useState({
    show: false,
    processando: false,
    total: 0,
    atual: 0,
    sucessos: 0,
    erros: 0,
    resultados: [],
    concluido: false,
    itens: []
  });

  // Modal de cancelamento no BB
  const [modalCancelar, setModalCancelar] = useState({
    show: false,
    pagamento: null,
    cancelando: false,
    erroBB: null
  });

  // Modal de configuração forçada (tipo e status)
  const [modalConfig, setModalConfig] = useState({
    show: false,
    etapa: 'senha', // 'senha' ou 'config'
    pagamento: null,
    senha: '',
    tipoForcado: '', // 'lote' ou 'enviar'
    novoStatus: '',  // status para tipo 'lote'
    marcarWhatsapp: false, // para tipo 'enviar'
    marcarEmail: false,    // para tipo 'enviar'
    processando: false,
    erro: null
  });

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  // Função para parsear data brasileira "DD/MM/YY" ou "DD/MM/YYYY"
  const parseDataBrasileira = (dataStr) => {
    if (!dataStr) return null;
    // Formato ISO: YYYY-MM-DD
    if (dataStr.includes('-') && dataStr.length >= 10) {
      const partes = dataStr.split('-');
      if (partes.length >= 3) {
        return new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
      }
    }
    // Formato brasileiro: DD/MM/YYYY
    const partes = dataStr.split('/');
    if (partes.length !== 3) return null;
    const dia = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10) - 1; // mês é 0-indexed
    let ano = parseInt(partes[2], 10);
    // Se ano tem 2 dígitos, assumir 20xx
    if (ano < 100) ano += 2000;
    return new Date(ano, mes, dia);
  };

  // Função para determinar classe CSS da linha (sem coloração por vencimento)
  const getClasseLinha = (dataVencimentoStr, status) => {
    return '';
  };

  // Função para ordenar pagamentos por vencimento (mais próximo primeiro)
  const ordenarPorVencimento = (lista) => {
    return [...lista].sort((a, b) => {
      const dataA = parseDataBrasileira(a.data_vencimento_fatura);
      const dataB = parseDataBrasileira(b.data_vencimento_fatura);

      // Itens sem data vão para o final
      if (!dataA && !dataB) return 0;
      if (!dataA) return 1;
      if (!dataB) return -1;

      return dataA - dataB;
    });
  };

  // Carregar meses disponíveis
  useEffect(() => {
    const carregarMeses = async () => {
      try {
        const response = await fetch(`${API_URL}/api/meses-disponiveis-boletos`);
        if (response.ok) {
          const data = await response.json();
          setMesesDisponiveis(data.meses || []);
          if (data.meses && data.meses.length > 0) {
            setMesReferencia(data.meses[0]);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar meses:', err);
      }
    };
    carregarMeses();
  }, [API_URL]);

  // Carregar dados quando mês mudar
  const carregarDados = useCallback(async () => {
    if (!mesReferencia) return;

    setLoading(true);
    setErro(null);

    try {
      // Carregar pagamentos
      let url = `${API_URL}/api/pagamentos-concessionaria?mes_referencia=${mesReferencia}`;
      if (filtroStatus) {
        url += `&status=${filtroStatus}`;
      }

      const [pagResponse, resumoResponse] = await Promise.all([
        fetch(url),
        fetch(`${API_URL}/api/pagamentos-concessionaria/resumo/${mesReferencia}`)
      ]);

      if (pagResponse.ok) {
        const data = await pagResponse.json();
        setPagamentos(data.pagamentos || []);
      }

      if (resumoResponse.ok) {
        const data = await resumoResponse.json();
        setResumo(data);
      }

      // Carregar UGs autorizadas com faturas do mes
      const ugsResponse = await fetch(`${API_URL}/api/pagamentos-concessionaria/ugs/${mesReferencia}`);
      if (ugsResponse.ok) {
        const data = await ugsResponse.json();
        setUgs(data.ugs || []);
      }

    } catch (err) {
      setErro('Erro ao carregar dados: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [API_URL, mesReferencia, filtroStatus]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Abrir modal para editar código de barras
  const handleEditarCodigo = (pagamento) => {
    setPagamentoSelecionado(pagamento);
    setCodigoBarras(pagamento.codigo_barras || '');
    setPixCopaCola(pagamento.pix_copia_cola || '');
    setShowModalCodigo(true);
  };

  // Salvar código de barras
  const handleSalvarCodigo = async () => {
    if (!pagamentoSelecionado) return;

    try {
      setLoading(true);

      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/${pagamentoSelecionado.id}/codigo-barras`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo_barras: codigoBarras || null,
          pix_copia_cola: pixCopaCola || null
        })
      });

      if (response.ok) {
        setSucesso('Código atualizado com sucesso');
        setShowModalCodigo(false);
        carregarDados();
      } else {
        const data = await response.json();
        setErro(data.error || 'Erro ao salvar');
      }

    } catch (err) {
      setErro('Erro ao salvar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Abre modal de confirmação para lançar pagamento
  const handleLancarPagamento = (pagamento) => {
    // Exige código de barras para lançar
    if (!pagamento.codigo_barras) {
      setErro('Codigo de barras nao encontrado. Nao e possivel lancar pagamento.');
      return;
    }

    // Verificar se a data de vencimento já passou
    const dataVenc = parseDataBrasileira(pagamento.data_vencimento_fatura);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const passou = dataVenc && dataVenc < hoje;
    setVencimentoPassou(passou);

    // Se passou, sugerir hoje como nova data
    if (passou) {
      const hojeData = new Date();
      const ano = hojeData.getFullYear();
      const mes = String(hojeData.getMonth() + 1).padStart(2, '0');
      const dia = String(hojeData.getDate()).padStart(2, '0');
      setNovaDataPagamento(`${ano}-${mes}-${dia}`);
    } else {
      setNovaDataPagamento('');
    }

    setPagamentoParaLancar(pagamento);
    setShowModalLancar(true);
  };

  // Confirma e executa o lançamento do pagamento
  const confirmarLancamento = async () => {
    if (!pagamentoParaLancar) return;

    // Se vencimento passou, exige nova data
    if (vencimentoPassou && !novaDataPagamento) {
      setErro('Informe uma nova data de pagamento');
      return;
    }

    try {
      setLancandoPagamento(true);
      setErro(null);

      // Preparar payload com nova data se necessário
      const payload = { nome_cliente: pagamentoParaLancar?.nome_cliente || null };
      if (novaDataPagamento) {
        // Enviar no formato ISO (yyyy-mm-dd) que é confiável para new Date()
        payload.data_pagamento = novaDataPagamento;
      }

      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/lancar/${pagamentoParaLancar.fatura_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok) {
        setSucesso(`Pagamento enviado para o Banco do Brasil! UC: ${pagamentoParaLancar.uc} - Requisição: ${data.pagamento?.numero_requisicao || 'N/A'}`);
        setShowModalLancar(false);
        setPagamentoParaLancar(null);

        // Sincronizar status automaticamente após lançamento
        await sincronizarStatusAutomatico();
        carregarDados();
      } else {
        setErro(data.error || data.message || 'Erro ao lancar pagamento');
      }

    } catch (err) {
      setErro('Erro ao lancar: ' + err.message);
    } finally {
      setLancandoPagamento(false);
    }
  };

  // ========================================
  // SELEÇÃO E LANÇAMENTO EM LOTE
  // ========================================

  // Toggle seleção de um item
  const toggleSelecao = (faturaId) => {
    setSelecionados(prev =>
      prev.includes(faturaId)
        ? prev.filter(id => id !== faturaId)
        : [...prev, faturaId]
    );
  };

  // Toggle todos os itens selecionáveis (pendentes com código de barras)
  // Determinar tipo efetivo do item (considera tipo_forcado)
  const getTipoEfetivo = (pag) => {
    // Se tem tipo forçado, usa ele
    if (pag.tipo_forcado) {
      return pag.tipo_forcado; // 'lote' ou 'enviar'
    }
    // Para ir para 'lote' precisa ter boleto_energia OU ser UG
    // Caso contrário, vai para 'enviar' (cliente paga direto à concessionária)
    if (!pag.tem_boleto_energia && !pag.is_ug) {
      return 'enviar';
    }
    // Se tem boleto ou é UG, usa nome_diferente para decidir
    return pag.nome_diferente ? 'enviar' : 'lote';
  };

  // Filtrar itens por tipo (considerando tipo_forcado)
  const isItemDoTipo = (pag, tipo) => {
    return getTipoEfetivo(pag) === tipo;
  };

  const toggleTodos = () => {
    // Só seleciona itens que são do tipo 'lote'
    const itensLancaveis = pagamentos.filter(pag =>
      pag.status === 'pendente' &&
      pag.codigo_barras &&
      (pag.tem_boleto_energia || pag.is_ug) &&
      isItemDoTipo(pag, 'lote')
    );

    if (selecionados.length === itensLancaveis.length && itensLancaveis.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(itensLancaveis.map(pag => pag.fatura_id));
    }
  };

  // Verificar se item é selecionável (apenas itens do tipo 'lote')
  const isItemSelecionavel = (pag) => {
    return pag.status === 'pendente' &&
           pag.codigo_barras &&
           (pag.tem_boleto_energia || pag.is_ug) &&
           isItemDoTipo(pag, 'lote');
  };

  // Iniciar lançamento em lote
  const iniciarLancamentoLote = () => {
    const itensParaLancar = pagamentos.filter(pag =>
      selecionados.includes(pag.fatura_id) &&
      pag.status === 'pendente' &&
      pag.codigo_barras
    );

    if (itensParaLancar.length === 0) {
      setErro('Nenhum item válido para lançamento');
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

  // Executar lançamento em lote
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
        const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/lancar/${item.fatura_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome_cliente: item.nome_cliente || null })
        });

        const data = await response.json();

        if (response.ok && data.pagamento) {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: true,
            mensagem: `Requisição ${data.pagamento.numero_requisicao}`
          });
          sucessos++;
        } else {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: false,
            mensagem: data.error || data.message || 'Erro desconhecido'
          });
          erros++;
        }
      } catch (error) {
        resultados.push({
          uc: item.uc,
          nome: item.nome_cliente,
          sucesso: false,
          mensagem: error.message
        });
        erros++;
      }

      // Pequeno delay entre requisições
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

    // Sincronizar status e recarregar dados após conclusão
    if (sucessos > 0) {
      await sincronizarStatusAutomatico();
      carregarDados();
    }
  };

  // Fechar modal de lançamento em lote
  const fecharModalLancamentoLote = () => {
    setModalLancamentoLote({
      show: false,
      processando: false,
      total: 0,
      atual: 0,
      sucessos: 0,
      erros: 0,
      resultados: [],
      concluido: false,
      itens: []
    });
    setSelecionados([]);
  };

  // ========================================
  // LANÇAMENTO NO AUPUS CONTROL
  // ========================================

  // Lançar individual no Control
  const handleLancarControl = (pagamento) => {
    if (!pagamento.codigo_barras) {
      setErro('Código de barras não encontrado.');
      return;
    }
    setPagamentoParaLancar(pagamento);
    setShowModalLancarControl(true);
  };

  // Confirmar lançamento individual no Control
  const confirmarLancamentoControl = async () => {
    if (!pagamentoParaLancar) return;
    try {
      setLancandoPagamento(true);
      setErro(null);

      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/lancar-control/${pagamentoParaLancar.fatura_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome_cliente: pagamentoParaLancar?.nome_cliente || null })
      });

      const data = await response.json();

      if (response.ok) {
        setSucesso(`Lançado no Aupus Control! UC: ${pagamentoParaLancar.uc} - ID: ${data.control_lancamento_id || 'OK'}`);
        setShowModalLancarControl(false);
        setPagamentoParaLancar(null);
        carregarDados();
      } else {
        setErro(data.error || data.message || 'Erro ao lançar no Control');
      }
    } catch (err) {
      setErro('Erro ao lançar no Control: ' + err.message);
    } finally {
      setLancandoPagamento(false);
    }
  };

  // Iniciar lançamento em lote no Control
  const iniciarLancamentoLoteControl = () => {
    const itensParaLancar = pagamentos.filter(pag =>
      selecionados.includes(pag.fatura_id) &&
      pag.status_control !== 'lancado' &&
      pag.codigo_barras
    );

    if (itensParaLancar.length === 0) {
      setErro('Nenhum item selecionado é elegível para lançamento no Control');
      return;
    }

    setModalLancamentoControl({
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

  // Executar lançamento em lote no Control
  const executarLancamentoLoteControl = async () => {
    const { itens } = modalLancamentoControl;

    setModalLancamentoControl(prev => ({ ...prev, processando: true }));

    const resultados = [];
    let sucessos = 0;
    let erros = 0;

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];

      setModalLancamentoControl(prev => ({
        ...prev,
        atual: i + 1,
        resultados: [...resultados]
      }));

      try {
        const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/lancar-control/${item.fatura_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome_cliente: item.nome_cliente || null })
        });

        const data = await response.json();

        if (response.ok) {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: true,
            mensagem: `ID ${data.control_lancamento_id}`
          });
          sucessos++;
        } else {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: false,
            mensagem: data.error || data.message || 'Erro desconhecido'
          });
          erros++;
        }
      } catch (error) {
        resultados.push({
          uc: item.uc,
          nome: item.nome_cliente,
          sucesso: false,
          mensagem: error.message
        });
        erros++;
      }

      if (i < itens.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setModalLancamentoControl(prev => ({
      ...prev,
      processando: false,
      concluido: true,
      sucessos,
      erros,
      resultados
    }));

    if (sucessos > 0) {
      carregarDados();
    }
  };

  // Fechar modal de lançamento Control em lote
  const fecharModalLancamentoControl = () => {
    setModalLancamentoControl({
      show: false,
      processando: false,
      total: 0,
      atual: 0,
      sucessos: 0,
      erros: 0,
      resultados: [],
      concluido: false,
      itens: []
    });
    setSelecionados([]);
  };

  // Sincronizar status com API BB (automático, sem confirmação)
  const sincronizarStatusAutomatico = async (silencioso = false) => {
    try {
      if (!silencioso) {
        console.log('🔄 Sincronizando status automaticamente...');
      }

      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/sincronizar-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (response.ok && data.sincronizados > 0 && !silencioso) {
        console.log(`✅ ${data.sincronizados} pagamentos atualizados`);
      }

      return data;
    } catch (err) {
      console.error('Erro ao sincronizar:', err.message);
      return null;
    }
  };

  // Sincronizar status com API BB (manual, com confirmação)
  const handleSincronizarStatus = async () => {
    if (!window.confirm('Sincronizar status dos pagamentos lançados com a API do Banco do Brasil? (Apenas pagamentos enviados via BB serão sincronizados)')) {
      return;
    }

    try {
      setLoading(true);
      setErro(null);

      const data = await sincronizarStatusAutomatico(true);

      if (data) {
        if (data.sincronizados > 0) {
          setSucesso(`Sincronizacao concluida: ${data.sincronizados} pagamentos atualizados`);
        } else {
          setSucesso('Nenhum pagamento teve status alterado');
        }
        carregarDados();
      } else {
        setErro('Erro ao sincronizar');
      }

    } catch (err) {
      setErro('Erro ao sincronizar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Exportar para Excel formatado (via servidor)
  const exportarExcel = async () => {
    if (!mesReferencia) {
      setErro('Selecione um mês de referência');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/exportar/${encodeURIComponent(mesReferencia)}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.erro || 'Erro ao exportar');
      }

      // Baixar o arquivo
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EQTL_Pagamentos_${mesReferencia.replace('/', '_')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      setSucesso('Planilha exportada com sucesso!');
    } catch (err) {
      setErro('Erro ao exportar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Gerar mensagem padrão WhatsApp para fatura EQTL
  const gerarMensagemWhatsappFatura = (pagamento) => {
    const nomeCliente = pagamento.nome_cliente || 'Cliente';
    const primeiroNome = nomeCliente.split(' ')[0];
    return `Ola ${primeiroNome}! Segue sua fatura de energia EQTL referente a ${pagamento.mes_referencia}.\n\nUnidade Consumidora: ${pagamento.uc}\nValor: ${formatarValor(pagamento.valor_fatura)}\nVencimento: ${pagamento.data_vencimento_fatura || '-'}\n\n[LINK]\n\nAtenciosamente,\nAUPUS Energia`;
  };

  // Gerar assunto padrão Email para fatura EQTL
  const gerarAssuntoEmailFatura = (pagamento) => {
    return `Fatura EQTL - UC ${pagamento.uc} - ${pagamento.mes_referencia}`;
  };

  // Gerar mensagem padrão Email para fatura EQTL
  const gerarMensagemEmailFatura = (pagamento) => {
    const nomeCliente = pagamento.nome_cliente || 'Cliente';
    return `Prezado(a) ${nomeCliente},\n\nSegue em anexo sua fatura de energia EQTL referente ao mes de ${pagamento.mes_referencia}.\n\nUnidade Consumidora: ${pagamento.uc}\nValor: ${formatarValor(pagamento.valor_fatura)}\nVencimento: ${pagamento.data_vencimento_fatura || '-'}\n\nAtenciosamente,\nAUPUS Energia`;
  };

  // Abrir modal de envio de fatura original
  const handleEnviarFatura = (pagamento) => {
    setModalEnvioFatura({
      show: true,
      pagamento: pagamento,
      tipoEnvio: 'whatsapp',
      telefone: pagamento.whatsapp || '',
      email: pagamento.email || '',
      emailSecundario: '',
      enviando: false,
      statusEnvio: null,
      forcarReenvio: false,
      abaAtiva: 'envio',
      mensagemWhatsapp: gerarMensagemWhatsappFatura(pagamento),
      mensagemEmail: gerarMensagemEmailFatura(pagamento),
      assuntoEmail: gerarAssuntoEmailFatura(pagamento),
      mensagemEditada: false
    });
  };

  // Fechar modal de envio de fatura
  const fecharModalEnvioFatura = () => {
    setModalEnvioFatura({
      show: false,
      pagamento: null,
      tipoEnvio: 'whatsapp',
      telefone: '',
      email: '',
      emailSecundario: '',
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

  // Executar envio de fatura original EQTL
  const executarEnvioFatura = async () => {
    const { pagamento, tipoEnvio, telefone, email, emailSecundario, forcarReenvio, mensagemWhatsapp, mensagemEmail, assuntoEmail } = modalEnvioFatura;

    // Validacoes
    if ((tipoEnvio === 'whatsapp' || tipoEnvio === 'ambos') && !telefone) {
      setModalEnvioFatura(prev => ({ ...prev, statusEnvio: { tipo: 'error', mensagem: 'Informe o telefone para envio por WhatsApp' } }));
      return;
    }
    if ((tipoEnvio === 'email' || tipoEnvio === 'ambos') && !email) {
      setModalEnvioFatura(prev => ({ ...prev, statusEnvio: { tipo: 'error', mensagem: 'Informe o email para envio por Email' } }));
      return;
    }

    setModalEnvioFatura(prev => ({ ...prev, enviando: true, statusEnvio: null }));

    try {
      let resultados = [];

      // Enviar por WhatsApp
      if (tipoEnvio === 'whatsapp' || tipoEnvio === 'ambos') {
        try {
          const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/enviar-fatura-whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fatura_id: pagamento.fatura_id,
              uc: pagamento.uc,
              mes_referencia: pagamento.mes_referencia,
              telefone: telefone,
              forcar_reenvio: forcarReenvio,
              mensagem_customizada: mensagemWhatsapp
            })
          });
          const data = await response.json();
          if (response.ok) {
            resultados.push({ tipo: 'WhatsApp', sucesso: true });
          } else {
            if (response.status === 409 && data.ja_enviado) {
              setModalEnvioFatura(prev => ({
                ...prev,
                enviando: false,
                statusEnvio: { tipo: 'warning', mensagem: `WhatsApp: ${data.mensagem}`, jaEnviado: true }
              }));
              return;
            }
            resultados.push({ tipo: 'WhatsApp', sucesso: false, erro: data.error || data.message });
          }
        } catch (error) {
          resultados.push({ tipo: 'WhatsApp', sucesso: false, erro: error.message });
        }
      }

      // Enviar por Email
      if (tipoEnvio === 'email' || tipoEnvio === 'ambos') {
        try {
          const payloadEmail = {
            fatura_id: pagamento.fatura_id,
            uc: pagamento.uc,
            mes_referencia: pagamento.mes_referencia,
            email: email,
            forcar_reenvio: forcarReenvio,
            assunto_customizado: assuntoEmail,
            mensagem_customizada: mensagemEmail
          };
          if (emailSecundario && emailSecundario.trim()) {
            payloadEmail.email_secundario = emailSecundario.trim();
          }
          const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/enviar-fatura-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadEmail)
          });
          const data = await response.json();
          if (response.ok) {
            resultados.push({ tipo: 'Email', sucesso: true });
          } else {
            if (response.status === 409 && data.ja_enviado) {
              setModalEnvioFatura(prev => ({
                ...prev,
                enviando: false,
                statusEnvio: { tipo: 'warning', mensagem: `Email: ${data.mensagem}`, jaEnviado: true }
              }));
              return;
            }
            resultados.push({ tipo: 'Email', sucesso: false, erro: data.error || data.message });
          }
        } catch (error) {
          resultados.push({ tipo: 'Email', sucesso: false, erro: error.message });
        }
      }

      // Verificar resultados
      const sucessos = resultados.filter(r => r.sucesso);
      const falhas = resultados.filter(r => !r.sucesso);

      if (falhas.length === 0) {
        setModalEnvioFatura(prev => ({
          ...prev,
          enviando: false,
          statusEnvio: { tipo: 'success', mensagem: `Fatura enviada com sucesso via ${sucessos.map(s => s.tipo).join(' e ')}!` }
        }));
        setSucesso(`Fatura EQTL enviada com sucesso!`);
        setTimeout(() => fecharModalEnvioFatura(), 2000);
      } else if (sucessos.length > 0) {
        setModalEnvioFatura(prev => ({
          ...prev,
          enviando: false,
          statusEnvio: { tipo: 'warning', mensagem: `${sucessos.map(s => s.tipo).join(', ')}: OK | ${falhas.map(f => `${f.tipo}: ${f.erro}`).join(', ')}` }
        }));
      } else {
        setModalEnvioFatura(prev => ({
          ...prev,
          enviando: false,
          statusEnvio: { tipo: 'error', mensagem: falhas.map(f => `${f.tipo}: ${f.erro}`).join(' | ') }
        }));
      }

    } catch (error) {
      console.error('Erro ao enviar fatura:', error);
      setModalEnvioFatura(prev => ({
        ...prev,
        enviando: false,
        statusEnvio: { tipo: 'error', mensagem: error.message || 'Erro desconhecido ao enviar' }
      }));
    }
  };

  // Cancelar pagamento - só funciona se já existe registro de pagamento
  const handleCancelarPagamento = async (pagamento) => {
    if (!pagamento.pagamento_id) {
      setErro('Este pagamento ainda não foi lançado');
      return;
    }

    if (!window.confirm(`Cancelar pagamento da UC ${pagamento.uc}?`)) {
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/${pagamento.pagamento_id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setSucesso('Pagamento cancelado');
        carregarDados();
      } else {
        const data = await response.json();
        setErro(data.error || 'Erro ao cancelar');
      }

    } catch (err) {
      setErro('Erro ao cancelar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Status que permitem cancelamento no BB
  const statusCancelaveis = ['lancado', 'aguardando_aprovacao', 'pendente_bb', 'consistente', 'processando'];

  // Verificar se pagamento pode ser cancelado no BB
  const podeCancelarNoBB = (pag) => {
    return pag.pagamento_id && statusCancelaveis.includes(pag.status);
  };

  // Abrir modal de cancelamento no BB
  const handleAbrirCancelar = (pagamento) => {
    setModalCancelar({
      show: true,
      pagamento: pagamento,
      cancelando: false
    });
  };

  // Executar cancelamento no BB
  const executarCancelamentoBB = async (forcar = false) => {
    const { pagamento } = modalCancelar;
    if (!pagamento) return;

    setModalCancelar(prev => ({ ...prev, cancelando: true }));

    try {
      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/${pagamento.pagamento_id}/cancelar-bb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forcar })
      });

      const data = await response.json();

      if (response.ok) {
        const msg = data.forcado
          ? `Pagamento cancelado localmente (forçado). UC: ${pagamento.uc}`
          : `Pagamento cancelado com sucesso no BB! UC: ${pagamento.uc}`;
        setSucesso(msg);
        setModalCancelar({ show: false, pagamento: null, cancelando: false, erroBB: null });
        carregarDados();
      } else {
        const errMsg = data.message || data.error || 'Erro ao cancelar no BB';
        if (data.podeForcar || data.jaProcessado) {
          setModalCancelar(prev => ({ ...prev, cancelando: false, erroBB: errMsg }));
        } else {
          setErro(errMsg);
          setModalCancelar(prev => ({ ...prev, cancelando: false }));
        }
      }
    } catch (err) {
      setErro('Erro ao cancelar: ' + err.message);
      setModalCancelar(prev => ({ ...prev, cancelando: false }));
    }
  };

  // Copiar para clipboard
  const handleCopiar = async (texto, tipo) => {
    try {
      await navigator.clipboard.writeText(texto);
      setSucesso(`${tipo} copiado para a area de transferencia!`);
      setTimeout(() => setSucesso(null), 2000);
    } catch (err) {
      setErro('Erro ao copiar: ' + err.message);
    }
  };

  // Abrir modal de configuração forçada (primeira etapa: senha)
  const handleAbrirConfig = (pagamento) => {
    setModalConfig({
      show: true,
      etapa: 'senha',
      pagamento: pagamento,
      senha: '',
      tipoForcado: '',
      novoStatus: '',
      marcarWhatsapp: false,
      marcarEmail: false,
      processando: false,
      erro: null
    });
  };

  // Fechar modal de configuração
  const fecharModalConfig = () => {
    setModalConfig({
      show: false,
      etapa: 'senha',
      pagamento: null,
      senha: '',
      tipoForcado: '',
      novoStatus: '',
      marcarWhatsapp: false,
      marcarEmail: false,
      processando: false,
      erro: null
    });
  };

  // Validar senha e ir para etapa de configuração
  const validarSenhaConfig = () => {
    const { pagamento, senha } = modalConfig;
    const SENHA_CONFIG = 'DevSmart123';

    if (!senha) {
      setModalConfig(prev => ({ ...prev, erro: 'Informe a senha' }));
      return;
    }

    if (senha !== SENHA_CONFIG) {
      setModalConfig(prev => ({ ...prev, erro: 'Senha incorreta' }));
      return;
    }

    // Determinar tipo atual (baseado em tipo_forcado ou nome_diferente)
    const tipoAtual = pagamento.tipo_forcado || (pagamento.nome_diferente ? 'enviar' : 'lote');

    // Senha correta, ir para etapa de configuração
    setModalConfig(prev => ({
      ...prev,
      etapa: 'config',
      tipoForcado: tipoAtual,
      novoStatus: pagamento.status || 'pendente',
      marcarWhatsapp: !!pagamento.data_envio_whatsapp,
      marcarEmail: !!pagamento.data_envio_email,
      erro: null
    }));
  };

  // Aplicar configuração forçada
  const aplicarConfigForcada = async () => {
    const { pagamento, senha, tipoForcado, novoStatus, marcarWhatsapp, marcarEmail } = modalConfig;
    if (!pagamento) return;

    setModalConfig(prev => ({ ...prev, processando: true, erro: null }));

    try {
      const payload = {
        senha,
        fatura_id: pagamento.fatura_id,
        tipo_forcado: tipoForcado
      };

      // Se tipo é 'lote', envia o status
      if (tipoForcado === 'lote') {
        payload.novo_status = novoStatus;
      }

      // Se tipo é 'enviar', envia os checkboxes de envio
      if (tipoForcado === 'enviar') {
        payload.marcar_enviado_whatsapp = marcarWhatsapp;
        payload.marcar_enviado_email = marcarEmail;
      }

      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/forcar-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok) {
        setSucesso(`Configuracao forcada aplicada para UC ${pagamento.uc}`);
        fecharModalConfig();
        carregarDados();
      } else {
        setModalConfig(prev => ({ ...prev, processando: false, erro: data.error || 'Erro ao aplicar' }));
      }
    } catch (err) {
      setModalConfig(prev => ({ ...prev, processando: false, erro: err.message }));
    }
  };

  // Reverter para configuração original
  const reverterConfigOriginal = async () => {
    const { pagamento, senha } = modalConfig;
    if (!pagamento) return;

    setModalConfig(prev => ({ ...prev, processando: true, erro: null }));

    try {
      const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/reverter-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha, fatura_id: pagamento.fatura_id })
      });

      const data = await response.json();

      if (response.ok) {
        setSucesso(`Configuracao revertida para UC ${pagamento.uc}`);
        fecharModalConfig();
        carregarDados();
      } else {
        setModalConfig(prev => ({ ...prev, processando: false, erro: data.error || 'Erro ao reverter' }));
      }
    } catch (err) {
      setModalConfig(prev => ({ ...prev, processando: false, erro: err.message }));
    }
  };

  // Lista de status possíveis para Pagamento em Lote
  const statusLoteDisponiveis = [
    { value: 'pendente', label: 'Pendente' },
    { value: 'aguardando_aprovacao', label: 'Aguardando Aprovação' },
    { value: 'processando_pagamento', label: 'Proc. Pagamento' },
    { value: 'pago', label: 'Pago' },
    { value: 'vencido', label: 'Vencido' },
    { value: 'cancelado', label: 'Cancelado' },
    { value: 'rejeitado', label: 'Rejeitado' },
    { value: 'devolvido', label: 'Devolvido' }
  ];

  // Badge de status com cores
  const getStatusBadge = (status, dataVencimentoStr = null) => {
    const textos = {
      pendente: 'Pendente',
      lancado: 'Lancado',
      liberado: 'Liberado',
      agendado: 'Agendado',
      consistente: 'Consistente',
      pendente_bb: 'Pend. BB',
      debitado: 'Debitado',
      processando: 'Processando',
      processando_lancamento: 'Proc. Lanc.',
      processando_pagamento: 'Proc. Pgto.',
      pago: 'Pago',
      devolvido: 'Devolvido',
      rejeitado: 'Rejeitado',
      inconsistente: 'Inconsistente',
      vencido: 'Vencido',
      erro: 'Erro',
      cancelado: 'Cancelado',
      aguardando_aprovacao: 'Aguard. Aprovacao'
    };

    // Definir cor do badge baseado no status
    let bgColor = 'secondary'; // cor padrão neutra

    switch (status) {
      case 'pago':
      case 'debitado':
        bgColor = 'success';
        break;
      case 'lancado':
        bgColor = 'primary'; // Azul escuro
        break;
      case 'aguardando_aprovacao':
        bgColor = 'warning'; // Amarelo/laranja - aguardando ação
        break;
      case 'processando_pagamento':
      case 'processando':
      case 'liberado':
      case 'agendado':
        bgColor = 'info'; // Azul claro - aprovado, em andamento
        break;
      case 'processando_lancamento':
      case 'consistente':
      case 'pendente_bb':
        bgColor = 'secondary'; // Cinza - transitório
        break;
      case 'erro':
      case 'rejeitado':
      case 'inconsistente':
      case 'devolvido':
        bgColor = 'danger';
        break;
      case 'cancelado':
        bgColor = 'dark';
        break;
      case 'vencido':
        bgColor = 'danger';
        break;
      case 'pendente':
        // Para pendente, verificar proximidade do vencimento
        if (dataVencimentoStr) {
          const dataVenc = parseDataBrasileira(dataVencimentoStr);
          if (dataVenc) {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            dataVenc.setHours(0, 0, 0, 0);
            const diffMs = dataVenc - hoje;
            const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            if (diffDias <= 1) {
              bgColor = 'danger'; // Vencido ou vence hoje/amanhã
            } else if (diffDias <= 5) {
              bgColor = 'warning'; // Vence em 2-5 dias
            } else {
              bgColor = 'secondary'; // Ainda tem tempo
            }
          }
        }
        break;
      default:
        bgColor = 'secondary';
    }

    return <Badge bg={bgColor}>{textos[status] || status}</Badge>;
  };

  // Status do lançamento no Aupus Control
  const getControlStatusBadge = (statusControl, controlId) => {
    if (!statusControl) {
      return <span className="text-muted small">--</span>;
    }
    const configs = {
      lancado: { bg: 'success', text: 'Control OK' },
      erro: { bg: 'danger', text: 'Erro' },
    };
    const config = configs[statusControl] || { bg: 'secondary', text: statusControl };
    return (
      <Badge bg={config.bg} title={controlId ? `ID: ${controlId}` : ''}>
        {config.text}
      </Badge>
    );
  };

  // Status de envio para faturas (quando é "Enviar Fatura" em vez de "Lancar Pagamento")
  const getEnvioStatusBadges = (pag) => {
    const enviouWhatsApp = !!pag.data_envio_whatsapp;
    const enviouEmail = !!pag.data_envio_email;

    if (!enviouWhatsApp && !enviouEmail) {
      return <span className="text-muted">Nao enviado</span>;
    }

    return (
      <div className="d-flex gap-1 flex-wrap">
        {enviouWhatsApp && (
          <Badge bg="success" title={`Enviado em ${new Date(pag.data_envio_whatsapp).toLocaleString('pt-BR')}`}>
            <i className="fab fa-whatsapp me-1"></i>OK
          </Badge>
        )}
        {enviouEmail && (
          <Badge bg="info" title={`Enviado em ${new Date(pag.data_envio_email).toLocaleString('pt-BR')}`}>
            <i className="fas fa-envelope me-1"></i>OK
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div className="pagamentos-concessionaria">
      {/* Estilos para linhas de alerta e status */}
      <style>{`
        /* Linha crítica - fundo vermelho claro */
        .pagamentos-concessionaria .linha-critica,
        .pagamentos-concessionaria .linha-critica:hover,
        .pagamentos-concessionaria .table-hover tbody tr.linha-critica:hover,
        .pagamentos-concessionaria .table-hover tbody tr.linha-critica:hover > td,
        .pagamentos-concessionaria .linha-critica td {
          background-color: #f8d7da !important;
          color: #842029 !important;
        }
        /* Linha alerta - fundo amarelo claro */
        .pagamentos-concessionaria .linha-alerta,
        .pagamentos-concessionaria .linha-alerta:hover,
        .pagamentos-concessionaria .table-hover tbody tr.linha-alerta:hover,
        .pagamentos-concessionaria .table-hover tbody tr.linha-alerta:hover > td,
        .pagamentos-concessionaria .linha-alerta td {
          background-color: #fff3cd !important;
          color: #664d03 !important;
        }
        /* UC e status (strong) nas linhas coloridas - herdar cor do tema */
        .pagamentos-concessionaria .linha-critica td > strong,
        .pagamentos-concessionaria .linha-alerta td > strong {
          color: inherit !important;
        }

        /* Botão nas linhas coloridas */
        .pagamentos-concessionaria .linha-critica .btn-outline-secondary,
        .pagamentos-concessionaria .linha-alerta .btn-outline-secondary {
          background-color: transparent !important;
          border-color: currentColor !important;
          color: inherit !important;
        }
        .pagamentos-concessionaria .linha-critica .btn-outline-secondary:hover,
        .pagamentos-concessionaria .linha-alerta .btn-outline-secondary:hover {
          background-color: rgba(0,0,0,0.1) !important;
          border-color: currentColor !important;
          color: inherit !important;
        }
        /* Botão normal - hover não fica branco */
        .pagamentos-concessionaria .btn-outline-secondary:hover {
          background-color: #6c757d !important;
          color: #fff !important;
        }
      `}</style>
      <h4 className="mb-4">
        <i className="fas fa-money-bill-wave me-2"></i>
        Pagamentos Concessionaria (EQTL)
      </h4>

      {/* Filtros */}
      <Card className="mb-4">
        <Card.Body>
          <Row className="align-items-end mb-2">
            <Col md={2}>
              <Form.Group>
                <Form.Label>Mes Referencia</Form.Label>
                <Form.Select
                  value={mesReferencia}
                  onChange={(e) => setMesReferencia(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {mesesDisponiveis.map(mes => (
                    <option key={mes} value={mes}>{mes}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Status</Form.Label>
                <Form.Select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="pendente">Pendente</option>
                  <option value="lancado">Lancado</option>
                  <option value="aguardando_aprovacao">Aguard. Aprovacao</option>
                  <option value="processando_lancamento">Proc. Lancamento</option>
                  <option value="processando_pagamento">Proc. Pagamento</option>
                  <option value="processando">Processando</option>
                  <option value="agendado">Agendado</option>
                  <option value="pago">Pago</option>
                  <option value="devolvido">Devolvido</option>
                  <option value="rejeitado">Rejeitado</option>
                  <option value="vencido">Vencido</option>
                  <option value="cancelado">Cancelado</option>
                  <option value="erro">Erro</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Filtrar UC</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Digite a UC..."
                  value={filtroUC}
                  onChange={(e) => setFiltroUC(e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Button
                variant="primary"
                onClick={carregarDados}
                disabled={loading}
              >
                <i className="fas fa-search me-2"></i>
                Buscar
              </Button>
            </Col>
            <Col md={4} className="text-end">
              <ButtonGroup className="me-2">
                <Button
                  variant="outline-success"
                  onClick={() => exportarExcel()}
                  disabled={loading || pagamentos.length === 0}
                  title="Exportar para Excel"
                >
                  <i className="fas fa-file-excel me-1"></i>
                  Exportar
                </Button>
              </ButtonGroup>
              <Button
                variant="outline-primary"
                onClick={handleSincronizarStatus}
                disabled={loading}
                title="Sincronizar status dos pagamentos com a API do BB"
              >
                <i className="fas fa-sync-alt me-1"></i>
                Sincronizar Status
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Alertas */}
      {erro && (
        <Alert variant="danger" dismissible onClose={() => setErro(null)}>
          {erro}
        </Alert>
      )}
      {sucesso && (
        <Alert variant="success" dismissible onClose={() => setSucesso(null)}>
          {sucesso}
        </Alert>
      )}

      {/* Resumo */}
      {resumo && (
        <Row className="mb-4">
          <Col md={3}>
            <Card className="text-center">
              <Card.Body>
                <h3>{resumo.quantidade_total || 0}</h3>
                <small className="text-muted">Total Pagamentos</small>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center bg-light">
              <Card.Body>
                <h3>{formatarValor(resumo.total_geral)}</h3>
                <small className="text-muted">Valor Total</small>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center">
              <Card.Body>
                <div className="d-flex flex-wrap justify-content-center gap-1">
                  {resumo.por_status?.map(s => (
                    <span key={s.status}>
                      {getStatusBadge(s.status)} {s.quantidade}
                    </span>
                  ))}
                </div>
                <small className="text-muted">Por Status</small>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Tabela de Pagamentos com Abas */}
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <ButtonGroup>
            <Button
              variant={abaAtiva === 'lote' ? 'primary' : 'outline-primary'}
              onClick={() => setAbaAtiva('lote')}
            >
              <Banknote size={16} className="me-1"/>
              Pagamento em Lote
              <Badge bg={abaAtiva === 'lote' ? 'light' : 'primary'} text={abaAtiva === 'lote' ? 'dark' : 'white'} className="ms-2">
                {pagamentos.filter(p => isItemDoTipo(p, 'lote') && (!filtroUC || p.uc.includes(filtroUC))).length}
              </Badge>
            </Button>
            <Button
              variant={abaAtiva === 'enviar' ? 'info' : 'outline-info'}
              onClick={() => setAbaAtiva('enviar')}
            >
              <Send size={16} className="me-1"/>
              Enviar ao Cliente
              <Badge bg={abaAtiva === 'enviar' ? 'light' : 'info'} text={abaAtiva === 'enviar' ? 'dark' : 'white'} className="ms-2">
                {pagamentos.filter(p => isItemDoTipo(p, 'enviar') && (!filtroUC || p.uc.includes(filtroUC))).length}
              </Badge>
            </Button>
          </ButtonGroup>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="primary" />
              <p className="mt-2 text-muted">Carregando...</p>
            </div>
          ) : pagamentos.filter(p =>
              isItemDoTipo(p, abaAtiva) &&
              (!filtroUC || p.uc.includes(filtroUC))
            ).length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="fas fa-inbox fa-3x mb-3"></i>
              <p>{abaAtiva === 'lote' ? 'Nenhuma fatura para pagamento em lote' : 'Nenhuma fatura para enviar ao cliente'}</p>
            </div>
          ) : (
            <Table hover responsive className="mb-0">
              <thead>
                <tr>
                  {abaAtiva === 'lote' && (
                    <th style={{ width: '40px' }}>
                      <Form.Check
                        type="checkbox"
                        checked={selecionados.length > 0 && selecionados.length === pagamentos.filter(p => isItemSelecionavel(p) && isItemDoTipo(p, 'lote') && (!filtroUC || p.uc.includes(filtroUC))).length}
                        onChange={toggleTodos}
                        title="Selecionar todos pendentes"
                      />
                    </th>
                  )}
                  <th>UC</th>
                  <th>Cliente</th>
                  <th>Valor EQTL</th>
                  <th>Vencimento</th>
                  {abaAtiva === 'lote' && <th>PIX</th>}
                  {abaAtiva === 'lote' && <th>Cod. Barras</th>}
                  {abaAtiva === 'enviar' && <th style={{ textAlign: 'center' }}>Titularidade Aupus</th>}
                  {abaAtiva === 'lote' ? <th>Status BB</th> : <th>Status</th>}
                  {abaAtiva === 'lote' && <th>Control</th>}
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {ordenarPorVencimento(pagamentos.filter(p =>
                  isItemDoTipo(p, abaAtiva) &&
                  (!filtroUC || p.uc.includes(filtroUC))
                )).map(pag => (
                  <tr key={pag.fatura_id} className={getClasseLinha(pag.data_vencimento_fatura, pag.status)}>
                    {abaAtiva === 'lote' && (
                      <td>
                        {isItemSelecionavel(pag) && (
                          <Form.Check
                            type="checkbox"
                            checked={selecionados.includes(pag.fatura_id)}
                            onChange={() => toggleSelecao(pag.fatura_id)}
                          />
                        )}
                      </td>
                    )}
                    <td><strong>{pag.uc}</strong></td>
                    <td style={{maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={pag.nome_cliente}>
                      {pag.nome_cliente || '-'}
                    </td>
                    <td>{formatarValor(pag.valor_fatura)}</td>
                    <td>{pag.data_vencimento_fatura || '-'}</td>
                    {abaAtiva === 'lote' && (
                      <td>
                        {pag.pix_copia_cola ? (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip id={`pix-tooltip-${pag.id}`}>
                                <div style={{maxWidth: '300px', wordBreak: 'break-all', fontSize: '11px'}}>
                                  {pag.pix_copia_cola.substring(0, 80)}...
                                </div>
                                <div className="mt-2">
                                  <strong>Clique para copiar</strong>
                                </div>
                              </Tooltip>
                            }
                          >
                            <span
                              style={{cursor: 'pointer', textDecoration: 'underline'}}
                              onClick={() => handleCopiar(pag.pix_copia_cola, 'PIX')}
                            >
                              <i className="fas fa-qrcode me-1"></i>
                              <i className="fas fa-copy me-1"></i>
                              OK
                            </span>
                          </OverlayTrigger>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    )}
                    {abaAtiva === 'lote' && (
                      <td>
                        {pag.codigo_barras ? (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip id={`barras-tooltip-${pag.fatura_id}`}>
                                <div style={{fontFamily: 'monospace', fontSize: '12px'}}>
                                  {pag.codigo_barras}
                                </div>
                                <div className="mt-2">
                                  <strong>Clique para copiar</strong>
                                </div>
                              </Tooltip>
                            }
                          >
                            <span
                              style={{cursor: 'pointer', textDecoration: 'underline'}}
                              onClick={() => handleCopiar(pag.codigo_barras, 'Codigo de barras')}
                            >
                              <i className="fas fa-barcode me-1"></i>
                              <i className="fas fa-copy me-1"></i>
                              OK
                            </span>
                          </OverlayTrigger>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    )}
                    {abaAtiva === 'enviar' && (
                      <td style={{ textAlign: 'center' }}>
                        {pag.nome_diferente
                          ? <span title="Nome na fatura diferente do titular Aupus" style={{ color: '#dc3545', fontSize: '16px' }}>&#10008;</span>
                          : <span title="Titularidade Aupus confirmada" style={{ color: '#198754', fontSize: '16px' }}>&#10004;</span>
                        }
                      </td>
                    )}
                    <td>
                      {/* Na aba lote: mostrar status BB. Na aba enviar: mostrar status de envio */}
                      {abaAtiva === 'lote'
                        ? getStatusBadge(pag.status, pag.data_vencimento_fatura)
                        : getEnvioStatusBadges(pag)
                      }
                    </td>
                    {abaAtiva === 'lote' && (
                      <td>
                        {getControlStatusBadge(pag.status_control, pag.control_lancamento_id)}
                      </td>
                    )}
                    <td>
                      <div className="d-flex gap-1 justify-content-center">
                        {/* Aba Lote: botão Lançar BB */}
                        {abaAtiva === 'lote' && (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip>
                                {pag.status !== 'pendente'
                                  ? 'Apenas itens pendentes podem ser lancados no BB'
                                  : pag.codigo_barras
                                    ? 'Lancar pagamento via BB'
                                    : 'Falta codigo de barras'
                                }
                              </Tooltip>
                            }
                          >
                            <span>
                              <Button
                                size="sm"
                                variant={pag.status === 'pendente' && pag.codigo_barras ? 'outline-success' : 'outline-secondary'}
                                onClick={() => handleLancarPagamento(pag)}
                                disabled={pag.status !== 'pendente' || !pag.codigo_barras}
                                style={pag.status !== 'pendente' || !pag.codigo_barras ? { pointerEvents: 'none', opacity: 0.35 } : {}}
                              >
                                <Banknote size={16} />
                              </Button>
                            </span>
                          </OverlayTrigger>
                        )}
                        {/* Aba Lote: botão Lançar Control */}
                        {abaAtiva === 'lote' && (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip>
                                {pag.status_control === 'lancado'
                                  ? `Ja lancado no Control (${pag.control_lancamento_id || ''})`
                                  : pag.codigo_barras
                                    ? 'Lancar no Aupus Control'
                                    : 'Falta codigo de barras'
                                }
                              </Tooltip>
                            }
                          >
                            <span>
                              <Button
                                size="sm"
                                variant={pag.status_control !== 'lancado' && pag.codigo_barras ? 'outline-primary' : 'outline-secondary'}
                                onClick={() => handleLancarControl(pag)}
                                disabled={pag.status_control === 'lancado' || !pag.codigo_barras}
                                style={pag.status_control === 'lancado' || !pag.codigo_barras ? { pointerEvents: 'none', opacity: 0.35 } : {}}
                              >
                                <Upload size={16} />
                              </Button>
                            </span>
                          </OverlayTrigger>
                        )}
                        {/* Aba Enviar: botão Enviar Fatura */}
                        {abaAtiva === 'enviar' && (
                          <OverlayTrigger
                            placement="top"
                            overlay={<Tooltip>Enviar fatura original ao cliente</Tooltip>}
                          >
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => handleEnviarFatura(pag)}
                            >
                              <Send size={16} />
                            </Button>
                          </OverlayTrigger>
                        )}
                        {/* Botão de configuração forçada - aparece em AMBAS as abas */}
                        {(() => {
                          // Na aba enviar, bloquear se já foi enviado (whatsapp ou email)
                          const jaEnviado = abaAtiva === 'enviar' && (pag.data_envio_whatsapp || pag.data_envio_email);
                          const bloqueado = jaEnviado && !pag.status_forcado;

                          return (
                            <OverlayTrigger
                              placement="top"
                              overlay={
                                <Tooltip>
                                  {bloqueado
                                    ? 'Ja foi enviado. Cancele o envio para alterar.'
                                    : pag.status_forcado
                                      ? `Configuracao forcada (original: ${pag.status_original || 'pendente'})`
                                      : 'Configurar status/envio forcado'
                                  }
                                </Tooltip>
                              }
                            >
                              <span>
                                <Button
                                  size="sm"
                                  variant={pag.status_forcado ? 'warning' : 'outline-secondary'}
                                  onClick={() => handleAbrirConfig(pag)}
                                  disabled={bloqueado}
                                  style={bloqueado ? { pointerEvents: 'none', opacity: 0.35 } : {}}
                                >
                                  {pag.status_forcado ? <RotateCcw size={16} /> : <Settings size={16} />}
                                </Button>
                              </span>
                            </OverlayTrigger>
                          );
                        })()}
                        {/* Aba Lote: Botão cancelar - sempre visível, desabilitado se não pode cancelar */}
                        {abaAtiva === 'lote' && (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip>
                                {podeCancelarNoBB(pag) ? 'Cancelar pagamento no BB' : 'Nao pode cancelar neste status'}
                              </Tooltip>
                            }
                          >
                            <span>
                              <Button
                                size="sm"
                                variant={podeCancelarNoBB(pag) ? 'outline-danger' : 'outline-secondary'}
                                onClick={() => handleAbrirCancelar(pag)}
                                disabled={!podeCancelarNoBB(pag)}
                                style={!podeCancelarNoBB(pag) ? { pointerEvents: 'none', opacity: 0.35 } : {}}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </span>
                          </OverlayTrigger>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
        {/* Footer com seleção e lançamento em lote (apenas na aba lote) */}
        {abaAtiva === 'lote' && selecionados.length > 0 && (
          <Card.Footer>
            <Row className="align-items-center">
              <Col>
                <span>
                  <strong>{selecionados.length}</strong> pagamento(s) selecionado(s)
                </span>
              </Col>
              <Col className="text-end">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="me-2"
                  onClick={() => setSelecionados([])}
                >
                  Limpar seleção
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  className="me-2"
                  onClick={iniciarLancamentoLote}
                >
                  <Banknote size={16} className="me-1" />
                  Lançar BB ({selecionados.filter(id => {
                    const p = pagamentos.find(x => x.fatura_id === id);
                    return p && p.status === 'pendente' && p.codigo_barras;
                  }).length})
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={iniciarLancamentoLoteControl}
                >
                  <Upload size={16} className="me-1" />
                  Lançar Control ({selecionados.filter(id => {
                    const p = pagamentos.find(x => x.fatura_id === id);
                    return p && p.status_control !== 'lancado' && p.codigo_barras;
                  }).length})
                </Button>
              </Col>
            </Row>
          </Card.Footer>
        )}
      </Card>

      {/* Tabela de UGs Autorizadas */}
      {ugs.length > 0 && (
        <Card className="mt-4">
          <Card.Header className="bg-warning text-dark">
            <strong><i className="fas fa-solar-panel me-2"></i>Usinas Geradoras (UGs)</strong>
            <Badge bg="dark" className="ms-2">{ugs.length}</Badge>
          </Card.Header>
          <Card.Body className="p-0">
            <Table hover responsive className="mb-0">
              <thead>
                <tr>
                  <th>UC</th>
                  <th>Nome Usina</th>
                  <th>Valor EQTL</th>
                  <th>Vencimento</th>
                  <th>PIX</th>
                  <th>Cod. Barras</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ordenarPorVencimento(ugs).map(ug => (
                  <tr key={ug.id || ug.uc} className={getClasseLinha(ug.data_vencimento_fatura, ug.status)}>
                    <td><strong>{ug.uc}</strong></td>
                    <td style={{maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={ug.nome_usina}>
                      {ug.nome_usina || '-'}
                    </td>
                    <td>{formatarValor(ug.valor_fatura)}</td>
                    <td>{ug.data_vencimento_fatura || '-'}</td>
                    <td>
                      {ug.pix_copia_cola ? (
                        <OverlayTrigger
                          placement="top"
                          overlay={
                            <Tooltip id={`ug-pix-tooltip-${ug.uc}`}>
                              <div style={{maxWidth: '300px', wordBreak: 'break-all', fontSize: '11px'}}>
                                {ug.pix_copia_cola.substring(0, 80)}...
                              </div>
                              <div className="mt-2">
                                <strong>Clique para copiar</strong>
                              </div>
                            </Tooltip>
                          }
                        >
                          <span
                            style={{cursor: 'pointer', textDecoration: 'underline'}}
                            onClick={() => handleCopiar(ug.pix_copia_cola, 'PIX')}
                          >
                            <i className="fas fa-qrcode me-1"></i>
                            <i className="fas fa-copy me-1"></i>
                            OK
                          </span>
                        </OverlayTrigger>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>
                      {ug.codigo_barras ? (
                        <OverlayTrigger
                          placement="top"
                          overlay={
                            <Tooltip id={`ug-barras-tooltip-${ug.uc}`}>
                              <div style={{fontFamily: 'monospace', fontSize: '12px'}}>
                                {ug.codigo_barras}
                              </div>
                              <div className="mt-2">
                                <strong>Clique para copiar</strong>
                              </div>
                            </Tooltip>
                          }
                        >
                          <span
                            style={{cursor: 'pointer', textDecoration: 'underline'}}
                            onClick={() => handleCopiar(ug.codigo_barras, 'Codigo de barras')}
                          >
                            <i className="fas fa-barcode me-1"></i>
                            <i className="fas fa-copy me-1"></i>
                            OK
                          </span>
                        </OverlayTrigger>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>{ug.status_fatura ? <strong style={{ color: '#198754' }}>Baixada</strong> : <span className="text-muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {/* Modal de Lançamento em Lote */}
      <Modal
        show={modalLancamentoLote.show}
        onHide={fecharModalLancamentoLote}
        centered
        backdrop={modalLancamentoLote.processando ? 'static' : true}
        size="lg"
      >
        <Modal.Header closeButton={!modalLancamentoLote.processando} className="bg-success text-white">
          <Modal.Title>
            <Banknote size={20} className="me-2" />
            Lançamento em Lote - {modalLancamentoLote.total} Pagamentos
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Estado inicial: confirmação */}
          {!modalLancamentoLote.processando && !modalLancamentoLote.concluido && (
            <>
              <Alert variant="warning" className="mb-3">
                <strong>Atenção:</strong> Todos os pagamentos selecionados serão enviados para a API do Banco do Brasil e debitados da conta da empresa.
              </Alert>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
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
                        <td className="text-end">{formatarValor(item.valor_fatura)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="table-dark">
                      <td colSpan={2}><strong>Total</strong></td>
                      <td className="text-end">
                        <strong>{formatarValor(modalLancamentoLote.itens.reduce((acc, i) => acc + parseFloat(i.valor_fatura || 0), 0))}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            </>
          )}

          {/* Estado: processando */}
          {modalLancamentoLote.processando && (
            <div>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span><Spinner size="sm" className="me-2" />Processando...</span>
                <span className="text-muted">
                  {modalLancamentoLote.atual} / {modalLancamentoLote.total}
                </span>
              </div>
              <div className="progress mb-3" style={{ height: '25px' }}>
                <div
                  className="progress-bar progress-bar-striped progress-bar-animated bg-success"
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
              <div className="d-flex gap-4 mb-3 justify-content-center">
                <div className="text-center">
                  <div className="display-6 text-success">{modalLancamentoLote.sucessos}</div>
                  <small className="text-muted">Sucesso</small>
                </div>
                <div className="text-center">
                  <div className="display-6 text-danger">{modalLancamentoLote.erros}</div>
                  <small className="text-muted">Erros</small>
                </div>
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
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
                <Banknote size={16} className="me-1" />
                Confirmar Lançamento
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

      {/* Modal de Confirmação de Lançamento de Pagamento */}
      <Modal show={showModalLancar} onHide={() => { setShowModalLancar(false); setPagamentoParaLancar(null); setNovaDataPagamento(''); setVencimentoPassou(false); }} centered>
        <Modal.Header closeButton className="bg-success text-white">
          <Modal.Title>
            <Banknote size={20} className="me-2" />
            Confirmar Lancamento de Pagamento
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {pagamentoParaLancar && (
            <>
              <Alert variant="warning" className="mb-3">
                <strong>Atencao:</strong> Este pagamento sera enviado diretamente para a API do Banco do Brasil e debitado da conta da empresa.
              </Alert>

              {/* Alerta de vencimento passado */}
              {vencimentoPassou && (
                <Alert variant="danger" className="mb-3">
                  <strong><i className="fas fa-exclamation-triangle me-2"></i>Data de vencimento ja passou!</strong>
                  <p className="mb-0 mt-1">Informe uma nova data para o pagamento ser agendado.</p>
                </Alert>
              )}

              <Card className="mb-3">
                <Card.Body>
                  <Row className="mb-2">
                    <Col xs={4}><strong>UC:</strong></Col>
                    <Col xs={8}>{pagamentoParaLancar.uc}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Cliente:</strong></Col>
                    <Col xs={8}>{pagamentoParaLancar.nome_cliente || '-'}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Mes Ref:</strong></Col>
                    <Col xs={8}>{pagamentoParaLancar.mes_referencia}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Vencimento:</strong></Col>
                    <Col xs={8}>
                      <span className={vencimentoPassou ? 'text-danger text-decoration-line-through' : ''}>
                        {pagamentoParaLancar.data_vencimento_fatura || '-'}
                      </span>
                      {vencimentoPassou && <Badge bg="danger" className="ms-2">Vencido</Badge>}
                    </Col>
                  </Row>
                  {/* Campo de nova data de pagamento */}
                  {vencimentoPassou && (
                    <Row className="mb-2">
                      <Col xs={4}><strong className="text-primary">Nova Data:</strong></Col>
                      <Col xs={8}>
                        <Form.Control
                          type="date"
                          value={novaDataPagamento}
                          onChange={(e) => setNovaDataPagamento(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="border-primary"
                          disabled={lancandoPagamento}
                        />
                        <Form.Text className="text-muted">Data em que o pagamento sera agendado</Form.Text>
                      </Col>
                    </Row>
                  )}
                  <Row className="mb-3">
                    <Col xs={4}><strong>Valor:</strong></Col>
                    <Col xs={8}>
                      <span className="text-success fw-bold fs-5">
                        {formatarValor(pagamentoParaLancar.valor_fatura)}
                      </span>
                    </Col>
                  </Row>
                  <Row>
                    <Col xs={12}>
                      <strong>Codigo de Barras:</strong>
                      <div className="bg-light p-2 rounded mt-1 text-dark" style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>
                        {pagamentoParaLancar.codigo_barras}
                      </div>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              <p className="text-muted small mb-0">
                Apos confirmacao, o pagamento sera registrado no Banco do Brasil e ficara aguardando processamento.
              </p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => { setShowModalLancar(false); setPagamentoParaLancar(null); setNovaDataPagamento(''); setVencimentoPassou(false); }}
            disabled={lancandoPagamento}
          >
            Cancelar
          </Button>
          <Button
            variant="success"
            onClick={confirmarLancamento}
            disabled={lancandoPagamento || (vencimentoPassou && !novaDataPagamento)}
          >
            {lancandoPagamento ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Enviando para BB...
              </>
            ) : (
              <>
                <Banknote size={16} className="me-2" />
                Confirmar Pagamento
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Modal de Envio de Fatura Original EQTL */}
      <Modal show={modalEnvioFatura.show} onHide={fecharModalEnvioFatura} centered size="lg">
        <Modal.Header closeButton className="bg-primary text-white">
          <Modal.Title>
            <Send size={20} className="me-2" />
            Enviar Fatura EQTL Original
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalEnvioFatura.pagamento && (
            <>
              {/* Info do pagamento */}
              <Card className="mb-3 bg-light">
                <Card.Body className="py-2">
                  <Row>
                    <Col md={6}>
                      <div><strong>{modalEnvioFatura.pagamento.nome_cliente || 'Cliente'}</strong></div>
                      <small className="text-muted">UC: {modalEnvioFatura.pagamento.uc}</small>
                    </Col>
                    <Col md={3}>
                      <div><small className="text-muted">Mes Ref:</small></div>
                      <div>{modalEnvioFatura.pagamento.mes_referencia}</div>
                    </Col>
                    <Col md={3}>
                      <div><small className="text-muted">Valor EQTL:</small></div>
                      <div><strong className="text-primary">{formatarValor(modalEnvioFatura.pagamento.valor_fatura)}</strong></div>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              <Tabs
                activeKey={modalEnvioFatura.abaAtiva}
                onSelect={(k) => setModalEnvioFatura(prev => ({ ...prev, abaAtiva: k }))}
                className="mb-3"
              >
                <Tab eventKey="envio" title={<><Send size={14} className="me-1" />Envio</>}>
                  {/* Tipo de Envio */}
                  <Form.Group className="mb-3">
                    <Form.Label className="fw-bold">Enviar via:</Form.Label>
                    <ButtonGroup className="w-100">
                      <Button
                        variant={modalEnvioFatura.tipoEnvio === 'whatsapp' ? 'success' : 'outline-success'}
                        size="sm"
                        onClick={() => setModalEnvioFatura(prev => ({ ...prev, tipoEnvio: 'whatsapp' }))}
                        disabled={modalEnvioFatura.enviando}
                      >
                        <MessageCircle size={14} className="me-1" /> WhatsApp
                      </Button>
                      <Button
                        variant={modalEnvioFatura.tipoEnvio === 'email' ? 'warning' : 'outline-warning'}
                        size="sm"
                        onClick={() => setModalEnvioFatura(prev => ({ ...prev, tipoEnvio: 'email' }))}
                        disabled={modalEnvioFatura.enviando}
                      >
                        <Mail size={14} className="me-1" /> Email
                      </Button>
                      <Button
                        variant={modalEnvioFatura.tipoEnvio === 'ambos' ? 'primary' : 'outline-primary'}
                        size="sm"
                        onClick={() => setModalEnvioFatura(prev => ({ ...prev, tipoEnvio: 'ambos' }))}
                        disabled={modalEnvioFatura.enviando}
                      >
                        Ambos
                      </Button>
                    </ButtonGroup>
                  </Form.Group>

                  {/* Campo Telefone */}
                  {(modalEnvioFatura.tipoEnvio === 'whatsapp' || modalEnvioFatura.tipoEnvio === 'ambos') && (
                    <Form.Group className="mb-3">
                      <Form.Label>Telefone (WhatsApp)</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="(62) 99999-9999"
                        value={modalEnvioFatura.telefone}
                        onChange={(e) => setModalEnvioFatura(prev => ({ ...prev, telefone: e.target.value }))}
                        disabled={modalEnvioFatura.enviando}
                      />
                    </Form.Group>
                  )}

                  {/* Campo Email */}
                  {(modalEnvioFatura.tipoEnvio === 'email' || modalEnvioFatura.tipoEnvio === 'ambos') && (
                    <>
                      <Form.Group className="mb-3">
                        <Form.Label>Email Principal</Form.Label>
                        <Form.Control
                          type="email"
                          placeholder="cliente@email.com"
                          value={modalEnvioFatura.email}
                          onChange={(e) => setModalEnvioFatura(prev => ({ ...prev, email: e.target.value }))}
                          disabled={modalEnvioFatura.enviando}
                        />
                      </Form.Group>
                      <Form.Group className="mb-3">
                        <Form.Label>Email Secundario (opcional)</Form.Label>
                        <Form.Control
                          type="email"
                          placeholder="outro@email.com"
                          value={modalEnvioFatura.emailSecundario}
                          onChange={(e) => setModalEnvioFatura(prev => ({ ...prev, emailSecundario: e.target.value }))}
                          disabled={modalEnvioFatura.enviando}
                        />
                      </Form.Group>
                    </>
                  )}
                </Tab>

                <Tab eventKey="mensagem" title={<><Edit3 size={14} className="me-1" />Mensagem {modalEnvioFatura.mensagemEditada && <Badge bg="warning" className="ms-1">Editada</Badge>}</>}>
                  {/* Mensagem WhatsApp */}
                  {(modalEnvioFatura.tipoEnvio === 'whatsapp' || modalEnvioFatura.tipoEnvio === 'ambos') && (
                    <Form.Group className="mb-3">
                      <Form.Label className="d-flex justify-content-between align-items-center">
                        <span>Mensagem WhatsApp</span>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => setModalEnvioFatura(prev => ({
                            ...prev,
                            mensagemWhatsapp: gerarMensagemWhatsappFatura(modalEnvioFatura.pagamento),
                            mensagemEditada: false
                          }))}
                        >
                          Restaurar padrao
                        </Button>
                      </Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        value={modalEnvioFatura.mensagemWhatsapp}
                        onChange={(e) => setModalEnvioFatura(prev => ({
                          ...prev,
                          mensagemWhatsapp: e.target.value,
                          mensagemEditada: true
                        }))}
                        disabled={modalEnvioFatura.enviando}
                      />
                    </Form.Group>
                  )}

                  {/* Mensagem Email */}
                  {(modalEnvioFatura.tipoEnvio === 'email' || modalEnvioFatura.tipoEnvio === 'ambos') && (
                    <>
                      <Form.Group className="mb-3">
                        <Form.Label>Assunto do Email</Form.Label>
                        <Form.Control
                          type="text"
                          value={modalEnvioFatura.assuntoEmail}
                          onChange={(e) => setModalEnvioFatura(prev => ({
                            ...prev,
                            assuntoEmail: e.target.value,
                            mensagemEditada: true
                          }))}
                          disabled={modalEnvioFatura.enviando}
                        />
                      </Form.Group>
                      <Form.Group className="mb-3">
                        <Form.Label className="d-flex justify-content-between align-items-center">
                          <span>Corpo do Email</span>
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0"
                            onClick={() => setModalEnvioFatura(prev => ({
                              ...prev,
                              assuntoEmail: gerarAssuntoEmailFatura(modalEnvioFatura.pagamento),
                              mensagemEmail: gerarMensagemEmailFatura(modalEnvioFatura.pagamento),
                              mensagemEditada: false
                            }))}
                          >
                            Restaurar padrao
                          </Button>
                        </Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={5}
                          value={modalEnvioFatura.mensagemEmail}
                          onChange={(e) => setModalEnvioFatura(prev => ({
                            ...prev,
                            mensagemEmail: e.target.value,
                            mensagemEditada: true
                          }))}
                          disabled={modalEnvioFatura.enviando}
                        />
                      </Form.Group>
                    </>
                  )}
                </Tab>
              </Tabs>

              {/* Status de Envio */}
              {modalEnvioFatura.statusEnvio && (
                <Alert
                  variant={modalEnvioFatura.statusEnvio.tipo === 'success' ? 'success' : modalEnvioFatura.statusEnvio.tipo === 'warning' ? 'warning' : 'danger'}
                  className="mt-3 mb-0"
                >
                  {modalEnvioFatura.statusEnvio.tipo === 'success' ? (
                    <CheckCircle size={16} className="me-2" />
                  ) : (
                    <XCircle size={16} className="me-2" />
                  )}
                  <div>{modalEnvioFatura.statusEnvio.mensagem}</div>
                  {modalEnvioFatura.statusEnvio.jaEnviado && (
                    <Form.Check
                      type="checkbox"
                      label="Forcar reenvio mesmo assim"
                      className="mt-2"
                      checked={modalEnvioFatura.forcarReenvio}
                      onChange={(e) => setModalEnvioFatura(prev => ({ ...prev, forcarReenvio: e.target.checked }))}
                    />
                  )}
                </Alert>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={fecharModalEnvioFatura} disabled={modalEnvioFatura.enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={executarEnvioFatura}
            disabled={modalEnvioFatura.enviando}
          >
            {modalEnvioFatura.enviando ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Enviando...
              </>
            ) : (
              <>
                <Send size={16} className="me-2" />
                Enviar Fatura
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Modal de PIX / Codigo de Barras */}
      <Modal show={showModalCodigo} onHide={() => setShowModalCodigo(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="fas fa-money-bill-wave me-2"></i>
            Dados de Pagamento - UC {pagamentoSelecionado?.uc}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {pagamentoSelecionado && (
            <>
              <div className="mb-4 p-3 bg-light rounded">
                <Row>
                  <Col md={6}>
                    <p className="mb-1"><strong>Valor EQTL:</strong> <span className="text-primary fw-bold">{formatarValor(pagamentoSelecionado.valor_fatura)}</span></p>
                    <p className="mb-0"><strong>Vencimento:</strong> {pagamentoSelecionado.data_vencimento_fatura || '-'}</p>
                  </Col>
                  <Col md={6}>
                    <p className="mb-1"><strong>Mes Ref:</strong> {pagamentoSelecionado.mes_referencia}</p>
                    <p className="mb-0"><strong>Status:</strong> {getStatusBadge(pagamentoSelecionado.status, pagamentoSelecionado.data_vencimento_fatura)}</p>
                  </Col>
                </Row>
              </div>

              <Alert variant="info" className="mb-4">
                <i className="fas fa-info-circle me-2"></i>
                <strong>Prioridade:</strong> O sistema tentara primeiro o PIX. Se nao houver PIX, usara o codigo de barras.
              </Alert>

              <Card className="mb-3 border-success">
                <Card.Header className="bg-success text-white">
                  <i className="fas fa-qrcode me-2"></i>
                  PIX Copia e Cola (Prioritario)
                  {pixCopaCola && <Badge bg="light" text="dark" className="ms-2">Preenchido</Badge>}
                </Card.Header>
                <Card.Body>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    placeholder="Cole aqui o codigo PIX copia e cola extraido da fatura EQTL"
                    value={pixCopaCola}
                    onChange={(e) => setPixCopaCola(e.target.value)}
                    className={pixCopaCola ? 'border-success' : ''}
                  />
                  <Form.Text className="text-muted">
                    Codigo EMV que comeca com "00020126..."
                  </Form.Text>
                </Card.Body>
              </Card>

              <Card className="border-info">
                <Card.Header className="bg-info text-white">
                  <i className="fas fa-barcode me-2"></i>
                  Codigo de Barras (Alternativo)
                  {codigoBarras && <Badge bg="light" text="dark" className="ms-2">Preenchido</Badge>}
                </Card.Header>
                <Card.Body>
                  <Form.Control
                    type="text"
                    placeholder="Digite ou cole o codigo de barras (47-48 digitos)"
                    value={codigoBarras}
                    onChange={(e) => setCodigoBarras(e.target.value.replace(/\D/g, ''))}
                    maxLength={48}
                    className={codigoBarras ? 'border-info' : ''}
                  />
                  <Form.Text className="text-muted">
                    Linha digitavel ou codigo de barras numerico da fatura
                  </Form.Text>
                </Card.Body>
              </Card>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModalCodigo(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSalvarCodigo}
            disabled={loading || (!codigoBarras && !pixCopaCola)}
          >
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Salvando...
              </>
            ) : (
              <>
                <i className="fas fa-save me-2"></i>
                Salvar Dados
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Modal de Cancelamento no BB */}
      <Modal show={modalCancelar.show} onHide={() => setModalCancelar({ show: false, pagamento: null, cancelando: false })} centered>
        <Modal.Header closeButton className="bg-danger text-white">
          <Modal.Title>
            <Trash2 size={20} className="me-2" />
            Cancelar Pagamento no BB
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalCancelar.pagamento && (
            <>
              <Alert variant="warning" className="mb-3">
                <strong>Atencao:</strong> Esta acao ira cancelar/baixar a requisicao de pagamento no Banco do Brasil.
                O pagamento NAO sera efetuado.
              </Alert>

              <Card className="mb-3">
                <Card.Body>
                  <Row className="mb-2">
                    <Col xs={4}><strong>UC:</strong></Col>
                    <Col xs={8}>{modalCancelar.pagamento.uc}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Cliente:</strong></Col>
                    <Col xs={8}>{modalCancelar.pagamento.nome_cliente || '-'}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Mes Ref:</strong></Col>
                    <Col xs={8}>{modalCancelar.pagamento.mes_referencia}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Valor:</strong></Col>
                    <Col xs={8}>
                      <span className="text-danger fw-bold">
                        {formatarValor(modalCancelar.pagamento.valor_fatura)}
                      </span>
                    </Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Status:</strong></Col>
                    <Col xs={8}>{getStatusBadge(modalCancelar.pagamento.status)}</Col>
                  </Row>
                  {modalCancelar.pagamento.numero_requisicao && (
                    <Row>
                      <Col xs={4}><strong>Requisicao BB:</strong></Col>
                      <Col xs={8}><code>{modalCancelar.pagamento.numero_requisicao}</code></Col>
                    </Row>
                  )}
                </Card.Body>
              </Card>

              {modalCancelar.erroBB ? (
                <Alert variant="danger" className="mb-0">
                  <strong>Nao foi possivel cancelar no BB:</strong><br/>
                  {modalCancelar.erroBB}<br/><br/>
                  <small className="text-muted">
                    Voce pode forcar o cancelamento apenas no sistema local. O lancamento continuara existindo no BB e sera debitado normalmente na data prevista.
                  </small>
                </Alert>
              ) : (
                <p className="text-muted small mb-0">
                  <strong>Importante:</strong> Se o pagamento ja foi processado ou debitado pelo BB, nao sera possivel cancelar.
                </p>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setModalCancelar({ show: false, pagamento: null, cancelando: false, erroBB: null })}
            disabled={modalCancelar.cancelando}
          >
            Voltar
          </Button>
          {modalCancelar.erroBB ? (
            <Button
              variant="warning"
              onClick={() => executarCancelamentoBB(true)}
              disabled={modalCancelar.cancelando}
            >
              {modalCancelar.cancelando ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Cancelando localmente...
                </>
              ) : (
                <>
                  <Trash2 size={16} className="me-2" />
                  Forcar Cancelamento Local
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={() => executarCancelamentoBB(false)}
              disabled={modalCancelar.cancelando}
            >
              {modalCancelar.cancelando ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Cancelando...
                </>
              ) : (
                <>
                  <Trash2 size={16} className="me-2" />
                  Confirmar Cancelamento
                </>
              )}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* Modal de Configuração Forçada */}
      <Modal show={modalConfig.show} onHide={fecharModalConfig} centered size={modalConfig.etapa === 'senha' ? 'sm' : 'lg'}>
        <Modal.Header closeButton className="bg-secondary text-white">
          <Modal.Title>
            <Settings size={20} className="me-2" />
            {modalConfig.etapa === 'senha' ? 'Autenticacao' : 'Configuracao Forcada'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* ETAPA 1: Senha */}
          {modalConfig.etapa === 'senha' && (
            <>
              <p className="text-muted mb-3">Digite a senha para acessar as configuracoes.</p>

              {modalConfig.erro && (
                <Alert variant="danger" className="mb-3">
                  <strong>Erro:</strong> {modalConfig.erro}
                </Alert>
              )}

              <Form onSubmit={(e) => { e.preventDefault(); validarSenhaConfig(); }}>
                <Form.Group className="mb-3">
                  <Form.Label><strong>Senha</strong></Form.Label>
                  <Form.Control
                    type="password"
                    placeholder="Digite a senha..."
                    value={modalConfig.senha}
                    onChange={(e) => setModalConfig(prev => ({ ...prev, senha: e.target.value, erro: null }))}
                    autoFocus
                  />
                </Form.Group>
              </Form>
            </>
          )}

          {/* ETAPA 2: Configuração */}
          {modalConfig.etapa === 'config' && modalConfig.pagamento && (
            <>
              {modalConfig.pagamento.status_forcado && (
                <Alert variant="warning" className="mb-3">
                  <strong><RotateCcw size={16} className="me-1" />Este item ja tem configuracao forcada!</strong>
                  <p className="mb-0 mt-1">
                    Tipo original: <Badge bg="info">{modalConfig.pagamento.nome_diferente ? 'Enviar ao Cliente' : 'Pagamento em Lote'}</Badge>
                    <span className="ms-2">| Status original: <Badge bg="info">{modalConfig.pagamento.status_original || 'pendente'}</Badge></span>
                  </p>
                </Alert>
              )}

              <Card className="mb-3">
                <Card.Body>
                  <Row className="mb-2">
                    <Col xs={4}><strong>UC:</strong></Col>
                    <Col xs={8}>{modalConfig.pagamento.uc}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Cliente:</strong></Col>
                    <Col xs={8}>{modalConfig.pagamento.nome_cliente || '-'}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Tipo Atual:</strong></Col>
                    <Col xs={8}>
                      <Badge bg={modalConfig.pagamento.nome_diferente ? 'primary' : 'success'}>
                        {modalConfig.pagamento.nome_diferente ? 'Enviar ao Cliente' : 'Pagamento em Lote'}
                      </Badge>
                      {modalConfig.pagamento.tipo_forcado && (
                        <Badge bg="warning" className="ms-2">Forçado</Badge>
                      )}
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              {modalConfig.erro && (
                <Alert variant="danger" className="mb-3">
                  <strong>Erro:</strong> {modalConfig.erro}
                </Alert>
              )}

              <Form>
                <Form.Group className="mb-3">
                  <Form.Label><strong>Tipo do Item</strong></Form.Label>
                  <div className="d-flex gap-3">
                    <Form.Check
                      type="radio"
                      id="tipo-lote"
                      name="tipoForcado"
                      label={<span className="text-success fw-bold">Pagamento em Lote</span>}
                      checked={modalConfig.tipoForcado === 'lote'}
                      onChange={() => setModalConfig(prev => ({ ...prev, tipoForcado: 'lote' }))}
                      disabled={modalConfig.processando}
                    />
                    <Form.Check
                      type="radio"
                      id="tipo-enviar"
                      name="tipoForcado"
                      label={<span className="text-primary fw-bold">Enviar ao Cliente</span>}
                      checked={modalConfig.tipoForcado === 'enviar'}
                      onChange={() => setModalConfig(prev => ({ ...prev, tipoForcado: 'enviar' }))}
                      disabled={modalConfig.processando}
                    />
                  </div>
                  <Form.Text className="text-muted">Define em qual aba este item aparecera</Form.Text>
                </Form.Group>

                {/* Opções para Pagamento em Lote */}
                {modalConfig.tipoForcado === 'lote' && (
                  <Card className="mb-3 border-success">
                    <Card.Header className="bg-success text-white py-2">
                      <strong>Opcoes de Pagamento em Lote</strong>
                    </Card.Header>
                    <Card.Body>
                      <Form.Group>
                        <Form.Label><strong>Status do Pagamento</strong></Form.Label>
                        <Form.Select
                          value={modalConfig.novoStatus}
                          onChange={(e) => setModalConfig(prev => ({ ...prev, novoStatus: e.target.value }))}
                          disabled={modalConfig.processando}
                        >
                          {statusLoteDisponiveis.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </Form.Select>
                        <Form.Text className="text-muted">Status que sera exibido (nao sera alterado pela sincronizacao)</Form.Text>
                      </Form.Group>
                    </Card.Body>
                  </Card>
                )}

                {/* Opções para Enviar ao Cliente */}
                {modalConfig.tipoForcado === 'enviar' && (
                  <Card className="mb-3 border-primary">
                    <Card.Header className="bg-primary text-white py-2">
                      <strong>Opcoes de Envio ao Cliente</strong>
                    </Card.Header>
                    <Card.Body>
                      <Form.Label><strong>Marcar como Enviado</strong></Form.Label>
                      <div className="d-flex gap-4">
                        <Form.Check
                          type="checkbox"
                          id="marcar-whatsapp"
                          label={<><MessageCircle size={16} className="me-1 text-success" />WhatsApp</>}
                          checked={modalConfig.marcarWhatsapp}
                          onChange={(e) => setModalConfig(prev => ({ ...prev, marcarWhatsapp: e.target.checked }))}
                          disabled={modalConfig.processando}
                        />
                        <Form.Check
                          type="checkbox"
                          id="marcar-email"
                          label={<><Mail size={16} className="me-1 text-primary" />Email</>}
                          checked={modalConfig.marcarEmail}
                          onChange={(e) => setModalConfig(prev => ({ ...prev, marcarEmail: e.target.checked }))}
                          disabled={modalConfig.processando}
                        />
                      </div>
                      <Form.Text className="text-muted">Marcar como ja enviado por estes canais</Form.Text>
                    </Card.Body>
                  </Card>
                )}
              </Form>

              <p className="text-muted small mb-0">
                <strong>Aviso:</strong> Itens com configuracao forcada NAO serao alterados pela sincronizacao automatica.
              </p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={fecharModalConfig}
            disabled={modalConfig.processando}
          >
            Cancelar
          </Button>

          {/* Botão Validar na etapa senha */}
          {modalConfig.etapa === 'senha' && (
            <Button
              variant="primary"
              onClick={validarSenhaConfig}
              disabled={!modalConfig.senha}
            >
              Validar
            </Button>
          )}

          {/* Botões na etapa config */}
          {modalConfig.etapa === 'config' && (
            <>
              {modalConfig.pagamento?.status_forcado && (
                <Button
                  variant="outline-warning"
                  onClick={reverterConfigOriginal}
                  disabled={modalConfig.processando}
                >
                  {modalConfig.processando ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-2" />
                      Revertendo...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={16} className="me-2" />
                      Reverter p/ Original
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={aplicarConfigForcada}
                disabled={modalConfig.processando}
              >
                {modalConfig.processando ? (
                  <>
                    <Spinner as="span" animation="border" size="sm" className="me-2" />
                    Aplicando...
                  </>
                ) : (
                  <>
                    <Settings size={16} className="me-2" />
                    Aplicar Configuracao
                  </>
                )}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>

      {/* Modal de Lançamento Individual no Control */}
      <Modal show={showModalLancarControl} onHide={() => { setShowModalLancarControl(false); setPagamentoParaLancar(null); }} centered>
        <Modal.Header closeButton className="bg-primary text-white">
          <Modal.Title>
            <Upload size={20} className="me-2" />
            Lançar no Aupus Control
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {pagamentoParaLancar && (
            <>
              <Alert variant="info" className="mb-3">
                <strong>Info:</strong> Este lançamento será criado no Aupus Control (sistema de controle financeiro).
              </Alert>

              <Card className="mb-3">
                <Card.Body>
                  <Row className="mb-2">
                    <Col xs={4}><strong>UC:</strong></Col>
                    <Col xs={8}>{pagamentoParaLancar.uc}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Cliente:</strong></Col>
                    <Col xs={8}>{pagamentoParaLancar.nome_cliente || '-'}</Col>
                  </Row>
                  <Row className="mb-2">
                    <Col xs={4}><strong>Mes Ref:</strong></Col>
                    <Col xs={8}>{pagamentoParaLancar.mes_referencia}</Col>
                  </Row>
                  <Row className="mb-3">
                    <Col xs={4}><strong>Valor:</strong></Col>
                    <Col xs={8}>
                      <span className="text-primary fw-bold fs-5">
                        {formatarValor(pagamentoParaLancar.valor_fatura)}
                      </span>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              <p className="text-muted small mb-0">
                O lançamento será criado com status pendente no Aupus Control.
              </p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => { setShowModalLancarControl(false); setPagamentoParaLancar(null); }}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={confirmarLancamentoControl}
            disabled={lancandoPagamento}
          >
            {lancandoPagamento ? (
              <>
                <Spinner size="sm" className="me-2" />
                Enviando...
              </>
            ) : (
              <>
                <Upload size={16} className="me-1" />
                Confirmar Control
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Modal de Lançamento em Lote no Control */}
      <Modal
        show={modalLancamentoControl.show}
        onHide={fecharModalLancamentoControl}
        centered
        size="lg"
        backdrop={modalLancamentoControl.processando ? 'static' : true}
        keyboard={!modalLancamentoControl.processando}
      >
        <Modal.Header closeButton={!modalLancamentoControl.processando} className="bg-primary text-white">
          <Modal.Title>
            <Upload size={20} className="me-2" />
            Lançamento Control - {modalLancamentoControl.total} Pagamentos
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Estado inicial: confirmação */}
          {!modalLancamentoControl.processando && !modalLancamentoControl.concluido && (
            <>
              <Alert variant="info" className="mb-3">
                <strong>Info:</strong> Todos os pagamentos selecionados serão enviados para o Aupus Control.
              </Alert>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <Table size="sm" hover>
                  <thead>
                    <tr>
                      <th>UC</th>
                      <th>Cliente</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalLancamentoControl.itens.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.uc}</td>
                        <td>{item.nome_cliente || '-'}</td>
                        <td>{formatarValor(item.valor_fatura)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="text-end mt-2">
                <strong>Total: </strong>
                <strong>{formatarValor(modalLancamentoControl.itens.reduce((acc, i) => acc + parseFloat(i.valor_fatura || 0), 0))}</strong>
              </div>
            </>
          )}

          {/* Processando */}
          {modalLancamentoControl.processando && (
            <div className="text-center py-3">
              <Spinner animation="border" variant="primary" className="mb-3" />
              <p>Enviando para Aupus Control...
                <br />{modalLancamentoControl.atual} / {modalLancamentoControl.total}
              </p>
              <div className="progress mb-3">
                <div className="progress-bar bg-primary"
                  style={{ width: `${(modalLancamentoControl.atual / modalLancamentoControl.total) * 100}%` }}>
                  {Math.round((modalLancamentoControl.atual / modalLancamentoControl.total) * 100)}%
                </div>
              </div>
              {modalLancamentoControl.resultados.length > 0 && (
                <div style={{ maxHeight: '200px', overflowY: 'auto', textAlign: 'left' }}>
                  {modalLancamentoControl.resultados.map((res, idx) => (
                    <div key={idx} className={`small ${res.sucesso ? 'text-success' : 'text-danger'}`}>
                      {res.sucesso ? '✓' : '✗'} {res.uc} - {res.nome || ''} - {res.mensagem}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Concluído */}
          {modalLancamentoControl.concluido && (
            <div className="text-center py-3">
              <Row className="mb-3">
                <Col>
                  <div className="display-6 text-success">{modalLancamentoControl.sucessos}</div>
                  <small>Sucessos</small>
                </Col>
                <Col>
                  <div className="display-6 text-danger">{modalLancamentoControl.erros}</div>
                  <small>Erros</small>
                </Col>
              </Row>
              <div style={{ maxHeight: '300px', overflowY: 'auto', textAlign: 'left' }}>
                {modalLancamentoControl.resultados.map((res, idx) => (
                  <div key={idx} className={`small mb-1 ${res.sucesso ? 'text-success' : 'text-danger'}`}>
                    {res.sucesso ? '✓' : '✗'} {res.uc} - {res.nome || ''} - {res.mensagem}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          {!modalLancamentoControl.processando && !modalLancamentoControl.concluido && (
            <>
              <Button variant="secondary" onClick={fecharModalLancamentoControl}>Cancelar</Button>
              <Button variant="primary" onClick={executarLancamentoLoteControl}>
                <Upload size={16} className="me-1" />
                Confirmar Lançamento Control
              </Button>
            </>
          )}
          {modalLancamentoControl.concluido && (
            <Button
              variant={modalLancamentoControl.erros === 0 ? 'primary' : 'secondary'}
              onClick={fecharModalLancamentoControl}
            >
              Fechar
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default PagamentosConcessionaria;
