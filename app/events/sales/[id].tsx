import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Button';
import { PurchaseRow, TierProgress } from '@/components/ui/EventSales';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles } from '@/context/ThemeContext';
import { useEventSales } from '@/hooks/useTickets';

/**
 * Every purchase for one of their events, on its own page so a busy event doesn't stretch the
 * manage screen. A list that renders as it scrolls, with a search by buyer or ticket type.
 */
export default function EventSalesScreen() {
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sales = useEventSales(id);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const purchases = (sales.data?.purchases ?? []).filter(
    (row) => !needle || row.buyer.toLowerCase().includes(needle) || row.tierName.toLowerCase().includes(needle),
  );

  return (
    <Screen scroll={false}>
      <QueryState query={sales} hasData={!!sales.data} skeleton="list" />
      {sales.data && (
        <FlatList
          data={purchases}
          keyExtractor={(row) => row.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            <View style={styles.header}>
              {sales.data.byTier.length > 0 && (
                <Card>
                  <TierProgress tiers={sales.data.byTier} />
                </Card>
              )}
              <Input
                label={t('tickets.searchPurchases')}
                autoCorrect={false}
                autoCapitalize="none"
                last
                value={search}
                onChangeText={setSearch}
              />
            </View>
          }
          ListEmptyComponent={<EmptyState message={t(needle ? 'tickets.noPurchaseMatches' : 'tickets.noPurchases')} />}
          renderItem={({ item }) => <PurchaseRow row={item} />}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    list: {
      paddingBottom: theme.spacing.xl,
    },
    header: {
      gap: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginVertical: theme.spacing.sm,
      backgroundColor: colors.border,
    },
  }),
);
