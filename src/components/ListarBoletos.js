import React, { useState } from 'react';
import { Form, Button, Row, Col, Alert, Spinner, Card, Badge, Modal } from 'react-bootstrap';
import { listarBoletos, consultarBoleto, consultarPixBoleto, baixarBoleto, obterToken } from '../services/api';
import TabelaBoletos from './TabelaBoletos';
import { CONFIG } from '../config';

function ListarBoletos({ onBoletoSelect }) {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [boletoDetalhado, setBoletoDetalhado] = useState([]);

  // Estados do modal de edição de vencimento
  const [showModalVencimento, setShowModalVencimento] = useState(false);
  const [boletoEditando, setBoletoEditando] = useState(null);
  const [novaDataVencimento, setNovaDataVencimento] = useState('');
  const [loadingEdicao, setLoadingEdicao] = useState(false);

  // Estados de paginação
  const [todosOsBoletos, setTodosOsBoletos] = useState([]); // Lista completa (apenas cabeçalhos)
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [boletosCarregados, setBoletosCarregados] = useState({}); // Cache: {pagina: [boletos]}
  const BOLETOS_POR_PAGINA = 20;

  // Calcular data inicial (primeiro dia do mês atual) e data fim (hoje)
  const obterDatasPadrao = () => {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    const formatarData = (data) => {
      const ano = data.getFullYear();
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const dia = String(data.getDate()).padStart(2, '0');
      return `${ano}-${mes}-${dia}`;
    };

    return {
      dataInicio: formatarData(primeiroDiaMes),
      dataFim: formatarData(hoje)
    };
  };

  const datasPadrao = obterDatasPadrao();

  const [filtros, setFiltros] = useState({
    indicadorSituacao: 'A',
    tipoData: 'registro',
    dataInicio: datasPadrao.dataInicio,
    dataFim: datasPadrao.dataFim,
    nome: ''
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFiltros(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleBuscar = async (e) => {
    if (e) e.preventDefault();

    setErro(null);
    setBoletoDetalhado([]);
    setLoading(true);

    try {
      console.log('🔍 Buscando boletos com filtros:', filtros);

      let response;

      // Preparar filtros base para datas
      const filtrosBase = {};
      if (filtros.dataInicio && filtros.dataFim) {
        const dataInicioFormatada = filtros.dataInicio.split('-').reverse().join('.');
        const dataFimFormatada = filtros.dataFim.split('-').reverse().join('.');

        if (filtros.tipoData === 'vencimento') {
          filtrosBase.dataInicioVencimento = dataInicioFormatada;
          filtrosBase.dataFimVencimento = dataFimFormatada;
        } else if (filtros.tipoData === 'registro') {
          filtrosBase.dataInicioRegistro = dataInicioFormatada;
          filtrosBase.dataFimRegistro = dataFimFormatada;
        }
      }

      // Se filtro for "Todos" (vazio), buscar A e B em paralelo
      if (filtros.indicadorSituacao === '') {
        console.log('🔍 Buscando TODOS os boletos (Ativos + Baixados)...');

        const [resultadoA, resultadoB] = await Promise.all([
          listarBoletos({ ...filtrosBase, indicadorSituacao: 'A' }),
          listarBoletos({ ...filtrosBase, indicadorSituacao: 'B' })
        ]);

        const boletosA = resultadoA?.boletos || [];
        const boletosB = resultadoB?.boletos || [];

        console.log(`📊 Resultado: ${boletosA.length} ativos + ${boletosB.length} baixados = ${boletosA.length + boletosB.length} total`);

        response = {
          boletos: [...boletosA, ...boletosB],
          indicadorContinuidade: resultadoA?.indicadorContinuidade || resultadoB?.indicadorContinuidade
        };
      } else {
        // Filtro específico (A ou B)
        const params = {
          ...filtrosBase,
          indicadorSituacao: filtros.indicadorSituacao
        };

        console.log('📋 Buscando boletos com indicadorSituacao:', filtros.indicadorSituacao);
        response = await listarBoletos(params);
      }

      console.log('📋 Resposta da API:', response);

      if (response && response.boletos && response.boletos.length > 0) {
        // Ordenar boletos por data de registro (mais recentes primeiro)
        const boletosOrdenados = [...response.boletos].sort((a, b) => {
          const dataA = a.dataRegistro.split('.').reverse().join('');
          const dataB = b.dataRegistro.split('.').reverse().join('');
          return dataB.localeCompare(dataA); // Decrescente (mais recente primeiro)
        });

        console.log(`📊 Total de ${boletosOrdenados.length} boletos encontrados`);
        console.log('📄 Carregando apenas página 1 (20 boletos)...');

        // Armazenar lista completa (cabeçalhos)
        setTodosOsBoletos(boletosOrdenados);
        setPaginaAtual(1);
        setBoletosCarregados({});

        // Carregar detalhes apenas da primeira página
        const primeiroIndice = 0;
        const ultimoIndice = BOLETOS_POR_PAGINA;
        const boletosPagina1 = boletosOrdenados.slice(primeiroIndice, ultimoIndice);
        const boletosComDetalhes = [];

        for (const boleto of boletosPagina1) {
          try {
            // Extrair sequencial do numeroBoletoBB (últimos 10 dígitos sem zeros à esquerda)
            const extrairSequencial = (numero) => {
              if (!numero) return null;
              const sequencial = numero.slice(-10).replace(/^0+/, '') || '1';
              return sequencial;
            };

            const sequencial = extrairSequencial(
              boleto.numeroTituloCliente || boleto.numeroBoletoBB || boleto.numero
            );

            console.log(`📋 Buscando detalhes do boleto ${sequencial}...`);

            if (sequencial) {
              // Aguardar 100ms entre cada requisição para evitar rate limit (503)
              await new Promise(resolve => setTimeout(resolve, 100));

              const detalhes = await consultarBoleto(sequencial);

              // NÃO buscar PIX aqui - será buscado apenas ao baixar PDF
              // Isso reduz de 40 para 20 requisições (50% mais rápido)

              // Mesclar dados: priorizar dados do consultarBoleto (detalhes completos)
              // Apenas sobrescrever com dados da listagem se forem mais recentes (numeroBoletoBB, dataRegistro)
              const boletoCompleto = {
                // Usar detalhes como base (dados completos)
                ...detalhes,

                // Adicionar campos úteis da listagem
                sequencial: sequencial,
                id: sequencial,
                numeroBoletoBB: boleto.numeroBoletoBB, // Da listagem
                dataRegistro: boleto.dataRegistro,     // Da listagem

                // Dados financeiros: PRIORIZAR detalhes (consultarBoleto tem dados corretos)
                dataVencimento: detalhes.dataVencimentoTituloCobranca || boleto.dataVencimento,
                valorOriginal: detalhes.valorOriginalTituloCobranca || boleto.valorOriginal,
                valorAtual: detalhes.valorAtualTituloCobranca || boleto.valorAtual,
                codigoEstadoTituloCobranca: detalhes.codigoEstadoTituloCobranca || boleto.codigoEstadoTituloCobranca,

                // IMPORTANTE: Dados do pagador - SEMPRE dos detalhes (consultarBoleto)
                nomeSacadoCobranca: detalhes.nomeSacadoCobranca,
                numeroInscricaoSacadoCobranca: detalhes.numeroInscricaoSacadoCobranca,
                codigoTipoInscricaoSacado: detalhes.codigoTipoInscricaoSacado,
                textoEnderecoSacadoCobranca: detalhes.textoEnderecoSacadoCobranca,
                nomeBairroSacadoCobranca: detalhes.nomeBairroSacadoCobranca,
                nomeMunicipioSacadoCobranca: detalhes.nomeMunicipioSacadoCobranca,
                siglaUnidadeFederacaoSacadoCobranca: detalhes.siglaUnidadeFederacaoSacadoCobranca,
                numeroCepSacadoCobranca: detalhes.numeroCepSacadoCobranca,
                textoEmailPagador: detalhes.textoEmailPagador,

                // Valores financeiros detalhados - dos detalhes
                valorOriginalTituloCobranca: detalhes.valorOriginalTituloCobranca,
                valorAtualTituloCobranca: detalhes.valorAtualTituloCobranca,
                dataVencimentoTituloCobranca: detalhes.dataVencimentoTituloCobranca,
                dataRegistroTituloCobranca: detalhes.dataRegistroTituloCobranca,

                // Linha digitável e códigos - dos detalhes
                codigoLinhaDigitavel: detalhes.codigoLinhaDigitavel,
                linhaDigitavel: detalhes.codigoLinhaDigitavel,
                textoCodigoBarrasTituloCobranca: detalhes.textoCodigoBarrasTituloCobranca,

                // QR Code PIX será carregado sob demanda ao baixar PDF
              };

              boletosComDetalhes.push(boletoCompleto);
            } else {
              boletosComDetalhes.push(boleto);
            }
          } catch (error) {
            console.warn('⚠️ Erro ao buscar detalhes do boleto:', error.message);
            // Adicionar boleto mesmo sem detalhes completos
            boletosComDetalhes.push(boleto);
          }
        }

        console.log(`✅ ${boletosComDetalhes.length} boletos da página 1 carregados com sucesso`);

        // Salvar no cache da página 1
        setBoletosCarregados({ 1: boletosComDetalhes });
        setBoletoDetalhado(boletosComDetalhes);

      } else {
        setErro('Nenhum boleto encontrado com os filtros selecionados.');
      }

    } catch (error) {
      console.error('❌ Erro ao listar boletos:', error);
      setErro(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Função para carregar detalhes de uma página específica
  const carregarPagina = async (numeroPagina) => {
    // Verificar se já está no cache
    if (boletosCarregados[numeroPagina]) {
      console.log(`📄 Página ${numeroPagina} já está em cache`);
      setPaginaAtual(numeroPagina);
      setBoletoDetalhado(boletosCarregados[numeroPagina]);
      return;
    }

    try {
      setLoading(true);
      console.log(`📄 Carregando página ${numeroPagina}...`);

      const primeiroIndice = (numeroPagina - 1) * BOLETOS_POR_PAGINA;
      const ultimoIndice = numeroPagina * BOLETOS_POR_PAGINA;
      const boletosDaPagina = todosOsBoletos.slice(primeiroIndice, ultimoIndice);

      const boletosComDetalhes = [];

      for (const boleto of boletosDaPagina) {
        try {
          const extrairSequencial = (numero) => {
            if (!numero) return null;
            const sequencial = numero.slice(-10).replace(/^0+/, '') || '1';
            return sequencial;
          };

          const sequencial = extrairSequencial(
            boleto.numeroTituloCliente || boleto.numeroBoletoBB || boleto.numero
          );

          if (sequencial) {
            // Aguardar 100ms entre cada requisição para evitar rate limit
            await new Promise(resolve => setTimeout(resolve, 100));

            const detalhes = await consultarBoleto(sequencial);

            // NÃO buscar PIX aqui - será buscado apenas ao baixar PDF

            const boletoCompleto = {
              ...detalhes,
              sequencial: sequencial,
              id: sequencial,
              numeroBoletoBB: boleto.numeroBoletoBB,
              dataRegistro: boleto.dataRegistro,
              dataVencimento: detalhes.dataVencimentoTituloCobranca || boleto.dataVencimento,
              valorOriginal: detalhes.valorOriginalTituloCobranca || boleto.valorOriginal,
              valorAtual: detalhes.valorAtualTituloCobranca || boleto.valorAtual,
              codigoEstadoTituloCobranca: detalhes.codigoEstadoTituloCobranca || boleto.codigoEstadoTituloCobranca,
              nomeSacadoCobranca: detalhes.nomeSacadoCobranca,
              numeroInscricaoSacadoCobranca: detalhes.numeroInscricaoSacadoCobranca,
              codigoTipoInscricaoSacado: detalhes.codigoTipoInscricaoSacado,
              textoEnderecoSacadoCobranca: detalhes.textoEnderecoSacadoCobranca,
              nomeBairroSacadoCobranca: detalhes.nomeBairroSacadoCobranca,
              nomeMunicipioSacadoCobranca: detalhes.nomeMunicipioSacadoCobranca,
              siglaUnidadeFederacaoSacadoCobranca: detalhes.siglaUnidadeFederacaoSacadoCobranca,
              numeroCepSacadoCobranca: detalhes.numeroCepSacadoCobranca,
              textoEmailPagador: detalhes.textoEmailPagador,
              valorOriginalTituloCobranca: detalhes.valorOriginalTituloCobranca,
              valorAtualTituloCobranca: detalhes.valorAtualTituloCobranca,
              dataVencimentoTituloCobranca: detalhes.dataVencimentoTituloCobranca,
              dataRegistroTituloCobranca: detalhes.dataRegistroTituloCobranca,
              codigoLinhaDigitavel: detalhes.codigoLinhaDigitavel,
              linhaDigitavel: detalhes.codigoLinhaDigitavel,
              textoCodigoBarrasTituloCobranca: detalhes.textoCodigoBarrasTituloCobranca,
              // QR Code PIX será carregado sob demanda ao baixar PDF
            };

            boletosComDetalhes.push(boletoCompleto);
          } else {
            boletosComDetalhes.push(boleto);
          }
        } catch (error) {
          console.warn('⚠️ Erro ao buscar detalhes do boleto:', error.message);
          boletosComDetalhes.push(boleto);
        }
      }

      console.log(`✅ Página ${numeroPagina} carregada: ${boletosComDetalhes.length} boletos`);

      // Salvar no cache
      setBoletosCarregados(prev => ({
        ...prev,
        [numeroPagina]: boletosComDetalhes
      }));

      setPaginaAtual(numeroPagina);
      setBoletoDetalhado(boletosComDetalhes);

    } catch (error) {
      console.error('❌ Erro ao carregar página:', error);
      alert('Erro ao carregar página: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBaixarBoleto = async (boleto) => {
    if (!window.confirm('Tem certeza que deseja baixar/cancelar este boleto?')) {
      return;
    }

    try {
      setLoading(true);
      const numeroConvenio = CONFIG.numeroConvenio;
      const numeroSequencial = boleto.sequencial || boleto.numeroTituloBeneficiario || boleto.numero;

      console.log('📋 Baixando boleto:', { numeroConvenio, numeroSequencial, boleto });

      await baixarBoleto(numeroConvenio, numeroSequencial, 'PEDIDO DO CLIENTE');

      alert('Boleto baixado com sucesso!');

      // Atualizar lista
      handleBuscar();

    } catch (error) {
      console.error('❌ Erro ao baixar boleto:', error);
      alert('Erro ao baixar boleto: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConsultarBoleto = (boleto) => {
    if (onBoletoSelect) {
      onBoletoSelect(boleto);
    }
  };

  // Função para abrir modal de edição de vencimento
  const handleEditarVencimento = (boleto) => {
    setBoletoEditando(boleto);
    // Converter data para formato yyyy-mm-dd para o input date
    const dataAtual = boleto.dataVencimento || boleto.dataVencimentoTituloCobranca;
    if (dataAtual) {
      // Formato pode ser dd.mm.yyyy ou dd/mm/yyyy
      const partes = dataAtual.includes('.') ? dataAtual.split('.') : dataAtual.split('/');
      if (partes.length === 3) {
        setNovaDataVencimento(`${partes[2]}-${partes[1]}-${partes[0]}`);
      }
    }
    setShowModalVencimento(true);
  };

  // Função para salvar nova data de vencimento
  const handleSalvarVencimento = async () => {
    if (!boletoEditando || !novaDataVencimento) {
      alert('Selecione uma nova data de vencimento');
      return;
    }

    try {
      setLoadingEdicao(true);

      // Obter token OAuth
      console.log('🔑 Obtendo token OAuth...');
      const tokenResponse = await obterToken();

      if (!tokenResponse || !tokenResponse.access_token) {
        throw new Error('Não foi possível obter token OAuth');
      }

      const numeroBoleto = boletoEditando.numeroBoletoBB || boletoEditando.numeroTituloCliente;

      console.log(`📅 Alterando vencimento do boleto ${numeroBoleto} para ${novaDataVencimento}`);

      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/api/boleto-energia/alterar-vencimento/${numeroBoleto}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          novaDataVencimento: novaDataVencimento,
          token: tokenResponse.access_token
        })
      });

      const resultado = await response.json();

      if (!response.ok) {
        throw new Error(resultado.error || 'Erro ao alterar vencimento');
      }

      alert(`✅ Data de vencimento alterada com sucesso!\n\nDe: ${resultado.boleto?.data_vencimento_anterior}\nPara: ${resultado.boleto?.data_vencimento_nova}`);

      // Fechar modal e atualizar lista
      setShowModalVencimento(false);
      setBoletoEditando(null);
      setNovaDataVencimento('');

      // Limpar cache e recarregar
      setBoletosCarregados({});
      handleBuscar();

    } catch (error) {
      console.error('❌ Erro ao alterar vencimento:', error);
      alert('Erro ao alterar vencimento: ' + error.message);
    } finally {
      setLoadingEdicao(false);
    }
  };

  const handleBaixarPDF = async (boleto) => {
    try {
      setLoading(true);
      console.log('📄 Iniciando download de PDF do boleto:', boleto.sequencial);

      // Buscar PIX sob demanda (apenas quando gerar PDF)
      let dadosPix = null;
      try {
        console.log('📱 Buscando PIX para o PDF...');
        dadosPix = await consultarPixBoleto(boleto.sequencial);
        console.log('✅ PIX carregado para PDF:', dadosPix);
      } catch (error) {
        console.log('ℹ️ Boleto sem PIX ou erro ao buscar:', error.message);
      }

      // Merge PIX data into boleto before sending to PDF generator
      const boletoComPix = {
        ...boleto,
        dadosPix: dadosPix
      };

      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/gerar-pdf-boleto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(boletoComPix)
      });

      if (!response.ok) {
        throw new Error(`Erro ao gerar PDF: ${response.statusText}`);
      }

      // Baixar o arquivo
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `boleto-${boleto.sequencial || boleto.numeroTitulo}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      console.log('✅ PDF baixado com sucesso');

    } catch (error) {
      console.error('❌ Erro ao baixar PDF:', error);
      alert('Erro ao baixar PDF: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card className="mb-4">
        <Card.Header className="bg-primary text-white">
          <h4 className="mb-0">Filtros de Busca</h4>
        </Card.Header>
        <Card.Body>
          <Form onSubmit={handleBuscar}>
            <Row>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Situação</Form.Label>
                  <Form.Select
                    name="indicadorSituacao"
                    value={filtros.indicadorSituacao}
                    onChange={handleInputChange}
                  >
                    <option value="A">Ativos</option>
                    <option value="B">Baixados</option>
                    <option value="">Todos</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Filtrar por</Form.Label>
                  <Form.Select
                    name="tipoData"
                    value={filtros.tipoData}
                    onChange={handleInputChange}
                  >
                    <option value="vencimento">Data de Vencimento</option>
                    <option value="registro">Data de Registro</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={2}>
                <Form.Group className="mb-3">
                  <Form.Label>Data Início</Form.Label>
                  <Form.Control
                    type="date"
                    name="dataInicio"
                    value={filtros.dataInicio}
                    onChange={handleInputChange}
                  />
                </Form.Group>
              </Col>

              <Col md={2}>
                <Form.Group className="mb-3">
                  <Form.Label>Data Fim</Form.Label>
                  <Form.Control
                    type="date"
                    name="dataFim"
                    value={filtros.dataFim}
                    onChange={handleInputChange}
                  />
                </Form.Group>
              </Col>

              <Col md={2}>
                <Form.Group className="mb-3">
                  <Form.Label>&nbsp;</Form.Label>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={loading}
                    className="w-100"
                  >
                    {loading ? (
                      <>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          role="status"
                          className="me-2"
                        />
                        Buscando...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-search me-2"></i>
                        Buscar
                      </>
                    )}
                  </Button>
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Filtrar por Nome do Cliente</Form.Label>
                  <Form.Control
                    type="text"
                    name="nome"
                    placeholder="Digite o nome do cliente..."
                    value={filtros.nome}
                    onChange={handleInputChange}
                  />
                  <Form.Text className="text-muted">
                    Filtra os resultados pelo nome do pagador (após buscar)
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Card.Body>
      </Card>

      {erro && (
        <Alert variant="warning" dismissible onClose={() => setErro(null)}>
          <i className="fas fa-exclamation-triangle me-2"></i>
          {erro}
        </Alert>
      )}

      {!loading && boletoDetalhado.length > 0 && (() => {
        // Aplicar filtro de nome (client-side)
        const boletosFiltrados = filtros.nome
          ? boletoDetalhado.filter(boleto =>
              (boleto.nomeSacadoCobranca || '').toLowerCase().includes(filtros.nome.toLowerCase())
            )
          : boletoDetalhado;

        return (
        <>
          <Card>
            <Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Resultados da Busca</h5>
              <Badge bg="light" text="dark">
                Total: {todosOsBoletos.length} boleto(s) | Mostrando: {boletosFiltrados.length}{filtros.nome ? ` (filtrado por nome)` : ''} da página {paginaAtual}
              </Badge>
            </Card.Header>
            <Card.Body className="p-0">
              <TabelaBoletos
                boletos={boletosFiltrados}
                onBaixar={handleBaixarBoleto}
                onConsultar={handleConsultarBoleto}
                onBaixarPDF={handleBaixarPDF}
                onEditarVencimento={handleEditarVencimento}
              />
            </Card.Body>
          </Card>

          {/* Controles de Paginação */}
          {todosOsBoletos.length > BOLETOS_POR_PAGINA && (
            <Card className="mt-3">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <span className="text-muted">
                      Mostrando {((paginaAtual - 1) * BOLETOS_POR_PAGINA) + 1} a {Math.min(paginaAtual * BOLETOS_POR_PAGINA, todosOsBoletos.length)} de {todosOsBoletos.length} boletos
                    </span>
                  </div>

                  <div className="btn-group">
                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={paginaAtual === 1 || loading}
                      onClick={() => carregarPagina(1)}
                    >
                      <i className="fas fa-angle-double-left"></i> Primeira
                    </Button>

                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={paginaAtual === 1 || loading}
                      onClick={() => carregarPagina(paginaAtual - 1)}
                    >
                      <i className="fas fa-angle-left"></i> Anterior
                    </Button>

                    <Button variant="outline-secondary" size="sm" disabled>
                      Página {paginaAtual} de {Math.ceil(todosOsBoletos.length / BOLETOS_POR_PAGINA)}
                    </Button>

                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={paginaAtual >= Math.ceil(todosOsBoletos.length / BOLETOS_POR_PAGINA) || loading}
                      onClick={() => carregarPagina(paginaAtual + 1)}
                    >
                      Próxima <i className="fas fa-angle-right"></i>
                    </Button>

                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={paginaAtual >= Math.ceil(todosOsBoletos.length / BOLETOS_POR_PAGINA) || loading}
                      onClick={() => carregarPagina(Math.ceil(todosOsBoletos.length / BOLETOS_POR_PAGINA))}
                    >
                      Última <i className="fas fa-angle-double-right"></i>
                    </Button>
                  </div>
                </div>
              </Card.Body>
            </Card>
          )}
        </>
        );
      })()}

      {loading && (
        <div className="loading-spinner">
          <Spinner animation="border" variant="primary" />
          <p className="mt-3 text-muted">Carregando boletos...</p>
        </div>
      )}

      {/* Modal de Edição de Vencimento */}
      <Modal show={showModalVencimento} onHide={() => setShowModalVencimento(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="fas fa-calendar-alt me-2"></i>
            Alterar Data de Vencimento
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {boletoEditando && (
            <>
              <div className="mb-3 p-3 bg-light rounded">
                <p className="mb-1"><strong>Boleto:</strong> {boletoEditando.sequencial}</p>
                <p className="mb-1"><strong>Pagador:</strong> {boletoEditando.nomeSacadoCobranca}</p>
                <p className="mb-1"><strong>Valor:</strong> R$ {(boletoEditando.valorAtual || boletoEditando.valorOriginal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                <p className="mb-0"><strong>Vencimento Atual:</strong> {boletoEditando.dataVencimento || boletoEditando.dataVencimentoTituloCobranca}</p>
              </div>

              <Form.Group>
                <Form.Label><strong>Nova Data de Vencimento:</strong></Form.Label>
                <Form.Control
                  type="date"
                  value={novaDataVencimento}
                  onChange={(e) => setNovaDataVencimento(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
                <Form.Text className="text-muted">
                  A nova data será atualizada diretamente na API do Banco do Brasil.
                </Form.Text>
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModalVencimento(false)} disabled={loadingEdicao}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSalvarVencimento} disabled={loadingEdicao || !novaDataVencimento}>
            {loadingEdicao ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Salvando...
              </>
            ) : (
              <>
                <i className="fas fa-save me-2"></i>
                Salvar Alteração
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default ListarBoletos;
