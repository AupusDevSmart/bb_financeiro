-- Verificar encoding atual do banco
SHOW SERVER_ENCODING;
SHOW CLIENT_ENCODING;

-- Definir encoding do cliente para UTF8
SET CLIENT_ENCODING TO 'UTF8';

-- Atualizar o registro de teste com encoding correto
UPDATE boletos_energia
SET cidade = 'Goiânia'
WHERE uc = '13095584' AND mes_referencia = '10/2025';

-- Verificar se foi atualizado corretamente
SELECT id, uc, mes_referencia, cidade, nome_completo
FROM boletos_energia
WHERE uc = '13095584';
