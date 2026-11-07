import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useT } from '@/context/SettingsContext';
import { Channel } from '@/lib/api/services/auth';
import { accountRule } from '@/lib/validation';

type ContactFieldProps = {
  channel: Channel;
  onChannelChange: (channel: Channel) => void;
  value: string;
  onChangeText: (text: string) => void;
  error?: string | null;
  hint?: string;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
};

/** Phone | Email switch with a field that uses the right keyboard and autofill for each. */
export function ContactField({ channel, onChannelChange, ...field }: ContactFieldProps) {
  const t = useT();
  const phone = channel === 'phone';
  return (
    <>
      <SegmentedControl
        options={[
          { value: 'phone', label: t('auth.usePhone') },
          { value: 'email', label: t('auth.useEmail') },
        ]}
        value={channel}
        onChange={onChannelChange}
      />
      <Input
        // Remount on switch so the keyboard type changes straight away.
        key={channel}
        label={t(phone ? 'signIn.phone' : 'signIn.email')}
        keyboardType={phone ? accountRule('airtime').keyboardType : 'email-address'}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={phone ? 'tel' : 'email'}
        textContentType={phone ? 'telephoneNumber' : 'emailAddress'}
        placeholder={phone ? accountRule('airtime').placeholder : t('signUp.emailPlaceholder')}
        last
        {...field}
      />
    </>
  );
}
