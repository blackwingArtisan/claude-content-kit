---
description: Draft an on-brand marketing email with subject lines, preview text and a plain-text version, saved to Google Docs or to a paste-ready markdown file
argument-hint: "<purpose, e.g. 'Bean Club October newsletter'> [--audience secondary]"
allowed-tools: Read, Write, Bash(node:*)
---

# Email draft

Draft a marketing email for: $ARGUMENTS

## 1. Load the brand

Load `./brand.config.json` with the brand-config skill. If it is missing, stop and suggest `/content-kit:setup`. Write to `audience.primary` unless `--audience secondary` was given.

## 2. Draft

Using the brand-voice skill, write the pieces below. Use only facts from the brand config and the purpose text above; mark anything else as a `[PLACEHOLDER]` and list it as an open question.

- Three subject-line options (up to 50 characters each), labelled by approach: benefit, curiosity, direct.
- Preview text (up to 90 characters) for each subject line.
- Body: a short opening tied to one content pillar, two or three short sections, one primary button using `ctas.primary` and `ctas.primaryUrl` with UTM tags (`utm_medium=email`).
- Every line from `compliance.requiredDisclosures` in the footer of both the body and the plain-text version, since the primary button promotes `ctas.primary`.
- A plain-text version of the full email.

## 3. Review

Send the draft to the `brand-voice-editor` agent, then to the `fact-checker` agent. Apply the edits and list any open fact-check questions.

## 4. Save

Save with the workspace-output skill:

- **Google Workspace connected:** create a Google Doc titled `<YYYY-MM-DD> Email - <purpose>` in `workspace.driveFolder` with subject options, preview text, body and plain-text version. Reply with the link.
- **Not connected (file fallback):** write `out/email/<YYYY-MM-DD>-<purpose-slug>.md` in the email-draft format the skill defines, then check it with the skill's checker.

## 5. Summarize

Reply with the path used, the link or file path, the recommended subject line and why, any open questions, and the approver who should review next.
