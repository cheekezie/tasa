import type { NetInfoState } from '@react-native-community/netinfo';

/**
 * False for no connection, and for one that carries no data: Wi-Fi or signal with nothing behind
 * it. `isInternetReachable` is null until checked, and unknown mustn't read as offline.
 */
export const hasInternet = ({ isConnected, isInternetReachable }: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) =>
  isConnected !== false && isInternetReachable !== false;
