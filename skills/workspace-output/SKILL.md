---
name: workspace-output
description: Decide where Content Kit output goes (Google Drive, Docs and Sheets when connected, local files when not) and the exact file formats for the fallback. Use whenever a content command is ready to save its results.
user-invocable: false
---

# Workspace output

Every content command ends by saving its work through this skill, so output looks the same whichever path is used.

## Choose the path

Read `workspace.mode` from `./brand.config.json`:

- `google`: use Google Workspace. If no Google tools are available, stop and tell the user to connect Google Drive (Claude app: Settings > Connectors; Claude Code: add a Google Workspace MCP server), or set `workspace.mode` to `files`.
- `files`: always write local files.
- `auto` (default): use Google Workspace when tools for Google Drive, Docs or Sheets are available in this session; otherwise write local files. Say which path was used in the final summary.

If a Google call fails partway through, write the full result to local files as well, so nothing is lost, and report the failure.

## Google Workspace path

- Put everything in the Drive folder named in `workspace.driveFolder`, creating it if needed.
- Long-form pieces (posts, emails) go in one Google Doc per run, titled `<YYYY-MM-DD> <Command> - <campaign>`.
- Tabular data (posting schedule, calendar) goes in the Google Sheet named in `workspace.calendarSheet`, one tab per run, with the same columns as the CSV formats below so the two paths stay interchangeable.
- Reply with the link to each Doc and Sheet that was created or updated.

## File fallback

Write under `workspace.outputDir` (default `out`) in the current project folder. Write every file with the Write tool, which creates folders as needed. Do not create helper scripts or any file not listed here.

```
out/
  social/<YYYY-MM-DD>-<campaign-slug>/posting-schedule.csv
  social/<YYYY-MM-DD>-<campaign-slug>/posts.md
  email/<YYYY-MM-DD>-<campaign-slug>.md
  calendar/<YYYY-MM>-content-calendar.csv
  calendar/<YYYY-MM>-content-calendar.md
```

### posting-schedule.csv

UTF-8, comma-separated, header row, every field double-quoted. Columns, in order:

`publish_date,publish_time,channel,post_text,hashtags,link,asset_note,pillar,status`

- `publish_date` is `YYYY-MM-DD`; `publish_time` is 24-hour `HH:MM` in the brand's local time.
- `status` starts as `draft`. The columns match the bulk-upload format of common scheduling tools after a column rename.

### content-calendar.csv

`week_of,publish_date,channel,pillar,title,brief,owner,status`

### Markdown files

Paste-ready: one heading per piece, the copy in a fenced `text` block with no extra formatting, and a note line under it: `Pillar: <pillar> · <channel> · <length>`, with the length exactly as the checker below prints it.

### Email drafts

An email draft has exactly these `##` sections, in order, so the checker can read it:

```markdown
## Subject lines

### Benefit (recommended)
Subject: <subject line, up to 50 characters>
Preview: <preview text, up to 90 characters>

### Curiosity
Subject: ...
Preview: ...

## Body
<HTML-ready body, in a fenced html block>

## Plain-text version
<the full email as plain text, in a fenced text block>
```

Put nothing else on a `Subject:` or `Preview:` line. Review notes and open questions can follow in further sections.

### Check the files

After writing a CSV or an email draft, check it with the checker that ships with the plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-output.js" --config brand.config.json <file.csv or email.md>
```

For CSV files it checks the header, quoting, dates, times, channels, pillars, links, UTM tags and channel limits, and prints each post's length. For email drafts it checks the sections, subject lines (up to 50 characters), preview text (up to 90) and required disclosures. Fix every line marked `PROBLEM`, rewrite the file and run it again until it prints `OK`. Use the lengths it prints; do not count characters by eye.

If commands cannot be run in this session, skip the check and say in the summary that the files were not checked.

Sample output lives at `${CLAUDE_PLUGIN_ROOT}/examples/out/`.
