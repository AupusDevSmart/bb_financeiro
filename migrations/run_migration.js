// =====================================================
// SCRIPT PARA EXECUTAR MIGRATION
// =====================================================

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuração do banco
const pool = new Pool({
    host: '92.113.38.164',
    port: 5432,
    database: 'aupus_staging',
    user: 'aupus_staging',
    password: 'AupusStaging2024',
});

async function executarMigration() {
    console.log('\n' + '='.repeat(60));
    console.log('EXECUTANDO MIGRATION: CREATE TABLE boletos_energia');
    console.log('='.repeat(60) + '\n');

    try {
        // Conectar ao banco
        console.log('📡 Conectando ao banco de dados...');
        console.log(`   Host: 92.113.38.164`);
        console.log(`   Database: aupus_staging`);
        console.log(`   User: aupus_staging\n`);

        const client = await pool.connect();
        console.log('✅ Conectado com sucesso!\n');

        // Ler arquivo SQL
        const sqlPath = path.join(__dirname, '001_create_boletos_energia.sql');
        console.log('📄 Lendo arquivo SQL...');
        console.log(`   Arquivo: ${sqlPath}\n`);

        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Executar migration
        console.log('⚙️  Executando migration...\n');
        await client.query(sql);

        console.log('✅ Migration executada com sucesso!\n');

        // Verificar se a tabela foi criada
        console.log('🔍 Verificando tabela criada...\n');
        const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'boletos_energia'
            ORDER BY ordinal_position;
        `);

        console.log('📋 Estrutura da tabela boletos_energia:');
        console.log('─'.repeat(60));
        console.log('COLUNA                          | TIPO           | NULL?');
        console.log('─'.repeat(60));
        result.rows.forEach(row => {
            const coluna = row.column_name.padEnd(30);
            const tipo = row.data_type.padEnd(14);
            const nullable = row.is_nullable === 'YES' ? 'SIM' : 'NÃO';
            console.log(`${coluna} | ${tipo} | ${nullable}`);
        });
        console.log('─'.repeat(60));
        console.log(`Total de colunas: ${result.rows.length}\n`);

        // Verificar índices
        const indices = await client.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'boletos_energia';
        `);

        console.log('📑 Índices criados:');
        console.log('─'.repeat(60));
        indices.rows.forEach(idx => {
            console.log(`  • ${idx.indexname}`);
        });
        console.log('─'.repeat(60));
        console.log(`Total de índices: ${indices.rows.length}\n`);

        client.release();

        console.log('='.repeat(60));
        console.log('✅ MIGRATION CONCLUÍDA COM SUCESSO!');
        console.log('='.repeat(60) + '\n');

        process.exit(0);

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ ERRO AO EXECUTAR MIGRATION');
        console.error('='.repeat(60));
        console.error('\nDetalhes do erro:');
        console.error(error);
        console.error('\n' + '='.repeat(60) + '\n');

        process.exit(1);
    }
}

// Executar
executarMigration();
