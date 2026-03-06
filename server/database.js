// =====================================================
// CONFIGURAÇÃO DO BANCO DE DADOS POSTGRESQL
// =====================================================

const { Pool } = require('pg');

// Configuração do pool de conexões - Banco local aupus_faturas
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || 'aupus_faturas',
    user: process.env.DB_USERNAME || 'aupus',
    password: process.env.DB_PASSWORD || 'SuaSenhaAqui123!',
    max: 20, // Máximo de conexões no pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
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

        // Adicionar colunas de status de envio se não existirem
        const addColumnsQuery = `
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'status_envio') THEN
                    ALTER TABLE boletos_energia ADD COLUMN status_envio VARCHAR(20) DEFAULT 'Pendente';
                    CREATE INDEX IF NOT EXISTS idx_boletos_energia_status_envio ON boletos_energia(status_envio);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'data_envio_whatsapp') THEN
                    ALTER TABLE boletos_energia ADD COLUMN data_envio_whatsapp TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'data_envio_email') THEN
                    ALTER TABLE boletos_energia ADD COLUMN data_envio_email TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'dados_resposta_bb') THEN
                    ALTER TABLE boletos_energia ADD COLUMN dados_resposta_bb JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'dados_pix_bb') THEN
                    ALTER TABLE boletos_energia ADD COLUMN dados_pix_bb JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'data_ultima_consulta_bb') THEN
                    ALTER TABLE boletos_energia ADD COLUMN data_ultima_consulta_bb TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boletos_energia' AND column_name = 'notificacoes_protesto') THEN
                    ALTER TABLE boletos_energia ADD COLUMN notificacoes_protesto JSONB DEFAULT '{}';
                END IF;
            END $$;
        `;
        await pool.query(addColumnsQuery);

        console.log('✅ Tabela boletos_energia verificada/criada');
        return true;
    } catch (error) {
        console.error('❌ Erro ao criar tabela:', error);
        return false;
    }
}

