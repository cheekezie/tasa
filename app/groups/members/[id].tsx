import { useLocalSearchParams } from 'expo-router';

import { GroupMembersList } from '@/components/ui/GroupMembersList';
import { Screen } from '@/components/ui/Screen';
import { useGroup } from '@/hooks/useGroups';

/** Everyone in the group, for executives (also the Members tab on the group). */
export default function GroupMembersScreen() {
  const { id, filter } = useLocalSearchParams<{ id: string; filter?: 'owing' | 'pending' }>();
  const group = useGroup(id).data;
  return (
    <Screen refreshable>
      <GroupMembersList groupId={id} pending={group?.members.pending ?? 0} initialFilter={filter ?? 'all'} />
    </Screen>
  );
}
