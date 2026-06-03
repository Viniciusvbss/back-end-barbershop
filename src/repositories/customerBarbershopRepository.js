const link = async (db, customerId, barbershopId, { privacyVersion = null, marketingConsent = false } = {}) => {
  await db.query(`
    INSERT INTO customer_barbershops
      (customer_id, barbershop_id, privacy_policy_accepted_at, privacy_policy_version,
       marketing_consent, marketing_consent_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      privacy_policy_accepted_at = IF(VALUES(privacy_policy_version) IS NOT NULL, NOW(), privacy_policy_accepted_at),
      privacy_policy_version = COALESCE(VALUES(privacy_policy_version), privacy_policy_version),
      marketing_consent = VALUES(marketing_consent),
      marketing_consent_at = VALUES(marketing_consent_at)
  `, [
    customerId,
    barbershopId,
    privacyVersion ? new Date() : null,
    privacyVersion || null,
    marketingConsent ? 1 : 0,
    marketingConsent ? new Date() : null,
  ]);
};

const isLinked = async (db, customerId, barbershopId) => {
  const [rows] = await db.query(
    'SELECT 1 FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ? LIMIT 1',
    [customerId, barbershopId],
  );
  return rows.length > 0;
};

const updateConsent = async (db, customerId, barbershopId, { privacyVersion, marketingConsent }) => {
  await db.query(`
    UPDATE customer_barbershops
    SET privacy_policy_accepted_at = NOW(),
        privacy_policy_version = ?,
        marketing_consent = ?,
        marketing_consent_at = ?
    WHERE customer_id = ? AND barbershop_id = ?
  `, [
    privacyVersion,
    marketingConsent ? 1 : 0,
    marketingConsent ? new Date() : null,
    customerId,
    barbershopId,
  ]);
};

const unlink = async (db, customerId, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ?',
    [customerId, barbershopId],
  );
  return result.affectedRows > 0;
};

const listByCustomer = async (db, customerId) => {
  const [rows] = await db.query(`
    SELECT bs.id, bs.name, bs.slug, bs.logo_url, cb.created_at AS linked_at
    FROM customer_barbershops cb
    JOIN barbershops bs ON bs.id = cb.barbershop_id
    WHERE cb.customer_id = ?
    ORDER BY cb.created_at DESC
  `, [customerId]);
  return rows;
};

module.exports = { link, isLinked, updateConsent, unlink, listByCustomer };
