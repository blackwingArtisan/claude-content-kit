---
name: brand-config
description: Schema and loading rules for brand.config.json, the single file that drives every Content Kit command. Use when reading, writing, validating or repairing a brand config.
user-invocable: false
---

# Brand config

Every Content Kit command reads one file: `brand.config.json` in the current project folder. `/content-kit:setup` writes it. A filled-in example ships with the plugin at `${CLAUDE_PLUGIN_ROOT}/examples/brand.config.json`.

## Loading

1. Read `./brand.config.json`.
2. If it is missing, stop and tell the user: "No brand config found. Run `/content-kit:setup` first (about two minutes)." Do not invent brand details.
3. If `schemaVersion` is higher than 1, stop and say the config was written by a newer version of the plugin. Do not rewrite it.
4. Check the required fields below. If any are missing, list them and offer to fill them in by asking only for those values.

## Required fields

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | integer | Always `1` for this version |
| `brand.name` | string | Public brand name |
| `brand.website` | URL | Used for links and UTM tags |
| `audience.primary` | string | One sentence describing the main reader |
| `voice.adjectives` | string[] | Three words, used by the brand-voice editor |
| `voice.do` / `voice.dont` | string[] | Concrete, checkable rules |
| `pillars` | string[] | Two to six recurring content themes |
| `channels` | object[] | Each has `name` (`instagram`, `linkedin`, `facebook`, `x`, `email`) and `postsPerWeek` |
| `ctas.primary`, `ctas.primaryUrl` | string | Default call to action |
| `workspace.mode` | `auto` \| `google` \| `files` | Output routing, see the workspace-output skill |

## Optional fields

`brand.tagline`, `brand.industry`, `audience.secondary`, `audience.painPoints`, `voice.sampleLine`, `ctas.secondary`, `compliance.bannedClaims`, `compliance.requiredDisclosures`, `approvals.approver`, `approvals.approverEmail`, `workspace.driveFolder`, `workspace.calendarSheet`, `workspace.outputDir` (default `out`).

## Writing rules

- Write the file as formatted JSON with two-space indentation.
- Never store passwords, API keys or access tokens in the config. Google access comes from the user's own connector, not from this file.
- Keep unknown fields when updating an existing config, so a newer team member's additions are not lost.
