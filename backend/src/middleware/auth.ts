import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const header = config.auth.header.toLowerCase();
  const key = (req.headers[header] as string | undefined) ?? '';

  if (!key) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const accepted = config.auth.apiKeys.some((acceptedKey) => safeEqual(acceptedKey, key));
  if (!accepted) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}