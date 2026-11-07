import { ComponentRef, forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { TasaText } from '@/components/ui/Screen';
import { palettes, theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';
import { Ticket } from '@/lib/api/mappers';
import { formatDateTime, formatNaira } from '@/lib/format';

// A printed thing: the same in light and dark, because this is also what gets saved and scanned.
const brand = palettes.light;
const INK = '#14201C';
const MUTED = '#66736E';
const NOTCH = 22;

type TicketPassProps = {
  ticket: Ticket;
  /** "Ticket 1 of 2" when bought together. */
  position?: string;
};

/** One ticket, drawn as a ticket. `ref` is what gets captured to save it as an image. */
export const TicketPass = forwardRef<ComponentRef<typeof View>, TicketPassProps>(function TicketPass({ ticket, position }, ref) {
  const { colors } = useTheme();
  const t = useT();
  const usable = ticket.status === 'valid';
  const cutout = { backgroundColor: colors.surface };

  return (
    <View ref={ref} collapsable={false} style={styles.pass}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TasaText variant="caption" color="rgba(255,255,255,0.75)">
            {t('tickets.passLabel')}
          </TasaText>
          {!!position && (
            <TasaText variant="caption" color="rgba(255,255,255,0.75)">
              {position}
            </TasaText>
          )}
        </View>
        <TasaText variant="title" color="#FFFFFF" numberOfLines={2}>
          {ticket.eventTitle}
        </TasaText>
        {!!ticket.startsAt && (
          <TasaText variant="bodyMedium" color="#FFFFFF">
            {formatDateTime(ticket.startsAt)}
          </TasaText>
        )}
        {!!ticket.venue && (
          <TasaText variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={2}>
            {ticket.venue}
          </TasaText>
        )}
        {!!ticket.organiser && (
          <TasaText variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
            {t('tickets.byOrganiser', { name: ticket.organiser })}
          </TasaText>
        )}
      </View>

      <View style={styles.tear}>
        <View style={[styles.notch, styles.notchLeft, cutout]} />
        <View style={styles.dashes} />
        <View style={[styles.notch, styles.notchRight, cutout]} />
      </View>

      <View style={styles.body}>
        {usable ? (
          <QRCode value={ticket.code} size={196} color={INK} backgroundColor="#FFFFFF" />
        ) : (
          <TasaText variant="title" color={MUTED} style={styles.status}>
            {t(`tickets.status.${ticket.status}`)}
          </TasaText>
        )}
        <TasaText variant="caption" color={MUTED}>
          {ticket.code}
        </TasaText>

        <View style={styles.holder}>
          <TasaText variant="caption" color={MUTED}>
            {t('tickets.passHolder')}
          </TasaText>
          <TasaText variant="subtitle" color={INK} numberOfLines={1}>
            {ticket.holderName}
          </TasaText>
        </View>

        <View style={styles.details}>
          <View style={styles.detail}>
            <TasaText variant="caption" color={MUTED}>
              {t('tickets.passType')}
            </TasaText>
            <TasaText variant="bodyMedium" color={INK} numberOfLines={1}>
              {ticket.tierName}
            </TasaText>
          </View>
          <View style={[styles.detail, styles.detailEnd]}>
            <TasaText variant="caption" color={MUTED}>
              {t('tickets.price')}
            </TasaText>
            <TasaText variant="bodyMedium" color={INK}>
              {formatNaira(ticket.price)}
            </TasaText>
          </View>
        </View>
        {!!ticket.covers && (
          <TasaText variant="caption" color={MUTED} style={styles.covers}>
            {t('tickets.includes', { what: ticket.covers })}
          </TasaText>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  pass: {
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  header: {
    gap: 4,
    padding: theme.spacing.lg,
    backgroundColor: brand.brand,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  tear: {
    height: NOTCH,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  notch: {
    position: 'absolute',
    width: NOTCH,
    height: NOTCH,
    borderRadius: NOTCH / 2,
  },
  notchLeft: {
    left: -NOTCH / 2,
  },
  notchRight: {
    right: -NOTCH / 2,
  },
  dashes: {
    marginHorizontal: NOTCH,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D5DAD8',
  },
  body: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  status: {
    paddingVertical: theme.spacing.xl,
  },
  holder: {
    alignSelf: 'stretch',
    gap: 2,
    marginTop: theme.spacing.xs,
  },
  details: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    alignSelf: 'stretch',
  },
  detail: {
    flex: 1,
    gap: 2,
  },
  detailEnd: {
    alignItems: 'flex-end',
  },
  covers: {
    alignSelf: 'stretch',
  },
});
