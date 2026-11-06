# Demo media

[Watch the usage tutorial on YouTube](https://youtu.be/CJw7eL7v4bw).
The README cover and play button open this video;
[`walkthrough.mp4`](walkthrough.mp4) is the downloadable repository copy:
**72 seconds / 1:12, 1920 × 1080, H.264 at 24 fps**, with Chinese system
narration and bilingual subtitles. It follows a CSV acceptance task in order,
from a prepared checklist to execution, a failed test, repair, manual acceptance,
stale results after an edit, and re-checking the current code.

The layout uses a slim light toolbar, the real DSH interface, and short tutorial
captions. The recorded interface occupies **76% of each operational frame**.
There are no promotional interludes, camera moves, music or sound effects.
Each source excerpt plays once; its final frame may hold for reading. No clip
loops. Waiting is shortened, so the tutorial is not a performance benchmark.

## Files

- [`walkthrough.mp4`](walkthrough.mp4): the finished tutorial, with MP4
  fast-start, ten chapters, Chinese narration, burned-in bilingual captions and
  optional Chinese/English text subtitle tracks.
- [`walkthrough.zh-CN.vtt`](walkthrough.zh-CN.vtt): Chinese narration captions.
- [`walkthrough.en.vtt`](walkthrough.en.vtt): corresponding English subtitles.
- [`../images/hero.gif`](../images/hero.gif): an **18-second**, 1200 × 650 inline
  preview showing checklist preview, confirmation, a real failure, details,
  manual acceptance, and all three old results becoming stale.
- [`../images/hero-poster.png`](../images/hero-poster.png): the GIF's static
  fallback.
- [`../images/demo-cover.jpg`](../images/demo-cover.jpg): the **1:12** cover for
  this tutorial. Its timestamp refers to `walkthrough.mp4`.

## Tutorial chapters

- **0:00 — Project and checklist:** the real project/input context names
  `src/export.mjs` and `done-check.yaml`. This source session already has two
  automatic checks and one manual check; checklist creation is not recorded.
- **0:07 — Preview:** `/done-check` shows the checks and their commands.
  Preview does not execute tests.
- **0:14 — Confirm:** `/done-check 确认` confirms the reviewed checklist.
  Confirmation and manual verdicts are user actions.
- **0:20 — Run:** `/done-check` executes checks; the CSV escaping test fails.
- **0:28 — Details:** `/done-check details 2` shows the actual test error,
  executed command, exit code 1 and preserved output.
- **0:35 — Fix and re-run:** ask the agent to repair escaping, then use
  `/done-check` again. Both automatic checks pass; the manual item is pending.
- **0:45 — Manual verdict:** after personally verifying the Chinese filename,
  record `/done-check ok`. The recording shows the submitted manual verdict,
  not the browser download itself. All three agreed checks now pass.
- **0:53 — Code changed:** `/done-check all` shows **all three** old results
  stale after a source edit, with their previous run evidence retained. The edit
  itself happens outside the captured DSH view; no editor operation is invented.
- **1:02 — Re-check current code:** `/done-check` refreshes the automatic
  checks. The remaining manual item needs fresh human verification.
- **1:08 — Installation:** a plain instruction card with the install command,
  requirements and `/done-check`. Installation is not executed in the video.

The last two result states are deliberately different: first all three old
results are stale; after re-running, only the manual verdict still needs review.
Passing the agreed checks does not establish complete requirement coverage.

## Authentic source footage

The source is [`dsh-done-check-demo.mp4`](dsh-done-check-demo.mp4):
**112.57 seconds / 1:53, 1920 × 1080, H.264 at 30 fps, no audio**.
SHA-256:
`9d169d1b40399eb1f748c9fb7438c8d664a9046487ae5ad129ef1309be04ce80`.

The existing [YouTube upload](https://youtu.be/kIWweTUUfP0) contains that source
presentation. It has not been replaced by the 72-second tutorial.

Source windows used by the tutorial, in chronological order:

- Project context: **0:09.5–0:12.5**, then hold.
- Preview: **0:17.5–0:24**, then hold.
- Confirmation: **0:25.5–0:31.5**.
- Run and failure: **0:33–0:36**, then **0:40–0:42**, then hold.
- Failure details: **0:49–0:53**, then hold.
- Repair and re-run: **1:03–1:07.5**, then **1:10–1:15.5**.
- Manual acceptance: **1:17–1:24.5**, then hold.
- All results stale: **1:29–1:37**, then hold.
- Automatic results refreshed/manual review pending: **1:40–1:45**, then hold.

The interface is cropped and uniformly scaled; its text and results are not
recreated. Top-bar command labels and tutorial captions are separate annotations.
The Chinese narration is synthesized offline with an installed Windows voice.

The GIF uses these source windows, each displayed as a three-second step:
**0:21–0:23**; a clean confirmation still at **0:35**; **0:40–0:42**;
**0:50–0:52**; **1:22.2–1:24.2**; and **1:34–1:36**. Short excerpts hold their
last frame; they do not loop into subsequent slash-command menus.

## Rebuild and verify

Requirements: Python 3.10+, Pillow, NumPy, `ffmpeg`/`ffprobe` on PATH,
Microsoft YaHei / Noto Sans CJK, and Cascadia Mono / DejaVu Sans Mono.

```bash
python -m pip install Pillow numpy
python scripts/build-walkthrough.py
python scripts/build-readme-visuals.py
```

Default Chinese narration uses the already installed SAPI Huihui voice token
`HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_ZH-CN_HUIHUI_11.0`.
The script neither changes the registry nor installs voices. No network,
account, external model or paid API is used. On a system without that voice:

```bash
python scripts/build-walkthrough.py --no-voice
```

To make a ten-step contact sheet without encoding, or verify the finished
tutorial's dimensions, duration, chapters and audio/subtitle tracks:

```bash
python scripts/build-walkthrough.py --preview-only
python scripts/build-walkthrough.py --verify-only
```

Build intermediates stay in a temporary directory inside the checkout and are
removed after completion. The optional contact sheet is saved in its parent
directory. Font and encoder versions can affect exact output bytes. Check each
chapter visually after changing source windows or crop rectangles.

GitHub README uses a linked cover image for YouTube playback, with the GIF in
an expandable preview. The MP4 remains an alternative download for readers who
cannot use YouTube. MP4 links may open a file preview or download depending on
the client. README image URLs
are absolute raw GitHub URLs so they also work in the npm package README after
the changes reach `main`; media binaries are excluded from the npm package.
