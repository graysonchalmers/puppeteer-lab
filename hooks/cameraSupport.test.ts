import { describe, it, expect, vi } from 'vitest';
import { resolveFacing, describeCameraError, createWithDelegateFallback } from './cameraSupport';

describe('resolveFacing', () => {
  it('trusts what the track reports over what was requested', () => {
    expect(resolveFacing('environment', 'user')).toBe('user'); // one-camera phone: ideal fell back to front
    expect(resolveFacing('user', 'environment')).toBe('environment');
  });
  it('falls back to the request when the browser reports nothing or something odd', () => {
    expect(resolveFacing('environment', undefined)).toBe('environment');
    expect(resolveFacing('user', 'left')).toBe('user');
  });
});

describe('describeCameraError', () => {
  it('says a denied permission is a block (the per-browser steps live on the structured issue)', () => {
    const m = describeCameraError({ name: 'NotAllowedError' });
    expect(m).toMatch(/blocked/i);
  });
  it('separates no-camera, busy-camera and insecure-page failures', () => {
    expect(describeCameraError({ name: 'NotFoundError' })).toMatch(/no camera/i);
    expect(describeCameraError({ name: 'NotReadableError' })).toMatch(/busy/i);
    expect(describeCameraError(new TypeError('navigator.mediaDevices is undefined'))).toMatch(/cannot use the camera/i);
  });
  it('never throws on junk', () => {
    expect(describeCameraError(null)).toMatch(/camera/i);
    expect(describeCameraError('boom')).toMatch(/camera/i);
    expect(describeCameraError(undefined)).toMatch(/camera/i);
  });
});

describe('createWithDelegateFallback', () => {
  it('uses the GPU when it works', async () => {
    const create = vi.fn(async (d: string) => `made-${d}`);
    const r = await createWithDelegateFallback(create);
    expect(r).toEqual({ value: 'made-GPU', delegate: 'GPU' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('retries on the CPU when GPU creation throws, and reports the GPU error', async () => {
    const gpuErr = new Error('gpu init failed');
    const create = vi.fn(async (d: string) => {
      if (d === 'GPU') throw gpuErr;
      return `made-${d}`;
    });
    const onFallback = vi.fn();
    const r = await createWithDelegateFallback(create, onFallback);
    expect(r).toEqual({ value: 'made-CPU', delegate: 'CPU' });
    expect(onFallback).toHaveBeenCalledWith(gpuErr);
  });
  it('rejects with the CPU error when both fail', async () => {
    const create = async (d: string) => {
      throw new Error(`${d} failed`);
    };
    await expect(createWithDelegateFallback(create)).rejects.toThrow('CPU failed');
  });
});
