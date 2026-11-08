import { useCallback, useRef, useState } from 'react';

import { ServiceId } from '@/constants/data';
import { BillProvider } from '@/lib/api/mappers';
import { detectNetwork } from '@/lib/networks';

/**
 * Picks the airtime network from the phone number as it's typed. It only switches when the
 * number's network changes, so a manual pick (for a ported number) sticks while they keep typing.
 * Call `onType` from the number field's onChangeText, not when a saved number is filled in:
 * a saved beneficiary already knows its network.
 */
export function useNetworkDetection(
  serviceId: ServiceId,
  providers: BillProvider[],
  select: (code: string) => void,
) {
  const lastDetected = useRef<string | null>(null);
  // The network we picked, while it's still the selected one; drives the "picked from the number" hint.
  const [detected, setDetected] = useState<string | null>(null);

  const onType = useCallback(
    (text: string) => {
      if (serviceId !== 'airtime') return;
      const network = detectNetwork(text);
      if (network === lastDetected.current) return;
      lastDetected.current = network;
      if (network && providers.some((provider) => provider.code === network)) {
        select(network);
        setDetected(network);
      }
    },
    [serviceId, providers, select],
  );

  /** Call when the user picks a provider themselves. */
  const onManualPick = useCallback(() => setDetected(null), []);

  /** Call when a saved number is filled in, so editing it afterwards detects afresh. */
  const reset = useCallback(() => {
    lastDetected.current = null;
    setDetected(null);
  }, []);

  const detectedName = providers.find((provider) => provider.code === detected)?.name ?? null;
  return { onType, onManualPick, reset, detectedName };
}
