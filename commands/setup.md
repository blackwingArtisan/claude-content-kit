---
description: Create or update brand.config.json by answering a few questions about the brand
argument-hint: "[--from <existing-config.json>]"
allowed-tools: Read, Write
---

# Set up Content Kit

Create `./brand.config.json`, the one file every Content Kit command reads. Follow the brand-config skill for the schema and writing rules.

Arguments: $ARGUMENTS

## Steps

1. **Check for an existing config.** If `./brand.config.json` exists, show a one-paragraph summary of it and ask whether to update it or start over. When updating, ask only about the sections the user wants to change and keep every other field, including unknown ones.
   If `--from <path>` was given, read that file as the starting point instead.

2. **Ask the questions.** Ask in small groups, using the question tool when it is available, and offer the example answer in brackets so the user can accept a sensible default:
   1. Brand name, website and a one-line description. [Harbor & Pine Coffee, https://harborandpine.example.com, specialty coffee roaster]
   2. Who is the main reader, and what problem do they have? [Home brewers who find grocery-store beans flat]
   3. Three words for the voice, plus one sentence that sounds exactly like the brand. [warm, plain-spoken, curious]
   4. Words or claims to avoid, and any line that must appear on promotions. [no health claims; "Cancel anytime."]
   5. Two to six content pillars. [Origin stories, Brewing tips, Behind the roaster]
   6. Channels and posts per week. [Instagram 4, LinkedIn 2, Email 1]
   7. Main call to action and its link. [Start a Bean Club subscription]
   8. Who approves content (name and email)?

3. **Choose the output path.** Check whether Google Drive, Docs or Sheets tools are available in this session.
   - If they are, ask for the Drive folder and calendar sheet names and set `workspace.mode` to `auto`.
   - If they are not, set `workspace.mode` to `auto` anyway and explain: content will be saved as files in `./out/` now, and will go to Google Workspace automatically once it is connected.

4. **Write the file.** Turn the answers into concrete `voice.do` and `voice.dont` rules (checkable statements, not adjectives). Write `./brand.config.json` with `schemaVersion: 1`.

5. **Confirm.** Show the saved config as a short table and suggest a first command, for example:
   `/content-kit:social-posts "October single-origin launch"`

Never ask for or store passwords, API keys or access tokens.
