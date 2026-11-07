import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { GroupJoinPreview, useJoinForm } from '@/components/ui/GroupJoinPreview';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { useT } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import { useGroupPreview, useJoinGroup } from '@/hooks/useGroups';
import { rememberLink } from '@/lib/pendingLink';
import { errorMessage } from '@/lib/api/errors';

/**
 * Joining with an invite code: the group's terms first, above all where the money goes, then a
 * the dues they'll pay and whatever the group asks for. Nothing is paid here; dues are paid from the group page.
 */
/**
 * An invite link (`https://<site>/g/CODE`, routed here by app/g/[code], or `tasa://groups/join?code=…`)
 * can open before they're signed in: it waits for the session.
 */
export default function JoinGroupScreen() {
  const { isSignedIn } = useApp();
  const params = useLocalSearchParams<{ code?: string }>();
  if (!isSignedIn) {
    rememberLink({ pathname: '/groups/join', params: params.code ? { code: params.code } : {} });
    return <Redirect href="/sign-in" />;
  }
  return <JoinGroup initialCode={params.code ?? ''} />;
}

function JoinGroup({ initialCode }: { initialCode: string }) {
  const t = useT();
  const { show } = useSnackbar();
  const [code, setCode] = useState(initialCode);
  const preview = useGroupPreview(code);
  const join = useJoinGroup();
  const group = preview.data;
  const form = useJoinForm(group);

  const submit = () =>
    join.mutate(
      { code: code.trim().toUpperCase(), fields: form.answers, acceptTerms: group!.terms.version },
      {
        onSuccess: (joined) => {
          show(t(joined.membership?.status === 'pending' ? 'groups.joinRequested' : 'groups.joined', { name: joined.name }));
          router.replace({ pathname: '/groups/[id]', params: { id: joined.id } });
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );

  return (
    <Screen
      footer={
        group ? (
          <Button
            disabled={!form.ready}
            label={t(group.requireApproval ? 'groups.askToJoin' : 'groups.joinGroup')}
            loading={join.isPending}
            onPress={submit}
          />
        ) : undefined
      }>
      <Input
        label={t('groups.inviteCode')}
        hint={t('groups.inviteCodeHint')}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
        error={preview.isError ? errorMessage(preview.error) : null}
        value={code}
        onChangeText={(next) => {
          setCode(next);
          form.setAccepted(false);
        }}
      />

      {group && <GroupJoinPreview group={group} form={form} />}
    </Screen>
  );
}
