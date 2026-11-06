#!/usr/bin/env python3
"""Build the small logo and authentic operation previews used by the README.

Requires Python 3.10+, Pillow and ffmpeg. No network or previous media scripts.
The original 112.57 s source is docs/video/dsh-done-check-demo.mp4, SHA-256
9d169d1b40399eb1f748c9fb7438c8d664a9046487ae5ad129ef1309be04ce80.

GIF provenance (six 3 s editorial beats, chronological):
  1. Source 21.0–23.0 s, then hold: expanded checklist, no dropdown.
  2. Source 35.0 s held: recorded checklist confirmation, before execution.
  3. Source 40.0–42.0 s, then hold: actual failing CSV test report.
  4. Source 50.0–52.0 s, then hold: actual command/exit-code/output details.
  5. Source 82.2–84.2 s, then hold: user's recorded manual verdict.
  6. Source 94.0–96.0 s, then hold: all three results stale after an edit.
Holds avoid the next slash-command menu. The original UI is cropped/scaled,
never reconstructed or reworded; the slim toolbar/navigation are annotations.
The cover refers to the separate 72 s walkthrough, not the original upload.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/video/dsh-done-check-demo.mp4"
OUT = ROOT / "docs/images"
BG, WHITE, TEXT, BLUE = "#f6f8fa", "#ffffff", "#1f2328", "#0969da"
MUTED, BORDER, SELECTED = "#59636e", "#d1d9e0", "#ddf4ff"
SIZE, FPS = (1200, 650), 6
CROP = (800, 210, 1840, 740)
SCENES = [
    (21.0, 2.0, "Preview / 预览清单", "/done-check", "Preview"),
    (35.0, 0.0, "Confirm / 确认清单", "/done-check confirm", "Confirm"),
    (40.0, 2.0, "Run / 执行检查", "/done-check", "Run"),
    (50.0, 2.0, "Inspect / 查看证据", "/done-check details 2", "Details"),
    (82.2, 2.0, "Manual verdict / 人工确认", "/done-check ok", "Manual"),
    (94.0, 2.0, "Code changed / 代码已更新", "/done-check all", "Code changed"),
]


def run(*args: object, capture: bool = False) -> bytes | None:
    result = subprocess.run([str(x) for x in args], check=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    if mono:
        paths = ["C:/Windows/Fonts/CascadiaMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
    elif bold:
        paths = ["C:/Windows/Fonts/msyhbd.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"]
    else:
        paths = ["C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise RuntimeError("Install Microsoft YaHei or Noto Sans CJK and a mono font.")


def label(d: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, size: int = 16,
          fill: str = TEXT, bold: bool = False, mono: bool = False) -> None:
    d.text(xy, value, font=font(size, bold, mono), fill=fill, anchor="lt")


def checkbox(d: ImageDraw.ImageDraw, x: int, y: int, size: int = 22) -> None:
    d.rounded_rectangle((x, y, x+size, y+size), radius=4, outline=BLUE, width=2)
    d.line([(x+5, y+11), (x+9, y+15), (x+17, y+6)], fill=BLUE, width=2)


def make_logo() -> None:
    (OUT / "logo.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-labelledby="title">
<title id="title">dsh-done-check: a checked box with recorded evidence</title>
<rect x="10" y="18" width="44" height="44" rx="9" fill="#fff" stroke="#0969da" stroke-width="6"/>
<path d="m21 40 10 10 17-22" fill="none" stroke="#0969da" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M66 29h18M66 43h18M66 57h12M18 77h60" fill="none" stroke="#0969da" stroke-width="5" stroke-linecap="round"/>
</svg>
''', encoding="utf-8")


def snapshot(second: float) -> Image.Image:
    data = run("ffmpeg", "-v", "error", "-ss", second, "-i", SOURCE,
               "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-", capture=True)
    return Image.open(io.BytesIO(data)).convert("RGB").crop(CROP)


def paste_ui(canvas: Image.Image, ui: Image.Image, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    ratio = min((right-left)/ui.width, (bottom-top)/ui.height)
    scaled = ui.resize((round(ui.width*ratio), round(ui.height*ratio)), Image.Resampling.LANCZOS)
    canvas.paste(scaled, (left+(right-left-scaled.width)//2, top+(bottom-top-scaled.height)//2))


def compose(index: int, ui: Image.Image, number: int) -> Image.Image:
    image = Image.new("RGB", SIZE, WHITE)
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, 1199, 48), fill=BG)
    d.line((0, 48, 1199, 48), fill=BORDER)
    checkbox(d, 16, 13)
    label(d, (49, 16), "dsh-done-check", 16, bold=True)
    d.line((216, 12, 216, 36), fill=BORDER)
    _, _, title, command, _ = SCENES[index]
    label(d, (233, 17), f"{index+1}/6  {title}", 15)
    d.rounded_rectangle((800, 9, 1184, 39), radius=5, fill=WHITE, outline=BORDER)
    label(d, (814, 17), command, 15, BLUE, mono=True)
    # The authentic DSH viewport occupies over 75% of the complete image.
    paste_ui(image, ui, (16, 52, 1184, 606))
    d.rectangle((0, 610, 1199, 649), fill=BG)
    d.line((0, 610, 1199, 610), fill=BORDER)
    for i, scene in enumerate(SCENES):
        left = 10+i*198
        if i == index:
            d.rounded_rectangle((left, 617, left+188, 644), radius=4, fill=SELECTED)
        label(d, (left+12, 624), f"{i+1}. {scene[4]}", 13, BLUE if i == index else MUTED, i == index)
    d.rectangle((0, 647, 1199, 649), fill=BORDER)
    d.rectangle((0, 647, round((number+1)/108*1200), 649), fill=BLUE)
    return image


def make_gif(temp: Path) -> None:
    frames = temp / "frames"
    frames.mkdir()
    count = 0
    for index, (start, live, *_rest) in enumerate(SCENES):
        captures = temp / f"capture-{index}"
        captures.mkdir()
        l, t, r, b = CROP
        run("ffmpeg", "-v", "error", "-ss", start, "-t", "3", "-i", SOURCE,
            "-vf", f"fps={FPS},crop={r-l}:{b-t}:{l}:{t}", captures / "%03d.png")
        captured = sorted(captures.glob("*.png"))
        # Each beat is 18 frames. Hold after its documented clean excerpt,
        # rather than display the following input dropdown/scroll transition.
        last_clean = max(0, min(len(captured)-1, round(live*FPS)-1))
        for local in range(18):
            ui = Image.open(captured[min(local, last_clean)]).convert("RGB")
            frame = compose(index, ui, count)
            if count == 0:
                frame.save(OUT / "hero-poster.png", optimize=True)
            frame.save(frames / f"{count:04d}.png")
            count += 1
    run("ffmpeg", "-v", "error", "-y", "-framerate", FPS, "-i", frames / "%04d.png",
        "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
        "-loop", "0", OUT / "hero.gif")


def make_cover() -> None:
    image = Image.new("RGB", (1280, 720), WHITE)
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, 1279, 63), fill=BG)
    d.line((0, 63, 1279, 63), fill=BORDER)
    checkbox(d, 20, 20)
    label(d, (56, 14), "CSV 导出验收演示", 20, bold=True)
    label(d, (56, 42), "CSV export: check, fix, verify", 12, MUTED)
    d.rounded_rectangle((1190, 20, 1258, 46), radius=5, fill=WHITE, outline=BORDER)
    label(d, (1204, 27), "1:12", 14, mono=True)
    paste_ui(image, snapshot(50), (16, 72, 1264, 666))
    d.rectangle((0, 674, 1279, 719), fill=BG)
    d.line((0, 674, 1279, 674), fill=BORDER)
    label(d, (22, 690), "dsh-done-check · 实际录屏 / recorded DSH session", 13, MUTED)
    d.rounded_rectangle((1104, 682, 1258, 711), radius=5, fill=BLUE)
    d.polygon([(1119, 690), (1119, 703), (1130, 697)], fill=WHITE)
    label(d, (1140, 690), "播放 / Play", 13, WHITE, True)
    image.save(OUT / "demo-cover.jpg", quality=92, optimize=True, subsampling=0)


def verify() -> None:
    gif = Image.open(OUT / "hero.gif")
    duration = 0
    for i in range(gif.n_frames):
        gif.seek(i)
        duration += gif.info["duration"] / 1000
    assert gif.size == SIZE and abs(duration-18) < .1, (gif.size, duration)
    assert gif.info.get("loop") == 0
    assert (OUT / "hero.gif").stat().st_size < 2_500_000
    assert Image.open(OUT / "hero-poster.png").size == SIZE
    assert Image.open(OUT / "demo-cover.jpg").size == (1280, 720)
    import xml.etree.ElementTree as ET
    ET.parse(OUT / "logo.svg")
    print(json.dumps({"gif_seconds": round(duration, 2), "gif_frames": gif.n_frames,
                      "gif_bytes": (OUT / "hero.gif").stat().st_size,
                      "cover_bytes": (OUT / "demo-cover.jpg").stat().st_size,
                      "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest()}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--static-only", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not args.verify_only:
        if not shutil.which("ffmpeg"):
            raise SystemExit("ffmpeg is required on PATH")
        make_logo()
        make_cover()
        if not args.static_only:
            with tempfile.TemporaryDirectory(prefix=".readme-visuals-", dir=ROOT) as folder:
                make_gif(Path(folder))
    if not args.static_only:
        verify()


if __name__ == "__main__":
    main()
