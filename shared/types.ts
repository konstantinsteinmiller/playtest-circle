import type { CampaignQuestion } from './questions'
import type { DeviceTarget, PayoutReason, PlaytimePresetId } from './rules'

export type Role = 'user' | 'admin'
export type CampaignStatus = 'draft' | 'live' | 'paused' | 'completed' | 'cancelled'
export type PlaytestStatus = 'reserved' | 'recording' | 'submitted' | 'paid' | 'no_payout' | 'expired'
export type GameHost = 'itch' | 'steam' | 'wavedash' | 'crazygames' | 'newgrounds' | 'own' | 'other'

export interface Me {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  role: Role
  /** Signed in without Google: tests and comments, but can't post games until linked. */
  guest: boolean
  credits: number
  /** Credits held in escrow for this user's live and paused campaigns (paid out per finished test). */
  reserved: number
  repUp: number
  repDown: number
  discordWebhook: string | null
  emailOptIn: boolean
  /** Email about new campaigns to test (at most daily, re-armed by visiting the app). */
  campaignAlerts: boolean
  onboarded: boolean
  recordingBytes: number
  /** Cheat Credits removed after the testing period, not yet acknowledged. */
  cheatRemoved: number
  /** Admin warnings the user hasn't acknowledged yet. */
  warnings: { id: string; reason: string; createdAt: number }[]
}

export interface PublicUser {
  id: string
  name: string
  avatarUrl: string | null
  repUp: number
  repDown: number
}

export interface Game {
  id: string
  ownerId: string
  title: string
  pitch: string
  description: string
  tags: string[]
  playUrl: string
  host: GameHost
  accessNotes: string
  trailerUrl: string | null
  coverUrl: string | null
  hoverClipUrl: string | null
  screenshots: string[]
  createdAt: number
}

export interface GameInput {
  title: string
  pitch: string
  description: string
  tags: string[]
  playUrl: string
  host: GameHost
  accessNotes: string
  trailerUrl: string | null
  coverKey: string | null
  hoverClipKey: string | null
  screenshotKeys: string[]
}

export interface CampaignInput {
  gameId: string
  buildLabel: string
  buildUrl: string | null
  instructions: string
  playtimePreset: PlaytimePresetId
  devices: DeviceTarget
  slots: number
  price: number
  minReputation: number
  catalogIds: string[]
  custom: { text: string; type: CampaignQuestion['type']; allowNa: boolean }[]
}

export interface CampaignCard {
  id: string
  status: CampaignStatus
  buildLabel: string
  price: number
  playtimePreset: PlaytimePresetId
  devices: DeviceTarget
  minMinutes: number
  slotsTotal: number
  slotsLeft: number
  publishedAt: number | null
  game: Pick<Game, 'id' | 'title' | 'pitch' | 'tags' | 'host' | 'coverUrl' | 'hoverClipUrl'>
  owner: PublicUser
  /** A replay is private to the one tester the studio sent it to. */
  replayFor: { id: string; name: string } | null
}

export interface CampaignDetail extends CampaignCard {
  instructions: string
  buildUrl: string
  minReputation: number
  questions: CampaignQuestion[]
  game: Game
  escrow: number
  /** The playtest this replay follows up (only shown to its studio). */
  replayOf: string | null
  myPlaytestId: string | null
  myPlaytestStatus: PlaytestStatus | null
  /** Credits the viewer was paid for their playtest of this campaign (0 until paid). */
  myCreditsAwarded: number
}

export interface PlaytestRow {
  id: string
  campaignId: string
  status: PlaytestStatus
  tester: PublicUser
  activeMs: number | null
  answered: number
  required: number
  totalQuestions: number
  creditsAwarded: number
  payoutReason: PayoutReason | null
  submittedAt: number | null
  recordingExpiresAt: number | null
  recordingDeleted: boolean
  recordingBytes: number
  devRating: -1 | 1 | null
  usedMic: boolean
}

export interface Note {
  id: string
  offsetMs: number
  text: string
}

export interface AnswerRow {
  questionId: string
  value: number | null
  na: boolean
  text: string
}

export interface PlaytestDetail extends PlaytestRow {
  campaign: CampaignDetail
  answers: AnswerRow[]
  notes: Note[]
  recordingUrl: string | null
  recordingMime: string | null
  devRatingNote: string
  startedAt: number | null
  reservedUntil: number | null
}

export interface LedgerRow {
  id: string
  delta: number
  reason: string
  refType: string | null
  refId: string | null
  createdAt: number
}

export interface NotificationRow {
  id: string
  type: string
  payload: Record<string, unknown>
  readAt: number | null
  createdAt: number
}

/** A game in the public catalog, with or without an open paid playtest. */
export interface GameCard {
  id: string
  title: string
  pitch: string
  tags: string[]
  host: GameHost
  coverUrl: string | null
  hoverClipUrl: string | null
  owner: Pick<PublicUser, 'id' | 'name'>
  /** Live campaigns with free slots: paid playtests the viewer could start. */
  openPlaytests: number
  /** Best reward among those campaigns, 0 when there is none. */
  topPrice: number
  comments: number
  /** The viewer hearted this game; always false when signed out. */
  favorite: boolean
}

export interface GameComment {
  id: string
  text: string
  createdAt: number
  author: Pick<PublicUser, 'id' | 'name' | 'avatarUrl'> & { guest: boolean }
  /** The viewer may delete it: author, game owner or admin. */
  canDelete: boolean
}

export interface GamePage {
  game: Game
  owner: PublicUser
  campaigns: CampaignCard[]
  comments: GameComment[]
}
