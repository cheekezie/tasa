import { ErrorView } from '@/components/ui/StatusView';
import { useT } from '@/context/SettingsContext';
import { CheckoutFailure } from '@/hooks/useCheckout';
import { formatNaira } from '@/lib/format';

type CheckoutFailureViewProps = {
  failure: CheckoutFailure;
  /** Resends the same quote, which the API can't charge twice. */
  onRetry: () => void;
  onEdit: () => void;
};

/** What every payment screen shows when a checkout doesn't end in success. */
export function CheckoutFailureView({ failure, onRetry, onEdit }: CheckoutFailureViewProps) {
  const t = useT();

  if (failure.status === 'unknown') {
    return (
      <ErrorView
        title={t('checkout.unknownTitle')}
        message={t('checkout.unknownBody')}
        primaryAction={{ label: t('checkout.checkAgain'), onPress: onRetry }}
        secondaryAction={{ label: t('fundTransfer.viewActivity'), href: '/(tabs)/activity' }}
      />
    );
  }
  if (failure.status === 'insufficient') {
    return (
      <ErrorView
        title={t('transfer.insufficientTitle')}
        message={t('transfer.insufficientBody', { shortfall: formatNaira(failure.shortfall) })}
        primaryAction={{ label: t('nav.fundWallet'), href: '/wallet/fund' }}
        secondaryAction={{ label: t('common.editDetails'), onPress: onEdit }}
      />
    );
  }
  return (
    <ErrorView
      title={t('review.failedTitle')}
      message={failure.reason}
      primaryAction={{ label: t('common.editDetails'), onPress: onEdit }}
      secondaryAction={{ label: t('common.backToHome'), href: '/' }}
    />
  );
}
