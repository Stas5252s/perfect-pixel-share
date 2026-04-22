// Shared rate-limit + IP utilities for server routes.
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import crypto from "crypto";

export function getClientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    // ignore
  }
  try {
    const req = getRequest();
    const xff = req?.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    const real = req?.headers.get("x-real-ip");
    if (real) return real;
    const cf = req?.headers.get("cf-connecting-ip");
    if (cf) return cf;
  } catch {
    // ignore
  }
  return "0.0.0.0";
}

export function hashIp(ip: string): string {
  // Salted hash so we don't store raw IPs.
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "static-salt";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// Light limits: 20 uploads/hour, 200 downloads/hour per IP.
export const LIMITS = {
  uploadsPerHour: 20,
  downloadsPerHour: 200,
  downloadsPerImagePerHour: 60,
};
