// Environment -> config. Numbers that are missing, garbage or not positive fall back to the default.
const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    dataDir: env.DATA_DIR || './data',
    maxBytes: int(env.MAX_TAKE_BYTES, 50 * 1024 * 1024),
    maxPerIpPerDay: int(env.MAX_UPLOADS_PER_IP_DAY, 30),
    // Uploads being read/parsed at once. Each can cost ~4x its size in memory, so this is the memory cap, not a rate limit.
    maxConcurrentUploads: int(env.MAX_CONCURRENT_UPLOADS, 2),
    linkTtlMs: int(env.LINK_TTL_HOURS, 24) * 3600_000,
    quotaBytes: int(env.QUOTA_MB, 10240) * 1024 * 1024,
    adminToken: env.ADMIN_TOKEN || '',
    contactEmail: env.CONTACT_EMAIL || '',
    ipSalt: env.IP_SALT || 'puppeteer-lab',
  };
}
