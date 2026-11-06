#!/usr/bin/env python3
"""Build original README artwork around authentic, unmodified DSH footage.

Rebuilds the current branded visual assets from source footage. Requires Pillow,
ffmpeg and ffprobe. Writes only docs/images and a temporary checkout folder.
The SVG banner is a conceptual diagram, not a reconstructed application UI.
"""
from __future__ import annotations

import argparse
import hashlib
import html
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
BLACK = "#111318"
CREAM = "#f7f4ec"
AMBER = "#ffbd59"
MINT = "#7ee0b8"
MUTED = "#b9b7af"
LINE = "#34363b"
FPS = 8
SIZE = (1280, 720)

# Source in, crop (left/top/right/bottom), title, subtitle, editorial label.
# Every screenshot remains a contiguous crop of the original recording.
SCENES = [
    (40.0, (825, 438, 1824, 660), "A real test catches it.", "真实 CSV 测试：引号转义有误", "FAIL"),
    (49.0, (800, 350, 1840, 740), "The evidence stays.", "命令、退出码、原始输出，都有记录", "EVIDENCE"),
    (78.5, (800, 450, 1840, 740), "The decision is yours.", "自动检查通过后，人工项仍由你确认", "YOU DECIDE"),
    (93.0, (814, 314, 1824, 604), "The code moved on.", "代码改动后，旧结果需要重新检查", "STALE"),
]


