import { useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder } from 'react-native';

/** How far down (px) or how fast a drag has to go to close the sheet; anything less springs back. */
const CLOSE_DISTANCE = 100;
const CLOSE_VELOCITY = 0.8;

/**
 * Drag a sheet down to close it. Spread `handlers` on what can be dragged (the whole sheet, or
 * just its handle and title when the rest scrolls) and put `style` on the sheet itself. Off
 * (`enabled` false) while it mustn't close, e.g. a payment in flight.
 */
export function useSheetDrag(visible: boolean, onClose: () => void, enabled = true) {
  const [y] = useState(() => new Animated.Value(0));
  // Back in place each time it opens.
  useEffect(() => {
    if (visible) y.setValue(0);
  }, [visible, y]);

  // Rebuilt when they change; a drag doesn't re-render the sheet, so one can't change mid-drag.
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Only a mostly-downward drag: taps and sideways swipes stay with the content.
        onMoveShouldSetPanResponder: (_, g) => enabled && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) {
            Animated.timing(y, { toValue: 1000, duration: 180, useNativeDriver: true }).start(() => onClose());
          } else {
            Animated.spring(y, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, bounciness: 0, useNativeDriver: true }).start(),
      }),
    [y, onClose, enabled],
  );

  return { handlers: responder.panHandlers, style: { transform: [{ translateY: y }] } };
}
