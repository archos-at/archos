import nodemailer from 'nodemailer';

export const GOOGLE_WORKSPACE_SMTP = { host: 'smtp.gmail.com', port: 465 } as const;

export interface Mail {
  from: { name: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

export interface SmtpLogin {
  user: string;
  password: string;
}

export function smtpLoginFrom(env: Record<string, string | undefined>): SmtpLogin | undefined {
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  return user && password ? { user, password } : undefined;
}

export function smtpSender(login: SmtpLogin, server: { host: string; port: number } = GOOGLE_WORKSPACE_SMTP): SendMail {
  const transport = nodemailer.createTransport({ host: server.host, port: server.port, secure: server.port === 465, auth: login });
  return async (mail) => {
    await transport.sendMail(mail);
  };
}
