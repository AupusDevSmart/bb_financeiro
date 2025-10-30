// =====================================================
// CONFIGURAÇÃO DO BANCO DE DADOS POSTGRESQL
// =====================================================

const { Pool } = require('pg');

// Configuração do pool de conexões
const pool = new Pool({
    host: process.env.DB_HOST || '92.113.38.164',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'aupus_staging',
    user: process.env.DB_USERNAME || 'aupus_staging',
    password: process.env.DB_PASSWORD || 'AupusStaging2024',
    max: 20, // Máximo de conexões no pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Aumentado para 10 segundos (conexão remota)
    client_encoding: 'UTF8' // Garantir encoding UTF-8
});

// Evento de erro
pool.on('error', (err, client) => {
    console.error('❌ Erro inesperado no cliente do banco de dados:', err);
});

// Testar conexão ao iniciar
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco de dados PostgreSQL:', err.stack);
        console.error('   Verifique as credenciais e se o PostgreSQL está rodando');
    } else {
        console.log('✅ Conectado ao banco de dados PostgreSQL (aupus_staging)');
        release();
    }
});

// =====================================================
// FUNÇÕES DE BANCO DE DADOS
// =====================================================

/**
 * Criar tabela se não existir
 */
async function criarTabelaSeNaoExistir() {
    const query = `
        CREATE TABLE IF NOT EXISTS boletos_energia (
            id SERIAL PRIMARY KEY,
            uc VARCHAR(20) NOT NULL,
            mes_referencia VARCHAR(10) NOT NULL,
            data_vencimento VARCHAR(10),
            valor_boleto NUMERIC(10, 2),
            descricao TEXT,
            tipo_pessoa VARCHAR(10),
            documento VARCHAR(20),
            nome_completo VARCHAR(255),
            endereco TEXT,
            bairro VARCHAR(100),
            cep VARCHAR(10),
            cidade VARCHAR(100),
            uf VARCHAR(2),
            energia_nao_compensado NUMERIC(10, 2),
            energia_compensado NUMERIC(10, 2),
            energia_total NUMERIC(10, 2),
            valor_energia_compensada NUMERIC(10, 2),
            valor_bandeira_compensada NUMERIC(10, 2),
            tarifa_minima_concessionaria NUMERIC(10, 2),
            valor_com_desconto_aupus NUMERIC(10, 2),
            email VARCHAR(255),
            telefone VARCHAR(20),
            dados_completos JSONB,
            status VARCHAR(20) DEFAULT 'Pendente',
            numero_boleto VARCHAR(50),
            data_recebimento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            data_atualizacao TIMESTAMP,
            data_geracao_boleto TIMESTAMP,
            CONSTRAINT uk_uc_mes UNIQUE (uc, mes_referencia)
        );

        CREATE INDEX IF NOT EXISTS idx_boletos_energia_uc ON boletos_energia(uc);
        CREATE INDEX IF NOT EXISTS idx_boletos_energia_status ON boletos_energia(status);
        CREATE INDEX IF NOT EXISTS idx_boletos_energia_dados_completos ON boletos_energia USING GIN (dados_completos);
    `;

    try {
        await pool.query(query);
        console.log('✅ Tabela boletos_energia verificada/criada');
        return true;
    } catch (error) {
        console.error('❌ Erro ao criar tabela:', error);
        return false;
    }
}

/**
 * Inserir ou atualizar boleto de energia
 * REGRA: Se boleto estiver cancelado, permite criar novo registro (reseta status para Pendente)
 */
async function inserirOuAtualizarBoleto(dados) {
    const query = `
        INSERT INTO boletos_energia (
            uc, mes_referencia, data_vencimento, valor_boleto, descricao,
            tipo_pessoa, documento, nome_completo, endereco, bairro, cep, cidade, uf,
            energia_nao_compensado, energia_compensado, energia_total,
            valor_energia_compensada, valor_bandeira_compensada,
            tarifa_minima_concessionaria, valor_com_desconto_aupus,
            valor_economia, valor_com_desconto, valor_bandeira_com_desconto, valor_s_desconto,
            email, telefone, dados_completos, status
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
            $25, $26, $27, $28
        )
        ON CONFLICT (uc, mes_referencia)
        DO UPDATE SET
            data_vencimento = EXCLUDED.data_vencimento,
            valor_boleto = EXCLUDED.valor_boleto,
            descricao = EXCLUDED.descricao,
            tipo_pessoa = EXCLUDED.tipo_pessoa,
            documento = EXCLUDED.documento,
            nome_completo = EXCLUDED.nome_completo,
            endereco = EXCLUDED.endereco,
            bairro = EXCLUDED.bairro,
            cep = EXCLUDED.cep,
            cidade = EXCLUDED.cidade,
            uf = EXCLUDED.uf,
            energia_nao_compensado = EXCLUDED.energia_nao_compensado,
            energia_compensado = EXCLUDED.energia_compensado,
            energia_total = EXCLUDED.energia_total,
            valor_energia_compensada = EXCLUDED.valor_energia_compensada,
            valor_bandeira_compensada = EXCLUDED.valor_bandeira_compensada,
            tarifa_minima_concessionaria = EXCLUDED.tarifa_minima_concessionaria,
            valor_com_desconto_aupus = EXCLUDED.valor_com_desconto_aupus,
            valor_economia = EXCLUDED.valor_economia,
            valor_com_desconto = EXCLUDED.valor_com_desconto,
            valor_bandeira_com_desconto = EXCLUDED.valor_bandeira_com_desconto,
            valor_s_desconto = EXCLUDED.valor_s_desconto,
            email = EXCLUDED.email,
            telefone = EXCLUDED.telefone,
            dados_completos = EXCLUDED.dados_completos,
            -- Se estiver Cancelado, permite criar novo (reseta para Pendente), senão mantém o status atual
            status = CASE
                WHEN boletos_energia.status = 'Cancelado' THEN 'Pendente'
                ELSE boletos_energia.status
            END,
            numero_boleto = CASE
                WHEN boletos_energia.status = 'Cancelado' THEN NULL
                ELSE boletos_energia.numero_boleto
            END,
            data_atualizacao = CURRENT_TIMESTAMP
        RETURNING *;
    `;

    const values = [
        dados.uc,
        dados.mes_referencia,
        dados.dataVencimento,
        dados.valorBoleto,
        dados.descricao,
        dados.tipoPessoa,
        dados.documento,
        dados.nomeCompleto,
        dados.endereco,
        dados.bairro,
        dados.cep,
        dados.cidade,
        dados.uf,
        dados.energiaNaoCompensado,
        dados.energiaCompensado,
        dados.energiaTotal,
        dados.valorEnergiaCompensada,
        dados.valorBandeiraCompensada,
        dados.tarifaMinimaConcessionaria,
        dados.valorComDescontoAupus,
        dados.valor_economia || null,
        dados.valor_com_desconto || null,
        dados.valor_bandeira_com_desconto || null,
        dados.valor_s_desconto || null,
        dados.email || null,
        dados.telefone || null,
        JSON.stringify(dados),
        'Pendente'
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('❌ Erro ao inserir/atualizar boleto:', error);
        throw error;
    }
}