/**
 * Inserir ou atualizar boleto de energia
 *
 * REGRAS DE PROTEÇÃO:
 * 1. Se boleto NÃO existe -> INSERE novo registro
 * 2. Se boleto existe com status 'Gerado' ou 'Pago' -> IGNORA atualização (mantém dados originais)
 * 3. Se boleto existe com status 'Pendente' -> ATUALIZA com novos dados
 * 4. Se boleto existe com status 'Cancelado' -> ATUALIZA e RESETA status para 'Pendente'
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
            email, telefone, dados_completos, status, valor_abatimento, motivo_abatimento,
            vencimento_consorcio
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
            $25, $26, $27, $28, $29, $30, $31
        )
        ON CONFLICT (uc, mes_referencia)
        DO UPDATE SET
            -- Só atualiza se o boleto NÃO estiver com status 'Boleto gerado' ou 'Pago'
            -- Se estiver Gerado/Pago, mantém todos os valores originais (ignora update)
            data_vencimento = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.data_vencimento
                ELSE EXCLUDED.data_vencimento
            END,
            valor_boleto = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_boleto
                ELSE EXCLUDED.valor_boleto
            END,
            descricao = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.descricao
                ELSE EXCLUDED.descricao
            END,
            tipo_pessoa = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.tipo_pessoa
                ELSE EXCLUDED.tipo_pessoa
            END,
            documento = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.documento
                ELSE EXCLUDED.documento
            END,
            nome_completo = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.nome_completo
                ELSE EXCLUDED.nome_completo
            END,
            endereco = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.endereco
                ELSE EXCLUDED.endereco
            END,
            bairro = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.bairro
                ELSE EXCLUDED.bairro
            END,
            cep = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.cep
                ELSE EXCLUDED.cep
            END,
            cidade = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.cidade
                ELSE EXCLUDED.cidade
            END,
            uf = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.uf
                ELSE EXCLUDED.uf
            END,
            energia_nao_compensado = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.energia_nao_compensado
                ELSE EXCLUDED.energia_nao_compensado
            END,
            energia_compensado = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.energia_compensado
                ELSE EXCLUDED.energia_compensado
            END,
            energia_total = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.energia_total
                ELSE EXCLUDED.energia_total
            END,
            valor_energia_compensada = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_energia_compensada
                ELSE EXCLUDED.valor_energia_compensada
            END,
            valor_bandeira_compensada = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_bandeira_compensada
                ELSE EXCLUDED.valor_bandeira_compensada
            END,
            tarifa_minima_concessionaria = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.tarifa_minima_concessionaria
                ELSE EXCLUDED.tarifa_minima_concessionaria
            END,
            valor_com_desconto_aupus = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_com_desconto_aupus
                ELSE EXCLUDED.valor_com_desconto_aupus
            END,
            valor_economia = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_economia
                ELSE EXCLUDED.valor_economia
            END,
            valor_com_desconto = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_com_desconto
                ELSE EXCLUDED.valor_com_desconto
            END,
            valor_bandeira_com_desconto = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_bandeira_com_desconto
                ELSE EXCLUDED.valor_bandeira_com_desconto
            END,
            valor_s_desconto = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_s_desconto
                ELSE EXCLUDED.valor_s_desconto
            END,
            email = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.email
                ELSE EXCLUDED.email
            END,
            telefone = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.telefone
                ELSE EXCLUDED.telefone
            END,
            dados_completos = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.dados_completos
                ELSE EXCLUDED.dados_completos
            END,
            -- Status: Se Cancelado permite recriar (Pendente), senão mantém o status atual
            status = CASE
                WHEN boletos_energia.status = 'Cancelado' THEN 'Pendente'
                ELSE boletos_energia.status
            END,
            numero_boleto = CASE
                WHEN boletos_energia.status = 'Cancelado' THEN NULL
                ELSE boletos_energia.numero_boleto
            END,
            -- Só atualiza a data se NÃO estiver Gerado/Pago
            data_atualizacao = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.data_atualizacao
                ELSE CURRENT_TIMESTAMP
            END,
            valor_abatimento = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.valor_abatimento
                ELSE EXCLUDED.valor_abatimento
            END,
            motivo_abatimento = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.motivo_abatimento
                ELSE EXCLUDED.motivo_abatimento
            END,
            vencimento_consorcio = CASE
                WHEN boletos_energia.status IN ('Gerado', 'Pago', 'Boleto gerado') THEN boletos_energia.vencimento_consorcio
                ELSE EXCLUDED.vencimento_consorcio
            END
        RETURNING *;
    `;

    // Normalizar tipo_pessoa: aceitar "1", "2", "CPF", "CNPJ" ou baseado no tamanho do documento
    let tipoPessoa = dados.tipoPessoa || dados.tipo_pessoa;
    const documento = dados.documento || dados.cpf_cnpj || dados.cpfCnpj || '';
    const documentoLimpo = documento.replace(/\D/g, '');

    // Converter código numérico para texto
    if (tipoPessoa === '1' || tipoPessoa === 1) {
        tipoPessoa = 'CPF';
    } else if (tipoPessoa === '2' || tipoPessoa === 2) {
        tipoPessoa = 'CNPJ';
    } else if (!tipoPessoa && documentoLimpo) {
        // Inferir pelo tamanho do documento
        tipoPessoa = documentoLimpo.length > 11 ? 'CNPJ' : 'CPF';
    }

    const values = [
        dados.uc,
        dados.mes_referencia,
        dados.dataVencimento || dados.data_vencimento,
        dados.valorBoleto || dados.valor_boleto,
        dados.descricao,
        tipoPessoa,
        documento,
        dados.nomeCompleto || dados.nome_completo,
        dados.endereco,
        dados.bairro,
        dados.cep,
        dados.cidade,
        dados.uf,
        dados.energiaNaoCompensado || dados.energia_nao_compensado,
        dados.energiaCompensado || dados.energia_compensado,
        dados.energiaTotal || dados.energia_total,
        dados.valorEnergiaCompensada || dados.valor_energia_compensada,
        dados.valorBandeiraCompensada || dados.valor_bandeira_compensada,
        dados.tarifaMinimaConcessionaria || dados.tarifa_minima_concessionaria,
        dados.valorComDescontoAupus || dados.valor_com_desconto_aupus,
        dados.valor_economia || null,
        dados.valor_com_desconto || null,
        dados.valor_bandeira_com_desconto || null,
        dados.valor_s_desconto || null,
        dados.email || null,
        dados.telefone || null,
        JSON.stringify(dados),
        'Pendente',
        dados.valor_abatimento || 0,
        dados.motivo_abatimento || null,
        dados.vencimento_consorcio || 20
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

    // Filtro por mês de referência
    if (filtros.mes_referencia) {
        query += ` AND mes_referencia = $${paramIndex}`;
        values.push(filtros.mes_referencia);
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
async function atualizarStatusBoleto(uc, mesReferencia, status, numeroBoleto = null, dataVencimento = null) {
    const query = `
        UPDATE boletos_energia
        SET status = $1::VARCHAR,
            numero_boleto = $2::VARCHAR,
            data_vencimento = COALESCE($5::VARCHAR, data_vencimento),
            data_atualizacao = CURRENT_TIMESTAMP,
            data_geracao_boleto = CASE WHEN $1::VARCHAR = 'Boleto gerado' THEN CURRENT_TIMESTAMP ELSE data_geracao_boleto END,
            dados_completos = CASE WHEN $1::VARCHAR = 'Pendente' THEN NULL ELSE dados_completos END
        WHERE uc = $3::VARCHAR AND mes_referencia = $4::VARCHAR
        RETURNING *;
    `;

    const values = [status, numeroBoleto, String(uc), String(mesReferencia), dataVencimento];

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

/**
 * Atualizar boleto parcialmente (apenas campos fornecidos)
 * Não sobrescreve campos existentes com null
 */
