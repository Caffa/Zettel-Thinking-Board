---
name: recurring-bug-to-rules
description: When fixing a recurring bug in this Obsidian plugin, add the fix and how to avoid it to a project cursor rules file. Use when the user says a bug is recurring, or asks to document a fix in rules so it does not happen again.
---

# Document recurring bug fixes in Cursor rules

When you fix a bug that the user identifies as **recurring**, you must also add the fix and how to avoid it to a Cursor rules file so the agent keeps it in mind when coding this plugin.

## When this applies

- User says the bug is "recurring", "happens again", "keep making this mistake", or similar.
- User explicitly asks to add the fix to rules / things to keep in mind when coding this plugin.

## What to do

1. **Fix the bug** as usual in the codebase.
2. **Create or update a rule file** in `.cursor/rules/` for plugin-coding gotchas.

### Rule file to use

- **Primary file**: `.cursor/rules/plugin-coding.mdc`
- If that file does not exist, create it. Use it as the single place for "things to keep in mind when coding this plugin" and recurring-bug entries.

### Rule file format

- Use Cursor rule format: `.mdc` with YAML frontmatter.
- Set `alwaysApply: true` so the rule is in context whenever working in this plugin.
- Keep each entry short: what was wrong, the fix, and how to avoid it next time.

**Example frontmatter and structure:**

```markdown
---
description: Things to keep in mind when coding this plugin (recurring bug fixes)
alwaysApply: true
---

# Plugin coding gotchas

[Existing content if any…]

## [Short name of the bug/fix]

- **What was wrong:** [1–2 sentences]
- **Fix:** [What was changed]
- **How to avoid:** [Concrete check or pattern to follow]
```

### Adding a new entry

- Append a new `## [Short name]` section to `plugin-coding.mdc`.
- Include the three bullets: What was wrong, Fix, How to avoid.
- Keep the rule file under ~50 lines total; if it grows large, consider splitting by area (e.g. `plugin-coding-canvas.mdc`, `plugin-coding-engine.mdc`).

## Summary

After fixing a recurring bug: create or update `.cursor/rules/plugin-coding.mdc` with the fix and how to avoid it, so the agent (and you) remember when coding this plugin.
