#!/usr/bin/env node
/**
 * Script para reenviar lançamentos ao Aupus Control.
 *
 * Uso: node reenviar-lancamentos.js
 *
 * Reenvia:
 * - Boletos de energia (ENTRADA) 12/2025 e 01/2026 como APROVADO (ou PAGO se já pago)
 * - Pagamentos EQTL (SAIDA) 01/2026 e 02/2026 com status adequado
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');
const { enviarLancamentoControl, enviarBoletoControl } = require('./lancamentoControl');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: 'aupus_faturas',
    user: process.env.DB_USERNAME || 'aupus',
    password: process.env.DB_PASSWORD || 'SuaSenhaAqui123!',
});

const poolCRM = new Pool({
    host: '92.113.38.164',
    port: 5432,
    database: 'aupus_prod',
    user: 'aupus_prod',
    password: 'AupusProd2024Hashtag',
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function reenviarBoletos() {
    console.log('\n========================================');
    console.log('📤 REENVIANDO BOLETOS DE ENERGIA (ENTRADA)');
    console.log('========================================\n');

    // 1. Reset status_control for all boletos 12/2025 and 01/2026
    const resetResult = await pool.query(`
        UPDATE boletos_energia
        SET status_control = NULL, control_lancamento_id = NULL,
            erro_control = NULL, resposta_control = NULL
        WHERE mes_referencia IN ('12/2025', '01/2026')
        RETURNING id
    `);
    console.log(`🔄 Reset ${resetResult.rowCount} boletos\n`);

    // 2. Get all boletos to send
    const boletos = await pool.query(`
        SELECT id, uc, mes_referencia, valor_boleto, data_vencimento,
               numero_boleto, status, nome_completo
        FROM boletos_energia
        WHERE mes_referencia IN ('12/2025', '01/2026')
        ORDER BY mes_referencia, uc
    `);

    console.log(`📋 Total: ${boletos.rows.length} boletos para enviar\n`);

    let sucesso = 0, erro = 0;

    for (const boleto of boletos.rows) {
        // Get client name from CRM
        let nomeCliente = boleto.nome_completo || null;
        try {
            const crmResult = await poolCRM.query(`
                SELECT cc.nome_cliente
                FROM unidades_consumidoras uc
                LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                WHERE uc.numero_unidade::text = $1
            `, [boleto.uc]);
            if (crmResult.rows.length > 0 && crmResult.rows[0].nome_cliente) {
                nomeCliente = crmResult.rows[0].nome_cliente;
            }
        } catch (e) { /* ignore */ }

        // ENTRADA vai como PENDENTE (aprovação é feita no Control), ou PAGO se já pago
        const statusControl = boleto.status === 'Pago' ? 'PAGO' : 'PENDENTE';

        const resultado = await enviarBoletoControl({
            numeroBoleto: boleto.numero_boleto,
            dataVencimento: boleto.data_vencimento,
            valor: parseFloat(boleto.valor_boleto),
            mesReferencia: boleto.mes_referencia,
            nomeCliente,
            uc: boleto.uc,
            status: statusControl,
        });

        if (resultado.sucesso) {
            await pool.query(`
                UPDATE boletos_energia
                SET status_control = 'lancado', control_lancamento_id = $1,
                    data_lancamento_control = CURRENT_TIMESTAMP,
                    resposta_control = $2, erro_control = NULL
                WHERE id = $3
            `, [resultado.dados.id, JSON.stringify(resultado.dados), boleto.id]);
            sucesso++;
        } else {
            await pool.query(`
                UPDATE boletos_energia
                SET status_control = 'erro', erro_control = $1,
                    resposta_control = $2, data_lancamento_control = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [resultado.erro, JSON.stringify(resultado.dados), boleto.id]);
            erro++;
            console.error(`   ❌ ${boleto.uc} ${boleto.mes_referencia}: ${resultado.erro}`);
        }

        // Small delay to avoid overwhelming the API
        if ((sucesso + erro) % 50 === 0) {
            console.log(`   ... ${sucesso + erro}/${boletos.rows.length} processados (${sucesso} ok, ${erro} erros)`);
            await sleep(500);
        }
    }

    console.log(`\n✅ Boletos: ${sucesso} enviados, ${erro} erros (total: ${boletos.rows.length})`);
    return { sucesso, erro, total: boletos.rows.length };
}

async function reenviarEqtl() {
    console.log('\n========================================');
    console.log('📤 REENVIANDO PAGAMENTOS EQTL (SAIDA)');
    console.log('========================================\n');

    // 1. Reset status_control for EQTL batch payments (pagamentos em lote) 01/2026 and 02/2026
    // Only include records with codigo_barras (pagamentos em lote via API BB)
    const resetResult = await pool.query(`
        UPDATE pagamentos_concessionaria
        SET status_control = NULL, control_lancamento_id = NULL
        WHERE mes_referencia IN ('01/2026', '02/2026')
          AND codigo_barras IS NOT NULL AND codigo_barras != ''
        RETURNING id
    `);
    console.log(`🔄 Reset ${resetResult.rowCount} pagamentos EQTL\n`);

    // 2. Get batch payments to send (only those with codigo_barras = pagamentos em lote)
    const pagamentos = await pool.query(`
        SELECT pc.id, pc.uc, pc.mes_referencia, pc.valor_fatura, pc.status,
               pc.codigo_barras, pc.data_vencimento_fatura,
               fb.dados_leitura
        FROM pagamentos_concessionaria pc
        LEFT JOIN faturas_baixadas fb ON fb.uc = pc.uc AND fb.mes_referencia = pc.mes_referencia
        WHERE pc.mes_referencia IN ('01/2026', '02/2026')
          AND pc.codigo_barras IS NOT NULL AND pc.codigo_barras != ''
        ORDER BY pc.mes_referencia, pc.uc
    `);

    console.log(`📋 Total: ${pagamentos.rows.length} pagamentos para enviar\n`);

    let sucesso = 0, erro = 0;

    for (const pag of pagamentos.rows) {
        // Get client name and UG status from CRM
        let nomeCliente = null;
        let isUg = false;
        try {
            const crmResult = await poolCRM.query(`
                SELECT uc.numero_unidade, uc.gerador, uc.nome_usina,
                       cc.nome_cliente
                FROM unidades_consumidoras uc
                LEFT JOIN controle_clube cc ON cc.uc_id = uc.id AND cc.deleted_at IS NULL
                WHERE uc.numero_unidade::text = $1
            `, [pag.uc]);
            if (crmResult.rows.length > 0) {
                nomeCliente = crmResult.rows[0].nome_cliente || crmResult.rows[0].nome_usina;
                isUg = crmResult.rows[0].gerador === true;
            }
        } catch (e) { /* ignore */ }

        // Status: PAGO se já pago no BB, APROVADO se status intermediário confirmado, PENDENTE caso contrário
        let statusControl = 'PENDENTE';
        if (pag.status === 'pago') {
            statusControl = 'PAGO';
        } else if (['aguardando_aprovacao', 'liberado', 'processando_pagamento', 'agendado'].includes(pag.status)) {
            statusControl = 'APROVADO';
        }

        // Data de vencimento
        let dataVencimento = pag.data_vencimento_fatura;
        if (!dataVencimento && pag.dados_leitura) {
            try {
                const dl = typeof pag.dados_leitura === 'string' ? JSON.parse(pag.dados_leitura) : pag.dados_leitura;
                dataVencimento = dl.data_vencimento || dl.vencimento;
            } catch (e) { /* ignore */ }
        }
        if (!dataVencimento) {
            // Fallback: use last day of the reference month
            const [m, y] = pag.mes_referencia.split('/');
            const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
            dataVencimento = `${y}-${m.padStart(2, '0')}-${lastDay}`;
        }

        const resultado = await enviarLancamentoControl({
            codigoBarras: pag.codigo_barras || '0',
            dataPagamento: dataVencimento,
            valor: parseFloat(pag.valor_fatura),
            mesReferencia: pag.mes_referencia,
            nomeCliente,
            uc: pag.uc,
            isUg,
            status: statusControl,
        });

        if (resultado.sucesso) {
            await pool.query(`
                UPDATE pagamentos_concessionaria
                SET status_control = 'lancado', control_lancamento_id = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [resultado.dados.id, pag.id]);
            sucesso++;
        } else {
            await pool.query(`
                UPDATE pagamentos_concessionaria
                SET status_control = 'erro', updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [pag.id]);
            erro++;
            console.error(`   ❌ ${pag.uc} ${pag.mes_referencia}: ${resultado.erro}`);
        }

        if ((sucesso + erro) % 50 === 0) {
            console.log(`   ... ${sucesso + erro}/${pagamentos.rows.length} processados (${sucesso} ok, ${erro} erros)`);
            await sleep(500);
        }
    }

    console.log(`\n✅ EQTL: ${sucesso} enviados, ${erro} erros (total: ${pagamentos.rows.length})`);
    return { sucesso, erro, total: pagamentos.rows.length };
}

async function main() {
    console.log('🚀 Iniciando reenvio de lançamentos para Aupus Control (staging)');
    console.log(`   API URL: ${process.env.CONTROL_API_URL}`);
    console.log(`   Conta bancária: ${process.env.CONTROL_CONTA_BANCARIA}\n`);

    try {
        const resultBoletos = await reenviarBoletos();
        const resultEqtl = await reenviarEqtl();

        console.log('\n========================================');
        console.log('📊 RESUMO FINAL');
        console.log('========================================');
        console.log(`Boletos ENTRADA: ${resultBoletos.sucesso}/${resultBoletos.total} (${resultBoletos.erro} erros)`);
        console.log(`EQTL SAIDA:      ${resultEqtl.sucesso}/${resultEqtl.total} (${resultEqtl.erro} erros)`);
        console.log('========================================\n');
    } catch (error) {
        console.error('❌ Erro fatal:', error);
    } finally {
        await pool.end();
        await poolCRM.end();
        process.exit(0);
    }
}

main();