async function atualizarBoletoParcial(uc, mesReferencia, campos) {
    // Construir SET dinamicamente apenas com campos fornecidos
    const camposParaAtualizar = [];
    const valores = [uc, mesReferencia];
    let paramIndex = 3;

    for (const [campo, valor] of Object.entries(campos)) {
        camposParaAtualizar.push(`${campo} = $${paramIndex}`);
        valores.push(valor);
        paramIndex++;
    }

    if (camposParaAtualizar.length === 0) {
        throw new Error('Nenhum campo para atualizar');
    }

    const query = `
        UPDATE boletos_energia
        SET ${camposParaAtualizar.join(', ')},
            data_atualizacao = CURRENT_TIMESTAMP
        WHERE uc = $1 AND mes_referencia = $2
        RETURNING *;
    `;

    try {
        const result = await pool.query(query, valores);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao atualizar boleto parcialmente:', error);
        throw error;
    }
}

// =====================================================
// TABELA DE CONTROLE DE ENVIOS (WhatsApp/Email)
// =====================================================

/**
 * Criar tabela de controle de envios se não existir
 */
async function criarTabelaEnviosSeNaoExistir() {
    const query = `
        CREATE TABLE IF NOT EXISTS controle_envios (
            id SERIAL PRIMARY KEY,
            arquivo VARCHAR(500) NOT NULL,
            pasta VARCHAR(100),
            mes_referencia VARCHAR(10),
            tipo_envio VARCHAR(20) NOT NULL, -- 'whatsapp' ou 'email'
            destinatario VARCHAR(255) NOT NULL, -- telefone ou email
            status VARCHAR(20) DEFAULT 'enviado', -- 'enviado', 'falha', 'pendente'
            mensagem TEXT,
            resposta_api TEXT,
            data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            enviado_por VARCHAR(100),
            CONSTRAINT uk_arquivo_tipo_dest UNIQUE (arquivo, tipo_envio, destinatario)
        );

        CREATE INDEX IF NOT EXISTS idx_controle_envios_arquivo ON controle_envios(arquivo);
        CREATE INDEX IF NOT EXISTS idx_controle_envios_mes ON controle_envios(mes_referencia);
        CREATE INDEX IF NOT EXISTS idx_controle_envios_tipo ON controle_envios(tipo_envio);
    `;

    try {
        await pool.query(query);
        console.log('✅ Tabela controle_envios verificada/criada');
        return true;
    } catch (error) {
        console.error('❌ Erro ao criar tabela controle_envios:', error);
        return false;
    }
}

