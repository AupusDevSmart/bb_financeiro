/**
 * Módulo para enviar lançamentos de faturas EQTL para o Aupus Control.
 *
 * Alternativa à API de Pagamentos em Lote do BB (pagamentosLoteBB.js).
 * Controlado pela variável DESTINO_LANCAMENTO no .env.
 */

const MESES_EXTENSO = [
    '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

const MESES_ABREV = [
    '', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez'
];

/**
 * Envia um lançamento de fatura EQTL para a API externa do Aupus Control.
 *
 * @param {Object} params
 * @param {string} params.codigoBarras - Código de barras do boleto
 * @param {string} params.dataPagamento - Data de vencimento (YYYY-MM-DD)
 * @param {number} params.valor - Valor da fatura
 * @param {string} params.mesReferencia - Mês de referência (formato "MM/YYYY")
 * @param {string} params.nomeCliente - Nome do cliente (opcional)
 * @param {string} params.uc - Número da UC
 * @param {boolean} [params.isUg] - Se é usina geradora
 * @param {string} [params.status] - Status inicial: 'PENDENTE' (default), 'APROVADO' ou 'PAGO'
 * @returns {Promise<{sucesso: boolean, dados: Object|null, erro: string|null}>}
 */
async function enviarLancamentoControl({ codigoBarras, dataPagamento, valor, mesReferencia, nomeCliente, uc, isUg, status }) {
    const apiUrl = process.env.CONTROL_API_URL;
    const apiKey = process.env.CONTROL_API_KEY;

    if (!apiUrl || !apiKey) {
        return {
            sucesso: false,
            dados: null,
            erro: 'CONTROL_API_URL e CONTROL_API_KEY devem estar configurados no .env'
        };
    }

    // Extrair mês e ano do mes_referencia (formato "MM/YYYY")
    const [mesStr, anoStr] = mesReferencia.split('/');
    const competenciaMes = parseInt(mesStr, 10);
    const competenciaAno = parseInt(anoStr, 10);

    // Limpar código de barras (remover espaços)
    const codigoBarrasLimpo = codigoBarras.replace(/[\s-]/g, '');
    const numeroDocumento = codigoBarrasLimpo.substring(0, 50);

    // Montar descrição diferenciando Associado/Usineiro
    const mesAbrev = MESES_ABREV[competenciaMes] || mesStr;
    const nomeDisplay = nomeCliente || 'Cliente';
    const tipo = isUg ? 'Usineiro' : 'Associado';
    const tipoUc = isUg ? 'UG' : 'UC';
    const descricao = `Fatura EQTL - ${tipo} - ${mesAbrev}/${competenciaAno} - ${nomeDisplay} - ${tipoUc} ${uc}`;

    // Observações
    const mesExtenso = MESES_EXTENSO[competenciaMes] || mesStr;
    const observacoes = `Referente ao mês de ${mesExtenso}/${competenciaAno} - UC ${uc}`;

    const payload = {
        tipoOperacao: 'fatura_equatorial',
        valor,
        dataVencimento: dataPagamento,
        competenciaMes,
        competenciaAno,
        numeroDocumento,
        codigoBarras: codigoBarrasLimpo,
        descricao,
        observacoes,
        ...(status && { status }),
    };

    // Idempotency key para prevenir duplicatas
    const idempotencyKey = `${uc}-${mesReferencia}`;

    try {
        console.log(`   📤 [CONTROL] Enviando lançamento: UC ${uc} - R$ ${valor} - ${mesReferencia}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok && data.id) {
            console.log(`   ✅ [CONTROL] Lançamento criado - ID: ${data.id}`);
            return { sucesso: true, dados: data, erro: null };
        } else {
            const mensagemErro = Array.isArray(data.message) ? data.message.join(', ') : (data.message || JSON.stringify(data));
            console.error(`   ❌ [CONTROL] Erro: ${mensagemErro}`);
            return { sucesso: false, dados: data, erro: mensagemErro };
        }
    } catch (error) {
        console.error(`   ❌ [CONTROL] Erro de conexão: ${error.message}`);
        return { sucesso: false, dados: null, erro: `Erro de conexão: ${error.message}` };
    }
}

/**
 * Envia um lançamento de boleto de energia (ENTRADA) para o Aupus Control.
 *
 * @param {Object} params
 * @param {string} params.numeroBoleto - Número do boleto BB
 * @param {string} params.dataVencimento - Data de vencimento (DD/MM/YYYY)
 * @param {number} params.valor - Valor do boleto
 * @param {string} params.mesReferencia - Mês de referência (formato "MM/YYYY")
 * @param {string} params.nomeCliente - Nome do cliente (opcional)
 * @param {string} params.uc - Número da UC
 * @param {string} [params.status] - Status inicial: 'PENDENTE' (default) ou 'PAGO'
 * @returns {Promise<{sucesso: boolean, dados: Object|null, erro: string|null}>}
 */
async function enviarBoletoControl({ numeroBoleto, dataVencimento, valor, mesReferencia, nomeCliente, uc, status }) {
    const apiUrl = process.env.CONTROL_API_URL;
    const apiKey = process.env.CONTROL_API_KEY;

    if (!apiUrl || !apiKey) {
        return {
            sucesso: false,
            dados: null,
            erro: 'CONTROL_API_URL e CONTROL_API_KEY devem estar configurados no .env'
        };
    }

    const [mesStr, anoStr] = mesReferencia.split('/');
    const competenciaMes = parseInt(mesStr, 10);
    const competenciaAno = parseInt(anoStr, 10);

    // Descrição
    const mesAbrev = MESES_ABREV[competenciaMes] || mesStr;
    const nomeDisplay = nomeCliente || 'Cliente';
    const descricao = `Boleto AUPUS - Associado - ${mesAbrev}/${competenciaAno} - ${nomeDisplay} - UC ${uc}`;

    // Observações
    const mesExtenso = MESES_EXTENSO[competenciaMes] || mesStr;
    const observacoes = `Referente ao mês de ${mesExtenso}/${competenciaAno} - UC ${uc}`;

    // Converter data de vencimento DD/MM/YYYY para YYYY-MM-DD
    let dataVencimentoISO = dataVencimento;
    if (dataVencimento && dataVencimento.includes('/')) {
        const partes = dataVencimento.split('/');
        if (partes.length === 3) {
            let ano = partes[2];
            if (ano.length === 2) ano = '20' + ano;
            dataVencimentoISO = `${ano}-${partes[1]}-${partes[0]}`;
        }
    }

    const payload = {
        tipoOperacao: 'boleto_de_contribuicao',
        valor,
        dataVencimento: dataVencimentoISO,
        competenciaMes,
        competenciaAno,
        ...(numeroBoleto && { numeroDocumento: numeroBoleto.substring(0, 50) }),
        descricao,
        observacoes,
        ...(status && { status }),
    };

    // Idempotency key com prefixo para não conflitar com faturas
    const idempotencyKey = `boleto-${uc}-${mesReferencia}`;

    try {
        console.log(`   📤 [CONTROL-BOLETO] Enviando: UC ${uc} - R$ ${valor} - ${mesReferencia}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok && data.id) {
            console.log(`   ✅ [CONTROL-BOLETO] Lançamento criado - ID: ${data.id}`);
            return { sucesso: true, dados: data, erro: null };
        } else {
            const mensagemErro = Array.isArray(data.message) ? data.message.join(', ') : (data.message || JSON.stringify(data));
            console.error(`   ❌ [CONTROL-BOLETO] Erro: ${mensagemErro}`);
            return { sucesso: false, dados: data, erro: mensagemErro };
        }
    } catch (error) {
        console.error(`   ❌ [CONTROL-BOLETO] Erro de conexão: ${error.message}`);
        return { sucesso: false, dados: null, erro: `Erro de conexão: ${error.message}` };
    }
}

/**
 * Cancela um lançamento no Aupus Control via API externa.
 *
 * @param {string} controlId - ID do lançamento no Control (ULID)
 * @param {string} [motivo] - Motivo do cancelamento (opcional)
 * @returns {Promise<{sucesso: boolean, dados: Object|null, erro: string|null}>}
 */
async function cancelarLancamentoControl(controlId, motivo) {
    const apiUrl = process.env.CONTROL_API_URL;
    const apiKey = process.env.CONTROL_API_KEY;

    if (!apiUrl || !apiKey) {
        return {
            sucesso: false,
            dados: null,
            erro: 'CONTROL_API_URL e CONTROL_API_KEY devem estar configurados no .env'
        };
    }

    const cancelUrl = `${apiUrl}/${controlId}/cancelar`;

    try {
        console.log(`   🗑️ [CONTROL] Cancelando lançamento: ${controlId}`);

        const response = await fetch(cancelUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
            body: JSON.stringify({ motivo: motivo || 'Cancelado via api-bb' }),
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`   ✅ [CONTROL] Lançamento ${controlId} cancelado`);
            return { sucesso: true, dados: data, erro: null };
        } else {
            const mensagemErro = Array.isArray(data.message) ? data.message.join(', ') : (data.message || JSON.stringify(data));
            console.error(`   ❌ [CONTROL] Erro ao cancelar: ${mensagemErro}`);
            return { sucesso: false, dados: data, erro: mensagemErro };
        }
    } catch (error) {
        console.error(`   ❌ [CONTROL] Erro de conexão ao cancelar: ${error.message}`);
        return { sucesso: false, dados: null, erro: `Erro de conexão: ${error.message}` };
    }
}

