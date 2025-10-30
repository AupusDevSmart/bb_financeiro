import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001',
  timeout: 30000,
});

// Configuracao do Banco do Brasil (Atualizado 28/10/2025)
export const CONFIG = {
  clientId: 'eyJpZCI6ImMzIiwiY29kaWdvUHVibGljYWRvciI6MCwiY29kaWdvU29mdHdhcmUiOjEyMTQ4NSwic2VxdWVuY2lhbEluc3RhbGFjYW8iOjF9',
  clientSecret: 'eyJpZCI6IjFiNTMxZjktMjZmYi00ZThjLThkZDItN2E1NDU1ODU5ODUzNmNjNjNlNCIsImNvZGlnb1B1YmxpY2Fkb3IiOjAsImNvZGlnb1NvZnR3YXJlIjoxMjE0ODUsInNlcXVlbmNpYWxJbnN0YWxhY2FvIjoxLCJzZXF1ZW5jaWFsQ3JlZGVuY2lhbCI6NCwiYW1iaWVudGUiOiJwcm9kdWNhbyIsImlhdCI6MTc2MTY4NDExNzI3N30',
  developerKey: '549827f7531a4cdd880437df70bf3d86',
  numeroConvenio: '3648981',
  agencia: '4148',
  conta: '25651',
  numeroVariacaoCarteira: '19',
};

// Armazenar token em memoria
let tokenCache = null;
let tokenExpiry = null;