/**
 * Extrair UC do nome do arquivo
 * Formatos suportados:
 * - "Fatura AUPUS - UC - Nome.pdf"
 * - "Boleto Aupus - UC - Nome.pdf"
 */
function extrairUCDoArquivo(arquivo) {
    if (!arquivo) return null;

    // Padrão: "Fatura AUPUS - UC - Nome.pdf" ou "Boleto Aupus - UC - Nome.pdf"
    // Também captura variações como "Fatura_AUPUS", "BOLETO AUPUS", etc.
    const match = arquivo.match(/(?:Fatura[_\s]+AUPUS|Boleto[_\s]+Aupus)\s*-\s*(\d+)\s*-/i);
    if (match) {
        return match[1];
    }

    // Fallback: tentar extrair qualquer sequência de dígitos após " - "
    // Ex: "Qualquer Nome - 12345678 - Cliente.pdf"
    const fallbackMatch = arquivo.match(/\s-\s(\d{6,12})\s-\s/);
    if (fallbackMatch) {
        return fallbackMatch[1];
    }

    return null;
}

/**
 * Atualizar status de envio do boleto na tabela boletos_energia
 */
async function atualizarStatusEnvioBoleto(uc, mesReferencia, tipoEnvio, sucesso = true) {
    if (!uc || !mesReferencia) {
        console.log(`⚠️ [atualizarStatusEnvioBoleto] Parâmetros inválidos: UC=${uc}, mes=${mesReferencia}`);
        return null;
    }

    // Converter mes_referencia de "MM.YYYY" ou "MM/YYYY" para o formato correto
    let mesFormatado = mesReferencia;
    if (mesReferencia.includes('.')) {
        mesFormatado = mesReferencia.replace('.', '/');
    }

    console.log(`📝 [atualizarStatusEnvioBoleto] UC=${uc}, mes=${mesFormatado}, tipo=${tipoEnvio}, sucesso=${sucesso}`);

    // Determinar novo status de envio baseado no tipo
    // Status possíveis: 'Pendente', 'WhatsApp', 'Email', 'WhatsApp e Email'
    const getNovoStatus = (statusAtual, tipoEnvio) => {
        if (!sucesso) return statusAtual || 'Pendente';

        if (tipoEnvio === 'whatsapp') {
            if (statusAtual === 'Email') return 'WhatsApp e Email';
            return 'WhatsApp';
        } else if (tipoEnvio === 'email') {
            if (statusAtual === 'WhatsApp') return 'WhatsApp e Email';
            return 'Email';
        }
        return statusAtual || 'Pendente';
    };

    try {
        // Buscar status atual do boleto
        const boletoAtual = await pool.query(
            'SELECT status_envio FROM boletos_energia WHERE uc = $1 AND mes_referencia = $2',
            [uc, mesFormatado]
        );

        if (boletoAtual.rows.length === 0) {
            console.log(`⚠️ [atualizarStatusEnvioBoleto] Boleto não encontrado para UC ${uc} mês ${mesFormatado}`);
            return null;
        }

        const statusAtual = boletoAtual.rows[0].status_envio;
        const novoStatus = getNovoStatus(statusAtual, tipoEnvio);

        // Atualizar o status de envio e a data correspondente
        const campoData = tipoEnvio === 'whatsapp' ? 'data_envio_whatsapp' : 'data_envio_email';

        const updateQuery = `
            UPDATE boletos_energia
            SET status_envio = $1,
                ${campoData} = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE ${campoData} END,
                data_atualizacao = CURRENT_TIMESTAMP
            WHERE uc = $2 AND mes_referencia = $3
            RETURNING *;
        `;

        const result = await pool.query(updateQuery, [novoStatus, uc, mesFormatado, sucesso]);

        if (result.rows.length > 0) {
            console.log(`✅ Status de envio atualizado: UC ${uc} - ${novoStatus}`);
        }

        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao atualizar status de envio do boleto:', error);
        return null; // Não propagar erro para não quebrar o fluxo de envio
    }
}

