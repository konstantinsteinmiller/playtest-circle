# Roadmap

Playtest Circle is open source and free. These are the next steps, roughly in order of value.

## Credits & money

- **Buy Credits** (Stripe or PayPal Checkout) to fund playtests. Purchased Credits flow to the testers who do the work.
- **PayPal payout** for testers who accumulate many Credits without spending them (threshold, KYC and tax notes, own terms).

## Platform

- Custom domain + a verified sending domain for email (switch `MAIL_DRIVER` to `resend`).
- More languages (German first) — every string already goes through `src/i18n/en.json`.
- Team / studio accounts sharing one wallet and one studio.
- Downloadable-build campaigns (Steam games already work with window capture).
- Per-campaign NDA toggle.
- Dispute flow, if fully automatic payouts get abused.

## Insights

- Heatmap of "Mark moment" timestamps across all testers of a campaign.
- Clip export of a marked moment.
- Public tester leaderboard.

## Reliability

- IndexedDB crash-resume for recordings (today a crashed tab loses the parts not yet uploaded).


- [x] #1 we need a quick onboard video with pictograms explaining the usage of the playtest circle platform.
- [x] #2 make starting to browse playtests and starting playtests possible without an account. 
Only playtest submissions with a game needs a google SSO login. Allow commenting a game on the platform. the playtesters can also browse games without an active playtest and play the games with or without a playtest screnario/recording.
The first-time user should be able to browse games and test them freely, also check credited playtests and participate freely. Later he can use his locally saved account to create studio by signing in with Google SSO.
- [x] #3 Playtester can quit early with up to 1 minute before the minimum play time if he enters at least a 60 characters answer(how the minimum 60 chars) in the why he quit early textfield.