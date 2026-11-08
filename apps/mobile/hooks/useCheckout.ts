import { useCallback, useRef, useState } from 'react';

import { ApiError, errorMessage, hasCode, isApiError } from '@/lib/api/errors';
import { Quote } from '@/lib/api/mappers';
import { paymentsService } from '@/lib/api/services/payments';
import { QuoteInput } from '@/lib/api/types';
import { Kobo } from '@/lib/money';
import { invalidateBalances } from '@/lib/queryClient';

const PIN_ERRORS = ['PIN_INCORRECT', 'PIN_REQUIRED'];

export type CheckoutFailure =
  | { status: 'insufficient'; shortfall: Kobo }
  /** The request never got a clear answer, so the money may have moved. */
  | { status: 'unknown' }
  | { status: 'failed'; reason: string };

/**
 * The one way money leaves a wallet: price it (`POST /quotes`), take the PIN, then consume the
 * quote. Retrying always reuses the same quote, which the API treats as the same payment, so a
 * dropped connection can never charge twice.
 */
export function useCheckout<T>(confirm: (quoteId: string, pin: string) => Promise<T>) {
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const pinRef = useRef('');
  const quoteRef = useRef<Quote | null>(null);

  const fail = useCallback((error: unknown) => {
    if (hasCode(error, 'INSUFFICIENT_FUNDS')) {
      setFailure({ status: 'insufficient', shortfall: (error as ApiError).shortfall });
    } else if (isApiError(error) && error.outcomeUnknown) {
      setFailure({ status: 'unknown' });
    } else {
      setFailure({
        status: 'failed',
        reason: errorMessage(error),
      });
    }
  }, []);

  /** Prices the input and opens the PIN sheet. Quote errors come back to the caller's form. */
  const start = useCallback(async (input: QuoteInput) => {
    setQuoting(true);
    try {
      const priced = await paymentsService.createQuote(input);
      quoteRef.current = priced;
      setQuote(priced);
      setPinOpen(true);
    } finally {
      setQuoting(false);
    }
  }, []);

  const submit = useCallback(
    async (pin: string) => {
      if (!quoteRef.current) return;
      pinRef.current = pin;
      try {
        setResult(await confirm(quoteRef.current.id, pin));
        setPinOpen(false);
        pinRef.current = '';
      } catch (error) {
        // A wrong PIN stays in the sheet, which shows the API's "n attempts left".
        if (hasCode(error, ...PIN_ERRORS)) throw error;
        setPinOpen(false);
        fail(error);
      } finally {
        invalidateBalances();
      }
    },
    [confirm, fail],
  );

  /**
   * Skips pricing when a screen already holds a quote, as the bill review does. `skipPin` is for
   * users who turned the PIN off; if the API wants one anyway (a new sign-in resets it), ask.
   */
  const startWithQuote = useCallback(
    async (existing: Quote, { skipPin = false }: { skipPin?: boolean } = {}) => {
      quoteRef.current = existing;
      setQuote(existing);
      if (!skipPin) {
        setPinOpen(true);
        return;
      }
      setPaying(true);
      await submit('').catch(() => setPinOpen(true));
      setPaying(false);
    },
    [submit],
  );

  /** After an unknown outcome: same quote, so the API returns the payment if it went through. */
  const retry = useCallback(async () => {
    if (!quote) return;
    setFailure(null);
    await submit(pinRef.current).catch(fail);
  }, [quote, submit, fail]);

  const reset = useCallback(() => {
    quoteRef.current = null;
    setQuote(null);
    setResult(null);
    setFailure(null);
    pinRef.current = '';
  }, []);

  return {
    quote,
    quoting,
    paying,
    result,
    failure,
    start,
    startWithQuote,
    retry,
    reset,
    pinSheet: { visible: pinOpen, onSubmit: submit, onClose: () => setPinOpen(false) },
  };
}
