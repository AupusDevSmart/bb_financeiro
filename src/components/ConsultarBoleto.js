import React, { useState } from 'react';
import { Form, Button, Card, Alert, Spinner, Row, Col, Badge } from 'react-bootstrap';
import { consultarBoleto } from '../services/api';
import { formatarPrimeiraMaiuscula, formatarValor, formatarData, formatarCPFComMascara, formatarCNPJComMascara } from '../utils/formatters';
import QRCodePIX from './QRCodePIX';

function ConsultarBoleto() {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [boleto, setBoleto] = useState(null);

  const [consultaData, setConsultaData] = useState({
    numeroConvenio: '3648981',
    numeroSequencial: ''
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setConsultaData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleConsultar = async (e) => {
    e.preventDefault();
    setErro(null);
    setBoleto(null);
    setLoading(true);

    try {
      if (!consultaData.numeroSequencial) {
        throw new Error('Número do boleto é obrigatório');
      }

      console.log('🔍 Consultando boleto:', consultaData);

      const response = await consultarBoleto(consultaData.numeroSequencial);

      console.log('✅ Boleto encontrado:', response);
      setBoleto(response);

    } catch (error) {
      console.error('❌ Erro ao consultar boleto:', error);
      setErro(error.message);
    } finally {
      setLoading(false);
    }
  };

  const getSituacaoBadge = (situacao) => {
    const situacoes = {
      'NORMAL': { variant: 'success', texto: 'Normal' },
      'BAIXADO': { variant: 'secondary', texto: 'Baixado' },
      'LIQUIDADO': { variant: 'info', texto: 'Liquidado' },
      'VENCIDO': { variant: 'danger', texto: 'Vencido' },
      'EMABERTO': { variant: 'warning', texto: 'Em Aberto' }
    };

    const config = situacoes[situacao] || { variant: 'secondary', texto: situacao };

    return (
      <Badge bg={config.variant}>
        {config.texto}
      </Badge>
    );
  };

  const formatarDocumento = (numero, tipo) => {
    if (!numero) return 'N/A';

    if (tipo === 1 || tipo === 'CPF') {
      return formatarCPFComMascara(numero);
    } else if (tipo === 2 || tipo === 'CNPJ') {
      return formatarCNPJComMascara(numero);
    }

    return numero;
  };

  const copiarLinhaDigitavel = () => {
    if (boleto?.linhaDigitavel) {
      navigator.clipboard.writeText(boleto.linhaDigitavel);
      alert('Linha digitável copiada com sucesso!');
    }
  };

  return (
    <div>
      <Card>
        <Card.Header className="bg-primary text-white">
          <h4 className="mb-0">Consultar Boleto</h4>
        </Card.Header>
        <Card.Body>
          {erro && (
            <Alert variant="danger" dismissible onClose={() => setErro(null)}>
              <i className="fas fa-exclamation-triangle me-2"></i>
              {erro}
            </Alert>
          )}

          <Form onSubmit={handleConsultar}>
            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Número do Convênio</Form.Label>
                  <Form.Control
                    type="text"
                    name="numeroConvenio"
                    value={consultaData.numeroConvenio}
                    onChange={handleInputChange}
                    placeholder="3648981"
                  />
                </Form.Group>
              </Col>

              <Col md={8}>
                <Form.Group className="mb-3">
                  <Form.Label>Número do Boleto (Nosso Número) *</Form.Label>
                  <Form.Control
                    type="text"
                    name="numeroSequencial"
                    value={consultaData.numeroSequencial}
                    onChange={handleInputChange}
                    placeholder="Digite o número do boleto"
                    required
                  />
                  <Form.Text className="text-muted">
                    Informe o número do boleto ou nosso número
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>

            <Button
              variant="primary"
              type="submit"
              disabled={loading}
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
                  Consultando...
                </>
              ) : (
                <>
                  <i className="fas fa-search me-2"></i>
                  Consultar
                </>
              )}
            </Button>
          </Form>
        </Card.Body>
      </Card>

      {boleto && (
        <>
          <Card className="mt-4">
            <Card.Header className="bg-success text-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Dados do Boleto</h5>
              {getSituacaoBadge(boleto.codigoEstadoTituloCobranca || boleto.situacao)}
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={6}>
                  <div className="boleto-info">
                    <h6 className="text-primary mb-3">Informações Gerais</h6>
                    <p className="mb-2">
                      <strong>Número do Título:</strong>{' '}
                      {boleto.numero || boleto.numeroTituloCliente || 'N/A'}
                    </p>
                    <p className="mb-2">
                      <strong>Nosso Número:</strong>{' '}
                      {boleto.numeroBoletoBB || boleto.nossoNumero || 'N/A'}
                    </p>
                    <p className="mb-2">
                      <strong>Convênio:</strong>{' '}
                      {boleto.numeroConvenio || 'N/A'}
                    </p>
                    <p className="mb-2">
                      <strong>Carteira:</strong>{' '}
                      {boleto.numeroCarteira || 'N/A'}
                      {boleto.numeroVariacaoCarteira && ` / ${boleto.numeroVariacaoCarteira}`}
                    </p>
                    <p className="mb-2">
                      <strong>Data de Emissão:</strong>{' '}
                      {formatarData(boleto.dataEmissao) || 'N/A'}
                    </p>
                    <p className="mb-2">
                      <strong>Data de Vencimento:</strong>{' '}
                      {formatarData(boleto.dataVencimento) || 'N/A'}
                    </p>
                    <p className="mb-2">
                      <strong>Data de Registro:</strong>{' '}
                      {formatarData(boleto.dataRegistro) || 'N/A'}
                    </p>
                  </div>
                </Col>

                <Col md={6}>
                  <div className="boleto-info">
                    <h6 className="text-primary mb-3">Valores</h6>
                    <p className="mb-2">
                      <strong>Valor Original:</strong>{' '}
                      <span className="fs-4 text-success">
                        {formatarValor(boleto.valorOriginal || boleto.valor)}
                      </span>
                    </p>
                    {boleto.valorAtual && (
                      <p className="mb-2">
                        <strong>Valor Atual:</strong>{' '}
                        {formatarValor(boleto.valorAtual)}
                      </p>
                    )}
                    {boleto.valorAbatimento && parseFloat(boleto.valorAbatimento) > 0 && (
                      <p className="mb-2">
                        <strong>Valor Abatimento:</strong>{' '}
                        {formatarValor(boleto.valorAbatimento)}
                      </p>
                    )}
                    {boleto.jurosMora && (
                      <p className="mb-2">
                        <strong>Juros:</strong>{' '}
                        {boleto.jurosMora.porcentagem}% ao mês
                      </p>
                    )}
                    {boleto.multa && (
                      <p className="mb-2">
                        <strong>Multa:</strong>{' '}
                        {boleto.multa.porcentagem}% após {formatarData(boleto.multa.data)}
                      </p>
                    )}
                  </div>
                </Col>
              </Row>

              {boleto.linhaDigitavel && (
                <div className="boleto-info mt-3">
                  <h6 className="text-primary mb-3">Linha Digitável</h6>
                  <div className="d-flex gap-2 align-items-center">
                    <code className="flex-grow-1 d-block p-3 bg-white rounded">
                      {boleto.linhaDigitavel}
                    </code>
                    <Button
                      variant="primary"
                      onClick={copiarLinhaDigitavel}
                    >
                      <i className="fas fa-copy"></i>
                    </Button>
                  </div>
                </div>
              )}

              {boleto.codigoBarraNumerico && (
                <div className="boleto-info mt-3">
                  <h6 className="text-primary mb-3">Código de Barras</h6>
                  <code className="d-block p-3 bg-white rounded">
                    {boleto.codigoBarraNumerico}
                  </code>
                </div>
              )}
            </Card.Body>
          </Card>

          <Card className="mt-4">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">Dados do Pagador</h5>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={6}>
                  <p className="mb-2">
                    <strong>Nome:</strong>{' '}
                    {formatarPrimeiraMaiuscula(boleto.pagador?.nome || 'N/A')}
                  </p>
                  <p className="mb-2">
                    <strong>Documento:</strong>{' '}
                    {formatarDocumento(
                      boleto.pagador?.numeroInscricao,
                      boleto.pagador?.tipoInscricao
                    )}
                  </p>
                  <p className="mb-2">
                    <strong>Endereço:</strong>{' '}
                    {formatarPrimeiraMaiuscula(boleto.pagador?.endereco || 'N/A')}
                  </p>
                </Col>
                <Col md={6}>
                  <p className="mb-2">
                    <strong>Bairro:</strong>{' '}
                    {formatarPrimeiraMaiuscula(boleto.pagador?.bairro || 'N/A')}
                  </p>
                  <p className="mb-2">
                    <strong>Cidade/UF:</strong>{' '}
                    {formatarPrimeiraMaiuscula(boleto.pagador?.cidade || 'N/A')} /{' '}
                    {boleto.pagador?.uf || 'N/A'}
                  </p>
                  <p className="mb-2">
                    <strong>CEP:</strong>{' '}
                    {boleto.pagador?.cep || 'N/A'}
                  </p>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          {boleto.qrCode && boleto.qrCode.txId && (
            <QRCodePIX
              codigoPix={boleto.qrCode.txId}
              numeroTitulo={boleto.numero || boleto.numeroTituloCliente}
            />
          )}
        </>
      )}
    </div>
  );
}

export default ConsultarBoleto;
