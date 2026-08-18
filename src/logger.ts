import { styleText } from 'node:util';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const LEVEL_COLOR: Record<LogLevel, Parameters<typeof styleText>[0]> = {
  INFO: 'green',
  WARN: 'yellow',
  ERROR: 'red',
};

function write(level: LogLevel, message: string, detail?: unknown): void {
  const stream = level === 'ERROR' ? console.error : console.log;
  const time = styleText('dim', new Date().toISOString());
  const badge = styleText(LEVEL_COLOR[level], `[${level}]`);
  const line = `${time} ${badge} ${message}`;

  if (detail === undefined) {
    stream(line);
  } else {
    stream(line, detail);
  }
}

export const logger = {
  info: (message: string, detail?: unknown) => write('INFO', message, detail),
  warn: (message: string, detail?: unknown) => write('WARN', message, detail),
  error: (message: string, detail?: unknown) => write('ERROR', message, detail),
};