// Funcao para remover acentos
export const removerAcentos = (texto) => {
  if (!texto) return texto;
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

// Obter token OAuth
export const obterToken = async () => {
  try {
    // Verificar se ja temos um token valido em cache
    if (tokenCache && tokenExpiry && Date.now() < tokenExpiry) {
      console.log('[INFO] Usando token em cache');
      return tokenCache;
    }

    console.log('[INFO] Obtendo novo token OAuth...');
    const auth = btoa(`${CONFIG.clientId}:${CONFIG.clientSecret}`);

    const response = await api.post('/proxy-oauth/oauth/token',
      'grant_type=client_credentials&scope=cobrancas.boletos-info cobrancas.boletos-requisicao',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`
        }
      }
    );

    // Armazenar token em cache (expira em 50 minutos - token valido por 1h)
    tokenCache = response.data.access_token;
    tokenExpiry = Date.now() + (50 * 60 * 1000);

    console.log('[OK] Token OAuth obtido com sucesso');
    return tokenCache;
  } catch (error) {
    console.error('[ERRO] Erro ao obter token:', error);
    throw error;
  }
};

// Interceptor para adicionar token e X-Application-Key em todas as requisicoes
api.interceptors.request.use(async (config) => {
  // Nao adicionar token para requisicoes OAuth
  if (config.url.includes('/proxy-oauth/')) {
    return config;
  }

  // Obter token e adicionar nos headers
  try {
    const token = await obterToken();
    config.headers.Authorization = `Bearer ${token}`;
    config.headers['X-Application-Key'] = CONFIG.developerKey;
  } catch (error) {
    console.error('Erro ao adicionar token na requisicao:', error);
  }

  return config;
});

// Criar boleto
export const criarBoleto = async (dados) => {
  try {
    const response = await api.post('/proxy-api/cobrancas/v2/boletos', dados);
    return response.data;
  } catch (error) {
    console.error('❌ Erro ao criar boleto:', error);
    if (error.response?.data) {
      console.error('📋 Detalhes do erro da API BB:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

// Listar boletos
export const listarBoletos = async (filtros = {}) => {
  try {
    const params = {
      indicadorSituacao: filtros.situacao || 'A',
      agenciaBeneficiario: parseInt(CONFIG.agencia),
      contaBeneficiario: parseInt(CONFIG.conta),
      numeroConvenio: CONFIG.numeroConvenio,
      ...filtros
    };

    let todosBoletos = [];
    let indice = 0;
    let temMais = true;

    // Buscar todas as páginas de boletos
    while (temMais) {
      const paramsComIndice = { ...params, indice };
      const response = await api.get('/proxy-api/cobrancas/v2/boletos', { params: paramsComIndice });

      if (response.data && response.data.boletos && response.data.boletos.length > 0) {
        todosBoletos = [...todosBoletos, ...response.data.boletos];

        // Verificar se há mais páginas
        if (response.data.proximoIndice && response.data.proximoIndice > indice) {
          indice = response.data.proximoIndice;
          console.log(`   📄 Página carregada. Buscando próxima página (índice ${indice})...`);
        } else {
          temMais = false;
        }
      } else {
        temMais = false;
      }
    }

    return {
      boletos: todosBoletos,
      total: todosBoletos.length
    };
  } catch (error) {
    console.error('Erro ao listar boletos:', error);
    throw error;
  }
};

// Consultar boleto individual
export const consultarBoleto = async (numeroBoletoBBOuSequencial) => {
  try {
    let numero20Digitos;

    // Se ja vier com 20 digitos (numeroBoletoBB completo), usar direto
    if (numeroBoletoBBOuSequencial.length === 20) {
      numero20Digitos = numeroBoletoBBOuSequencial;
    } else {
      // Senao, gerar a partir do sequencial
      const convenioStr = CONFIG.numeroConvenio.toString().padStart(7, '0');
      const sequencialStr = numeroBoletoBBOuSequencial.toString().padStart(10, '0');
      numero20Digitos = `000${convenioStr}${sequencialStr}`;
    }

    const response = await api.get(
      `/proxy-api/cobrancas/v2/boletos/${numero20Digitos}`,
      {
        params: {
          numeroConvenio: CONFIG.numeroConvenio
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Erro ao consultar boleto:', error);
    throw error;
  }
};

// Consultar QR Code PIX do boleto
export const consultarPixBoleto = async (numeroBoletoBBOuSequencial) => {
  try {
    let numero20Digitos;

    // Se ja vier com 20 digitos (numeroBoletoBB completo), usar direto
    if (numeroBoletoBBOuSequencial.length === 20) {
      numero20Digitos = numeroBoletoBBOuSequencial;
    } else {
      // Senao, gerar a partir do sequencial
      const convenioStr = CONFIG.numeroConvenio.toString().padStart(7, '0');
      const sequencialStr = numeroBoletoBBOuSequencial.toString().padStart(10, '0');
      numero20Digitos = `000${convenioStr}${sequencialStr}`;
    }

    console.log(`📱 Consultando PIX do boleto ${numero20Digitos}...`);

    const response = await api.get(
      `/proxy-api/cobrancas/v2/boletos/${numero20Digitos}/pix`,
      {
        params: {
          numeroConvenio: CONFIG.numeroConvenio
        }
      }
    );

    console.log('✅ PIX consultado com sucesso:', response.data);
    return response.data;
  } catch (error) {
    // Se o erro for 404, significa que o boleto não tem PIX gerado
    if (error.response?.status === 404) {
      console.log('ℹ️ Boleto não possui PIX gerado');
      return null;
    }
    console.error('Erro ao consultar PIX do boleto:', error);
    throw error;
  }
};

// Baixar boleto
export const baixarBoleto = async (numeroConvenio, sequencial, motivo = 'ACERTO') => {
  try {
    console.log('🔍 Consultando boleto antes de baixar...', { sequencial, numeroConvenio });

    // Primeiro consultar o boleto para obter o número correto
    const boletoEncontrado = await consultarBoleto(sequencial);
    console.log('✅ Boleto encontrado:', boletoEncontrado);

    // Extrair número de 20 dígitos do boleto
    let numero20Digitos = boletoEncontrado.numero ||
                          boletoEncontrado.numeroBoletoBB ||
                          boletoEncontrado.numeroTituloCobranca;

    // Se não encontrou, gerar manualmente
    if (!numero20Digitos || numero20Digitos.length !== 20) {
      const convenioStr = numeroConvenio.toString().padStart(7, '0');
      const sequencialStr = sequencial.toString().padStart(10, '0');
      numero20Digitos = `000${convenioStr}${sequencialStr}`;
      console.log('🔧 Número gerado manualmente:', numero20Digitos);
    }

    console.log('🔽 Baixando boleto:', {
      sequencial,
      numeroConvenio,
      numero20Digitos,
      motivo
    });

    const payload = {
      numeroConvenio: parseInt(numeroConvenio),
      tipoDescricaoMotivoMovimento: motivo
    };

    const response = await api.post(
      `/proxy-api/cobrancas/v2/boletos/${numero20Digitos}/baixar`,
      payload
    );

    console.log('✅ Boleto baixado com sucesso!', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Erro ao baixar boleto:', error.response?.data || error.message);
    throw error;
  }
};

// Gerar número de 20 dígitos
export const gerarNumero20Digitos = (sequencial) => {
  const convenioStr = CONFIG.numeroConvenio.toString().padStart(7, '0');
  const sequencialStr = sequencial.toString().padStart(10, '0');
  return `000${convenioStr}${sequencialStr}`;
};

// Extrair sequencial do boleto
// Extrai os últimos 10 dígitos do número do boleto (sequencial)
// Formato: 000 + 7 dígitos convênio + 10 dígitos sequencial = 20 dígitos
// Exemplo novo: 00036489810000000001 -> últimos 10: 0000000001 -> 1
// Exemplo antigo: 00036489813648981057 -> últimos 10: 3648981057 (zona proibida)
const extrairSequencial = (boleto) => {
  let numero20Digitos = null;

  // Tentar obter o número de 20 dígitos
  if (boleto.numeroTituloCliente && boleto.numeroTituloCliente.length === 20) {
    numero20Digitos = boleto.numeroTituloCliente;
  } else if (boleto.numeroBoletoBB && boleto.numeroBoletoBB.length === 20) {
    numero20Digitos = boleto.numeroBoletoBB;
  } else if (boleto.numero && boleto.numero.length === 20) {
    numero20Digitos = boleto.numero;
  }

  if (!numero20Digitos) {
    return 'N/A';
  }

  // Formato correto: 000 + CCCCCCC (7 dígitos convênio) + SSSSSSSSSS (10 dígitos sequencial)
  // Exemplos:
  // 00036489810000000001 -> convênio: 3648981, sequencial: 0000000001 -> 1
  // 00036489810000000004 -> convênio: 3648981, sequencial: 0000000004 -> 4

  // Extrair os 10 últimos dígitos (sequencial)
  const sequencialStr = numero20Digitos.slice(-10);
  const sequencial = sequencialStr.replace(/^0+/, '') || '1';

  return sequencial;
};

// Formatar data DD.MM.YYYY
export const formatarDataAPI = (data) => {
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  return `${dia}.${mes}.${ano}`;
};

// Obter próximo sequencial automaticamente
export const obterProximoSequencial = async () => {
  try {
    console.log('🔍 Buscando maior sequencial de TODOS os boletos ativos...');

    // Definir faixas válidas de sequenciais
    // FAIXA 1: 0000000001 até 3648980999 (antes da zona proibida)
    // ZONA PROIBIDA: 3648981000 até 3648981999 (IGNORAR)
    // FAIXA 2: 4000000001 em diante (após zona proibida)

    const FAIXA1_MIN = 1;                // 0000000001
    const FAIXA1_MAX = 3648980999;       // 3648980999 (antes de 3648981xxx)
    const ZONA_PROIBIDA_MIN = 3648981000; // Início da zona proibida
    const ZONA_PROIBIDA_MAX = 3648981999; // Fim da zona proibida
    const FAIXA2_MIN = 4000000001;       // Início da segunda faixa
    const LIMITE_SEQUENCIAL_MAXIMO = 9999999999; // 10 dígitos máximo

    let maiorSequencialFaixa1 = 0;
    let maiorSequencialFaixa2 = 0;

    // Buscar boletos dos últimos 60 dias (mais eficiente e pega os recentes)
    const dataFim = new Date();
    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - 60); // 60 dias atrás

    const filtrosAtivos = {
      indicadorSituacao: 'A',
      dataInicioRegistro: formatarDataAPI(dataInicio),
      dataFimRegistro: formatarDataAPI(dataFim)
    };

    console.log('📋 Buscando boletos ativos dos últimos 60 dias...');
    console.log(`   Período: ${filtrosAtivos.dataInicioRegistro} até ${filtrosAtivos.dataFimRegistro}`);

    // VERIFICAÇÃO DIRETA: Tentar buscar boletos 1-10 individualmente
    console.log('\n🔍 Verificação direta: consultando boletos sequenciais 1-10...');
    for (let seq = 1; seq <= 10; seq++) {
      try {
        const boleto = await consultarBoleto(seq);
        if (boleto) {
          console.log(`   ✅ Boleto ${seq} EXISTE:`, {
            numeroBoletoBB: boleto.numeroBoletoBB,
            numeroTituloCliente: boleto.numeroTituloCliente,
            numeroTituloBeneficiario: boleto.numeroTituloBeneficiario
          });

          // Adicionar ao cálculo do maior sequencial
          if (seq > maiorSequencialFaixa1) {
            maiorSequencialFaixa1 = seq;
          }
        }
      } catch (error) {
        // Boleto não existe ou erro - isso é esperado
        if (seq <= 5) {
          console.log(`   ❌ Boleto ${seq} não encontrado`);
        }
      }
    }
    console.log('\n📋 Agora buscando lista completa de boletos...');

    const resultado = await listarBoletos(filtrosAtivos);

    console.log(`   📊 Total de boletos encontrados na lista: ${resultado.total || 0}`);

    if (resultado && resultado.boletos && resultado.boletos.length > 0) {
      resultado.boletos.forEach((boleto, index) => {
        const sequencialStr = extrairSequencial(boleto);
        const sequencial = parseInt(sequencialStr);

        if (index < 10) { // Log dos primeiros 10 para debug
          console.log(`   Boleto ${index + 1}:`, {
            numeroBoletoBB: boleto.numeroBoletoBB,
            numeroTituloCliente: boleto.numeroTituloCliente,
            numeroTituloBeneficiario: boleto.numeroTituloBeneficiario,
            numeroTituloCedenteCobranca: boleto.numeroTituloCedenteCobranca,
            sequencialExtraido: sequencialStr,
            sequencialInt: sequencial,
            faixa: sequencial >= ZONA_PROIBIDA_MIN && sequencial <= ZONA_PROIBIDA_MAX
              ? '🚫 ZONA PROIBIDA (ignorado)'
              : sequencial >= FAIXA1_MIN && sequencial <= FAIXA1_MAX
                ? '✅ FAIXA 1'
                : sequencial >= FAIXA2_MIN
                  ? '✅ FAIXA 2'
                  : '❓ Fora das faixas'
          });
        }

        // Ignorar se estiver na zona proibida
        if (sequencial >= ZONA_PROIBIDA_MIN && sequencial <= ZONA_PROIBIDA_MAX) {
          if (index < 5) {
            console.log(`      ⚠️ Ignorando boleto na zona proibida: ${sequencial}`);
          }
          return; // Pular este boleto
        }

        // Verificar se está na FAIXA 1
        if (sequencial >= FAIXA1_MIN && sequencial <= FAIXA1_MAX) {
          if (sequencial > maiorSequencialFaixa1) {
            maiorSequencialFaixa1 = sequencial;
          }
        }

        // Verificar se está na FAIXA 2
        if (sequencial >= FAIXA2_MIN && sequencial <= LIMITE_SEQUENCIAL_MAXIMO) {
          if (sequencial > maiorSequencialFaixa2) {
            maiorSequencialFaixa2 = sequencial;
          }
        }
      });

      console.log(`\n📊 Análise dos sequenciais:`);
      console.log(`   FAIXA 1 (1 até ${FAIXA1_MAX}): Maior encontrado = ${maiorSequencialFaixa1}`);
      console.log(`   FAIXA 2 (${FAIXA2_MIN} em diante): Maior encontrado = ${maiorSequencialFaixa2}`);

      let proximoSequencial;

      // Se já está usando FAIXA 2, continuar na FAIXA 2
      if (maiorSequencialFaixa2 > 0) {
        proximoSequencial = maiorSequencialFaixa2 + 1;
        console.log(`✅ Usando FAIXA 2: próximo sequencial = ${proximoSequencial}`);
      }
      // Se FAIXA 1 ainda tem espaço (não atingiu o limite)
      else if (maiorSequencialFaixa1 > 0 && maiorSequencialFaixa1 < FAIXA1_MAX) {
        proximoSequencial = maiorSequencialFaixa1 + 1;
        console.log(`✅ Usando FAIXA 1: próximo sequencial = ${proximoSequencial}`);
      }
      // Se FAIXA 1 atingiu o limite, pular para FAIXA 2
      else if (maiorSequencialFaixa1 >= FAIXA1_MAX) {
        proximoSequencial = FAIXA2_MIN;
        console.log(`🔄 FAIXA 1 completa! Pulando para FAIXA 2: ${proximoSequencial}`);
      }
      // Nenhum boleto válido encontrado, começar do início da FAIXA 1
      else {
        proximoSequencial = FAIXA1_MIN;
        console.log(`📋 Nenhum boleto válido encontrado. Iniciando FAIXA 1 do ${proximoSequencial}`);
      }

      console.log(`\n🎯 Próximo sequencial escolhido: ${proximoSequencial}`);
      return proximoSequencial;
    } else {
      console.log('📋 Nenhum boleto ativo encontrado. Iniciando do 1.');
      return FAIXA1_MIN;
    }
  } catch (error) {
    console.warn('⚠️ Erro ao obter próximo sequencial:', error);
    // Em caso de erro, começar do início da FAIXA 1
    console.log(`🔄 Usando sequencial inicial da FAIXA 1: 1`);
    return 1;
  }
};

// Gerar segunda via
export const gerarSegundaVia = async (sequencial) => {
  try {
    const numero20Digitos = `000${CONFIG.numeroConvenio}${sequencial}`.slice(-20);
    const response = await api.get(
      `/proxy-api/cobrancas/v2/boletos/${numero20Digitos}/gerar-pdf`,
      {
        params: {
          numeroConvenio: CONFIG.numeroConvenio
        },
        responseType: 'blob'
      }
    );
    return response.data;
  } catch (error) {
    console.error('Erro ao gerar segunda via:', error);
    throw error;
  }
};

export default api;