def execute(*args: object, capture: bool = False) -> bytes | None:
    result = subprocess.run([str(x) for x in args], check=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        ["C:/Windows/Fonts/CascadiaMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"] if mono else
        ["C:/Windows/Fonts/msyhbd.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"] if bold else
        ["C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    )
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise RuntimeError("Install Microsoft YaHei or Noto Sans CJK; a mono font is also required.")


def text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, size: int,
         fill: str = CREAM, bold: bool = False, mono: bool = False) -> None:
    draw.text(xy, value, font=font(size, bold, mono), fill=fill, anchor="lt")


def icon(draw: ImageDraw.ImageDraw, x: int, y: int, scale: int = 28, color: str = AMBER) -> None:
    draw.rounded_rectangle((x, y, x + scale, y + scale), radius=scale // 5, outline=color, width=max(2, scale // 12))
    draw.line([(x + scale * .23, y + scale * .51), (x + scale * .43, y + scale * .70),
               (x + scale * .78, y + scale * .28)], fill=color, width=max(2, scale // 10))


def snapshot(second: float, box: tuple[int, int, int, int]) -> Image.Image:
    data = execute("ffmpeg", "-v", "error", "-ss", second, "-i", SOURCE,
                   "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-", capture=True)
    return Image.open(io.BytesIO(data)).convert("RGB").crop(box)


class Banner:
    """Produce the same simple original composition as SVG and raster PNG."""
    def __init__(self) -> None:
        self.image = Image.new("RGB", (1200, 400), BLACK)
        self.draw = ImageDraw.Draw(self.image)
        self.svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img">',
                    '<rect width="1200" height="400" fill="#111318"/>']

    def rect(self, box: tuple[int, int, int, int], fill: str, radius: int = 0,
             stroke: str | None = None, width: int = 2) -> None:
        x, y, r, b = box
        self.draw.rounded_rectangle(box, radius, fill, stroke, width)
        self.svg.append(f'<rect x="{x}" y="{y}" width="{r-x}" height="{b-y}" rx="{radius}" fill="{fill}"' +
                        (f' stroke="{stroke}" stroke-width="{width}"' if stroke else '') + '/>')

    def line(self, points: list[tuple[float, float]], fill: str, width: int = 2) -> None:
        self.draw.line(points, fill=fill, width=width, joint="curve")
        self.svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in points)}" fill="none" stroke="{fill}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')

    def type(self, x: int, y: int, value: str, size: int, fill: str = CREAM,
             bold: bool = False, mono: bool = False) -> None:
        text(self.draw, (x, y), value, size, fill, bold, mono)
        family = "Cascadia Mono,DejaVu Sans Mono,monospace" if mono else "Microsoft YaHei,Noto Sans CJK SC,Arial,sans-serif"
        self.svg.append(f'<text x="{x}" y="{y+size*.88}" font-family="{family}" font-size="{size}" font-weight="{700 if bold else 400}" fill="{fill}">{html.escape(value)}</text>')

    def save(self, stem: str, description: str) -> None:
        self.svg.insert(1, f'<title>{html.escape(description)}</title>')
        (OUT / f"{stem}.svg").write_text("\n".join(self.svg) + "\n</svg>\n", encoding="utf-8")
        self.image.save(OUT / f"{stem}.png", optimize=True)


def make_banner(chinese: bool = False) -> None:
    b = Banner()
    b.rect((42, 32, 70, 60), BLACK, 6, AMBER)
    b.line([(49, 46), (55, 52), (64, 39)], AMBER, 3)
    b.type(84, 35, "dsh-done-check", 18, CREAM, True, True)
    b.type(42, 105, "完成了？" if chinese else "Done is a claim.", 59, CREAM, True)
    b.type(42, 188, "拿检查结果来。" if chinese else "Show the proof.", 59, AMBER, True)
    b.type(44, 286, "真实检查。证据留存。代码变了，重新验收。" if chinese else "Real checks. Recorded evidence. Fresh verdicts.", 18, MUTED)
    b.line([(42, 344), (1158, 344)], LINE, 1)
    b.type(44, 366, "DEEPSEEK HARNESS PLUGIN", 12, MUTED, mono=True)
    b.type(868, 366, "RUN / RECORD / RE-CHECK", 12, MUTED, mono=True)
    b.type(704, 78, "工作方式 / 概念示意" if chinese else "HOW IT WORKS / CONCEPT", 12, MUTED, mono=not chinese)
    for i, (label, color) in enumerate([("FAIL", AMBER), ("VERIFY", MINT), ("STALE", AMBER)]):
        x = 704 + i * 154
        b.rect((x, 114, x + 126, 285), "#1b1e24", 12, LINE, 1)
        b.type(x+15, 130, f"0{i+1}", 11, MUTED, mono=True)
        b.rect((x+16, 164, x+50, 198), BLACK, 6, color, 2)
        if i == 0:
            b.line([(x+26, 174), (x+40, 188)], color, 3)
            b.line([(x+40, 174), (x+26, 188)], color, 3)
        elif i == 1:
            b.line([(x+23, 181), (x+31, 189), (x+44, 173)], color, 3)
        else:
            b.line([(x+32, 171), (x+32, 182), (x+40, 185)], color, 3)
        b.type(x+16, 220, label, 17, color, True, True)
        b.line([(x+16, 255), (x+100, 255)], LINE, 2)
        b.line([(x+16, 263), (x+79, 263)], LINE, 2)
        if i < 2:
            b.line([(x+132, 202), (x+148, 202), (x+143, 197), (x+148, 202), (x+143, 207)], MUTED, 1)
    stem = "readme-banner.zh-CN" if chinese else "readme-banner"
    b.save(stem, "完成了？拿检查结果来。" if chinese else "Done is a claim. Show the proof.")


def framed_report(canvas: Image.Image, report: Image.Image, box: tuple[int, int, int, int],
                  motion: float = 0) -> None:
    x, y, r, b = box
    width, height = r-x, b-y
    # The white recorded UI is never painted over or reworded. Its full crop is
    # contained in a native editorial frame, scaled uniformly with no stretching.
    panel = Image.new("RGB", (width, height), "#f8f9fb")
    ratio = min((width-26)/report.width, (height-18)/report.height)
    report = report.resize((round(report.width*ratio), round(report.height*ratio)), Image.Resampling.LANCZOS)
    panel.paste(report, ((width-report.width)//2, (height-report.height)//2))
    if motion:
        x += round(motion)
    mask = Image.new("L", panel.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width-1, height-1), radius=12, fill=255)
    canvas.paste(panel, (x, y), mask)


def hero_frame(index: int, report: Image.Image, frame: int) -> Image.Image:
    image = Image.new("RGB", SIZE, BLACK)
    d = ImageDraw.Draw(image)
    icon(d, 40, 29, 23)
    text(d, (76, 32), "dsh-done-check", 16, CREAM, True, True)
    text(d, (898, 34), "ONE REAL SESSION / EDITED", 12, MUTED, mono=True)
    _, _, title, subtitle, label = SCENES[index]
    accent = MINT if index == 2 else AMBER
    text(d, (38, 85), f"0{index+1}", 73, accent, bold=True, mono=True)
    text(d, (175, 92), title, 46, CREAM, True)
    text(d, (178, 152), subtitle, 24, MUTED)
    # A short entrance glide introduces each chapter; the remainder is a
    # continuous authentic excerpt, not a slideshow of reconstructed screens.
    local = frame % 32
    shift = 36 * (1-local/3)**2 if index and local < 3 else 0
    framed_report(image, report, (40, 211, 1240, 618), shift)
    text(d, (42, 638), "REAL OUTPUT / 实际录屏", 11, MUTED)
    labels = ["01 FAIL", "02 EVIDENCE", "03 YOU DECIDE", "04 STALE"]
    for n, value in enumerate(labels):
        x = 40+n*303
        if n == index:
            d.rounded_rectangle((x, 660, x+286, 695), radius=6, fill=accent)
        text(d, (x+12, 671), value, 13, BLACK if n == index else MUTED, n == index, True)
    d.rectangle((0, 714, 1279, 719), fill=LINE)
    d.rectangle((0, 714, round((frame+1)/128*1280), 719), fill=accent)
    return image


def make_hero(temp: Path) -> None:
    frames = temp / "frames"
    frames.mkdir()
    count = 0
    for index, (start, box, *_rest) in enumerate(SCENES):
        captures = temp / f"capture-{index}"
        captures.mkdir()
        left, top, right, bottom = box
        execute("ffmpeg", "-v", "error", "-ss", start, "-t", "4", "-i", SOURCE,
                "-vf", f"fps={FPS},crop={right-left}:{bottom-top}:{left}:{top}", captures / "%03d.png")
        capture_paths = sorted(captures.glob("*.png"))
        for local, path in enumerate(capture_paths):
            # The source opens the next slash-command menu near 0:43. Hold
            # the clean 0:42 report for the remainder of this four-second beat.
            if index == 0 and local > 16:
                path = capture_paths[16]
            frame = hero_frame(index, Image.open(path).convert("RGB"), count)
            if count == 0:
                frame.save(OUT / "hero-poster.png", optimize=True)
            frame.save(frames / f"{count:04d}.png")
            count += 1
    execute("ffmpeg", "-v", "error", "-y", "-framerate", FPS, "-i", frames / "%04d.png",
            "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
            "-loop", "0", OUT / "hero.gif")


def make_cover() -> None:
    image = Image.new("RGB", (1600, 900), BLACK)
    d = ImageDraw.Draw(image)
    icon(d, 64, 38, 30)
    text(d, (110, 42), "dsh-done-check", 23, CREAM, True, True)
    text(d, (1164, 47), "A REAL DSH SESSION", 15, MUTED, mono=True)
    text(d, (58, 113), "Done needs proof.", 88, CREAM, True)
    text(d, (58, 220), "Start with a real test.", 88, AMBER, True)
    text(d, (66, 339), "完成，要有检查为证。", 30, MUTED)
    d.rounded_rectangle((1128, 322, 1536, 385), radius=31, fill=MINT)
    d.polygon([(1152, 339), (1152, 367), (1175, 353)], fill=BLACK)
    text(d, (1194, 343), "WATCH DEMO / 1:04", 21, BLACK, True, True)
    report = snapshot(40, (814, 438, 1824, 740))
    framed_report(image, report, (64, 416, 1536, 848))
    text(d, (66, 873), "RECORDED OUTPUT. REAL CHECKS. / 原始录屏 · 真实检查", 12, MUTED)
    image.save(OUT / "demo-cover.jpg", quality=92, optimize=True, subsampling=0)


def make_features() -> None:
    samples = [
        ("feature-evidence", 51, (814, 367, 1824, 740), "Recorded, not claimed.", "命令、退出码与测试原文输出", "01 / EVIDENCE"),
        ("feature-human", 73, (814, 486, 1824, 740), "Your verdict. Your call.", "自动检查已通过，人工项仍等你确认", "02 / HUMAN"),
        ("feature-stale", 94, (814, 314, 1824, 604), "Old code. Old result.", "代码改动后，旧结果提示需要重新检查", "03 / STALE"),
    ]
    for stem, second, box, title, subtitle, label in samples:
        report = snapshot(second, box)
        image = Image.new("RGB", (1280, 720), BLACK)
        d = ImageDraw.Draw(image)
        text(d, (42, 32), label, 15, MINT if stem == "feature-human" else AMBER, True, True)
        text(d, (40, 83), title, 48, CREAM, True)
        text(d, (44, 151), subtitle, 24, MUTED)
        framed_report(image, report, (40, 212, 1240, 660))
        text(d, (42, 691), "AUTHENTIC DSH CAPTURE / 实际录屏；标题为编辑注释", 11, MUTED)
        image.save(OUT / f"{stem}.png", optimize=True)


def verify() -> None:
    gif = Image.open(OUT / "hero.gif")
    seconds = 0
    for i in range(gif.n_frames):
        gif.seek(i)
        seconds += gif.info["duration"] / 1000
    assert gif.size == SIZE and abs(seconds-16) < .05, (gif.size, seconds)
    assert gif.info.get("loop") == 0
    assert (OUT / "hero.gif").stat().st_size < 2_000_000
    assert Image.open(OUT / "demo-cover.jpg").size == (1600, 900)
    for stem in ["readme-banner", "readme-banner.zh-CN"]:
        assert Image.open(OUT / f"{stem}.png").size == (1200, 400)
        assert '<script' not in (OUT / f"{stem}.svg").read_text(encoding="utf-8")
    print(json.dumps({"gif_seconds": round(seconds, 2), "gif_frames": gif.n_frames,
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
        make_banner()
        make_banner(True)
        make_cover()
        make_features()
        if not args.static_only:
            with tempfile.TemporaryDirectory(prefix=".readme-visuals-", dir=ROOT) as folder:
                make_hero(Path(folder))
    if not args.static_only:
        verify()


if __name__ == "__main__":
    main()