/**
 * Registrar envio de fatura
 */
async function registrarEnvio(dados) {
    const { arquivo, pasta, mes_referencia, tipo_envio, destinatario, status, mensagem, resposta_api, enviado_por } = dados;

    // Verificar se já existe para o mesmo arquivo + mês + tipo + destinatário
    // O mes_referencia é incluído pois o mesmo arquivo pode ser enviado em meses diferentes
    const checkQuery = `
        SELECT * FROM controle_envios
        WHERE arquivo = $1 AND tipo_envio = $2 AND destinatario = $3 AND mes_referencia = $4
    `;

    try {
        const existente = await pool.query(checkQuery, [arquivo, tipo_envio, destinatario, mes_referencia]);

        let result;
        if (existente.rows.length > 0) {
            // Já existe para este mês - atualizar
            const updateQuery = `
                UPDATE controle_envios
                SET status = $5, mensagem = $6, resposta_api = $7, data_envio = CURRENT_TIMESTAMP, enviado_por = $8, pasta = $9
                WHERE arquivo = $1 AND tipo_envio = $2 AND destinatario = $3 AND mes_referencia = $4
                RETURNING *;
            `;
            result = await pool.query(updateQuery, [arquivo, tipo_envio, destinatario, mes_referencia, status, mensagem, resposta_api, enviado_por, pasta]);
            result = { ...result.rows[0], atualizado: true };
        } else {
            // Não existe para este mês - inserir novo registro
            const insertQuery = `
                INSERT INTO controle_envios (arquivo, pasta, mes_referencia, tipo_envio, destinatario, status, mensagem, resposta_api, enviado_por)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *;
            `;
            result = await pool.query(insertQuery, [arquivo, pasta, mes_referencia, tipo_envio, destinatario, status, mensagem, resposta_api, enviado_por]);
            result = { ...result.rows[0], novo: true };
        }

        // NOTA: Não atualizamos mais boletos_energia aqui.
        // O status de envio é consultado diretamente de controle_envios (fonte única de verdade)

        return result;
    } catch (error) {
        console.error('❌ Erro ao registrar envio:', error);
        throw error;
    }
}

/**
 * Verificar se arquivo já foi enviado para destinatário no mesmo mês
 */
async function verificarEnvioExistente(arquivo, tipo_envio, destinatario, mes_referencia = null) {
    // Se mes_referencia for fornecido, verificar apenas para aquele mês
    // Caso contrário, verificar qualquer envio (comportamento legado)
    let query;
    let params;

    if (mes_referencia) {
        query = `
            SELECT * FROM controle_envios
            WHERE arquivo = $1 AND tipo_envio = $2 AND destinatario = $3 AND mes_referencia = $4 AND status = 'enviado'
            ORDER BY data_envio DESC
            LIMIT 1
        `;
        params = [arquivo, tipo_envio, destinatario, mes_referencia];
    } else {
        query = `
            SELECT * FROM controle_envios
            WHERE arquivo = $1 AND tipo_envio = $2 AND destinatario = $3 AND status = 'enviado'
            ORDER BY data_envio DESC
            LIMIT 1
        `;
        params = [arquivo, tipo_envio, destinatario];
    }

    try {
        const result = await pool.query(query, params);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erro ao verificar envio existente:', error);
        throw error;
    }
}

/**
 * Listar histórico de envios
 */
