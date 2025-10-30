-- =====================================================
-- MIGRATION: Adicionar campos de desconto
-- Data: 2025-10-29
-- Descrição: Adiciona campos para valores com desconto e economia
-- =====================================================

-- Adicionar novos campos
ALTER TABLE boletos_energia
ADD COLUMN IF NOT EXISTS valor_economia NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS valor_com_desconto NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS valor_bandeira_com_desconto NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS valor_s_desconto NUMERIC(10, 2);

-- Comentários nas colunas
COMMENT ON COLUMN boletos_energia.valor_economia IS 'Valor da economia total (já calculado no JSON)';
COMMENT ON COLUMN boletos_energia.valor_com_desconto IS 'Valor da energia compensada COM desconto AUPUS';
COMMENT ON COLUMN boletos_energia.valor_bandeira_com_desconto IS 'Valor da bandeira tarifária COM desconto AUPUS';
COMMENT ON COLUMN boletos_energia.valor_s_desconto IS 'Valor total SEM desconto (será mostrado riscado no PDF)';

-- Mensagem de sucesso
DO $$
BEGIN
    RAISE NOTICE 'Campos de desconto adicionados com sucesso!';
    RAISE NOTICE 'Novos campos: valor_economia, valor_com_desconto, valor_bandeira_com_desconto, valor_s_desconto';
END $$;
