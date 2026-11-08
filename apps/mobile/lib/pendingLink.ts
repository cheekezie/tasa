import type { Href } from 'expo-router';

/**
 * A link opened before signing in (a group invite), kept until there's a session to open it in.
 * In memory only: an invite is worth following now, not after the app restarts.
 */
let pending: Href | null = null;

export const rememberLink = (href: Href) => {
  pending = href;
};

/** The remembered link, once: opening it clears it. */
export const takeLink = () => {
  const href = pending;
  pending = null;
  return href;
};
