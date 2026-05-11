import winston from 'winston';
import config from '../config';

function serializeLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };

    if (value.stack) {
      serialized.stack = value.stack;
    }

    const errorWithCause = value as Error & { cause?: unknown };
    if (errorWithCause.cause !== undefined) {
      serialized.cause = serializeLogValue(errorWithCause.cause, seen);
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (!(key in serialized)) {
        serialized[key] = serializeLogValue(nestedValue, seen);
      }
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return value.map(item => serializeLogValue(item, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const serialized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      serialized[key] = serializeLogValue(nestedValue, seen);
    }
    seen.delete(value);
    return serialized;
  }

  return value;
}

function buildConsoleLine(info: winston.Logform.TransformableInfo): string {
  const { timestamp, level, message, service, ...meta } = info;
  const serializedMeta = serializeLogValue(meta);
  const metaStr = Object.keys(meta).length
    ? ` ${JSON.stringify(serializedMeta)}`
    : '';

  return `${timestamp} [${level}] ${service}: ${message}${metaStr}`;
}

function createConsoleFormat(useColors: boolean): winston.Logform.Format {
  const formats: winston.Logform.Format[] = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
  ];

  if (useColors) {
    formats.push(winston.format.colorize({ all: true }));
  }

  formats.push(winston.format.printf((info) => buildConsoleLine(info)));

  return winston.format.combine(...formats);
}

const useColors = Boolean(process.stdout.isTTY);

const logger = winston.createLogger({
  level: config.app.logLevel,
  defaultMeta: { service: 'feishu-bot' },
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
      format: createConsoleFormat(useColors),
    }),
  ],
});

export default logger;
