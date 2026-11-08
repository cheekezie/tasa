import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How tall the keyboard is right now (0 when hidden). For sheets in a Modal, which sit outside
 * the screen's keyboard handling: they lift by this much and shrink to the space left above it.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
