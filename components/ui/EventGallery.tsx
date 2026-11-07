import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { GalleryItemDto } from '@/lib/api/types';

const THUMB = 112;

/**
 * Photos and videos from an event, usually past ones, in a row. Tapping one opens them full
 * screen to swipe through. `onRemove` adds a remove button to each, for the organiser.
 */
export function EventGallery({ items, onRemove }: { items: GalleryItemDto[]; onRemove?: (item: GalleryItemDto) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return null;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item, index) => (
          <View key={item.id}>
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={t(item.kind === 'video' ? 'tickets.playVideo' : 'tickets.viewPhoto')}
              onPress={() => setOpen(index)}
              style={styles.thumb}>
              {item.kind === 'image' ? (
                <Image source={item.url} contentFit="cover" style={styles.thumbImage} />
              ) : (
                <View style={styles.videoThumb}>
                  <Icon color="#FFFFFF" ios="play.circle.fill" android="play_circle" size={34} />
                </View>
              )}
            </Pressable>
            {onRemove && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('tickets.removeMedia')}
                hitSlop={8}
                onPress={() => onRemove(item)}
                style={styles.remove}>
                <Icon color="#FFFFFF" ios="xmark" android="close" size={12} />
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
      <TasaText variant="caption" color={colors.inkSubtle}>
        {t('tickets.galleryHint')}
      </TasaText>
      <Viewer items={items} start={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Full screen, one at a time, swiped sideways. Videos play with the system controls, which include their own full screen. */
function Viewer({ items, start, onClose }: { items: GalleryItemDto[]; start: number | null; onClose: () => void }) {
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [page, setPage] = useState(0);

  return (
    <Modal visible={start !== null} animationType="fade" onRequestClose={onClose} onShow={() => setPage(start ?? 0)} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.viewer}>
        {start !== null && (
          <FlatList
            horizontal
            pagingEnabled
            data={items}
            keyExtractor={(item) => item.id}
            initialScrollIndex={start}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <View style={{ width, height }}>
                {item.kind === 'image' ? (
                  <Image source={item.url} contentFit="contain" style={styles.full} />
                ) : (
                  <FullVideo url={item.url} active={index === page} />
                )}
              </View>
            )}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={12}
          onPress={onClose}
          style={[styles.close, { top: insets.top + theme.spacing.sm }]}>
          <Icon color="#FFFFFF" ios="xmark" android="close" size={20} />
        </Pressable>
        {items.length > 1 && (
          <View style={[styles.count, { bottom: insets.bottom + theme.spacing.md }]}>
            <TasaText variant="caption" color="rgba(255,255,255,0.8)">
              {page + 1} / {items.length}
            </TasaText>
          </View>
        )}
      </View>
    </Modal>
  );
}

/** Only the video on screen plays; swiping away pauses it. */
function FullVideo({ url, active }: { url: string; active: boolean }) {
  const styles = useStyles();
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} style={styles.full} />;
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      backgroundColor: colors.track,
    },
    thumbImage: {
      width: '100%',
      height: '100%',
    },
    videoThumb: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandDeep,
    },
    remove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    viewer: {
      flex: 1,
      backgroundColor: '#000000',
    },
    full: {
      width: '100%',
      height: '100%',
    },
    close: {
      position: 'absolute',
      right: theme.spacing.md,
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    count: {
      position: 'absolute',
      alignSelf: 'center',
    },
  }),
);
