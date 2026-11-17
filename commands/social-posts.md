---
description: Draft a week of on-brand social posts with a posting schedule, saved to Google Sheets and Docs or to a CSV and paste-ready markdown
argument-hint: "<campaign and the facts posts may use> [--channels instagram,linkedin] [--start YYYY-MM-DD]"
allowed-tools: Read, Write, Bash(node:*)
---

# Social posts

Draft social posts for this campaign or topic: $ARGUMENTS

## 1. Load the brand

Load `./brand.config.json` with the brand-config skill. If it is missing, stop and suggest `/content-kit:setup`.

## 2. Plan the week

- Channels: the ones named in `--channels`, otherwise every non-email entry in `channels`.
- Posts per channel: that channel's `postsPerWeek`.
- Start date: `--start`, otherwise next Monday. Spread posts across weekdays at sensible local times (for example 08:00, 12:00 or 17:30) and avoid two posts on the same channel on the same day.
- Rotate through `pillars` so no single pillar takes more than half the posts.

## 3. Draft

Write each post with the brand-voice skill, respecting the channel limits it lists. Use only facts from the brand config and the campaign text above; mark anything else as a `[PLACEHOLDER]` and list it as an open question. For every post record: publish date and time, channel, post text, hashtags, link with UTM tags, a one-line image or video note, pillar.

## 4. Review

1. Send all drafts to the `brand-voice-editor` agent. Apply its edits.
2. Send any post that states a fact (number, date, price, origin, award, claim) to the `fact-checker` agent. Remove or reword anything it marks as unsupported, and list open questions for the user.

## 5. Save

Save with the workspace-output skill:

- **Google Workspace connected:** add a tab named `<YYYY-MM-DD> <campaign>` to the `workspace.calendarSheet` Google Sheet with the posting-schedule columns, and create a Google Doc with the paste-ready posts in `workspace.driveFolder`. Reply with both links.
- **Not connected (file fallback):** write `out/social/<YYYY-MM-DD>-<campaign-slug>/posting-schedule.csv`, check it with the skill's checker, then write `posts.md`, in the formats the skill defines.

## 6. Summarize

Reply with: the path used (Google Workspace or files), links or file paths, post count per channel, any fact-check questions, and the approver from `approvals.approver` who should review next.
