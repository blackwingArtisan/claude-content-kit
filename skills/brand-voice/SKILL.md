---
name: brand-voice
description: Apply the brand voice from brand.config.json to any marketing copy (social posts, emails, captions, calendar briefs). Use when drafting or reviewing content for the brand.
---

# Brand voice

Load `./brand.config.json` using the brand-config skill, then apply these rules to every draft.

## Before drafting

- Pick one content pillar from `pillars` for each piece and note it.
- Write to `audience.primary` unless the request names another audience.
- Re-read `voice.sampleLine` if present; match its sentence length and rhythm. It shows how the brand sounds, not what is on sale now, so do not reuse its facts.

## While drafting

- Use the three `voice.adjectives` as the tone target. If a sentence fights one of them, rewrite it.
- Follow every `voice.do` rule and break no `voice.dont` rule. These are checked word by word by the brand-voice-editor agent.
- Never use a phrase from `compliance.bannedClaims`. Add each `compliance.requiredDisclosures` line to any piece that promotes a subscription or offer.
- Use only facts from `brand.config.json` and the user's brief. When a piece needs a fact you do not have (an origin, tasting notes, a price, a date), write a placeholder in square brackets, such as `[ORIGIN]`, and list it as an open question. Never fill a gap with a guess.
- End promotional pieces with `ctas.primary` linking to `ctas.primaryUrl`. Add UTM tags: `utm_source=<channel>&utm_medium=social|email&utm_campaign=<campaign-slug>`.

## Channel limits

| Channel | Length | Notes |
| --- | --- | --- |
| instagram | up to 2,200 characters; first 125 carry the hook | 3-8 hashtags at the end; link goes in bio, so say "link in bio" |
| linkedin | up to 300 words | No more than 3 hashtags; plain line breaks between ideas |
| facebook | 40-120 words | One link, one question to invite replies |
| x | 280 characters including link | One hashtag at most |
| email | subject up to 50 characters; preview text up to 90 | One primary button, plain-text version included |

Limits are ceilings, not targets. Do not pad a short piece to reach a length.

## After drafting

Hand the draft to the `brand-voice-editor` agent, then to the `fact-checker` agent for any piece that states a number, date, price, origin or claim.
