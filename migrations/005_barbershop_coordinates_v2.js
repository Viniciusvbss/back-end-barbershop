/**
 * Migração 005 — Reintroduz coordenadas nas barbearias (v2)
 *
 * Adiciona `latitude` e `longitude` de volta à tabela `barbershops`
 * (removidas pela migração 004). Desta vez as colunas são populadas
 * via geocoding (Nominatim/OSM) ao salvar o endereço, não pelo cliente.
 *
 * Idempotência: usa SHOW COLUMNS LIKE para pular se já existirem.
 */
module.exports = {
  async up(db) {
    const addIfMissing = async (column, definition) => {
      const [rows] = await db.query('SHOW COLUMNS FROM barbershops LIKE ?', [column]);
      if (!rows.length) {
        await db.query(`ALTER TABLE barbershops ADD COLUMN ${column} ${definition}`);
      }
    };

    await addIfMissing('latitude', 'DECIMAL(10,6) NULL');
    await addIfMissing('longitude', 'DECIMAL(11,6) NULL');
  },
};
