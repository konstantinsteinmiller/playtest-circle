# Brand — Playtest Circle

**Name:** Playtest Circle
**Tagline:** *Quid pro quo playtesting*
**One-liner:** Game devs test each other's games — record the session, answer real questions, earn Credits, spend them on your own game.

## Voice

Dev-to-dev, direct, generous. Short sentences. No hype, no growth-hacking words. We say "Credits" (capitalised), "playtest", "campaign", "tester", "dev".

- ✅ "Play, mark the moment, tell the dev why."
- ❌ "Unlock premium feedback experiences!"

## Logo

`public/logo.svg` — two arrows chasing each other around a circle (the exchange: you test mine, I test yours) with a play triangle in the centre.

- Lime arrow `#C6FF3D` (giving), magenta arrow `#FF3DA5` (receiving), off-white play triangle on a near-black disc.
- The disc is always dark, in both themes, so the mark looks identical everywhere.
- Minimum size 16 px (favicon). Don't recolour, rotate or outline it.
- `AppLogo.vue` renders the same mark inline with the wordmark (Space Grotesk Bold) and the tagline.

## Colour tokens

Defined once in `src/styles/main.css` and mapped into Tailwind (`bg-canvas`, `text-primary-ink`, …). Dark is the default theme.

| Token | Dark | Light | Use |
|---|---|---|---|
| canvas | `#0B0B10` | `#F7F7F2` | page background |
| surface / surface-2 | `#15151D` / `#1F1F2B` | `#FFFFFF` / `#ECECE4` | cards, inputs |
| line | `#4A4A5C` | `#7A7A88` | borders (≥ 3:1) |
| ink | `#F7F7F2` | `#0B0B10` | body text (AAA) |
| muted | `#C2C2CF` | `#3C3C48` | secondary text (AAA) |
| primary (fill) | `#C6FF3D` | `#C6FF3D` | CTAs, Credit pills — always with dark text |
| primary-ink | `#C6FF3D` | `#355400` | lime as *text* |
| accent / accent-ink | `#FF3DA5` / `#FF7CC2` | `#D4006F` / `#A30056` | highlights, "not helpful" |
| info-ink | `#3DD9FF` | `#00566E` | playtime chips |
| danger-ink, warn-ink | `#FF8A8A`, `#FFD23D` | `#A0001C`, `#6B4F00` | errors, warnings |

Status is never colour alone: every status chip also carries an icon and a word.

## Type

- Display: **Space Grotesk** 600/700 — headings, numbers, Credit pills.
- UI: **Inter** 400–700.
- Scale: h1 36/30 px, h2 24 px, h3 18 px, body 16 px, small 14 px.

## Accessibility contract

- WCAG 2.2 AA minimum, AAA for body text, in both themes (`e2e/a11y.spec.ts` enforces zero serious axe violations).
- Hit targets ≥ 44 px, visible 3 px focus ring, `prefers-reduced-motion` respected.
