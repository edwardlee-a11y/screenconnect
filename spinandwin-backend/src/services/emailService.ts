import nodemailer, { Transporter } from 'nodemailer';

// ─── Transport singleton ────────────────────────────────────────────────────
// Configure via environment variables:
//   EMAIL_HOST         SMTP server (e.g. smtp.sendgrid.net)
//   EMAIL_PORT         SMTP port    (default 587)
//   EMAIL_SECURE       "true" for port 465 TLS, "false" otherwise
//   EMAIL_USER         SMTP username / API key user
//   EMAIL_PASS         SMTP password / API key
//   EMAIL_FROM         Sender address shown to recipients
//
// For local development with Ethereal (free catch-all):
//   Leave EMAIL_HOST unset — a test account is created automatically.

let _transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (_transporter) return _transporter;

  if (!process.env.EMAIL_HOST) {
    // Development mode: use Ethereal fake SMTP so emails are captured but never delivered.
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log(
      '[email] Using Ethereal test account. Preview emails at https://ethereal.email — ' +
      `user: ${testAccount.user}`,
    );
  } else {
    _transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT ?? '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  return _transporter;
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Spin & Win <noreply@spinandwin.app>';
const APP_URL      = process.env.APP_URL    ?? 'https://spinandwin.app';

// ─── Email helpers ──────────────────────────────────────────────────────────

/**
 * Send a welcome email to a newly registered user.
 */
export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: FROM_ADDRESS,
    to,
    subject: '🎰 Welcome to Spin & Win!',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0D0D1A;color:#ffffff;padding:32px;border-radius:16px;">
        <h1 style="color:#FFD700;margin-bottom:8px;">Welcome, ${username}!</h1>
        <p style="color:rgba(255,255,255,0.7);line-height:1.6;">
          Your Spin & Win account is ready. Deposit MATIC, connect your wallet, and start playing.
        </p>
        <a href="${APP_URL}"
           style="display:inline-block;background:#E94560;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;margin-top:20px;">
          Open the App
        </a>
        <p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:32px;">
          You must be 18+ to play. Crypto gambling involves risk.
        </p>
      </div>
    `,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] Welcome email preview:', nodemailer.getTestMessageUrl(info));
  }
}

/**
 * Send a withdrawal confirmation email with a Polygonscan link.
 */
export async function sendWithdrawalConfirmationEmail(params: {
  to: string;
  username: string;
  amountUsd: number;
  netAmountUsd: number;
  txHash: string;
  walletAddress: string;
}): Promise<void> {
  const transporter = await getTransporter();
  const network = process.env.NODE_ENV === 'production' ? 'polygon' : 'amoy';
  const polygonscanUrl = `https://${network === 'amoy' ? 'amoy.' : ''}polygonscan.com/tx/${params.txHash}`;

  const info = await transporter.sendMail({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `✅ Withdrawal of $${params.netAmountUsd.toFixed(2)} Confirmed`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0D0D1A;color:#ffffff;padding:32px;border-radius:16px;">
        <h1 style="color:#7ED321;margin-bottom:8px;">Withdrawal Confirmed</h1>
        <p style="color:rgba(255,255,255,0.7);line-height:1.6;">
          Hi ${params.username}, your withdrawal has been processed.
        </p>
        <table style="width:100%;margin:20px 0;border-collapse:collapse;">
          <tr>
            <td style="color:rgba(255,255,255,0.4);padding:8px 0;">Requested</td>
            <td style="color:#fff;text-align:right;">$${params.amountUsd.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color:rgba(255,255,255,0.4);padding:8px 0;">Network fee (2%)</td>
            <td style="color:#E94560;text-align:right;">−$${(params.amountUsd - params.netAmountUsd).toFixed(2)}</td>
          </tr>
          <tr style="border-top:1px solid rgba(255,255,255,0.1);">
            <td style="color:#fff;font-weight:700;padding:8px 0;">You received</td>
            <td style="color:#7ED321;font-weight:700;text-align:right;">$${params.netAmountUsd.toFixed(2)}</td>
          </tr>
        </table>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all;">
          To: ${params.walletAddress}
        </p>
        <a href="${polygonscanUrl}"
           style="display:inline-block;background:rgba(255,255,255,0.08);color:#4A9EFF;padding:12px 20px;border-radius:10px;text-decoration:none;font-size:13px;margin-top:12px;">
          View on Polygonscan ↗
        </a>
        <p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:32px;">
          If you did not request this withdrawal, contact support immediately.
        </p>
      </div>
    `,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] Withdrawal email preview:', nodemailer.getTestMessageUrl(info));
  }
}

/**
 * Send a security alert for suspicious activity.
 * (e.g. wallet address changed, login from a new device)
 */
export async function sendSecurityAlertEmail(params: {
  to: string;
  username: string;
  event: string;
  detail: string;
}): Promise<void> {
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `⚠️ Security Alert — ${params.event}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0D0D1A;color:#ffffff;padding:32px;border-radius:16px;">
        <h1 style="color:#FFD700;margin-bottom:8px;">Security Alert</h1>
        <p style="color:rgba(255,255,255,0.7);">Hi ${params.username},</p>
        <p style="color:rgba(255,255,255,0.7);line-height:1.6;">
          We detected the following activity on your account:
        </p>
        <div style="background:rgba(233,69,96,0.1);border:1px solid #E94560;border-radius:10px;padding:16px;margin:16px 0;">
          <strong style="color:#E94560;">${params.event}</strong>
          <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;">${params.detail}</p>
        </div>
        <p style="color:rgba(255,255,255,0.7);line-height:1.6;">
          If this was you, no action is needed. If not, secure your account immediately.
        </p>
        <p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:32px;">
          Spin & Win Security Team
        </p>
      </div>
    `,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] Security alert email preview:', nodemailer.getTestMessageUrl(info));
  }
}
