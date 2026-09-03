---
name: word-count
description: Counts the number of words in a given piece of text using a shell command.
---
This skill counts words in a piece of text without relying on your own
judgement of what counts as a word - use the shell so the count is exact
and reproducible.

## Command

Run, inside your sandbox, replacing `<TEXT>` with the exact text to count
(kept inside the single quotes so shell word-splitting doesn't affect the
result):

```
printf '%s' '<TEXT>' | wc -w
```

The command's output is the word count. Reply with just that number unless
asked for more.
