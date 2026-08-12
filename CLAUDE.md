# CLAUDE.md — tracker

This repo holds two things:

- **the native iOS tracker** (`InflightTracker/`, `project.yml`,
  `codemagic.yaml`) — Swift + SwiftUI, no third-party dependencies. This is
  where new work goes.
- **the old web tracker** (`old/`) — the entire previous app, moved wholesale
  and otherwise untouched. It still ships from Netlify and is the reference for
  the backend's data shapes.

`old/CLAUDE.md` has the rules for working inside `old/`. Read it before touching
anything under that directory — several files there will exhaust a context
window on a single Read.

## The native app

The `.xcodeproj` is **generated, not committed**. `project.yml` is the project
definition; `xcodegen generate` produces the Xcode project, both locally and in
CI. Never hand-edit or commit a pbxproj.

Adding a file to `InflightTracker/Sources/` is enough — the spec globs the
directory, so there is no project file to update.

There are deliberately no SPM or CocoaPods dependencies. Adding one means
touching `project.yml` *and* `codemagic.yaml`, so weigh it against what ships
with the SDK first.

## Data shapes

The ACARS backend's payloads are documented in `old/SocketDataHub.js` (the big
comment at the top) and `old/FlightDeltaClient.js`. Grep those before guessing
at a field name. Decoding on the Swift side is deliberately lenient — one
malformed flight must never blank the map — so a wrong assumption fails
silently as a missing value rather than loudly as an error.

## Finding code

1. Grep with `output_mode: "files_with_matches"` to locate.
2. Grep with `output_mode: "content"` and `-C 5` to confirm.
3. Read only the confirmed range with `offset`/`limit`.

Skip straight to Read only when the path is already known and the file is small.
Every file under `InflightTracker/` is small.

## Editing

- Use Edit on existing files. Never Write a whole file to change part of it —
  that spends output tokens equal to the file's full length.
- Do not re-read a file to verify an edit landed. Edit fails loudly if the
  match was wrong; silence means it worked.
- Batch independent tool calls into one block rather than one per turn.

## Verifying

There is no Xcode on Linux, so a Swift change cannot be compiled here. Say so
rather than implying a change was built. What *can* be checked locally:

- `python3 -c "import yaml,sys; yaml.safe_load(open('project.yml'))"` and the
  same for `codemagic.yaml`.
- `plutil -lint` is macOS-only; on Linux use
  `python3 -c "import plistlib; plistlib.load(open('InflightTracker/Resources/Info.plist','rb'))"`.
- `node old/tools/verify-data.js` for anything under `old/`.

Use `git diff --stat` before `git diff`. Prefer `git diff -- <path>` over the
whole working tree.

## Responses

- Lead with the answer or the result. No preamble, no "Great question!", no
  closing summary of what was just done.
- Never paste back code that was just written or edited — reference it as
  `path/to/file.swift:120`.
- Report file contents by reference, not by quoting the file into chat.
- State a recommendation instead of enumerating every option considered.
- If a requirement is genuinely ambiguous, ask once before building — a wrong
  build and its rewrite cost far more than the question.

## Subagents

Do not spawn subagents unless explicitly asked. Each one starts cold and
re-derives context this session already holds, which multiplies token use
rather than saving it.
