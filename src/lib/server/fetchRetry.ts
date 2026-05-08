/**
 * fetch with retry on transient failures.
 *
 * Retries on:
 *   - network errors (TypeError thrown by fetch)
 *   - timeouts (AbortError from AbortSignal.timeout)
 *   - 5xx server responses
 *
 * Does NOT retry on:
 *   - 4xx client errors (your fault, retry won't help)
 *   - explicit user aborts (AbortController)
 *
 * Default: 1 retry with 250ms backoff (so worst case latency ≈ 2× the per-call timeout).
 */

export interface RetryOptions {
  retries?: number;       // additional attempts after the first (default 1)
  backoffMs?: number;     // delay before first retry (default 250)
  backoffFactor?: number; // multiplier per attempt (default 2)
  perTryTimeoutMs?: number; // if set, wraps each attempt in AbortSignal.timeout
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function isUserAbort(signal: AbortSignal | null | undefined): boolean {
  return !!signal && signal.aborted;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 1;
  const backoffMs = opts.backoffMs ?? 250;
  const factor = opts.backoffFactor ?? 2;
  const perTryTimeoutMs = opts.perTryTimeoutMs;

  let lastErr: unknown;
  let delay = backoffMs;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Build per-try signal: combine caller's signal (if any) with the per-try timeout (if any).
    let signal: AbortSignal | undefined = init.signal as AbortSignal | undefined;
    if (perTryTimeoutMs !== undefined) {
      const timeoutSignal = AbortSignal.timeout(perTryTimeoutMs);
      signal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    }

    try {
      const res = await fetch(url, { ...init, signal });
      // Retry only 5xx (transient server errors). 4xx are caller bugs — return immediately.
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(delay);
        delay *= factor;
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // If the caller's signal was aborted (user cancellation), don't retry.
      if (isUserAbort(init.signal as AbortSignal | undefined)) throw e;
      // Out of retries → bubble up.
      if (attempt >= retries) throw e;
      // For abort errors and network errors, retry.
      if (!isAbortError(e) && !(e instanceof TypeError) && !(e instanceof Error)) throw e;
      await sleep(delay);
      delay *= factor;
    }
  }

  // Unreachable in practice — loop either returns or throws.
  throw lastErr ?? new Error('fetchWithRetry: exhausted attempts');
}
