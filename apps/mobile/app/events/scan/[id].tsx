import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useScanTicket } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';

type Result = { ok: boolean; title: string; detail: string };

/** Admits a ticket by its QR, or by its code when the camera can't read it. */
export default function ScanScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const scan = useScanTicket(id);
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<Result | null>(null);
  const [code, setCode] = useState('');
  // The camera reports the same code many times a second; one check per ticket shown.
  const busy = useRef(false);

  const check = async (value: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const ticket = await scan.mutateAsync(value.trim());
      setResult({
        ok: true,
        title: t('tickets.admit'),
        detail: `${ticket.holderName} · ${ticket.tierName}`,
      });
      setCode('');
    } catch (error) {
      setResult({ ok: false, title: t('tickets.dontAdmit'), detail: errorMessage(error) });
    }
  };

  const next = () => {
    busy.current = false;
    setResult(null);
  };

  return (
    <Screen>
      {result ? (
        <View style={[styles.result, { backgroundColor: result.ok ? colors.success : colors.danger }]}>
          <TasaText variant="display" color="#FFFFFF" style={styles.centered}>
            {result.title}
          </TasaText>
          <TasaText variant="body" color="#FFFFFF" style={styles.centered}>
            {result.detail}
          </TasaText>
        </View>
      ) : permission?.granted ? (
        <View style={styles.camera}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => check(data)}
          />
        </View>
      ) : (
        <Card style={styles.permission}>
          <TasaText variant="body" color={colors.inkMuted}>
            {t('tickets.cameraNeeded')}
          </TasaText>
          <Button label={t('tickets.allowCamera')} variant="secondary" onPress={requestPermission} />
        </Card>
      )}

      {result ? (
        <Button label={t('tickets.scanNext')} style={styles.action} onPress={next} />
      ) : (
        <>
          <Input
            label={t('tickets.enterCode')}
            autoCapitalize="characters"
            autoCorrect={false}
            last
            value={code}
            onChangeText={setCode}
          />
          <Button
            disabled={code.trim().length < 8}
            label={t('tickets.checkCode')}
            variant="secondary"
            loading={scan.isPending}
            onPress={() => check(code)}
          />
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    camera: {
      height: 320,
      marginBottom: theme.spacing.md,
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
    },
    permission: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    result: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.lg,
    },
    centered: {
      textAlign: 'center',
    },
    action: {
      marginTop: theme.spacing.md,
    },
  }),
);
