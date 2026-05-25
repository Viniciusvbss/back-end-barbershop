const nodemailer = require('nodemailer');

const hasEmailConfig = () => (
  process.env.EMAIL_HOST &&
  process.env.EMAIL_PORT &&
  process.env.EMAIL_USER &&
  process.env.EMAIL_PASSWORD
);

const sendPasswordResetEmail = async ({ to, resetLink }) => {
  if (!hasEmailConfig()) {
    console.log('Password reset link:', resetLink);
    return { sent: false, preview: resetLink };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject: 'Recuperacao de senha',
    text: `Use este link para redefinir sua senha: ${resetLink}`,
    html: `
      <p>Recebemos uma solicitacao para redefinir sua senha.</p>
      <p><a href="${resetLink}">Clique aqui para criar uma nova senha</a></p>
      <p>Se voce nao solicitou isso, ignore este email.</p>
    `,
  });

  return { sent: true };
};

module.exports = { hasEmailConfig, sendPasswordResetEmail };
