import React, { useState } from 'react';
import { Form, Button, Row, Col, Alert, Spinner, Card } from 'react-bootstrap';
import { IMaskInput } from 'react-imask';
import { criarBoleto, obterProximoSequencial } from '../services/api';
import { formatarCpfCnpj, formatarCep, removerAcentos, formatarDataParaAPI, adicionarDias } from '../utils/formatters';
import QRCodePIX from './QRCodePIX';

function CriarBoleto({ onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [boletoCreated, setBoletoCreated] = useState(null);
  const [dadosBoletoExibicao, setDadosBoletoExibicao] = useState(null);

  // Calcular data de vencimento padrão (7 dias a partir de hoje)
  const dataVencimentoPadrao = () => {
    const hoje = new Date();
    hoje.setDate(hoje.getDate() + 7);
    return hoje.toISOString().split('T')[0];
  };

  const [formData, setFormData] = useState({
    // Dados do boleto
    numeroConvenio: '3648981',
    numeroCarteira: '17',
    numeroVariacaoCarteira: '19',
    codigoModalidade: '1',
    dataEmissao: (() => {
      const hoje = new Date();
      const ano = hoje.getFullYear();
      const mes = String(hoje.getMonth() + 1).padStart(2, '0');
      const dia = String(hoje.getDate()).padStart(2, '0');
      return `${ano}-${mes}-${dia}`;
    })(),
    dataVencimento: dataVencimentoPadrao(),
    valorOriginal: '',
    descricao: '',

    // Dados do pagador
    tipoInscricao: '1',
    numeroInscricao: '',
    nome: '',
    endereco: '',
    cep: '',
    cidade: '',
    bairro: '',
    uf: 'GO',
    telefone: '',
    email: '',

    // Dados de juros e multa
    codigoTipoJuro: '3',
    percentualJuro: '1.00',
    codigoTipoMulta: '2',
    percentualMulta: '2.00'
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Buscar CEP usando ViaCEP
  const handleCEPBlur = async (e) => {
    const cep = e.target.value.replace(/\D/g, '');
    if (cep.length === 8) {
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();

        if (!data.erro) {
          setFormData(prev => ({
            ...prev,
            endereco: data.logradouro || prev.endereco,
            bairro: data.bairro || prev.bairro,
            cidade: data.localidade || prev.cidade,
            uf: data.uf || prev.uf
          }));
        }
      } catch (error) {
        console.log('Erro ao buscar CEP:', error);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro(null);
    setBoletoCreated(null);
    setLoading(true);

    try {
      // Validações
      if (!formData.dataVencimento) {
        throw new Error('Data de vencimento é obrigatória');
      }

      if (!formData.valorOriginal || parseFloat(formData.valorOriginal) <= 0) {
        throw new Error('Valor do boleto deve ser maior que zero');
      }

      if (!formData.nome) {
        throw new Error('Nome do pagador é obrigatório');
      }

      // 1. OBTER PRÓXIMO SEQUENCIAL AUTOMATICAMENTE
      console.log('🔢 Obtendo próximo sequencial automaticamente...');
      const sequencial = await obterProximoSequencial();
      console.log(`🔢 Sequencial obtido: ${sequencial}`);

      // Calcular data da multa (vencimento + 1 dia)
      const dataMulta = adicionarDias(formData.dataVencimento, 1);

      // Gerar número de 20 dígitos
      const convenioStr = '3648981'.padStart(7, '0');
      const sequencialStr = sequencial.toString().padStart(10, '0');
      const numeroTituloCliente20Digitos = `000${convenioStr}${sequencialStr}`;

      // Data de emissão SEMPRE a data de hoje (para evitar erro de timezone)
      const hoje = new Date();
      const dataEmissaoHoje = `${String(hoje.getDate()).padStart(2, '0')}.${String(hoje.getMonth() + 1).padStart(2, '0')}.${hoje.getFullYear()}`;

      // Preparar dados para a API (exatamente como API_BB original)
      const dadosBoleto = {
        numeroConvenio: parseInt(formData.numeroConvenio),
        numeroCarteira: parseInt(formData.numeroCarteira),
        numeroVariacaoCarteira: parseInt(formData.numeroVariacaoCarteira),
        codigoModalidade: parseInt(formData.codigoModalidade),
        dataEmissao: dataEmissaoHoje,  // Usar data de hoje calculada no momento
        dataVencimento: formatarDataParaAPI(formData.dataVencimento),
        valorOriginal: parseFloat(formData.valorOriginal),
        indicadorAceiteTituloVencido: 'S',
        numeroDiasLimiteRecebimento: 300,
        quantidadeDiasProtesto: 45,
        codigoAceite: 'N',
        codigoTipoTitulo: 2,
        descricaoTipoTitulo: 'DM',
        indicadorPermissaoRecebimentoParcial: 'N',
        numeroTituloBeneficiario: sequencial.toString(),
        numeroTituloCliente: numeroTituloCliente20Digitos,

        // Juros (1% ao mês - tipo 2)
        jurosMora: {
          tipo: 2,
          porcentagem: parseFloat('1.00')
        },

        // Multa (2% após vencimento + 1 dia)
        multa: {
          tipo: 2,
          data: dataMulta,
          porcentagem: parseFloat('2.00')
        },

        // Dados do pagador com formatação
        pagador: {
          tipoInscricao: parseInt(formData.tipoInscricao),
          numeroInscricao: formatarCpfCnpj(formData.numeroInscricao, parseInt(formData.tipoInscricao)),
          nome: removerAcentos(formData.nome.toUpperCase()),
          endereco: removerAcentos(formData.endereco.toUpperCase()),
          cep: formatarCep(formData.cep),
          cidade: removerAcentos(formData.cidade.toUpperCase()),
          bairro: removerAcentos(formData.bairro.toUpperCase()),
          uf: formData.uf.toUpperCase(),
          telefone: formData.telefone.replace(/\D/g, ''),
          email: formData.email || ''
        },

        // Indicadores
        indicadorPix: 'S'
      };

      console.log('📤 Enviando boleto:', dadosBoleto);

      const response = await criarBoleto(dadosBoleto);

      console.log('✅ Boleto criado:', response);

      // Salvar dados para exibição antes de limpar o formulário
      setDadosBoletoExibicao({
        numero: response.numero || numeroTituloCliente20Digitos,
        valor: parseFloat(formData.valorOriginal).toFixed(2),
        vencimento: formatarDataParaAPI(formData.dataVencimento),
        pagador: formData.nome
      });

      setBoletoCreated(response);

      if (onSuccess) {
        onSuccess(response);
      }

      // Limpar formulário após sucesso
      setFormData({
        ...formData,
        dataVencimento: dataVencimentoPadrao(),
        valorOriginal: '',
        numeroInscricao: '',
        nome: '',
        endereco: '',
        cep: '',
        cidade: '',
        bairro: '',
        uf: 'GO'
      });

    } catch (error) {
      console.error('❌ Erro ao criar boleto:', error);
      setErro(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card>
        <Card.Header className="bg-primary text-white">
          <h4 className="mb-0">Criar Novo Boleto</h4>
        </Card.Header>
        <Card.Body>
          {erro && (
            <Alert variant="danger" dismissible onClose={() => setErro(null)}>
              <i className="fas fa-exclamation-triangle me-2"></i>
              {erro}
            </Alert>
          )}

          <Form onSubmit={handleSubmit}>
            <h5 className="mb-3 text-primary">Dados do Boleto</h5>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Data de Vencimento *</Form.Label>
                  <Form.Control
                    type="date"
                    name="dataVencimento"
                    value={formData.dataVencimento}
                    onChange={handleInputChange}
                    required
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Valor (R$) *</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    min="0.01"
                    name="valorOriginal"
                    value={formData.valorOriginal}
                    onChange={handleInputChange}
                    placeholder="0.00"
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label>Descrição</Form.Label>
                  <Form.Control
                    type="text"
                    name="descricao"
                    value={formData.descricao}
                    onChange={handleInputChange}
                    placeholder="Descrição do boleto"
                  />
                </Form.Group>
              </Col>
            </Row>

            <hr className="my-4" />

            <h5 className="mb-3 text-primary">Dados do Pagador</h5>
            <Row>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Tipo de Documento *</Form.Label>
                  <Form.Select
                    name="tipoInscricao"
                    value={formData.tipoInscricao}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="1">CPF</option>
                    <option value="2">CNPJ</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={5}>
                <Form.Group className="mb-3">
                  <Form.Label>
                    {formData.tipoInscricao === '1' ? 'CPF' : 'CNPJ'} *
                  </Form.Label>
                  <Form.Control
                    as={IMaskInput}
                    mask={formData.tipoInscricao === '1' ? '000.000.000-00' : '00.000.000/0000-00'}
                    value={formData.numeroInscricao}
                    onAccept={(value) => {
                      handleInputChange({ target: { name: 'numeroInscricao', value } });
                    }}
                    placeholder={formData.tipoInscricao === '1' ? '000.000.000-00' : '00.000.000/0000-00'}
                    required
                  />
                </Form.Group>
              </Col>

              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Nome Completo *</Form.Label>
                  <Form.Control
                    type="text"
                    name="nome"
                    value={formData.nome}
                    onChange={handleInputChange}
                    placeholder="Nome do pagador"
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>E-mail</Form.Label>
                  <Form.Control
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="email@exemplo.com"
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Telefone *</Form.Label>
                  <Form.Control
                    as={IMaskInput}
                    mask="(00) 00000-0000"
                    value={formData.telefone}
                    onAccept={(value) => {
                      handleInputChange({ target: { name: 'telefone', value } });
                    }}
                    placeholder="(11) 99999-9999"
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Endereço *</Form.Label>
                  <Form.Control
                    type="text"
                    name="endereco"
                    value={formData.endereco}
                    onChange={handleInputChange}
                    placeholder="Rua, número, complemento"
                    required
                  />
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Bairro *</Form.Label>
                  <Form.Control
                    type="text"
                    name="bairro"
                    value={formData.bairro}
                    onChange={handleInputChange}
                    placeholder="Bairro"
                    required
                  />
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>CEP *</Form.Label>
                  <Form.Control
                    as={IMaskInput}
                    mask="00000-000"
                    value={formData.cep}
                    onAccept={(value) => {
                      handleInputChange({ target: { name: 'cep', value } });
                    }}
                    onBlur={handleCEPBlur}
                    placeholder="00000-000"
                    required
                  />
                  <Form.Text className="text-muted">
                    O endereço será preenchido automaticamente
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={8}>
                <Form.Group className="mb-3">
                  <Form.Label>Cidade *</Form.Label>
                  <Form.Control
                    type="text"
                    name="cidade"
                    value={formData.cidade}
                    onChange={handleInputChange}
                    placeholder="Cidade"
                    required
                  />
                </Form.Group>
              </Col>

              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>UF *</Form.Label>
                  <Form.Select
                    name="uf"
                    value={formData.uf}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="">Selecione...</option>
                    <option value="AC">AC</option>
                    <option value="AL">AL</option>
                    <option value="AP">AP</option>
                    <option value="AM">AM</option>
                    <option value="BA">BA</option>
                    <option value="CE">CE</option>
                    <option value="DF">DF</option>
                    <option value="ES">ES</option>
                    <option value="GO">GO</option>
                    <option value="MA">MA</option>
                    <option value="MT">MT</option>
                    <option value="MS">MS</option>
                    <option value="MG">MG</option>
                    <option value="PA">PA</option>
                    <option value="PB">PB</option>
                    <option value="PR">PR</option>
                    <option value="PE">PE</option>
                    <option value="PI">PI</option>
                    <option value="RJ">RJ</option>
                    <option value="RN">RN</option>
                    <option value="RS">RS</option>
                    <option value="RO">RO</option>
                    <option value="RR">RR</option>
                    <option value="SC">SC</option>
                    <option value="SP">SP</option>
                    <option value="SE">SE</option>
                    <option value="TO">TO</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <hr className="my-4" />

            <h5 className="mb-3 text-primary">Juros e Multa</h5>
            <Row>
              <Col md={6}>
                <Alert variant="info">
                  <strong>Juros:</strong> 1% ao mês sobre o valor original
                </Alert>
              </Col>
              <Col md={6}>
                <Alert variant="info">
                  <strong>Multa:</strong> 2% a partir de 1 dia após o vencimento
                </Alert>
              </Col>
            </Row>

            <div className="mt-4 d-flex justify-content-end">
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
                    Criando Boleto...
                  </>
                ) : (
                  <>
                    <i className="fas fa-plus-circle me-2"></i>
                    Criar Boleto
                  </>
                )}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      {boletoCreated && dadosBoletoExibicao && (
        <Card className="mt-4 border-success">
          <Card.Body className="bg-light">
            <h4 className="text-success mb-4">
              ✅ Boleto {dadosBoletoExibicao.numero} criado com sucesso!
            </h4>

            <Row>
              <Col md={boletoCreated.qrCode && boletoCreated.qrCode.emv ? 8 : 12}>
                <div className="mb-3">
                  <div className="mb-2"><strong>Número:</strong> {dadosBoletoExibicao.numero}</div>
                  <div className="mb-2"><strong>Valor:</strong> R$ {dadosBoletoExibicao.valor.replace('.', ',')}</div>
                  <div className="mb-2"><strong>Vencimento:</strong> {dadosBoletoExibicao.vencimento}</div>
                  <div className="mb-2"><strong>Pagador:</strong> {dadosBoletoExibicao.pagador}</div>
                </div>

                {boletoCreated.linhaDigitavel && (
                  <Form.Group className="mb-3">
                    <Form.Label><strong>Linha Digitável:</strong></Form.Label>
                    <Form.Control
                      type="text"
                      value={boletoCreated.linhaDigitavel}
                      readOnly
                      onClick={(e) => e.target.select()}
                      className="font-monospace"
                    />
                    <Form.Text className="text-muted">Clique para copiar</Form.Text>
                  </Form.Group>
                )}

                {boletoCreated.qrCode && boletoCreated.qrCode.emv && (
                  <Form.Group className="mb-3">
                    <Form.Label><strong>PIX Copia e Cola:</strong></Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={boletoCreated.qrCode.emv}
                      readOnly
                      onClick={(e) => e.target.select()}
                      className="font-monospace"
                    />
                    <Form.Text className="text-muted">Clique para copiar o código PIX</Form.Text>
                  </Form.Group>
                )}
              </Col>

              {boletoCreated.qrCode && boletoCreated.qrCode.emv && (
                <Col md={4} className="text-center">
                  <h6>QR Code PIX</h6>
                  <QRCodePIX
                    codigoPix={boletoCreated.qrCode.emv}
                    numeroTitulo={dadosBoletoExibicao.numero}
                  />
                  <small className="text-muted d-block mt-2">Escaneie para pagar via PIX</small>
                </Col>
              )}
            </Row>

            <div className="mt-3">
              <Button variant="success" className="me-2">
                📥 Download PDF
              </Button>
              <Button variant="info">
                🔍 Ver Detalhes
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}

export default CriarBoleto;
