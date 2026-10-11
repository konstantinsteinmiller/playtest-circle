export interface Env {
  DB: D1Database
  LOCAL_BUCKET: R2Bucket
  ASSETS: Fetcher
  APP_URL: string
  STORAGE_DRIVER: 'local' | 'b2'
  DEV_LOGIN: string
  ADMIN_EMAILS: string
  GITHUB_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  B2_ENDPOINT: string
  B2_BUCKET: string
  B2_REGION: string
  B2_KEY_ID: string
  B2_APP_KEY: string
  /** Password for the admin panel (HTTP Basic Auth, any user name). Admin is disabled while unset. */
  BASIC_AUTH_PASSWORD?: string
  MAIL_DRIVER?: 'gmail' | 'resend' | 'none'
  SMTP_USER?: string
  SMTP_PASS?: string
  MAIL_FROM_NAME?: string
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  /** Test-only: shrink campaign minimum playtime to seconds. Never set in production. */
  TEST_MINUTE_MS?: string
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
  credits: number
  banned: boolean
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } }
