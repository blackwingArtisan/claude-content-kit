---
description: Plan a month of content across every channel and pillar, saved to a Google Sheet or to a CSV and markdown calendar
argument-hint: "[YYYY-MM] [--weeks 4] [--theme '<campaign theme>']"
allowed-tools: Read, Write, Bash(node:*)
---

# Content calendar

Plan a content calendar. Arguments: $ARGUMENTS

## 1. Load the brand

Load `./brand.config.json` with the brand-config skill. If it is missing, stop and suggest `/content-kit:setup`.

## 2. Plan

- Month: the `YYYY-MM` argument, otherwise next month. Length: `--weeks`, default 4.
- Weeks start on Monday; `week_of` is that Monday, even when it falls in the previous month. Every `publish_date` is inside the month. For each week and channel, schedule `postsPerWeek` slots. Balance `pillars` evenly across the month and across channels.
- If `--theme` is given, tie at least half the slots to it and keep the rest evergreen.
- Give every slot a working title, a two-sentence brief, the pillar, an owner (default `approvals.approver`) and status `planned`.
- Note seasonal dates in the month that suit the brand and its industry, and flag any you are unsure of for the user to confirm instead of presenting them as fact.

## 3. Review

Send the titles and briefs to the `brand-voice-editor` agent for a quick tone pass. No fact-check is needed at the planning stage unless a brief states a specific fact.

## 4. Save

Save with the workspace-output skill:

- **Google Workspace connected:** add a tab named `<YYYY-MM>` to the `workspace.calendarSheet` Google Sheet with the content-calendar columns, sorted by date. Reply with the link.
- **Not connected (file fallback):** write `out/calendar/<YYYY-MM>-content-calendar.csv`, check it with the skill's checker, then write a readable week-by-week `out/calendar/<YYYY-MM>-content-calendar.md`.

## 5. Summarize

Reply with the path used, the link or file paths, slot counts per channel and per pillar, and any dates the user should confirm. Suggest running `/content-kit:social-posts` for the first week.
