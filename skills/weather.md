---
name: weather
description: Look up current weather conditions for a city using the wttr.in command-line weather service. Use when the user asks about the weather, temperature, or forecast for a location.
---
This skill fetches current weather conditions from wttr.in, a free plain-text
weather service that needs no API key and returns output already formatted
for a one-line chat reply.

## Command

Use `curl` (installed in the sandbox) to make the request. Always set a
short timeout so a network problem doesn't stall the reply, and run it
silently so only the weather text comes back:

```
curl -s --max-time 10 "https://wttr.in/<LOCATION>?format=%l:+%C,+%t+(feels+%f),+humidity+%h,+wind+%w&m"
```

Replace `<LOCATION>` with the place the user asked about, URL-safe:
replace spaces with `+` (e.g. `New+York`, `Sao+Paulo`). If the user gave a
country or region only, pass that as-is (e.g. `Japan`). If the user did not
name a location at all, omit it — request plain `https://wttr.in/?format=...`
— wttr.in will then try to infer a location from the request's IP address.
Treat that inferred location as unreliable in this sandboxed environment
(the container's outbound IP has no relation to the user's real location),
so prefer asking the user for a location before falling back to this.

The trailing `&m` forces metric units (Celsius, km/h). Drop it (or replace
with `&u`) only if the user specifically asks for Fahrenheit/mph.

## Reading the format string

The `format=` value above requests exactly these fields, comma-separated,
in this order:

- `%l` — resolved location name
- `%C` — weather condition in words (e.g. "Partly cloudy")
- `%t` — current temperature
- `%f` — "feels like" temperature
- `%h` — humidity percentage
- `%w` — wind direction and speed

A successful response is a single line of plain text, for example:

```
Paris: Partly cloudy, +15°C (feels +14°C), humidity 72%, wind ↗11km/h
```

Read that line directly — no parsing beyond splitting on commas is needed —
and answer the user's question from it (current conditions, temperature,
whether it feels colder/warmer than the air temperature, wind, etc.).

## Handling failures

- A non-zero curl exit code, empty output, or an output that isn't the
  expected one-line format (e.g. an HTML error page or a message like
  "Unknown location") means the lookup failed. Do not invent a forecast —
  tell the user the weather lookup did not work, and mention the location
  you tried if one was given.
- If the command times out or curl reports it cannot resolve/connect to
  `wttr.in`, outbound network access is most likely unavailable in this
  session — say so rather than retrying repeatedly.