/**
 * Listar boletos com filtros
 */
async function listarBoletos(filtros = {}) {
    let query = 'SELECT * FROM boletos_energia WHERE 1=1';
    const values = [];
    let paramIndex = 1;

    // Filtro por status
    if (filtros.status && filtros.status !== 'Todos') {
        query += ` AND status = $${paramIndex}`;
        values.push(filtros.status);
        paramIndex++;
    }

    // Filtro por UC
    if (filtros.uc) {
        query += ` AND uc LIKE $${paramIndex}`;
        values.push(`%${filtros.uc}%`);
        paramIndex++;
    }

    // Filtro por data início
    if (filtros.data_inicio) {
        query += ` AND data_recebimento >= $${paramIndex}`;
        values.push(filtros.data_inicio);
        paramIndex++;
    }

    // Filtro por data fim
    if (filtros.data_fim) {
        query += ` AND data_recebimento <= $${paramIndex}`;
        values.push(filtros.data_fim);
        paramIndex++;
    }

    // Ordenar por data de recebimento (mais recentes primeiro)
    query += ' ORDER BY data_recebimento DESC';

    try {
        const result = await pool.query(query, values);

        // Converter dados_completos de volta para objeto
        return result.rows.map(row => ({
            ...row,
            dados_completos: row.dados_completos || {}
        }));
    } catch (error) {
        console.error('❌ Erro ao listar boletos:', error);
        throw error;
    }
}

/**
 * Atualizar status do boleto
 */
async function atualizarStatusBoleto(uc, mesReferencia, status, numeroBoleto = null) {
    const query = `
        UPDATE boletos_energia
        SET status = $1::VARCHAR,
            numero_boleto = $2::VARCHAR,
            data_atualizacao = CURRENT_TIMESTAMP,
            data_geracao_boleto = CASE WHEN $1::VARCHAR = 'Boleto gerado' THEN CURRENT_TIMESTAMP ELSE data_geracao_boleto END
        WHERE uc = $3::VARCHAR AND mes_referencia = $4::VARCHAR
        RETURNING *;
    `;

    const values = [status, numeroBoleto, String(uc), String(mesReferencia)];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('❌ Erro ao atualizar status:', error);
        throw error;
    }
}

/**
 * Buscar boleto por UC e mês
 */
async function buscarBoleto(uc, mesReferencia) {
    const query = 'SELECT * FROM boletos_energia WHERE uc = $1 AND mes_referencia = $2';

    try {
        const result = await pool.query(query, [uc, mesReferencia]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao buscar boleto:', error);
        throw error;
    }
}

/**
 * Deletar boleto por UC e mês
 */
async function deletarBoleto(uc, mesReferencia) {
    const query = 'DELETE FROM boletos_energia WHERE uc = $1 AND mes_referencia = $2 RETURNING *';

    try {
        const result = await pool.query(query, [uc, mesReferencia]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao deletar boleto:', error);
        throw error;
    }
}

/**
 * Buscar boleto por número do boleto BB
 */
async function buscarBoletoPorNumero(numeroBoleto) {
    const query = 'SELECT * FROM boletos_energia WHERE numero_boleto = $1';

    try {
        const result = await pool.query(query, [numeroBoleto]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao buscar boleto por número:', error);
        throw error;
    }
}

/**
 * Atualizar status do boleto por número do boleto BB
 */
async function atualizarStatusBoletoPorNumero(numeroBoleto, status) {
    const query = `
        UPDATE boletos_energia
        SET status = $1::VARCHAR,
            data_atualizacao = CURRENT_TIMESTAMP
        WHERE numero_boleto = $2::VARCHAR
        RETURNING *;
    `;

    try {
        const result = await pool.query(query, [status, numeroBoleto]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao atualizar status por número:', error);
        throw error;
    }
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    pool,
    criarTabelaSeNaoExistir,
    inserirOuAtualizarBoleto,
    listarBoletos,
    atualizarStatusBoleto,
    buscarBoleto,
    deletarBoleto,
    buscarBoletoPorNumero,
    atualizarStatusBoletoPorNumero
};
