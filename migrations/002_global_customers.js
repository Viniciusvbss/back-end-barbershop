module.exports = {
  async up(db) {
    // --- Novas tabelas ---

    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_barbershops (
        customer_id             INT NOT NULL,
        barbershop_id           INT NOT NULL,
        privacy_policy_accepted_at DATETIME NULL,
        privacy_policy_version  VARCHAR(32) NULL,
        marketing_consent       TINYINT(1) NOT NULL DEFAULT 0,
        marketing_consent_at    DATETIME NULL,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (customer_id, barbershop_id),
        INDEX idx_cb_customer_id   (customer_id),
        INDEX idx_cb_barbershop_id (barbershop_id),
        CONSTRAINT fk_cb_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        CONSTRAINT fk_cb_barbershop
          FOREIGN KEY (barbershop_id) REFERENCES barbershops(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_favorites (
        customer_id   INT NOT NULL,
        barbershop_id INT NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (customer_id, barbershop_id),
        CONSTRAINT fk_cf_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        CONSTRAINT fk_cf_barbershop
          FOREIGN KEY (barbershop_id) REFERENCES barbershops(id) ON DELETE CASCADE
      )
    `);

    // --- Migração de dados (roda só se barbershop_id ainda existir) ---

    const [cols] = await db.query("SHOW COLUMNS FROM customers LIKE 'barbershop_id'");
    if (cols.length > 0) {
      // Resolve telefones duplicados: mantém o registro mais antigo (menor id)
      const [dups] = await db.query(`
        SELECT phone, MIN(id) AS keep_id, GROUP_CONCAT(id ORDER BY id) AS all_ids
        FROM customers
        WHERE phone IS NOT NULL
        GROUP BY phone
        HAVING COUNT(*) > 1
      `);

      for (const { keep_id, all_ids } of dups) {
        const otherIds = all_ids.split(',').map(Number).filter((id) => id !== keep_id);

        // Grava vínculos das duplicatas no registro que será mantido
        await db.query(`
          INSERT IGNORE INTO customer_barbershops
            (customer_id, barbershop_id, privacy_policy_accepted_at, privacy_policy_version,
             marketing_consent, marketing_consent_at)
          SELECT ?, barbershop_id, privacy_policy_accepted_at, privacy_policy_version,
                 marketing_consent, marketing_consent_at
          FROM customers
          WHERE id IN (?)
        `, [keep_id, otherIds]);

        // Redireciona agendamentos para o registro mantido
        await db.query(
          'UPDATE appointments SET customer_id = ? WHERE customer_id IN (?)',
          [keep_id, otherIds],
        );

        // Remove duplicatas
        await db.query('DELETE FROM customers WHERE id IN (?)', [otherIds]);
      }

      // Migra todos os vínculos restantes para customer_barbershops
      await db.query(`
        INSERT IGNORE INTO customer_barbershops
          (customer_id, barbershop_id, privacy_policy_accepted_at, privacy_policy_version,
           marketing_consent, marketing_consent_at)
        SELECT id, barbershop_id, privacy_policy_accepted_at, privacy_policy_version,
               marketing_consent, marketing_consent_at
        FROM customers
        WHERE barbershop_id IS NOT NULL
      `);

      // Remove emails duplicados antes de criar índice único (mantém o mais antigo)
      await db.query(`
        UPDATE customers c
        JOIN (
          SELECT email, MIN(id) AS keep_id
          FROM customers
          WHERE email IS NOT NULL AND email != ''
          GROUP BY email
          HAVING COUNT(*) > 1
        ) dup ON c.email = dup.email AND c.id != dup.keep_id
        SET c.email = NULL
      `);

      // Remove FK, índices e colunas que deixam de fazer parte de customers
      const tryDrop = async (sql) => {
        try { await db.query(sql); } catch (_) { /* já removido */ }
      };

      await tryDrop('ALTER TABLE customers DROP FOREIGN KEY fk_customers_barbershop');
      await tryDrop('ALTER TABLE customers DROP INDEX uk_customers_phone_shop');
      await tryDrop('ALTER TABLE customers DROP INDEX idx_customers_barbershop_id');
      await tryDrop('ALTER TABLE customers DROP COLUMN barbershop_id');
      await tryDrop('ALTER TABLE customers DROP COLUMN privacy_policy_accepted_at');
      await tryDrop('ALTER TABLE customers DROP COLUMN privacy_policy_version');
      await tryDrop('ALTER TABLE customers DROP COLUMN marketing_consent');
      await tryDrop('ALTER TABLE customers DROP COLUMN marketing_consent_at');

      // Índice único global no telefone
      await tryDrop('ALTER TABLE customers ADD UNIQUE INDEX uk_customers_phone (phone)');
    }

    // Índice único no email (idempotente)
    const [[{ cnt: emailIdxCnt }]] = await db.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customers'
        AND index_name = 'uk_customers_email'
    `);
    if (!emailIdxCnt) {
      await db.query('ALTER TABLE customers ADD UNIQUE INDEX uk_customers_email (email)');
    }

    // password_hash para login do cliente
    const [pwCols] = await db.query("SHOW COLUMNS FROM customers LIKE 'password_hash'");
    if (!pwCols.length) {
      await db.query('ALTER TABLE customers ADD COLUMN password_hash VARCHAR(255) NULL AFTER email');
    }
  },
};
