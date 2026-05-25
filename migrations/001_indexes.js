// Índices compostos para as queries mais frequentes da aplicação.
// Cada bloco usa SHOW INDEX para verificar existência antes de criar.
module.exports = {
  async up(db) {
    const addIndex = async (table, indexName, columns) => {
      const [rows] = await db.query(
        'SHOW INDEX FROM ?? WHERE Key_name = ?',
        [table, indexName],
      );
      if (!rows.length) {
        await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`);
      }
    };

    // Agendamentos: busca por barbearia + data (tela de agenda diária)
    await addIndex('appointments', 'idx_apt_shop_date', 'barbershop_id, appointment_date');
    // Agendamentos: busca por barbeiro + data (filtro de barbeiro na agenda)
    await addIndex('appointments', 'idx_apt_barber_date', 'barber_id, appointment_date');
    // Agendamentos: busca por status (relatórios, filtros)
    await addIndex('appointments', 'idx_apt_shop_status', 'barbershop_id, status');

    // Clientes: busca por telefone dentro da barbearia (lookup de agendamento público)
    // UNIQUE uk_customers_phone_shop já cobre (phone, barbershop_id); adiciona só o prefixo
    await addIndex('customers', 'idx_customers_shop_name', 'barbershop_id, name');

    // Consent logs: busca por barbershop + ação (auditoria LGPD)
    await addIndex('consent_logs', 'idx_consent_shop_action', 'barbershop_id, action');

    // Business hours: lookup público por barbearia (usado em toda abertura do booking)
    await addIndex('business_hours', 'idx_bh_barbershop_weekday', 'barbershop_id, weekday');
  },
};
