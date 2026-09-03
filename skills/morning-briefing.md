---
name: morning-briefing
description: Runs a short multi-step routine (date/time, weather, a joke) and replies with one combined summary. Use when the user asks for their morning briefing, daily summary, or a rundown to start the day.
---
This skill is a routine: perform the steps below in order, each as its own
`execute_command` call, then reply once with a single synthesized summary.
Do not paste each step's raw output into the chat — the user gets one short,
readable message that weaves the results together, not a transcript.

## Steps

1. **Get the current date and time.** Run:

   ```
   date "+%A, %B %d, %Y %H:%M %Z"
   ```

   This sandbox has no persistent configuration, so treat the returned time
   as UTC unless the output's timezone abbreviation says otherwise. Use this
   to open the briefing (e.g. "Good morning — it's Wednesday, September 3,
   2026").

2. **Get the weather.** Follow the `weather` skill's approach: retrieve that
   skill's body if you have not already, and run its `curl` command against
   `https://wttr.in` for whatever location the user mentioned (in this
   message, since there is no memory of earlier ones). If the user gave no
   location, say in the summary that you don't have one rather than
   guessing. If the request fails (bad exit code, empty or non-plain-text
   output, timeout), note plainly that weather is unavailable right now and
   move on — do not stop the routine.

3. **Get a short joke to close on a light note.** Run:

   ```
   curl -s --max-time 10 -H "Accept: text/plain" https://icanhazdadjoke.com/
   ```

   This returns a single joke as plain text (no JSON parsing needed — the
   `Accept: text/plain` header is what makes the service return plain text
   instead of JSON). If the command fails or returns empty/HTML output,
   skip the joke in the summary rather than blocking on it.

## Final reply

After all three steps, write **one** message to the user that combines
their results into a short, natural morning briefing: the date, then the
weather (or a note that it's unavailable), then the joke (or nothing, if it
failed). Do not label it "Step 1 / Step 2 / Step 3" and do not show raw
command output — write it the way a person would read a briefing, e.g.:

> Good morning! It's Wednesday, September 3, 2026, 08:12 UTC.
> In Paris right now: partly cloudy, +15°C (feels +14°C), light wind.
> And your daily joke: [joke text].

If one or more steps failed, fold that into the same single reply
("Couldn't reach the weather service this time") instead of a separate
error message — the user still gets one coherent answer.
