import { Redactor } from '@redactpii/node'

const redactor = new Redactor({
  rules: {
    EMAIL: true,
    PHONE: true,
    CREDIT_CARD: true,
    SSN: true,
    NAME: true,
  },
  customRules: [
    /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    /(?<!\d)(?:\+?\d[\d ()/-]{7,}\d)(?!\d)/g,
    /\b(?:password|passwort|api[_ -]?key|secret|token|bearer|sozialversicherungsnummer|steuernummer|personalausweis)\b[^\n]*/gi,
  ],
})

export function redactPii(text: string): string {
  return redactor.redact(text)
}
