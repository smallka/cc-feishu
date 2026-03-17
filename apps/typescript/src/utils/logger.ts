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

const logger = winston.createLogger({
  level: config.app.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'feishu-bot' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          const serializedMeta = serializeLogValue(meta);
          const metaStr = Object.keys(meta).length
            ? JSON.stringify(serializedMeta)
            : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    }),
  ],
});

export default logger;
