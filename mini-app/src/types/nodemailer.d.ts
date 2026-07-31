declare module 'nodemailer' {
  namespace nodemailer {
    export interface SendMailOptions {
      from?: string;
      to?: string | string[];
      subject?: string;
      text?: string;
      html?: string;
      attachments?: Array<Record<string, unknown>>;
    }

    export interface Transporter {
      sendMail(options: SendMailOptions): Promise<unknown>;
    }
  }

  export interface SendMailOptions {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    attachments?: Array<Record<string, unknown>>;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export function createTransport(options: Record<string, unknown>): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
  export { nodemailer };
}
