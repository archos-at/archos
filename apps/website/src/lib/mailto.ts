export interface MailLine {
  label: string;
  value: string;
}

function encode(text: string): string {
  return encodeURIComponent(text.replace(/\r?\n/g, '\r\n'));
}

export function mailBody(lines: MailLine[], message?: string): string {
  const head = lines
    .filter((line) => line.value.trim() !== '')
    .map((line) => `${line.label}: ${line.value.trim()}`)
    .join('\n');
  const text = message?.trim() ?? '';
  return [head, text].filter((part) => part !== '').join('\n\n');
}

export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encode(subject)}&body=${encode(body)}`;
}

export function fillSubject(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (token, key: string) => (values[key]?.trim() ? values[key].trim() : token))
    .replace(/\s*\{\w+\}/g, '')
    .trim();
}
