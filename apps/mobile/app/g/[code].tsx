import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * An invite link from the website (`https://<site>/g/CODE`), opened by iOS or Android straight in
 * Tasa: it's the join screen, with the code filled in.
 */
export default function InviteLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/groups/join', params: { code: code ?? '' } }} />;
}
