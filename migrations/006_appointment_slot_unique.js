/**
 * Migração 006 — Slot do barbeiro: troca `unique_barber_time` por um índice que
 * ignora agendamentos cancelados
 *
 * O banco já tinha um UNIQUE `unique_barber_time (barber_id, appointment_date,
 * appointment_time)` criado à mão — não estava em migration nem no schema.md.
 * Ele segura a corrida entre o `checkConflict` e o `INSERT`, mas conta linhas
 * canceladas: depois que um agendamento é cancelado, aquele horário daquele
 * barbeiro fica queimado para sempre, e nenhum outro cliente consegue marcar.
 *
 * Este índice faz a mesma trava sem esse efeito. `active_slot` é gerada a partir
 * do status: vale 1 enquanto o agendamento está de pé e NULL quando cancelado.
 * Como o MySQL não aplica UNIQUE sobre NULL, dois agendamentos ativos no mesmo
 * barbeiro/data/hora continuam impossíveis, mas o horário cancelado volta a
 * ficar livre.
 *
 * A trava é por barbeiro, não por horário: dois clientes continuam podendo
 * marcar o mesmo horário desde que com barbeiros diferentes.
 *
 * Idempotência: SHOW COLUMNS / SHOW INDEX antes de cada ALTER.
 */
module.exports = {
  async up(db) {
    // Duplicatas pré-existentes fariam o ADD UNIQUE INDEX falhar no meio do
    // ALTER; detecta antes para a migration morrer com uma mensagem acionável.
    const [duplicates] = await db.query(`
      SELECT barber_id, appointment_date, appointment_time, COUNT(*) AS total
      FROM appointments
      WHERE status <> 'cancelled'
      GROUP BY barber_id, appointment_date, appointment_time
      HAVING total > 1
    `);

    if (duplicates.length) {
      const detail = duplicates.map((row) => {
        const date = row.appointment_date instanceof Date
          ? row.appointment_date.toISOString().slice(0, 10)
          : String(row.appointment_date).slice(0, 10);
        return `barbeiro ${row.barber_id} em ${date} ${String(row.appointment_time).slice(0, 5)} (${row.total}x)`;
      }).join(', ');

      throw new Error(
        'Migration 006: ha agendamentos ativos duplicados no mesmo barbeiro/horario e o '
        + `indice UNIQUE nao pode ser criado. Cancele ou remaneje os conflitos e reinicie o servidor. Conflitos: ${detail}`,
      );
    }

    const [columns] = await db.query('SHOW COLUMNS FROM appointments LIKE ?', ['active_slot']);
    if (!columns.length) {
      await db.query(`
        ALTER TABLE appointments
        ADD COLUMN active_slot TINYINT
        GENERATED ALWAYS AS (IF(status = 'cancelled', NULL, 1)) STORED
      `);
    }

    const [indexes] = await db.query(
      'SHOW INDEX FROM appointments WHERE Key_name = ?',
      ['uk_apt_barber_slot'],
    );
    if (!indexes.length) {
      await db.query(`
        ALTER TABLE appointments
        ADD UNIQUE INDEX uk_apt_barber_slot (barber_id, appointment_date, appointment_time, active_slot)
      `);
    }

    // Só depois do novo índice existir, para nunca ficar uma janela sem trava.
    // O novo cobre as mesmas colunas do antigo, então nada de proteção se perde.
    const [legacy] = await db.query(
      'SHOW INDEX FROM appointments WHERE Key_name = ?',
      ['unique_barber_time'],
    );
    if (legacy.length) {
      await db.query('ALTER TABLE appointments DROP INDEX unique_barber_time');
    }
  },
};
