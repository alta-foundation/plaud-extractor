import { z } from 'zod'

export const CookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  expires: z.number().optional(),
})

export const EndpointMapSchema = z.object({
  listRecordings: z.string().optional(),   // GET /file/simple/web
  batchDetail: z.string().optional(),       // POST /file/list
  getAudioUrl: z.string().optional(),       // GET /file/temp-url/<id>
  userProfile: z.string().optional(),       // GET /user/me
  apiBaseUrl: z.string().optional(),
  /** @deprecated — transcript is embedded in the recording, not a separate endpoint */
  getTranscript: z.string().optional(),
})

export type EndpointMap = z.infer<typeof EndpointMapSchema>

export const AuthSessionSchema = z.object({
  cookies: z.array(CookieSchema),
  authToken: z.string().optional(),
  apiBaseUrl: z.string(),
  capturedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  endpointMap: EndpointMapSchema.optional(),
})

export type AuthSession = z.infer<typeof AuthSessionSchema>

export const StoredCredentialsSchema = AuthSessionSchema.extend({
  schemaVersion: z.literal(1),
})

export type StoredCredentials = z.infer<typeof StoredCredentialsSchema>
