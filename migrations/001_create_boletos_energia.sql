-- =====================================================
-- MIGRATION: Criar tabela boletos_energia
-- Data: 2025-10-27
-- Descrição: Armazena dados de boletos de energia recebidos do Sistema_Faturas
-- =====================================================

-- Criar tabela
CREATE TABLE IF NOT EXISTS boletos_energia (
    -- Chave primária
    id SERIAL PRIMARY KEY,

    -- Identificação única (UC + Mês)
    uc VARCHAR(20) NOT NULL,
    mes_referencia VARCHAR(10) NOT NULL,

    -- Dados do boleto
    data_vencimento VARCHAR(10),
    valor_boleto NUMERIC(10, 2),
    descricao TEXT,

    -- Dados do pagador
    tipo_pessoa VARCHAR(10),
    documento VARCHAR(20),
    nome_completo VARCHAR(255),

    -- Endereço
    endereco TEXT,
    bairro VARCHAR(100),
    cep VARCHAR(10),
    cidade VARCHAR(100),
    uf VARCHAR(2),

    -- Dados de energia (valores numéricos)
    energia_nao_compensado NUMERIC(10, 2),
    energia_compensado NUMERIC(10, 2),
    energia_total NUMERIC(10, 2),
    valor_energia_compensada NUMERIC(10, 2),
    valor_bandeira_compensada NUMERIC(10, 2),
    tarifa_minima_concessionaria NUMERIC(10, 2),
    valor_com_desconto_aupus NUMERIC(10, 2),

    -- Contatos (opcionais)
    email VARCHAR(255),
    telefone VARCHAR(20),

    -- Dados JSON completos (backup de todos os dados recebidos)
    dados_completos JSONB,

    -- Status do boleto
    status VARCHAR(20) DEFAULT 'Pendente',
    numero_boleto VARCHAR(50),

    -- Controle de datas
    data_recebimento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP,
    data_geracao_boleto TIMESTAMP,

    -- Constraint: UC + mês devem ser únicos
    CONSTRAINT uk_uc_mes UNIQUE (uc, mes_referencia)
);

-- Criar índices para melhorar performance de consultas
CREATE INDEX IF NOT EXISTS idx_boletos_energia_uc ON boletos_energia(uc);
CREATE INDEX IF NOT EXISTS idx_boletos_energia_mes ON boletos_energia(mes_referencia);
CREATE INDEX IF NOT EXISTS idx_boletos_energia_status ON boletos_energia(status);
CREATE INDEX IF NOT EXISTS idx_boletos_energia_data_recebimento ON boletos_energia(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_boletos_energia_numero_boleto ON boletos_energia(numero_boleto);

-- Criar índice GIN para busca no JSONB
CREATE INDEX IF NOT EXISTS idx_boletos_energia_dados_completos ON boletos_energia USING GIN (dados_completos);

-- Comentários na tabela e colunas
COMMENT ON TABLE boletos_energia IS 'Armazena dados de boletos de energia recebidos do Sistema_Faturas para geração automática';
COMMENT ON COLUMN boletos_energia.id IS 'ID sequencial (chave primária)';
COMMENT ON COLUMN boletos_energia.uc IS 'Unidade Consumidora';
COMMENT ON COLUMN boletos_energia.mes_referencia IS 'Mês de referência da fatura (ex: 10/2025)';
COMMENT ON COLUMN boletos_energia.dados_completos IS 'JSON completo com todos os dados recebidos do Sistema_Faturas';
COMMENT ON COLUMN boletos_energia.status IS 'Status: Pendente, Boleto gerado, Erro';
COMMENT ON COLUMN boletos_energia.numero_boleto IS 'Número do boleto gerado no Banco do Brasil';

-- Mensagem de sucesso
DO $$
BEGIN
    RAISE NOTICE 'Tabela boletos_energia criada com sucesso!';
END $$;
