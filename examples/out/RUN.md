# How these files were made

Every file in this folder is the unedited output of one headless run of each content command, made on 2026-11-16.

| | |
| --- | --- |
| Claude Code | `claude --version` printed `2.1.325 (Claude Code)` |
| Model | requested as `--model sonnet`; the run's JSON result (`modelUsage`) reports `claude-sonnet-5-5` for all three runs |
| Working folder | a new empty folder per run, holding only a copy of [`examples/brand.config.json`](../brand.config.json) |
| Google connector | none: user settings and MCP servers were turned off, so every command took the file path |

## Command line

Each run used this command, with `<prompt>` replaced by one of the prompts below and `<repo>` by the path to this repository:

```bash
env -u ANTHROPIC_API_KEY claude -p "<prompt>" \
  --plugin-dir <repo> \
  --model sonnet \
  --setting-sources project \
  --strict-mcp-config \
  --no-chrome \
  --no-session-persistence \
  --permission-mode acceptEdits \
  --allowedTools "Read Write Edit Glob Grep Agent WebSearch WebFetch Skill Bash(node:*)" \
  --output-format json
```

`Bash(node:*)` lets the commands run the format checker (`scripts/check-output.js`). No other shell commands were allowed.

## Prompts and results

### Social posts

```text
/content-kit:social-posts "Winter Blend launch. Facts the posts may use: Winter Blend is Colombia Huila and Ethiopia Guji, roasted medium; tasting notes are dark chocolate, orange peel and brown sugar; a 12 oz bag is $19; it goes on sale December 1, and Bean Club members get it first, on November 30." --start 2026-11-30
```

Wrote [`posting-schedule.csv`](social/2026-11-30-winter-blend-launch/posting-schedule.csv) and [`posts.md`](social/2026-11-30-winter-blend-launch/posts.md): 6 posts (4 Instagram, 2 LinkedIn), reviewed by `brand-voice-editor` and `fact-checker`, and checked with the format checker (`OK`). Two facts the brief did not give are left as placeholders for the team: `[BREWING TIP: method, grind or water temperature]` and `[ORIGIN DETAIL: farm, producer or altitude]`. 4 turns, 32 seconds.

### Email draft

```text
/content-kit:email-draft "Bean Club December newsletter. Facts: the Winter Blend (Colombia Huila and Ethiopia Guji, medium roast; dark chocolate, orange peel, brown sugar) ships to Bean Club members on November 30, a day before it goes on sale."
```

Wrote [`2026-11-16-bean-club-december-newsletter.md`](email/2026-11-16-bean-club-december-newsletter.md): 3 subject lines with preview text, an HTML-ready body and a plain-text version, reviewed by `brand-voice-editor` and `fact-checker`, and checked with the format checker (`OK`; subjects 45, 39 and 36 characters, previews 80, 65 and 79). Every fact in it comes from the prompt or the brand config. The run also asked for two `ls` commands, which the allow list declined. 8 turns, 35 seconds.

### Content calendar

```text
/content-kit:content-calendar 2026-12 --theme 'Winter Blend launch: Colombia Huila and Ethiopia Guji, on sale December 1, Bean Club members get it November 30'
```

Wrote [`2026-12-content-calendar.csv`](calendar/2026-12-content-calendar.csv) and [`2026-12-content-calendar.md`](calendar/2026-12-content-calendar.md): 28 slots (16 Instagram, 8 LinkedIn, 4 email; 7 per pillar), reviewed by `brand-voice-editor`, and checked with the format checker (`OK`). The calendar does not use the fact-checker, because briefs are plans, not claims. 4 turns, 37 seconds.

## Check them yourself

```bash
npm run check-output -- --config examples/brand.config.json \
  examples/out/social/2026-11-30-winter-blend-launch/posting-schedule.csv \
  examples/out/email/2026-11-16-bean-club-december-newsletter.md \
  examples/out/calendar/2026-12-content-calendar.csv
```

The dashboard's sample data is built from these same files (`npm run build-sample`), so its approval cards and calendar show this campaign.
