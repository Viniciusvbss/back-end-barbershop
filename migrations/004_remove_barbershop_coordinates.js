/**
 * Migração 004 — Remove coordenadas das barbearias
 *
 * A busca por proximidade (Haversine) foi descontinuada. Remove as colunas
 * `latitude` e `longitude` e o índice `idx_barbershops_geo` da tabela
 * `barbershops`, adicionados pela migração 003.
 *
 * `address`, `city` e `state` permanecem — continuam em uso na busca por
 * cidade e na exibição do endereço.
 *
 * Idempotência: cada DROP é precedido por SHOW INDEX / SHOW COLUMNS; se o
 * índice ou a coluna já não existir, o passo é pulado.
 */
module.exports = {
  async up(db) {
    const [idxRows] = await db.query(
      "SHOW INDEX FROM barbershops WHERE Key_name = 'idx_barbershops_geo'",
    );
    if (idxRows.length) {
      await db.query('ALTER TABLE barbershops DROP INDEX idx_barbershops_geo');
    }

    const dropColumnIfExists = async (column) => {
      const [rows] = await db.query('SHOW COLUMNS FROM barbershops LIKE ?', [column]);
      if (rows.length) {
        await db.query(`ALTER TABLE barbershops DROP COLUMN ${column}`);
      }
    };

    await dropColumnIfExists('latitude');
    await dropColumnIfExists('longitude');
  },
};
