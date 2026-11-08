import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useApp } from '@/context/AppContext';
import { UserProfile } from '@/lib/api/mappers';
import { accountService, walletService } from '@/lib/api/services/account';
import { kobo } from '@/lib/money';
import { queryKeys } from '@/lib/queryClient';

const emptyProfile: UserProfile = {
  fullName: '',
  username: '',
  phone: '',
  email: '',
  bvnLast4: null,
  bvnStatus: null,
  bvnRejectionReason: null,
  hasPin: false,
  billPinEnabled: true,
  avatarUri: null,
};

/** The signed-in user. Falls back to what the device remembers until `GET /me` answers. */
export function useAccount() {
  const { isSignedIn, rememberedAccount } = useApp();
  const query = useQuery({
    queryKey: queryKeys.me,
    queryFn: accountService.getMe,
    enabled: isSignedIn,
  });
  const account = query.data;
  return {
    profile: { ...emptyProfile, ...rememberedAccount, ...account?.profile },
    walletBalance: account?.walletBalance ?? kobo(0),
    /** False until the balance is real, so nobody is told they're short from a loading 0. */
    balanceKnown: !!account,
    payday: account?.payday ?? null,
    giftsUnseen: account?.giftsUnseen ?? 0,
    giftsBalance: account?.giftsBalance ?? kobo(0),
    query,
  };
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: accountService.updateMe,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useWallet() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.wallet,
    queryFn: walletService.getWallet,
    enabled: isSignedIn,
  });
}

/**
 * The user's permanent account number. Issued the first time it's needed, so it's simply there;
 * the API returns the same number every time, and a failure leaves `retry` for a manual try.
 */
export function useWalletAccount() {
  const wallet = useWallet();
  const { mutate: issue, isPending, isError } = useIssueWalletAccount();
  const asked = useRef(false);
  const missing = !!wallet.data && !wallet.data.account;

  useEffect(() => {
    if (!missing || asked.current) return;
    asked.current = true;
    issue();
  }, [missing, issue]);

  return { account: wallet.data?.account ?? null, issuing: isPending, failed: isError, retry: () => issue() };
}

export function useIssueWalletAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => walletService.issueAccount(),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.wallet }),
  });
}

export function useSetBillPin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ enabled, pin }: { enabled: boolean; pin: string }) =>
      accountService.setBillPin(enabled, pin),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useUploadAvatar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: accountService.uploadAvatar,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useRemoveAvatar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: accountService.removeAvatar,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.me }),
  });
}
