import { existsSync, readFileSync } from 'node:fs';
export function loadLocalCredentials(path: string, environment: Record<string, string | undefined> = process.env): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^(.+?)\s+KEY\s*[:：]\s*(\S+)\s*$/i);
    if (!match) continue;
    const variable = /^deepseek$/i.test(match[1]) ? 'DEEPSEEK_API_KEY' : /^qwen/i.test(match[1]) ? 'QWEN_API_KEY' : null;
    if (variable && !environment[variable]) environment[variable] = match[2];
  }
}
