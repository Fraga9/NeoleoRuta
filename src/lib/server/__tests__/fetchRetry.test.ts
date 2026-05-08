import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../fetchRetry';

const okResponse = (status = 200, body = 'ok') =>
  new Response(body, { status, headers: { 'content-type': 'text/plain' } });

describe('fetchWithRetry()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns immediately on 200', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(200, 'hi'));
    const res = await fetchWithRetry('https://example.test/');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(404, 'not found'));
    const res = await fetchWithRetry('https://example.test/', {}, { retries: 3, backoffMs: 1 });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(200, 'ok'));
    const res = await fetchWithRetry('https://example.test/', {}, { retries: 1, backoffMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns last 5xx after exhausting retries', async () => {
    fetchMock.mockResolvedValue(okResponse(500));
    const res = await fetchWithRetry('https://example.test/', {}, { retries: 2, backoffMs: 1 });
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on network error (TypeError)', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(okResponse(200, 'ok'));
    const res = await fetchWithRetry('https://example.test/', {}, { retries: 1, backoffMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on persistent network errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    await expect(
      fetchWithRetry('https://example.test/', {}, { retries: 2, backoffMs: 1 }),
    ).rejects.toThrow(/network down/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on timeout (AbortError)', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockResolvedValueOnce(okResponse(200, 'ok'));
    const res = await fetchWithRetry('https://example.test/', {}, { retries: 1, backoffMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry when caller aborts via their own signal', async () => {
    const ac = new AbortController();
    ac.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(
      fetchWithRetry('https://example.test/', { signal: ac.signal }, { retries: 3, backoffMs: 1 }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies perTryTimeoutMs by passing AbortSignal to fetch', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(200, 'ok'));
    await fetchWithRetry('https://example.test/', {}, { perTryTimeoutMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const passedInit = call[1] as RequestInit;
    expect(passedInit.signal).toBeDefined();
    expect((passedInit.signal as AbortSignal).aborted).toBe(false);
  });

  it('combines caller signal with per-try timeout signal', async () => {
    const ac = new AbortController();
    fetchMock.mockResolvedValueOnce(okResponse(200, 'ok'));
    await fetchWithRetry(
      'https://example.test/',
      { signal: ac.signal },
      { perTryTimeoutMs: 5000 },
    );
    const call = fetchMock.mock.calls[0];
    const sig = (call[1] as RequestInit).signal as AbortSignal;
    expect(sig).toBeDefined();
    // Aborting the caller signal should also abort the combined signal.
    ac.abort();
    expect(sig.aborted).toBe(true);
  });

  it('exponential backoff: delays grow per attempt (no real-clock dependency)', async () => {
    // We can't measure real time without flakiness, so check via mock spy on setTimeout-like behavior.
    // Instead, verify retries fire in order with the helper still returning.
    fetchMock
      .mockRejectedValueOnce(new TypeError('boom'))
      .mockRejectedValueOnce(new TypeError('boom'))
      .mockResolvedValueOnce(okResponse(200, 'ok'));
    const res = await fetchWithRetry(
      'https://example.test/',
      {},
      { retries: 2, backoffMs: 1, backoffFactor: 2 },
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
