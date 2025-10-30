const { Pool } = require('pg');

const pool = new Pool({
    host: '92.113.38.164',
    port: 5432,
    database: 'aupus_staging',
    user: 'aupus_staging',
    password: 'AupusStaging2024',
    client_encoding: 'UTF8'
});

async function fixEncoding() {
    const client = await pool.connect();

    try {
        console.log('🔧 Corrigindo encoding UTF-8...\n');

        // Configurar encoding da sessão
        await client.query("SET CLIENT_ENCODING TO 'UTF8'");
        console.log('✅ Client encoding definido para UTF8\n');

        // Atualizar registro de teste com encoding correto
        const result = await client.query(`
            UPDATE boletos_energia
            SET
                cidade = 'Goiânia',
                dados_completos = jsonb_set(
                    dados_completos,
                    '{cidade}',
                    '"Goiânia"'
                )
            WHERE uc = '13095584' AND mes_referencia = '10/2025'
            RETURNING id, uc, mes_referencia, cidade;
        `);

        if (result.rows.length > 0) {
            console.log('✅ Registro atualizado com sucesso:');
            console.log(result.rows[0]);
        } else {
            console.log('⚠️ Nenhum registro encontrado para atualizar');
        }

        // Verificar
        const verify = await client.query(`
            SELECT id, uc, mes_referencia, cidade, nome_completo
            FROM boletos_energia
            WHERE uc = '13095584'
        `);

        console.log('\n📋 Dados verificados:');
        console.log(verify.rows[0]);

    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

fixEncoding();
