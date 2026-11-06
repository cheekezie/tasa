import type { UserProfile } from "@/features/users/api";

/** The best name we have for someone: legal name, then @username, then phone or email. */
export const userName = (u: Pick<UserProfile, "fullName" | "username" | "phone" | "email">) =>
  u.fullName ?? (u.username ? `@${u.username}` : (u.phone ?? u.email ?? "Unnamed user"));
