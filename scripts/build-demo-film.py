#!/usr/bin/env python3
"""Compose a 64-second product film from authentic DSH footage.

Python 3.10+, Pillow, NumPy, ffmpeg/ffprobe. Windows SAPI supplies offline
Chinese narration; other systems can rebuild the visual film with --no-voice.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/video"
SOURCE = OUT / "dsh-done-check-demo.mp4"
W, H, FPS = 1920, 1080, 24
BLACK, CREAM, AMBER, MINT = "#111318", "#f7f4ec", "#ffbd59", "#7ee0b8"
GRAY, DIM = "#a6a8a6", "#25282d"

# Labels and narration are editorial. UI text is always real recorded pixels.
SCENES = [
    dict(start=0, end=6, code="00 / THE QUESTION", zh="“完成”，该由什么证明？", en="What makes done verifiable?",
         voice="任务交给 AI，怎样才算完成？这个 CSV，真的导对了吗？", sub="What makes an AI coding task done? Did this CSV actually export correctly?", accent=AMBER,
         shot=(40, 2.6, (814, 438, 1824, 740))),
    dict(start=6, end=14, code="01 / AGREE", zh="先约定，怎样才算通过。", en="Make the acceptance criteria executable.",
         voice="先约定验收标准。自动测试和人工检查，都放进一份清单。", sub="Agree on the checks first: executable tests and a manual check, in one checklist.", accent=AMBER,
         shot=(23.6, .4, (814, 390, 1824, 740))),
    dict(start=14, end=21, code="02 / YOUR DECISION", zh="确认权，在你手里。", en="The agent cannot confirm its own checklist.",
         voice="确认清单，只能由你完成。看清命令，再开始检查。", sub="Only you can confirm the checklist. Read the commands before running them.", accent=AMBER,
         shot=(31, .5, (814, 555, 1824, 740))),
    dict(start=21, end=29, code="03 / THE EVIDENCE", zh="失败原文，就是线索。", en="The test speaks. The evidence stays.",
         voice="缺失的引号，让两列变成三列。测试的失败报告和退出码，原样留存。", sub="Missing quotes turn two columns into three. The test report and exit code are preserved.", accent=AMBER,
         shot=(49, 4.0, (814, 365, 1824, 740))),
    dict(start=29, end=37, code="04 / FIX + RE-CHECK", zh="修好，再真正跑一次。", en="A fix earns a fresh check.",
         voice="把失败交给 Agent 修复。然后，重新运行真正的测试。", sub="Let the agent fix the failure. Then run the real checks again.", accent=MINT,
         shot=(65, 1.5, (808, 505, 1824, 670)), second=(73, 2.0, (814, 486, 1824, 740))),
    dict(start=37, end=45, code="05 / HUMAN VERDICT", zh="最后一项，需要你。", en="Automation stops where your judgment begins.",
         voice="自动检查通过，人工项仍等你。亲自验证中文文件名后，再记录通过。", sub="The automated checks pass. Verify the Chinese filename yourself, then record your verdict.", accent=MINT,
         shot=(73, 2.0, (814, 486, 1824, 740)), second=(82, 2.0, (814, 509, 1824, 740))),
    dict(start=45, end=55, code="06 / RESULTS EXPIRE", zh="旧“通过”，不会永久有效。", en="New code needs a current verdict.",
         voice="代码更新后，旧的人工结论需要重新确认。这个画面里，两项新的自动结果仍然有效。", sub="After code changes, the old manual verdict needs review. These two newer automatic results remain valid.", accent=AMBER,
         shot=(104, 3.0, (814, 534, 1824, 740))),
    dict(start=55, end=64, code="07 / YOUR NEXT TASK", zh="每句完成，都要有证据。", en="Done needs proof.",
         voice="每句完成，都要有证据。安装插件，从下一次任务开始，把完成变成可验证的记录。", sub="Done needs proof. Install the plugin and make your next task's checks verifiable.", accent=MINT),
]


def command(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)


def face(size, bold=False, mono=False):
    if mono:
        paths = ["C:/Windows/Fonts/CascadiaMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
    elif bold:
        paths = ["C:/Windows/Fonts/msyhbd.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"]
    else:
        paths = ["C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for path in paths:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    raise RuntimeError("Install Microsoft YaHei / Noto Sans CJK and Cascadia Mono / DejaVu Sans Mono.")


FONTS = {(s, b, m): face(s, b, m) for s, b, m in [
    (18, False, True), (20, False, True), (22, False, True), (24, False, False),
    (26, False, False), (28, False, False), (30, False, False), (36, False, True),
    (38, False, True), (44, True, False), (68, True, False), (88, True, False),
    (112, True, False), (170, True, False)]}


def text(draw, xy, value, size, color=CREAM, bold=False, mono=False):
    draw.text(xy, value, font=FONTS[size, bold, mono], fill=color)


def smooth(x):
    x = max(0, min(1, x))
    return x * x * (3 - 2 * x)


def sample_shot(temp, shot, number):
    start, duration, box = shot
    target = temp / f"shot-{number}"
    target.mkdir()
    x1, y1, x2, y2 = box
    command("ffmpeg", "-v", "error", "-ss", start, "-t", duration, "-i", SOURCE,
            "-vf", f"fps=8,crop={x2-x1}:{y2-y1}:{x1}:{y1}", target / "%03d.png")
    frames = [Image.open(p).convert("RGB") for p in sorted(target.glob("*.png"))]
    assert frames
    return frames


def build_base():
    im = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(im)
    for x in range(112, 1809, 212):
        d.line((x, 92, x, 1056), fill="#191c21", width=1)
    d.line((112, 93, 1808, 93), fill="#353638", width=1)
    text(d, (112, 41), "dsh-done-check", 22, CREAM, mono=True)
    text(d, (1290, 43), "DEEPSEEK HARNESS / PRODUCT FILM", 18, GRAY, mono=True)
    return im


BASE = build_base()


def fit_panel(image, width, height):
    result = Image.new("RGB", (width, height), "#f7f8fa")
    # Keep recorded text clear of the camera-push crop and rounded corners.
    scale = min((width-48) / image.width, (height-30) / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    result.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return result


def ui_panel(canvas, image, local, duration, accent, y=320, height=548):
    # A small camera push happens inside the authentic panel, never changing text.
    width = 1696
    push = 1 + .016 * smooth(local / duration)
    panel = fit_panel(image, width, height)
    if push > 1:
        enlarged = panel.resize((round(width * push), round(height * push)), Image.Resampling.BICUBIC)
        x, yy = (enlarged.width - width) // 2, (enlarged.height - height) // 2
        panel = enlarged.crop((x, yy, x + width, yy + height))
    mask = Image.new("L", (width, height), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, width-1, height-1), radius=16, fill=255)
    reveal = smooth(local / .48)
    if reveal < 1:
        md.rectangle((round(width * reveal), 0, width, height), fill=0)
    canvas.paste(panel, (112, y), mask)
    d = ImageDraw.Draw(canvas)
    d.line((112, y-14, 112+round(220*reveal), y-14), fill=accent, width=3)


def wrap(draw, value, font, width):
    rows, line = [], ""
    # Word wrapping for English; Chinese lines fit within the intended width.
    for word in value.split(" "):
        nxt = (line + " " + word).strip()
        if draw.textlength(nxt, font=font) > width and line:
            rows.append(line)
            line = word
        else:
            line = nxt
    return rows + [line]


def render_frame(t, shots):
    index = next((i for i, s in enumerate(SCENES) if s["start"] <= t < s["end"]), len(SCENES)-1)
    s = SCENES[index]
    local, duration = t-s["start"], s["end"]-s["start"]
    accent = s["accent"]
    canvas = BASE.copy()
    d = ImageDraw.Draw(canvas)
    # Editorial typography moves in separately from the recorded UI.
    title_y = round(151 + 12*(1-smooth(local/.6)))
    text(d, (114, 113), s["code"], 20, accent, mono=True)
    text(d, (110, title_y), s["zh"], 68, CREAM, bold=True)
    text(d, (114, 247), s["en"], 28, GRAY)
    text(d, (1657, 125), f"{index:02}", 88, "#2b2d30", bold=True)

    if index == 7:
        # A separate install end card, not a simulated terminal session.
        text(d, (112, 362), "dsh-done-check", 112, CREAM, bold=True)
        text(d, (117, 514), "INSTALL IN YOUR PROFILE", 20, MINT, mono=True)
        d.rounded_rectangle((112, 560, 1808, 671), 13, fill="#1c2222", outline="#385549", width=2)
        install = "dsh plugin --profile <your-profile> add dsh-done-check"
        count = round(len(install) * smooth((local-.7)/2.1))
        text(d, (146, 595), install[:count] + ("▏" if local < 3.4 else ""), 38, CREAM, mono=True)
        text(d, (116, 725), "THEN, IN CHAT", 20, GRAY, mono=True)
        text(d, (116, 770), "/done-check", 44, MINT, bold=True)
        text(d, (116, 854), "github.com/BeforeLanding/dsh-done-check", 24, GRAY)
    else:
        source_label = "RECORDED DSH OUTPUT / CROP + EDIT / NOT REAL-TIME"
        text(d, (114, 289), source_label, 18, GRAY, mono=True)
        which = "primary"
        if index in (4, 5) and local >= 3.6:
            which = "secondary"
        frame_set = shots[index][which]
        elapsed = max(0, local - (3.6 if which == "secondary" else 0))
        # B-roll runs once, then holds so viewers can read its evidence.
        sample = min(len(frame_set)-1, round(elapsed*8))
        image = frame_set[sample]
        if index == 2:
            text(d, (114, 359), "/done-check confirm", 44, AMBER, bold=True)
            text(d, (114, 430), "USER-ONLY ACTION", 18, GRAY, mono=True)
            ui_panel(canvas, image, local, duration, accent, y=489, height=355)
        elif index == 4 and which == "primary":
            ui_panel(canvas, image, local, duration, accent, y=350, height=450)
        else:
            ui_panel(canvas, image, elapsed, duration-(3.6 if which == "secondary" else 0), accent)
        d = ImageDraw.Draw(canvas)
        if index == 0:
            text(d, (114, 901), "CSV EXPORT / EXPECTED 2 COLUMNS / GOT 3", 20, AMBER, mono=True)
        elif index == 3:
            text(d, (114, 901), "ORIGINAL TEST REPORT  +  EXIT CODE  +  RECORDED OUTPUT", 20, AMBER, mono=True)
        elif index == 4:
            text(d, (114, 901), "01  AGENT FIX" if which == "primary" else "02  FRESH AUTOMATED CHECKS", 20, MINT, mono=True)
        elif index == 5:
            text(d, (114, 901), "WAITING FOR YOU" if which == "primary" else "YOUR MANUAL VERDICT RECORDED", 20, MINT, mono=True)
        elif index == 6:
            text(d, (114, 901), "OLD MANUAL VERDICT: STALE  /  TWO NEW AUTOMATIC RESULTS: VALID", 20, AMBER, mono=True)

    d = ImageDraw.Draw(canvas)
    # Full narration text is burned in, independently from real UI messages.
    text(d, (114, 960), s["voice"], 30, CREAM)
    rows = wrap(d, s["sub"], FONTS[24, False, False], 1696)
    assert len(rows) == 1, (index, rows)
    text(d, (114, 1006), rows[0], 24, GRAY)
    for n, other in enumerate(SCENES):
        x = 112 + round(other["start"] / 64 * 1696)
        width = round((other["end"]-other["start"])/64*1696)-5
        d.rectangle((x, 1056, x+width, 1060), fill=DIM)
    d.rectangle((112, 1056, 112+round(t/64*1696), 1060), fill=accent)
    # Brief dip-to-black transitions separate acts without hiding evidence.
    dip = max(0, 1-local/.18) if index > 0 else 0
    if dip:
        canvas = Image.blend(canvas, Image.new("RGB", canvas.size, BLACK), dip*.85)
    return canvas


def timestamp(second):
    ms = round(second * 1000)
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}"


def captions_and_chapters(temp):
    for lang, key in [("zh-CN", "voice"), ("en", "sub")]:
        lines = ["WEBVTT", ""]
        for s in SCENES:
            lines.extend([f'{timestamp(s["start"])} --> {timestamp(s["end"])}', s[key], ""])
        (OUT / f"film.{lang}.vtt").write_text("\n".join(lines), encoding="utf-8")
    meta = [";FFMETADATA1", "title=dsh-done-check / Done needs proof", "comment=Real DSH footage; editorial crops and holds; offline synthetic Chinese narration."]
    for s in SCENES:
        meta.extend(["[CHAPTER]", "TIMEBASE=1/1000", f'START={s["start"]*1000}', f'END={s["end"]*1000}', f'title={s["code"]}'])
    path = temp / "chapters.txt"
    path.write_text("\n".join(meta)+"\n", encoding="utf-8")
    return path


def make_narration(temp, silent=False):
    rate = 48000
    soundtrack = np.zeros(64*rate, dtype=np.float64)
    if not silent:
        lines = [dict(text=s["voice"], path=str(temp / f"voice-{i}.wav")) for i, s in enumerate(SCENES)]
        (temp / "narration.json").write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8-sig")
        ps = r'''$ErrorActionPreference='Stop'
$voice=New-Object -ComObject SAPI.SpVoice
$token=New-Object -ComObject SAPI.SpObjectToken
$token.SetId('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_ZH-CN_HUIHUI_11.0')
$voice.Voice=$token
$voice.Rate=0
$rows=Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'narration.json') | ConvertFrom-Json
foreach($row in $rows){
 $stream=New-Object -ComObject SAPI.SpFileStream
 $stream.Open($row.path,3,$false)
 $voice.AudioOutputStream=$stream
 $null=$voice.Speak($row.text)
 $stream.Close()
}
'''
        script = temp / "narrate.ps1"
        script.write_text(ps, encoding="utf-8-sig")
        command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script)
        for i, s in enumerate(SCENES):
            raw = temp / f"voice-{i}.wav"
            probe = command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw, stdout=subprocess.PIPE, text=True)
            available = s["end"]-s["start"]-.8
            speed = max(1, float(probe.stdout.strip())/available)
            target = temp / f"voice-mono-{i}.wav"
            command("ffmpeg", "-v", "error", "-y", "-i", raw, "-af", f"atempo={speed:.5f},loudnorm=I=-18:TP=-2:LRA=7", "-ar", rate, "-ac", 1, "-c:a", "pcm_s16le", target)
            with wave.open(str(target), "rb") as wav:
                data = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(float)/32768
            start = round((s["start"]+.4)*rate)
            soundtrack[start:start+len(data)] += data
    # Original unobtrusive chapter accents, no downloaded music or samples.
    for i, s in enumerate(SCENES):
        length = .24
        t = np.arange(round(length*rate))/rate
        bell = (np.sin(2*np.pi*(660 if i<4 else 880)*t) + .25*np.sin(2*np.pi*1320*t))*np.exp(-t*23)
        bell *= .035 * np.minimum(1,t/.008)
        start = round((s["start"]+.05)*rate)
        soundtrack[start:start+len(bell)] += bell
    soundtrack = np.clip(soundtrack, -.98, .98)
    path = temp / "soundtrack.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate)
        wav.writeframes((soundtrack*32767).astype("<i2").tobytes())
    return path


def verify():
    film = OUT / "dsh-done-check-film.mp4"
    p = command("ffprobe", "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", film, stdout=subprocess.PIPE, encoding="utf-8")
    data = json.loads(p.stdout)
    vid = next(x for x in data["streams"] if x["codec_type"] == "video")
    assert (vid["width"],vid["height"]) == (W,H)
    assert vid["codec_name"] == "h264" and vid["pix_fmt"] == "yuv420p"
    assert 63.98 <= float(data["format"]["duration"]) <= 64.1
    assert sum(x["codec_type"] == "audio" for x in data["streams"]) == 1
    assert sum(x["codec_type"] == "subtitle" for x in data["streams"]) == 2
    assert len(data["chapters"]) == 8
    print(json.dumps({"seconds":data["format"]["duration"],"bytes":film.stat().st_size,"chapters":len(data["chapters"]),"source_sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest()},indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--no-voice", action="store_true", help="No system narration; retain captions and original chapter accents")
    args = parser.parse_args()
    if args.verify_only:
        verify(); return
    with tempfile.TemporaryDirectory(prefix=".film-build-", dir=ROOT) as name:
        temp = Path(name)
        assert temp.resolve().is_relative_to(ROOT.resolve())
        shots = {}
        for i,s in enumerate(SCENES):
            if "shot" in s:
                shots[i] = {"primary": sample_shot(temp, s["shot"], f"{i}-a")}
                if "second" in s:
                    shots[i]["secondary"] = sample_shot(temp,s["second"],f"{i}-b")
        if args.preview_only:
            contact = Image.new("RGB", (1920,2160), BLACK)
            for i,s in enumerate(SCENES):
                frame = render_frame(s["start"]+min(4,(s["end"]-s["start"])/2),shots)
                frame = frame.resize((960,540),Image.Resampling.LANCZOS)
                contact.paste(frame,((i%2)*960,(i//2)*540))
            preview = ROOT.parent / "dsh-film-preview.jpg"
            contact.save(preview, quality=92)
            print(preview); return
        metadata = captions_and_chapters(temp)
        audio = make_narration(temp,args.no_voice)
        silent = temp / "visual.mp4"
        proc = subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p",str(silent)],stdin=subprocess.PIPE)
        try:
            for n in range(64*FPS):
                frame = render_frame(n/FPS,shots)
                proc.stdin.write(frame.tobytes())
                if n % (8*FPS) == 0:
                    print(f"Rendered {n/FPS:.0f}/64 seconds",flush=True)
        finally:
            proc.stdin.close()
        if proc.wait():
            raise RuntimeError("Video encoder failed")
        command("ffmpeg","-v","error","-y","-i",silent,"-i",audio,"-f","ffmetadata","-i",metadata,"-i",OUT/"film.zh-CN.vtt","-i",OUT/"film.en.vtt","-map","0:v","-map","1:a","-map","3:s","-map","4:s","-map_metadata","2","-map_chapters","2","-c:v","copy","-c:a","aac","-b:a","160k","-c:s","mov_text","-metadata:s:a:0","language=zho","-metadata:s:a:0","title=Offline synthetic Chinese narration","-metadata:s:s:0","language=zho","-metadata:s:s:1","language=eng","-movflags","+faststart",OUT/"dsh-done-check-film.mp4")
    verify()


if __name__ == "__main__":
    main()
