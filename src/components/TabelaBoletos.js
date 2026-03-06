import React, { useState } from 'react';
import { Table, Button, Badge, Collapse, Card, Row, Col, ButtonGroup } from 'react-bootstrap';
import { formatarPrimeiraMaiuscula, formatarValor, formatarData, formatarCPFComMascara, formatarCNPJComMascara } from '../utils/formatters';

function TabelaBoletos({ boletos, onBaixar, onConsultar, onBaixarPDF, onEditarVencimento }) {
  const [expandedRows, setExpandedRows] = useState({});

  const toggleRow = (index) => {
    setExpandedRows(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const getSituacaoBadge = (codigoSituacao) => {
    // Mapeamento baseado no código numérico do Banco do Brasil
    const situacoes = {
      1: { variant: 'success', texto: 'Normal' },
      2: { variant: 'secondary', texto: 'Movimento Cartório' },
      3: { variant: 'secondary', texto: 'Em Cartório' },
      4: { variant: 'info', texto: 'Título com Ocorrência de Cartório' },
      5: { variant: 'secondary', texto: 'Protestado Eletrônico' },
      6: { variant: 'info', texto: 'Liquidado' },
      7: { variant: 'secondary', texto: 'Baixado' },
      8: { variant: 'warning', texto: 'Título com Pendência Cartório' },
      9: { variant: 'secondary', texto: 'Título Protestado Manual' },
      10: { variant: 'secondary', texto: 'Título Baixado/Pago em Cartório' },
      11: { variant: 'secondary', texto: 'Título Liquidado/Protestado' },
      12: { variant: 'secondary', texto: 'Título Liquid/Pgto Em Cartório' },
      13: { variant: 'secondary', texto: 'Título Protestado Aguardando Baixa' },
      14: { variant: 'secondary', texto: 'Título em Liquidação' },
      15: { variant: 'secondary', texto: 'Título Excluído' },
      16: { variant: 'secondary', texto: 'Título Cancelado' }
    };

    const config = situacoes[codigoSituacao] || { variant: 'secondary', texto: `Código ${codigoSituacao}` };

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

  if (!boletos || boletos.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center py-5">
          <i className="fas fa-inbox fa-3x text-muted mb-3"></i>
          <p className="text-muted">Nenhum boleto encontrado.</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <div className="table-responsive">
      <Table hover className="align-middle">
        <thead>
          <tr>
            <th style={{ width: '50px' }}></th>
            <th>Número</th>
            <th>Pagador</th>
            <th>Vencimento</th>
            <th>Valor</th>
            <th>Situação</th>
            <th style={{ width: '150px' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {boletos.map((boleto, index) => (
            <React.Fragment key={index}>
              <tr>
                <td>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => toggleRow(index)}
                    className="p-0 text-decoration-none"
                  >
                    <i className={`fas fa-chevron-${expandedRows[index] ? 'down' : 'right'}`}></i>
                  </Button>
                </td>
                <td>
                  <strong>{boleto.sequencial || boleto.id || boleto.numero || 'N/A'}</strong>
                  <br />
                  <small className="text-muted">
                    {boleto.numeroBoletoBB || boleto.numeroTituloCliente || 'N/A'}
                  </small>
                </td>
                <td>
                  {formatarPrimeiraMaiuscula(
                    boleto.nomeSacadoCobranca ||
                    boleto.pagador?.nome ||
                    'Não informado'
                  )}
                  <br />
                  <small className="text-muted">
                    {formatarDocumento(
                      boleto.numeroInscricaoSacadoCobranca || boleto.pagador?.numeroInscricao,
                      boleto.codigoTipoInscricaoSacado || boleto.pagador?.tipoInscricao
                    )}
                  </small>
                </td>
                <td>{formatarData(boleto.dataVencimento || boleto.dataVencimentoTituloCobranca) || 'N/A'}</td>
                <td>
                  <strong>
                    {formatarValor(
                      boleto.valorAtual ||
                      boleto.valorAtualTituloCobranca ||
                      boleto.valorOriginal ||
                      boleto.valorOriginalTituloCobranca ||
                      boleto.valor
                    )}
                  </strong>
                </td>
                <td>{getSituacaoBadge(boleto.codigoEstadoTituloCobranca || boleto.situacao)}</td>
                <td>
                  <ButtonGroup size="sm">
                    <Button
                      variant="outline-info"
                      title="Ver Detalhes"
                      onClick={() => toggleRow(index)}
                    >
                      <i className="fas fa-eye"></i>
                    </Button>
                    <Button
                      variant="outline-success"
                      title="Baixar PDF"
                      onClick={() => onBaixarPDF && onBaixarPDF(boleto)}
                    >
                      <i className="fas fa-file-pdf"></i>
                    </Button>
                    {boleto.codigoEstadoTituloCobranca === 1 && (
                      <>
                        <Button
                          variant="outline-warning"
                          title="Alterar Vencimento"
                          onClick={() => onEditarVencimento && onEditarVencimento(boleto)}
                        >
                          <i className="fas fa-calendar-alt"></i>
                        </Button>
                        <Button
                          variant="outline-danger"
                          title="Cancelar Boleto"
                          onClick={() => onBaixar && onBaixar(boleto)}
                        >
                          <i className="fas fa-times"></i>
                        </Button>
                      </>
                    )}
                  </ButtonGroup>
                </td>
              </tr>

              <tr>
                <td colSpan="7" className="p-0 border-0">
                  <Collapse in={expandedRows[index]}>
                    <div>
                      <Card className="border-0 border-top rounded-0">
                        <Card.Body className="bg-light">
                          <Row>
                            <Col md={6}>
                              <h6 className="text-primary mb-3">💰 Informações Financeiras</h6>
                              <p className="mb-1">
                                <strong>Valor Original:</strong>{' '}
                                {formatarValor(boleto.valorOriginal || boleto.valorOriginalTituloCobranca)}
                              </p>
                              <p className="mb-1">
                                <strong>Valor Atual:</strong>{' '}
                                {formatarValor(boleto.valorAtual || boleto.valorAtualTituloCobranca)}
                              </p>
                              <p className="mb-1">
                                <strong>Data Vencimento:</strong>{' '}
                                {formatarData(boleto.dataVencimento || boleto.dataVencimentoTituloCobranca) || 'N/A'}
                              </p>
                              <p className="mb-1">
                                <strong>Data Registro:</strong>{' '}
                                {formatarData(boleto.dataRegistro || boleto.dataRegistroTituloCobranca) || 'N/A'}
                              </p>
                              <p className="mb-1">
                                <strong>Status:</strong>{' '}
                                {getSituacaoBadge(boleto.codigoEstadoTituloCobranca)}
                              </p>

                              {(boleto.linhaDigitavel || boleto.codigoLinhaDigitavel) && (
                                <div className="mt-3">
                                  <strong>Linha Digitável:</strong>
                                  <code className="d-block p-2 bg-white rounded mt-1">
                                    {boleto.linhaDigitavel || boleto.codigoLinhaDigitavel}
                                  </code>
                                </div>
                              )}

                              {boleto.textoCodigoBarrasTituloCobranca && boleto.textoCodigoBarrasTituloCobranca !== 'N/A' && (
                                <div className="mt-2">
                                  <strong>Código de Barras:</strong>
                                  <code className="d-block p-2 bg-white rounded mt-1">
                                    {boleto.textoCodigoBarrasTituloCobranca}
                                  </code>
                                </div>
                              )}
                            </Col>

                            <Col md={6}>
                              <h6 className="text-primary mb-3">👤 Dados do Pagador</h6>
                              <p className="mb-1">
                                <strong>Nome:</strong>{' '}
                                {formatarPrimeiraMaiuscula(boleto.nomeSacadoCobranca || 'N/A')}
                              </p>
                              <p className="mb-1">
                                <strong>Documento:</strong>{' '}
                                {formatarDocumento(
                                  boleto.numeroInscricaoSacadoCobranca,
                                  boleto.codigoTipoInscricaoSacado
                                )}
                              </p>
                              <p className="mb-1">
                                <strong>Email:</strong>{' '}
                                {boleto.textoEmailPagador || 'N/A'}
                              </p>
                              <p className="mb-1">
                                <strong>Endereço:</strong>{' '}
                                {formatarPrimeiraMaiuscula(boleto.textoEnderecoSacadoCobranca || 'N/A')}
                              </p>
                              <p className="mb-1">
                                <strong>Bairro:</strong>{' '}
                                {formatarPrimeiraMaiuscula(boleto.nomeBairroSacadoCobranca || 'N/A')}
                              </p>
                              <p className="mb-1">
                                <strong>Cidade:</strong>{' '}
                                {formatarPrimeiraMaiuscula(boleto.nomeMunicipioSacadoCobranca || 'N/A')}
                              </p>
                              <p className="mb-1">
                                <strong>UF:</strong>{' '}
                                {boleto.siglaUnidadeFederacaoSacadoCobranca || 'N/A'}
                              </p>
                              <p className="mb-1">
                                <strong>CEP:</strong>{' '}
                                {boleto.numeroCepSacadoCobranca || 'N/A'}
                              </p>
                            </Col>
                          </Row>

                          {boleto.qrCode && boleto.qrCode.txId && (
                            <Row className="mt-3">
                              <Col>
                                <h6 className="text-primary mb-3">PIX</h6>
                                <div className="d-flex gap-2">
                                  <Button
                                    variant="success"
                                    size="sm"
                                    onClick={() => {
                                      navigator.clipboard.writeText(boleto.qrCode.txId);
                                      alert('Código PIX copiado!');
                                    }}
                                  >
                                    <i className="fas fa-qrcode me-2"></i>
                                    Copiar Código PIX
                                  </Button>
                                </div>
                              </Col>
                            </Row>
                          )}
                        </Card.Body>
                      </Card>
                    </div>
                  </Collapse>
                </td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default TabelaBoletos;