/**
 * Registra pagamento de um lançamento no Aupus Control (APROVADO → PAGO).
 *
 * @param {string} controlId - ID do lançamento no Control (ULID)
 * @param {Object} params
 * @param {string} params.dataPagamento - Data do pagamento (YYYY-MM-DD)
 * @param {number} params.valorPago - Valor pago
 * @param {string} [params.contaBancariaNome] - Nome da conta bancária (opcional)
 * @param {string} [params.formaPagamento] - Forma de pagamento (opcional)
 * @returns {Promise<{sucesso: boolean, dados: Object|null, erro: string|null}>}
 */
async function pagarLancamentoControl(controlId, { dataPagamento, valorPago, contaBancariaNome, formaPagamento } = {}) {
    const apiUrl = process.env.CONTROL_API_URL;
    const apiKey = process.env.CONTROL_API_KEY;

    if (!apiUrl || !apiKey) {
        return { sucesso: false, dados: null, erro: 'CONTROL_API_URL e CONTROL_API_KEY devem estar configurados no .env' };
    }

    const pagarUrl = `${apiUrl}/${controlId}/pagar`;

    try {
        console.log(`   💰 [CONTROL] Registrando pagamento: ${controlId}`);

        const body = { dataPagamento, valorPago };
        if (contaBancariaNome) body.contaBancariaNome = contaBancariaNome;
        if (formaPagamento) body.formaPagamento = formaPagamento;

        const response = await fetch(pagarUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`   ✅ [CONTROL] Pagamento registrado: ${controlId}`);
            return { sucesso: true, dados: data, erro: null };
        } else {
            const mensagemErro = Array.isArray(data.message) ? data.message.join(', ') : (data.message || JSON.stringify(data));
            console.error(`   ❌ [CONTROL] Erro ao pagar: ${mensagemErro}`);
            return { sucesso: false, dados: data, erro: mensagemErro };
        }
    } catch (error) {
        console.error(`   ❌ [CONTROL] Erro de conexão ao pagar: ${error.message}`);
        return { sucesso: false, dados: null, erro: `Erro de conexão: ${error.message}` };
    }
}

