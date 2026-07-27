import winston from "winston";
import { config } from "../config";

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "vera" },
  transports: [
    new winston.transports.Console({
      format:
        config.nodeEnv === "development"
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length > 1
                  ? ` ${JSON.stringify(meta)}`
                  : "";
                return `${timestamp} [${level}]: ${message}${metaStr}`;
              })
            )
          : winston.format.json(),
    }),
  ],
});
