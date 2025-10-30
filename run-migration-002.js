// =====================================================
// Script para executar migration 002
// =====================================================

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuração do banco (EXATAMENTE igual ao database.js)
const dbConfig = {
    host: '92.113.38.164',
    port: 5432,
    database: 'aupus_staging',
    user: 'aupus_staging',
    password: 'AupusStaging2024',
    ssl: false,
    connectionTimeoutMillis: 30000
};

async function runMigration() {
    const client = new Client(dbConfig);

    try {
        console.log('🔌 Conectando ao banco de dados...');
        await client.connect();
        console.log('✅ Conectado!');

        // Ler arquivo de migration
        const migrationPath = path.join(__dirname, 'migrations', '002_add_discount_fields.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 Executando migration 002_add_discount_fields.sql...');
        await client.query(sql);

        console.log('✅ Migration executada com sucesso!');
        console.log('');
        console.log('Novos campos adicionados:');
        console.log('  - valor_economia (NUMERIC)');
        console.log('  - valor_com_desconto (NUMERIC)');
        console.log('  - valor_bandeira_com_desconto (NUMERIC)');
        console.log('  - valor_s_desconto (NUMERIC)');

    } catch (error) {
        console.error('❌ Erro ao executar migration:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await client.end();
        console.log('🔌 Desconectado do banco de dados');
    }
}

// Executar
runMigration();