/**
 * Estorna o pagamento de um lançamento no Aupus Control (PAGO → APROVADO).
 *
 * @param {string} controlId - ID do lançamento no Control (ULID)
 * @param {string} [motivo] - Motivo do estorno (opcional)
 * @returns {Promise<{sucesso: boolean, dados: Object|null, erro: string|null}>}
 */
async function estornarPagamentoControl(controlId, motivo) {
    const apiUrl = process.env.CONTROL_API_URL;
    const apiKey = process.env.CONTROL_API_KEY;

    if (!apiUrl || !apiKey) {
        return { sucesso: false, dados: null, erro: 'CONTROL_API_URL e CONTROL_API_KEY devem estar configurados no .env' };
    }

    const estornarUrl = `${apiUrl}/${controlId}/estornar-pagamento`;

    try {
        console.log(`   ↩️ [CONTROL] Estornando pagamento: ${controlId}`);

        const response = await fetch(estornarUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
            body: JSON.stringify({ motivo: motivo || 'Estornado via api-bb' }),
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`   ✅ [CONTROL] Pagamento estornado: ${controlId}`);
            return { sucesso: true, dados: data, erro: null };
        } else {
            const mensagemErro = Array.isArray(data.message) ? data.message.join(', ') : (data.message || JSON.stringify(data));
            console.error(`   ❌ [CONTROL] Erro ao estornar: ${mensagemErro}`);
            return { sucesso: false, dados: data, erro: mensagemErro };
        }
    } catch (error) {
        console.error(`   ❌ [CONTROL] Erro de conexão ao estornar: ${error.message}`);
        return { sucesso: false, dados: null, erro: `Erro de conexão: ${error.message}` };
    }
}

module.exports = { enviarLancamentoControl, enviarBoletoControl, cancelarLancamentoControl, pagarLancamentoControl, estornarPagamentoControl };