async function listarEnvios(filtros = {}) {
    let query = `SELECT * FROM controle_envios WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filtros.arquivo) {
        query += ` AND arquivo ILIKE $${paramIndex}`;
        params.push(`%${filtros.arquivo}%`);
        paramIndex++;
    }
    if (filtros.pasta) {
        query += ` AND pasta = $${paramIndex}`;
        params.push(filtros.pasta);
        paramIndex++;
    }
    if (filtros.mes_referencia) {
        query += ` AND mes_referencia = $${paramIndex}`;
        params.push(filtros.mes_referencia);
        paramIndex++;
    }
    if (filtros.tipo_envio) {
        query += ` AND tipo_envio = $${paramIndex}`;
        params.push(filtros.tipo_envio);
        paramIndex++;
    }
    if (filtros.destinatario) {
        query += ` AND destinatario ILIKE $${paramIndex}`;
        params.push(`%${filtros.destinatario}%`);
        paramIndex++;
    }
    if (filtros.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(filtros.status);
        paramIndex++;
    }

    query += ` ORDER BY data_envio DESC LIMIT 500`;

    try {
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('❌ Erro ao listar envios:', error);
        throw error;
    }
}

/**
 * Sincronizar status de envio dos boletos com base na tabela controle_envios
 * Esta função corrige retroativamente boletos que foram enviados mas não tiveram o status atualizado
 */
async function sincronizarStatusEnviosBoletos() {
    console.log('🔄 Iniciando sincronização de status de envios...');

    try {
        // Buscar todos os envios bem-sucedidos de boletos de energia (pasta NET ou NET Completo)
        const enviosQuery = `
            SELECT DISTINCT arquivo, pasta, mes_referencia, tipo_envio, MIN(data_envio) as primeira_data
            FROM controle_envios
            WHERE status = 'enviado'
              AND (pasta = 'NET' OR pasta = 'NET Completo')
            GROUP BY arquivo, pasta, mes_referencia, tipo_envio
            ORDER BY mes_referencia DESC, arquivo
        `;

        const envios = await pool.query(enviosQuery);
        console.log(`📊 Encontrados ${envios.rows.length} registros de envio para processar`);

        let atualizados = 0;
        let erros = 0;
        const processados = new Map(); // Para rastrear UC+mes já processados

        for (const envio of envios.rows) {
            const uc = extrairUCDoArquivo(envio.arquivo);
            if (!uc) continue;

            // Converter mes_referencia para formato padrão
            let mesRef = envio.mes_referencia;
            if (mesRef && mesRef.includes('.')) {
                mesRef = mesRef.replace('.', '/');
            }

            const chave = `${uc}-${mesRef}`;

            // Verificar se já processamos este UC+mes
            if (!processados.has(chave)) {
                processados.set(chave, { whatsapp: false, email: false });
            }

            const statusProcessado = processados.get(chave);

            // Marcar o tipo de envio como processado
            if (envio.tipo_envio === 'whatsapp') {
                statusProcessado.whatsapp = true;
            } else if (envio.tipo_envio === 'email') {
                statusProcessado.email = true;
            }

            processados.set(chave, statusProcessado);
        }

        // Agora atualizar cada boleto com base nos envios encontrados
        for (const [chave, status] of processados.entries()) {
            const [uc, mesRef] = chave.split('-');

            let novoStatus = 'Pendente';
            if (status.whatsapp && status.email) {
                novoStatus = 'WhatsApp e Email';
            } else if (status.whatsapp) {
                novoStatus = 'WhatsApp';
            } else if (status.email) {
                novoStatus = 'Email';
            }

            try {
                // Buscar as datas de envio mais recentes
                const datasQuery = `
                    SELECT tipo_envio, MAX(data_envio) as data_envio
                    FROM controle_envios
                    WHERE arquivo LIKE $1
                      AND mes_referencia = $2
                      AND status = 'enviado'
                      AND (pasta = 'NET' OR pasta = 'NET Completo')
                    GROUP BY tipo_envio
                `;
                // Buscar com ambos os formatos de mes_referencia (/ e .)
                const mesComPonto = mesRef.replace('/', '.');
                const mesComBarra = mesRef.replace('.', '/');
                const datasResult = await pool.query(datasQuery, [`%${uc}%`, mesComBarra]);
                // Fallback: se não encontrar com /, tenta com .
                if (datasResult.rows.length === 0) {
                    const datasResult2 = await pool.query(datasQuery, [`%${uc}%`, mesComPonto]);
                    datasResult.rows = datasResult2.rows;
                }

                let dataWhatsapp = null;
                let dataEmail = null;

                for (const row of datasResult.rows) {
                    if (row.tipo_envio === 'whatsapp') dataWhatsapp = row.data_envio;
                    if (row.tipo_envio === 'email') dataEmail = row.data_envio;
                }

                const updateQuery = `
                    UPDATE boletos_energia
                    SET status_envio = $1,
                        data_envio_whatsapp = COALESCE($4, data_envio_whatsapp),
                        data_envio_email = COALESCE($5, data_envio_email),
                        data_atualizacao = CURRENT_TIMESTAMP
                    WHERE uc = $2 AND mes_referencia = $3
                      AND (status_envio IS NULL OR status_envio = 'Pendente' OR status_envio != $1)
                    RETURNING id, uc, mes_referencia, status_envio;
                `;

                const result = await pool.query(updateQuery, [novoStatus, uc, mesRef, dataWhatsapp, dataEmail]);

                if (result.rows.length > 0) {
                    atualizados++;
                    console.log(`   ✅ UC ${uc} (${mesRef}): ${novoStatus}`);
                }
            } catch (err) {
                erros++;
                console.error(`   ❌ Erro ao atualizar UC ${uc} (${mesRef}):`, err.message);
            }
        }

        console.log(`\n📊 Sincronização concluída:`);
        console.log(`   ✅ Atualizados: ${atualizados}`);
        console.log(`   ❌ Erros: ${erros}`);
        console.log(`   📋 Total processados: ${processados.size}`);

        return { atualizados, erros, total: processados.size };
    } catch (error) {
        console.error('❌ Erro na sincronização de status de envios:', error);
        throw error;
    }
}

// =====================================================
// PERSISTÊNCIA DE DADOS BB (fallback para PDF)
// =====================================================

/**
 * Salvar resposta da API BB para um boleto (para geração de PDF offline)
 */
async function salvarRespostaBB(numeroBoleto, dadosBB, dadosPix = null) {
    try {
        const result = await pool.query(`
            UPDATE boletos_energia
            SET dados_resposta_bb = $1,
                dados_pix_bb = COALESCE($2, dados_pix_bb),
                data_ultima_consulta_bb = CURRENT_TIMESTAMP,
                data_atualizacao = CURRENT_TIMESTAMP
            WHERE numero_boleto = $3
            RETURNING id, uc, mes_referencia
        `, [
            JSON.stringify(dadosBB),
            dadosPix ? JSON.stringify(dadosPix) : null,
            numeroBoleto
        ]);
        if (result.rows.length > 0) {
            console.log(`💾 Dados BB salvos para boleto ${numeroBoleto} (UC ${result.rows[0].uc})`);
        }
        return result.rows[0] || null;
    } catch (error) {
        console.error('⚠️ Erro ao salvar resposta BB:', error.message);
        return null;
    }
}

/**
 * Buscar resposta BB salva para um boleto
 */
async function buscarRespostaBBSalva(numeroBoleto) {
    try {
        const result = await pool.query(`
            SELECT dados_resposta_bb, dados_pix_bb, data_ultima_consulta_bb
            FROM boletos_energia
            WHERE numero_boleto = $1
              AND dados_resposta_bb IS NOT NULL
        `, [numeroBoleto]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('⚠️ Erro ao buscar resposta BB salva:', error.message);
        return null;
    }
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    pool,
    criarTabelaSeNaoExistir,
    inserirOuAtualizarBoleto,
    atualizarBoletoParcial,
    listarBoletos,
    atualizarStatusBoleto,
    buscarBoleto,
    deletarBoleto,
    buscarBoletoPorNumero,
    atualizarStatusBoletoPorNumero,
    // Controle de envios
    criarTabelaEnviosSeNaoExistir,
    registrarEnvio,
    verificarEnvioExistente,
    listarEnvios,
    // Status de envio de boletos
    atualizarStatusEnvioBoleto,
    sincronizarStatusEnviosBoletos,
    extrairUCDoArquivo,
    // Persistência dados BB
    salvarRespostaBB,
    buscarRespostaBBSalva
};
