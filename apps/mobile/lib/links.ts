/** The website; invite links on it open Tasa when it's installed (see app.config.ts). */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://tasa.ng').replace(/\/$/, '');

/** A group invite to share: opens Tasa on the join screen, or the website (with the store links) without it. */
export const groupInviteLink = (code: string) => `${SITE_URL}/g/${encodeURIComponent(code)}`;
