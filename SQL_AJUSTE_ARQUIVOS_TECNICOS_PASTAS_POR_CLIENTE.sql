BEGIN;

-- 1) Apaga somente as pastas padrão automáticas que ainda estão vazias.
DELETE FROM arquivos_tecnicos_pastas p
WHERE p.modelo_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM arquivos_tecnicos_arquivos a
      WHERE a.pasta_id = p.id
  );

-- 2) Se alguma pasta automática já recebeu arquivos, preserva a pasta e os arquivos
--    transformando-a em uma pasta normal daquele cliente.
UPDATE arquivos_tecnicos_pastas
SET modelo_id = NULL
WHERE modelo_id IS NOT NULL;

-- 3) Remove a estrutura global de pastas padrão, que não é mais usada.
ALTER TABLE arquivos_tecnicos_pastas
    DROP CONSTRAINT IF EXISTS uq_arqtec_pasta_cliente_modelo;

DROP INDEX IF EXISTS ix_arqtec_pastas_modelo;

ALTER TABLE arquivos_tecnicos_pastas
    DROP COLUMN IF EXISTS modelo_id;

DROP TABLE IF EXISTS arquivos_tecnicos_pastas_modelo;

-- 4) Como o banco local já estava marcado na 0006, registra a correção 0007.
UPDATE alembic_version
SET version_num = '20260807_0007'
WHERE version_num = '20260807_0006';

COMMIT;
