import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApp } from '@/context/AppContext';
import { accountService } from '@/lib/api/services/account';
import { BankAccountInput, OptInInput, OrganiserProfileInput, SellerIdType } from '@/lib/api/types';
import { eventsService, organisersService, sellerService, ticketsService } from '@/lib/api/services/tickets';
import { Kobo } from '@/lib/money';
import { invalidateBalances, queryKeys } from '@/lib/queryClient';

export function useEvents(search: string) {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.events(search),
    queryFn: () => eventsService.list(search),
    enabled: isSignedIn,
  });
}

export function useEvent(id: string) {
  return useQuery({ queryKey: queryKeys.event(id), queryFn: () => eventsService.get(id) });
}

export function useMyEvents() {
  return useQuery({ queryKey: queryKeys.myEvents, queryFn: eventsService.mine });
}

export function useManagedEvent(id: string) {
  return useQuery({ queryKey: queryKeys.manageEvent(id), queryFn: () => eventsService.manage(id) });
}

export function useOrganiser(id: string) {
  return useQuery({ queryKey: ['events', 'organiser', id], queryFn: () => organisersService.get(id) });
}

export function useEventSales(id: string) {
  return useQuery({ queryKey: ['events', 'sales', id], queryFn: () => eventsService.sales(id) });
}

export function useEventGallery(id: string) {
  const refresh = useRefreshEvents();
  const add = useMutation({
    mutationFn: (uri: string) => eventsService.addMedia(id, uri),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (mediaId: string) => eventsService.removeMedia(id, mediaId), onSuccess: refresh });
  return { add, remove };
}

export function useMyTickets() {
  const { isSignedIn } = useApp();
  return useQuery({ queryKey: queryKeys.tickets, queryFn: ticketsService.list, enabled: isSignedIn });
}

export function useTicket(id: string) {
  return useQuery({ queryKey: queryKeys.ticket(id), queryFn: () => ticketsService.get(id) });
}

export function useSeller() {
  return useQuery({ queryKey: queryKeys.seller, queryFn: sellerService.get });
}

/** Everything an organiser's change can move: their dashboards and what buyers see. */
function useRefreshEvents() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['events'] });
}

export function useCreateEvent() {
  const refresh = useRefreshEvents();
  return useMutation({ mutationFn: eventsService.create, onSuccess: refresh });
}

export function useUpdateEvent(id: string) {
  const refresh = useRefreshEvents();
  return useMutation({
    mutationFn: (changes: Parameters<typeof eventsService.update>[1]) => eventsService.update(id, changes),
    onSuccess: refresh,
  });
}

export function useEventImage(id: string) {
  const refresh = useRefreshEvents();
  return useMutation({ mutationFn: (uri: string) => eventsService.setImage(id, uri), onSuccess: refresh });
}

export function useEventStaff(id: string) {
  const refresh = useRefreshEvents();
  const add = useMutation({
    mutationFn: (username: string) => eventsService.addStaff(id, username),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => eventsService.removeStaff(id, userId),
    onSuccess: refresh,
  });
  return { add, remove };
}

export function useScanTicket(id: string) {
  const refresh = useRefreshEvents();
  return useMutation({ mutationFn: (code: string) => eventsService.scan(id, code), onSettled: refresh });
}

export function useRefundTicket(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => ticketsService.refund(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.tickets });
      client.invalidateQueries({ queryKey: ['events'] });
      invalidateBalances();
    },
  });
}

export function useRateEvent(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (stars: number) => eventsService.rate(eventId, stars),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.tickets });
      client.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

/**
 * Opting in needs an ID on file, so this saves the one they typed first. The logo goes up
 * once they're a seller; if only that fails, they're still in and can add it from the dashboard.
 */
export function useBecomeSeller() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
      logo,
      verification,
    }: {
      id: { type: 'bvn' | 'nin'; value: string } | null;
      input: OptInInput;
      logo: string | null;
      verification: VerificationInput;
    }) => {
      if (id?.type === 'bvn') await accountService.setBvn(id.value);
      if (id?.type === 'nin') await sellerService.setNin(id.value);
      const seller = await sellerService.optIn(input);
      // They're a seller from here: if an upload fails, the dashboard asks for it again.
      const verificationFailed = await sellerService
        .submitVerification(verification.idType, verification.photo, verification.id)
        .then(() => false)
        .catch(() => true);
      const logoFailed = logo ? await sellerService.setLogo(logo).then(() => false).catch(() => true) : false;
      return { seller, logoFailed, verificationFailed };
    },
    // Settled, not success: if the ID saved but opting in failed, the retry mustn't resend it.
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.seller });
      client.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export type VerificationInput = { idType: SellerIdType; photo: string; id: string };

/** Sends (or re-sends, after a rejection) the photo and ID for review. */
export function useSubmitVerification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ idType, photo, id }: VerificationInput) => sellerService.submitVerification(idType, photo, id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.seller }),
  });
}

/** A rename or logo shows on every event and ticket at once. */
export function useUpdateSeller() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: OrganiserProfileInput & { acceptTerms?: string; logo?: string }) =>
      changes.logo ? sellerService.setLogo(changes.logo) : sellerService.update(changes),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.seller });
      client.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function useBanks() {
  return useQuery({ queryKey: queryKeys.banks, queryFn: sellerService.getBanks, staleTime: 86_400_000 });
}

/** Looks the account up as soon as there's a bank and a full number. A 4xx answers for good. */
export function useVerifiedBankAccount(bankCode: string | null, accountNumber: string) {
  return useQuery({
    queryKey: queryKeys.bankAccount(bankCode ?? '', accountNumber),
    queryFn: () => sellerService.verifyBankAccount({ bankCode: bankCode!, accountNumber }),
    enabled: !!bankCode && accountNumber.length === 10,
    retry: false,
  });
}

export function useSaveBankAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (account: BankAccountInput) => sellerService.setBankAccount(account),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.seller }),
  });
}

/** To the bank: priced first, then confirmed with the PIN. */
export function useTicketPayout() {
  const client = useQueryClient();
  const quote = useMutation({ mutationFn: sellerService.quotePayout });
  const pay = useMutation({
    mutationFn: ({ quoteId, pin }: { quoteId: string; pin: string }) => sellerService.payout(quoteId, pin),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.seller }),
  });
  return { quote, pay };
}

export function useWithdrawTicketSales() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ amount, pin, key }: { amount: Kobo; pin: string; key: string }) =>
      sellerService.withdraw(amount, pin, key),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.seller });
      invalidateBalances();
    },
  });
}
