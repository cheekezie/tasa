import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAcceptStudentTerms, useStudentTerms } from '@/hooks/useStudents';
import { errorMessage } from '@/lib/api/errors';
import { StudentTermsDto } from '@/lib/api/types';

/**
 * "Are you a student?": the student profile shows `children` only once they've said yes
 * to the current student terms. Until then, the terms (as the API words them) and the choice.
 */
export function StudentTermsGate({ children }: { children: ReactNode }) {
  const query = useStudentTerms();
  if (query.data?.accepted) return children;
  if (!query.data) {
    return (
      <Screen refreshable>
        <QueryState query={query} hasData={false} skeleton="detail" />
      </Screen>
    );
  }
  // A new version starts unticked: they haven't read it yet.
  return <TermsPrompt key={query.data.version} terms={query.data} />;
}

function TermsPrompt({ terms }: { terms: StudentTermsDto }) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const { show } = useSnackbar();
  const accept = useAcceptStudentTerms();
  const [agreed, setAgreed] = useState(false);

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label={t('studentTerms.no')}
            variant="secondary"
            style={styles.footerButton}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
          <Button
            label={t('studentTerms.yes')}
            disabled={!agreed}
            loading={accept.isPending}
            style={styles.footerButton}
            onPress={() => accept.mutate(terms.version, { onError: (error) => show(errorMessage(error), { tone: 'error' }) })}
          />
        </View>
      }>
      <TasaText variant="title" color={colors.heading}>
        {t('studentTerms.title')}
      </TasaText>
      <TasaText variant="body" color={colors.inkMuted} style={styles.body}>
        {t('studentTerms.body')}
      </TasaText>
      <Card style={styles.terms}>
        {terms.points.map((point) => (
          <View key={point} style={styles.point}>
            <View style={styles.dot} />
            <TasaText variant="caption" style={styles.flex}>
              {point}
            </TasaText>
          </View>
        ))}
      </Card>
      <View style={styles.accept}>
        <Switch value={agreed} onValueChange={setAgreed} accessibilityLabel={t('studentTerms.agree')} />
        <TasaText variant="caption" style={styles.flex}>
          {t('studentTerms.agree')}
        </TasaText>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    body: {
      marginTop: theme.spacing.xs,
    },
    terms: {
      gap: 6,
      marginVertical: theme.spacing.md,
      borderColor: `${colors.brand}33`,
      backgroundColor: `${colors.brand}0D`,
    },
    point: {
      flexDirection: 'row',
      gap: 8,
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      marginTop: 7,
      backgroundColor: colors.brand,
    },
    accept: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    footer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    footerButton: {
      flex: 1,
    },
    flex: {
      flex: 1,
    },
  }),
);
