export type ExpirationPreset = "1h" | "24h" | "7d" | "30d" | "never" | "custom";

export const EXPIRATION_OPTIONS: { value: ExpirationPreset; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
  { value: "custom", label: "Custom date & time" },
];

export function presetToDate(preset: ExpirationPreset, custom?: Date): Date | null {
  const now = Date.now();
  switch (preset) {
    case "1h": return new Date(now + 60 * 60 * 1000);
    case "24h": return new Date(now + 24 * 60 * 60 * 1000);
    case "7d": return new Date(now + 7 * 24 * 60 * 60 * 1000);
    case "30d": return new Date(now + 30 * 24 * 60 * 60 * 1000);
    case "never": return null;
    case "custom": return custom ?? null;
  }
}

export function describeStatus(image: {
  expires_at: string | null;
  revoked_at: string | null;
  deleted_at: string | null;
}): { label: string; tone: "ok" | "warn" | "bad" } {
  if (image.deleted_at) return { label: "Deleted", tone: "bad" };
  if (image.revoked_at) return { label: "Revoked", tone: "bad" };
  if (image.expires_at && new Date(image.expires_at) < new Date()) return { label: "Expired", tone: "bad" };
  if (image.expires_at) {
    const ms = new Date(image.expires_at).getTime() - Date.now();
    const hours = ms / (60 * 60 * 1000);
    if (hours < 24) return { label: `Expires in ${Math.max(1, Math.round(hours))}h`, tone: "warn" };
    const days = Math.round(hours / 24);
    return { label: `Expires in ${days}d`, tone: "ok" };
  }
  return { label: "Active", tone: "ok" };
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
