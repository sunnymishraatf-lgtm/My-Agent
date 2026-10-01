/**
 * NEUTRON email sender — verification emails via SMTP (nodemailer).
 *
 * Configure with environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   SMTP_FROM (optional, defaults to SMTP_USER)
 *   APP_URL (optional, defaults to https://neutron-agent.vercel.app)
 *
 * For Gmail: create an App Password (Google Account → Security →
 * 2-Step Verification → App passwords), then:
 *   SMTP_HOST=smtp.gmail.com SMTP_PORT=587
 *   SMTP_USER=you@gmail.com SMTP_PASS=<app-password>
 *
 * If not configured, sendVerificationEmail logs and returns false —
 * the API still creates the token so the flow can be completed manually.
 */
import nodemailer from "nodemailer";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function getConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user,
    pass,
    from: process.env.SMTP_FROM || user,
  };
}

export function isMailConfigured(): boolean {
  return getConfig() !== null;
}

export async function sendVerificationEmail(
  toEmail: string,
  displayName: string,
  token: string
): Promise<boolean> {
  const cfg = getConfig();
  const appUrl = (process.env.APP_URL || "https://neutron-agent.vercel.app").replace(/\/$/, "");
  const link = `${appUrl}/app#/verify?token=${encodeURIComponent(token)}`;

  const subject = "Verify your NEUTRON account";
  const text =
    `Hi ${displayName || "there"},\n\n` +
    `Click the link below to verify your NEUTRON account:\n\n${link}\n\n` +
    `This link expires in 24 hours.\n\n` +
    `If you didn't create this account, you can ignore this email.`;
  const html =
    `<p>Hi ${escapeHtml(displayName || "there")},</p>` +
    `<p>Click the link below to verify your NEUTRON account:</p>` +
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;` +
    `background:#CC8066;color:#fff;text-decoration:none;border-radius:8px;">` +
    `Verify my account</a></p>` +
    `<p style="color:#888;font-size:12px;">This link expires in 24 hours.<br>` +
    `If you didn't create this account, you can ignore this email.</p>`;

  if (!cfg) {
    // Never log the full link in production — it's a live credential.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[auth] SMTP not configured — verification link for ${toEmail}: ${link}`);
    } else {
      console.log(`[auth] SMTP not configured — cannot send verification email to ${toEmail}`);
    }
    return false;
  }

  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({
      from: `"NEUTRON" <${cfg.from}>`,
      to: toEmail,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error("[auth] Failed to send verification email:", (err as Error).message);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
