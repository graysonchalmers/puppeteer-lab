import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.mjs';

describe('loadConfig', () => {
  it('uses the agreed defaults', () => {
    const c = loadConfig({});
    expect(c.maxBytes).toBe(50 * 1024 * 1024);
    expect(c.maxPerIpPerDay).toBe(30);
    expect(c.linkTtlMs).toBe(24 * 3600_000);
    expect(c.quotaBytes).toBe(10240 * 1024 * 1024);
    expect(c.contactEmail).toBe('');
    expect(c.adminToken).toBe('');
    expect(c.host).toBe('127.0.0.1');
  });

  it('reads overrides', () => {
    const c = loadConfig({ PORT: '9000', MAX_TAKE_BYTES: '1000', MAX_UPLOADS_PER_IP_DAY: '2', LINK_TTL_HOURS: '1', QUOTA_MB: '5', CONTACT_EMAIL: 'a@b.c', ADMIN_TOKEN: 'tok', DATA_DIR: '/d', HOST: '0.0.0.0' });
    expect(c).toMatchObject({ port: 9000, maxBytes: 1000, maxPerIpPerDay: 2, linkTtlMs: 3600_000, quotaBytes: 5 * 1024 * 1024, contactEmail: 'a@b.c', adminToken: 'tok', dataDir: '/d', host: '0.0.0.0' });
  });

  it('falls back to the default for garbage or non-positive numbers', () => {
    const c = loadConfig({ PORT: 'abc', MAX_TAKE_BYTES: '-5', MAX_UPLOADS_PER_IP_DAY: '0' });
    expect(c.port).toBe(8787);
    expect(c.maxBytes).toBe(50 * 1024 * 1024);
    expect(c.maxPerIpPerDay).toBe(30);
  });
});
