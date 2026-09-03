/**
 * Zod schemas for everything crossing the network boundary.
 *
 * Postgres and its policies are the authority on *who may see what*; these
 * schemas are the authority on *what shape arrived*. A row that fails to parse
 * is dropped rather than rendered — a malformed realtime payload should cost
 * one footprint, not the whole map.
 */
import { z } from 'zod';

export const visibilityModeSchema = z.enum(['ghost', 'friends', 'public']);
export type VisibilityMode = z.infer<typeof visibilityModeSchema>;

export const friendStatusSchema = z.enum(['pending', 'accepted']);
export type FriendStatus = z.infer<typeof friendStatusSchema>;

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'Handles are 3–20 characters: lower-case letters, digits, underscore.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'A name needs at least two characters.')
  .max(32, 'A name may not run past 32 characters.');

export const profileSchema = z.object({
  id: z.string().uuid(),
  display_name: displayNameSchema,
  handle: handleSchema,
  faculty: z.string().max(64).nullable().default(null),
  sound_enabled: z.boolean().default(false),
  created_at: z.string().nullable().default(null),
});
export type Profile = z.infer<typeof profileSchema>;

export const livePresenceSchema = z.object({
  user_id: z.string().uuid(),
  zone_id: z.string().max(48).nullable(),
  visibility: visibilityModeSchema,
  updated_at: z.string(),
  expires_at: z.string(),
});
export type LivePresence = z.infer<typeof livePresenceSchema>;

export const liveFixSchema = z.object({
  user_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nullable().default(null),
  bearing: z.number().nullable().default(null),
  updated_at: z.string(),
  expires_at: z.string(),
});
export type LiveFix = z.infer<typeof liveFixSchema>;

export const friendshipSchema = z.object({
  requester_id: z.string().uuid(),
  addressee_id: z.string().uuid(),
  status: friendStatusSchema,
  created_at: z.string().nullable().default(null),
});
export type Friendship = z.infer<typeof friendshipSchema>;

export const blockSchema = z.object({
  blocker_id: z.string().uuid(),
  blocked_id: z.string().uuid(),
  created_at: z.string().nullable().default(null),
});
export type Block = z.infer<typeof blockSchema>;

/** Parse a row, returning null instead of throwing, so one bad row is survivable. */
export function safeRow<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (import.meta.env.DEV) {
    console.warn(`Discarded a malformed ${what} row:`, parsed.error.issues);
  }
  return null;
}
