import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DueFields, dueReady, emptyDue, toDueInput, type DueForm } from '@/components/ui/DueFields';
import { Screen } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { useT } from '@/context/SettingsContext';
import { useAddDue } from '@/hooks/useGroups';
import { errorMessage } from '@/lib/api/errors';

/** A new due for the group: dues that repeat, or a one-off (a levy, a condolence fee) for today's members. */
export default function NewDueScreen() {
  const t = useT();
  const { show } = useSnackbar();
  const { group } = useLocalSearchParams<{ group: string }>();
  const add = useAddDue(group);
  const [due, setDue] = useState<DueForm>(() => ({ ...emptyDue(), kind: 'one_off' }));

  return (
    <Screen
      footer={
        <Button
          disabled={!dueReady(due)}
          label={t('groups.addDue')}
          loading={add.isPending}
          onPress={() =>
            add.mutate(toDueInput(due), {
              onSuccess: () => {
                show(t('groups.dueAdded', { name: due.name.trim() }));
                router.back();
              },
              onError: (error) => show(errorMessage(error), { tone: 'error' }),
            })
          }
        />
      }>
      <DueFields value={due} onChange={(changes) => setDue((current) => ({ ...current, ...changes }))} />
    </Screen>
  );
}
