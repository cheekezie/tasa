import { Children, ReactNode, isValidElement, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';

import { theme } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

const GAP = 12;
// How much of the next card shows, so it's obvious there's more to swipe to.
const PEEK = 28;

/**
 * Cards side by side, swiped one at a time, with dots underneath. A single card renders as is.
 * Children should take `flex: 1` so cards of different content end up the same height.
 */
export function CardCarousel({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const cards = Children.toArray(children).filter(isValidElement);

  if (cards.length < 2) return <>{cards}</>;

  const cardWidth = width - PEEK;
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + GAP));
    if (next !== index) setIndex(Math.max(0, Math.min(cards.length - 1, next)));
  };

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + GAP}
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEventThrottle={16}
          onScroll={onScroll}
          // Reach the screen edges so the peeking card isn't cut off by the page margin.
          style={styles.bleed}
          contentContainerStyle={styles.track}>
          {cards.map((card, position) => (
            <View
              key={card.key ?? position}
              accessibilityElementsHidden={position !== index}
              importantForAccessibility={position === index ? 'auto' : 'no-hide-descendants'}
              style={{ width: cardWidth }}>
              {card}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.dots}>
        {cards.map((card, position) => (
          <View key={card.key ?? position} style={[styles.dot, position === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    bleed: {
      marginHorizontal: -theme.spacing.screen,
    },
    track: {
      gap: GAP,
      paddingHorizontal: theme.spacing.screen,
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: theme.spacing.sm,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.border,
    },
    dotActive: {
      width: 18,
      backgroundColor: colors.brand,
    },
  }),
);
