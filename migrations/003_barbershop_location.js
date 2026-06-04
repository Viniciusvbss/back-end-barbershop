/**
 * Migração 003 — Localização das barbearias
 *
 * Adiciona cinco colunas à tabela `barbershops` para suportar a busca por
 * proximidade na área do cliente:
 *
 *   address   — endereço completo (rua + número), exibido na tela pública
 *   city      — cidade, usada também como filtro de busca textual
 *   state     — UF (sigla), ex.: "SP"
 *   latitude  — coordenada decimal (WGS-84), usada na fórmula Haversine
 *   longitude — coordenada decimal (WGS-84), usada na fórmula Haversine
 *
 * Todas as colunas são opcionais (NULL) — barbearias existentes continuam
 * funcionando sem precisar preencher o endereço imediatamente.
 *
 * Idempotência: cada ALTER TABLE é precedido por SHOW COLUMNS LIKE; se a
 * coluna já existir (re-execução manual ou rollback parcial), o bloco é pulado.
 */
module.exports = {
  async up(db) {
    // Helper: adiciona a coluna apenas se ainda não existir
    const addIfMissing = async (column, definition) => {
      const [rows] = await db.query('SHOW COLUMNS FROM barbershops LIKE ?', [column]);
      if (!rows.length) {
        await db.query(`ALTER TABLE barbershops ADD COLUMN ${column} ${definition}`);
      }
    };

    // Endereço textual — exibido no card público da barbearia
    await addIfMissing('address', 'VARCHAR(500) NULL AFTER updated_at');

    // Cidade — indexada para buscas por texto (LIKE '%cidade%')
    await addIfMissing('city', 'VARCHAR(100) NULL AFTER address');

    // Estado / UF — duas letras, ex.: "SP", "RJ"
    await addIfMissing('state', 'VARCHAR(2) NULL AFTER city');

    // Latitude em graus decimais, precisão de ~1 metro (6 casas decimais)
    // DECIMAL(10,6) cobre o intervalo [-90, 90] com margem suficiente
    await addIfMissing('latitude', 'DECIMAL(10,6) NULL AFTER state');

    // Longitude em graus decimais, precisão de ~1 metro
    // DECIMAL(11,6) cobre o intervalo [-180, 180]
    await addIfMissing('longitude', 'DECIMAL(11,6) NULL AFTER latitude');

    // Índice composto para a busca Haversine — filtra primeiro as linhas com
    // coordenadas preenchidas sem fazer full table scan
    const [idxRows] = await db.query(
      "SHOW INDEX FROM barbershops WHERE Key_name = 'idx_barbershops_geo'",
    );
    if (!idxRows.length) {
      await db.query(
        'ALTER TABLE barbershops ADD INDEX idx_barbershops_geo (latitude, longitude)',
      );
    }

    // Índice para busca por cidade (LIKE 'cidade%' aproveita este índice)
    const [cityIdxRows] = await db.query(
      "SHOW INDEX FROM barbershops WHERE Key_name = 'idx_barbershops_city'",
    );
    if (!cityIdxRows.length) {
      await db.query('ALTER TABLE barbershops ADD INDEX idx_barbershops_city (city)');
    }
  },
};
