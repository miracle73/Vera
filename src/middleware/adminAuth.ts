import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { logger } from "./requestLogger";

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.admin.apiKey) {
    return next();
  }

  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!provided || provided !== config.admin.apiKey) {
    logger.warn("Unauthorized admin request", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Provide x-api-key header.",
    });
  }

  next();
}
