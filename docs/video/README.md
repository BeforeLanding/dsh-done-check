# Demo film and source footage

[`dsh-done-check-film.mp4`](dsh-done-check-film.mp4) is the current README film:
**1:04 / 64 seconds, 1920 × 1080, H.264 at 24 fps**, with offline synthetic
Chinese narration, bilingual captions, eight named chapters, and original subtle
chapter chimes. It has been recomposed from the ground up: a question, the real
failed test, an acceptance checklist, user confirmation, preserved evidence, a
fix and re-check, a manual verdict, result expiry, and an installation end card.

The film uses close-ups of authentic recorded DSH output. New editorial titles,
camera pushes, panel reveals, chapter transitions and the installation card are
separate from that output. No UI or test result is invented or rewritten.
Excerpts play once and hold for reading; the film is **not real-time** and does
not establish a performance benchmark. The narration is an offline system voice,
not the voice of the person who recorded the session.

## Story and chapters

- **0:00 — The question:** “完成，该由什么证明？” / What makes done verifiable?
  The actual failing CSV test opens the film. This is a general question about
  acceptance, not a claim that the recorded agent first announced completion.
- **0:06 — Agree:** executable tests and a manual check share one acceptance
  checklist. The real preview lists the commands before execution.
- **0:14 — Your decision:** checklist confirmation is a user action. The film
  shows the command separately from the real confirmation receipt.
- **0:21 — The evidence:** missing CSV quotes turn two fields into three. The
  actual test report, command, exit code and output remain readable.
- **0:29 — Fix and re-check:** the agent's repair message gives way to freshly
  run checks. A code edit alone is not a passing result.
- **0:37 — Human verdict:** the automatic checks pass; the manual item waits
  for the user. The recorded manual verdict then makes the agreed checks pass.
- **0:45 — Results expire:** the old manual verdict requires review after a
  code change. In this particular frame, two newer automatic results remain
  valid. The narration and captions preserve that distinction.
- **0:55 — Your next task:** a new installation card and `/done-check` call to
  action. The command is an instruction, not a simulated shell execution.

Passing all agreed checks does not prove that every requirement is complete.
The real success output includes that limitation.

## Film and README files

- [`dsh-done-check-film.mp4`](dsh-done-check-film.mp4): the finished film, with
  fast-start metadata, one Chinese narration track and optional Chinese/English
  subtitle tracks. Captions are also burned in for clients without track controls.
- [`film.zh-CN.vtt`](film.zh-CN.vtt): Chinese narration transcript and timecodes.
- [`film.en.vtt`](film.en.vtt): corresponding English subtitles.
- [`../images/hero.gif`](../images/hero.gif): the new **16-second**, 1280 × 720
  inline teaser. Four acts: FAIL, EVIDENCE, YOU DECIDE, STALE. Its source windows
  are 0:40–0:42 (then held to fill the four-second act), 0:49–0:53,
  1:18.5–1:22.5 and 1:33–1:37.
  That last excerpt shows **all three results** stale. The film instead uses the
  later manual-only stale view and states that distinction explicitly.
- [`../images/hero-poster.png`](../images/hero-poster.png): the teaser's static
  fallback. The bilingual banner, feature close-ups and **1:04 film cover** share
  the warm black, warm white, amber and mint visual direction.

README image assets use
[`../../scripts/build-readme-visuals.py`](../../scripts/build-readme-visuals.py).
The cover's time label refers to the new film, not the source footage below.
The earlier 12-second GIF and 39-second cut are superseded.

## Source and provenance

[`dsh-done-check-demo.mp4`](dsh-done-check-demo.mp4) is the retained source:
**112.57 seconds / 1:53, 1920 × 1080, H.264 at 30 fps**, without audio.
Its SHA-256 is
`9d169d1b40399eb1f748c9fb7438c8d664a9046487ae5ad129ef1309be04ce80`.

The existing [YouTube upload](https://youtu.be/kIWweTUUfP0) is that original
112-second presentation. It has **not** been replaced by the 64-second film.
The new film is delivered as a repository file, ready for a separate upload.

The new composition reads only the real output regions from these source times:

- Failure: **0:40–0:42.6**, cropped to the result panel.
- Checklist preview: **0:23.6–0:24**, held so the commands can be read.
- Confirmation receipt: **0:31–0:31.5**.
- Failure details: **0:49–0:53**, including exit code and recorded output.
- Repair message: **1:05–1:06.5**.
- Re-check and pending manual item: **1:13–1:15**.
- Recorded manual verdict: **1:22–1:24**.
- Stale manual verdict: **1:44–1:47**.

Coordinates, source windows, captions and narration are all declared in
[`../../scripts/build-demo-film.py`](../../scripts/build-demo-film.py).
The original full-screen two-column presentation is not reused as the new
composition; only its authentic recorded UI regions are used as source pixels.

## Rebuild

Requirements: Python 3.10+, Pillow, NumPy, `ffmpeg` and `ffprobe` on PATH,
Microsoft YaHei / Noto Sans CJK, and Cascadia Mono / DejaVu Sans Mono.

```bash
python -m pip install Pillow numpy
python scripts/build-demo-film.py
```

The default narration path uses the already installed Windows SAPI Chinese
Huihui voice, selected by its registered token
`HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_ZH-CN_HUIHUI_11.0`.
The script does not change the registry or install a voice. It uses no network,
paid API, account, downloaded music or external sample. It synthesizes each
chapter separately, fits the narration to that chapter, and leaves breathing
room around it. Original quiet chapter tones are generated mathematically.

On a system without that voice, rebuild the visuals, captions and chapter tones
without narration:

```bash
python scripts/build-demo-film.py --no-voice
```

To create an eight-chapter contact sheet without encoding, or verify the
delivered file without rebuilding:

```bash
python scripts/build-demo-film.py --preview-only
python scripts/build-demo-film.py --verify-only
```

Temporary files stay inside the checkout and are removed after the build.
The contact sheet is a review artifact in the checkout's parent directory.
Font rendering and encoder versions may change exact output bytes. Verify
readability and caption alignment after changing the source or crop rectangles.

## README playback

GitHub README shows a looping GIF and a linked image poster. A repository MP4
link may open a file preview or download depending on the client; a README does
not provide a dependable inline video player. The cover links to the new film
file, while the old YouTube link is explicitly identified as source/archive.

The npm package excludes media binaries. Absolute raw GitHub image sources let
the package README display the same visual assets after changes reach `main`.
