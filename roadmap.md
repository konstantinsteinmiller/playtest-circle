# Roadmap

Play Testing Circle is open source and free. These are the next steps, roughly in order of value.

## Credits & money

- **Buy Credits** (Stripe or PayPal Checkout) to fund playtests. Purchased Credits flow to the testers who do the work.
- **PayPal payout** for testers who accumulate many Credits without spending them (threshold, KYC and tax notes, own terms).

## Platform

- Custom domain + a verified sending domain for email (switch `MAIL_DRIVER` to `resend`).
- More languages (German first) — every string already goes through `src/i18n/en.json`.
- Team / studio accounts sharing one wallet and one studio.
- Downloadable-build and Steam-key campaigns (desktop/window capture instead of tab capture).
- Per-campaign NDA toggle.
- Dispute flow, if fully automatic payouts get abused.

## Insights

- Heatmap of "Mark moment" timestamps across all testers of a campaign.
- Clip export of a marked moment.
- Public tester leaderboard.

## Reliability

- IndexedDB crash-resume for recordings (today a crashed tab loses the parts not yet uploaded).
