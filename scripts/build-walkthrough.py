#!/usr/bin/env python3
"""Build the 72-second chronological DSH usage tutorial from real footage.

Requires Python 3.10+, Pillow, NumPy, ffmpeg/ffprobe; the default offline Chinese
narration uses the installed Windows SAPI Huihui voice. --no-voice is portable.
"""
from __future__ import annotations

import argparse
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/video"
SOURCE = OUT / "dsh-done-check-demo.mp4"
FILM = OUT / "walkthrough.mp4"
W, H, FPS, SOURCE_FPS = 1920, 1080, 24, 12
LIGHT, WHITE, TEXT, BLUE, MUTED, LINE = "#f6f8fa", "#ffffff", "#1f2328", "#0969da", "#656d76", "#d0d7de"
# 1872 × 842 recorded pixels occupy 76% of each operational frame.
VIEW = (24, 80, 1896, 922)

# Every crop is inside the authentic right-hand DSH window of the source.
# A clip plays once, then holds its last frame for reading; it never loops.
STEPS = [
 dict(start=0,end=7,name="项目与验收清单",command="done-check.yaml",
      zh="在 CSV 项目根目录准备验收清单，包含两项自动测试和一项人工检查。",
      en="Prepare done-check.yaml in the CSV project: two automated tests and one manual check.",
      shots=[(9.5,3,(790,170,1848,647),7)]),
 dict(start=7,end=14,name="预览清单",command="/done-check",
      zh="输入主命令，先预览三项检查和将要运行的命令，此时不会执行测试。",
      en="Preview the three checks and their commands. No tests run during this preview.",
      shots=[(17.5,6.5,(790,290,1848,767),7)]),
 dict(start=14,end=20,name="确认清单",command="/done-check 确认",
      zh="核对清单后输入确认命令。清单确认和人工结论，都只能由用户提交。",
      en="Review and confirm the checklist. Only the user can confirm it or submit a manual verdict.",
      shots=[(25.5,6,(790,400,1848,877),6)]),
 dict(start=20,end=28,name="执行检查",command="/done-check",
      zh="再次输入主命令执行检查。CSV 转义测试失败，输出直接引用测试报告。",
      en="Run the checks. The CSV escaping test fails, and its original report is shown.",
      shots=[(33,3,(790,438,1848,915),3),(40,2,(790,438,1848,915),5)]),
 dict(start=28,end=35,name="查看失败证据",command="/done-check details 2",
      zh="用详情命令查看第二项。这里保留了原始错误、执行命令和退出码一。",
      en="Inspect check 2: the original error, executed command and exit code 1 are preserved.",
      shots=[(49,4,(790,365,1848,842),7)]),
 dict(start=35,end=45,name="修复并重新检查",command="让 Agent 修复代码 → /done-check",
      zh="让 Agent 修复转义逻辑，再输入主命令重跑。两项自动检查通过，一项仍等你确认。",
      en="Ask the agent to fix escaping, then re-run. Both automated checks pass; the manual item waits.",
      shots=[(63,4.5,(790,300,1848,777),4.5),(70,5.5,(790,438,1848,915),5.5)]),
 dict(start=45,end=53,name="提交人工验收结果",command="/done-check ok",
      zh="亲自验证中文文件名，随后输入 ok 记录人工验收通过。三项约定检查现在全部通过。",
      en="Verify the Chinese filename yourself, then record ok. All three agreed checks now pass.",
      shots=[(77,7.5,(790,438,1848,915),8)]),
 dict(start=53,end=62,name="代码修改后查看状态",command="/done-check all",
      zh="修改源码后查看全部检查。三项旧结果都已过期，详情仍保留上次运行记录。",
      en="After a source edit, all three old results are stale. Their previous run records remain visible.",
      shots=[(89,8,(790,280,1848,757),9)]),
 dict(start=62,end=68,name="重新检查当前代码",command="/done-check",
      zh="再次执行主命令，自动项会重新检查。人工项仍需你重新验证并确认。",
      en="Re-run against the current code. The manual item still needs your fresh verification.",
      shots=[(100,5,(790,438,1848,915),6)]),
 dict(start=68,end=72,name="安装与下一步",command="安装命令 / Installation",
      zh="按 README 安装插件，即可使用这些命令。",
      en="Install the plugin using the README, then use these commands in your DSH chat.",shots=[]),
]


def run(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)


@lru_cache(maxsize=32)
def font(size, bold=False, mono=False):
    if mono:
        paths=["C:/Windows/Fonts/CascadiaMono.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
    elif bold:
        paths=["C:/Windows/Fonts/msyhbd.ttc","/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"]
    else:
        paths=["C:/Windows/Fonts/msyh.ttc","/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for path in paths:
        if Path(path).is_file():
            return ImageFont.truetype(path,size)
    raise RuntimeError("Install Microsoft YaHei / Noto Sans CJK and Cascadia Mono / DejaVu Sans Mono.")


def put(d,xy,value,size=26,color=TEXT,bold=False,mono=False):
    d.text(xy,value,font=font(size,bold,mono),fill=color)


def extract(temp):
    clips={}
    for i,step in enumerate(STEPS):
        clips[i]=[]
        for j,(start,duration,box,display) in enumerate(step["shots"]):
            folder=temp/f"step-{i}-{j}"
            folder.mkdir()
            x1,y1,x2,y2=box
            run("ffmpeg","-v","error","-ss",start,"-t",duration,"-i",SOURCE,
                "-vf",f"fps={SOURCE_FPS},crop={x2-x1}:{y2-y1}:{x1}:{y1}",folder/"%04d.png")
            paths=sorted(folder.glob("*.png"))
            assert paths
            clips[i].append((paths,display))
    return clips


@lru_cache(maxsize=8)
def recorded_frame(path):
    im=Image.open(path).convert("RGB")
    # Uniform scale and less than 1px of aspect-fit crop; no camera animation.
    return ImageOps.fit(im,(VIEW[2]-VIEW[0],VIEW[3]-VIEW[1]),method=Image.Resampling.LANCZOS)


def chapter_base(index):
    s=STEPS[index]
    im=Image.new("RGB",(W,H),LIGHT)
    d=ImageDraw.Draw(im)
    d.rectangle((0,0,W,65),fill=WHITE)
    d.line((0,65,W,65),fill=LINE,width=1)
    put(d,(24,17),"dsh-done-check",24,BLUE,mono=True)
    put(d,(342,16),f"{index+1:02}/{len(STEPS):02}  {s['name']}",26,bold=True)
    command=s["command"]
    command_font=font(25)
    width=d.textlength(command,font=command_font)
    put(d,(W-28-width,18),command,25,BLUE)
    d.rectangle((23,79,1897,923),outline=LINE,width=1)
    put(d,(24,936),"真实 DSH 会话 · 已裁切并压缩等待 / Recorded session · cropped, waits shortened",17,MUTED)
    assert d.textlength(s["zh"],font=font(28))<1872
    assert d.textlength(s["en"],font=font(22))<1872
    put(d,(24,971),s["zh"],28)
    put(d,(24,1018),s["en"],22,MUTED)
    if not s["shots"]:
        d.rectangle(VIEW,fill=WHITE)
        put(d,(88,174),"Install dsh-done-check",42,bold=True)
        put(d,(88,258),"DSH >=0.1.5-rc.1 <0.3.0  ·  Node.js >=22.19  ·  git",25,MUTED)
        d.rounded_rectangle((88,340,1832,463),radius=8,fill=LIGHT,outline=LINE)
        put(d,(122,381),"dsh plugin --profile <your-profile> add dsh-done-check",34,mono=True)
        put(d,(88,532),"在 DSH 对话中 / In your DSH chat",28,bold=True)
        put(d,(88,602),"/done-check",38,BLUE,mono=True)
        put(d,(88,715),"清单示例、命令说明和版本要求见 README。",27)
        put(d,(88,771),"github.com/BeforeLanding/dsh-done-check",26,MUTED)
        put(d,(88,853),"指令卡：此处未执行安装 / Instructions only; installation is not executed here.",21,MUTED)
    return im


BASES=[chapter_base(i) for i in range(len(STEPS))]


def frame_at(t,clips):
    index=next((i for i,s in enumerate(STEPS) if s["start"]<=t<s["end"]),len(STEPS)-1)
    im=BASES[index].copy()
    elapsed=t-STEPS[index]["start"]
    for paths,display in clips[index]:
        if elapsed<display:
            # Playback at 1x for the excerpt, followed by an explicit final hold.
            sample=min(len(paths)-1,int(elapsed*SOURCE_FPS))
            im.paste(recorded_frame(paths[sample]),VIEW[:2])
            break
        elapsed-=display
    d=ImageDraw.Draw(im)
    d.rectangle((0,1076,round(t/72*W),1079),fill=BLUE)
    return im


def stamp(seconds):
    ms=round(seconds*1000)
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}"


def metadata_and_subtitles(temp):
    for lang,key in [("zh-CN","zh"),("en","en")]:
        lines=["WEBVTT",""]
        for s in STEPS:
            lines.extend([f"{stamp(s['start'])} --> {stamp(s['end'])}",s[key],""])
        (OUT/f"walkthrough.{lang}.vtt").write_text("\n".join(lines),encoding="utf-8")
    lines=[";FFMETADATA1","title=dsh-done-check / CSV acceptance walkthrough",
           "comment=Authentic DSH excerpts; cropped and held for reading. Offline synthetic Chinese narration."]
    for i,s in enumerate(STEPS):
        lines.extend(["[CHAPTER]","TIMEBASE=1/1000",f"START={s['start']*1000}",f"END={s['end']*1000}",f"title={i+1:02} {s['name']}"])
    path=temp/"chapters.txt"
    path.write_text("\n".join(lines)+"\n",encoding="utf-8")
    return path


def narration(temp,no_voice):
    sr=48000
    soundtrack=np.zeros(72*sr,dtype=np.float64)
    if not no_voice:
        rows=[dict(text=s["zh"],path=str(temp/f"voice-{i}.wav")) for i,s in enumerate(STEPS)]
        (temp/"narration.json").write_text(json.dumps(rows,ensure_ascii=False),encoding="utf-8-sig")
        ps=r'''$ErrorActionPreference='Stop'
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
        script=temp/"narrate.ps1"
        script.write_text(ps,encoding="utf-8-sig")
        run("powershell","-NoProfile","-ExecutionPolicy","Bypass","-File",script)
        for i,s in enumerate(STEPS):
            source=temp/f"voice-{i}.wav"
            duration=float(run("ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",source,stdout=subprocess.PIPE,text=True).stdout)
            speed=max(1,duration/(s["end"]-s["start"]-.5))
            target=temp/f"normalized-{i}.wav"
            run("ffmpeg","-v","error","-y","-i",source,"-af",f"atempo={speed:.5f},loudnorm=I=-18:TP=-2:LRA=7","-ar",sr,"-ac",1,"-c:a","pcm_s16le",target)
            with wave.open(str(target),"rb") as wav:
                data=np.frombuffer(wav.readframes(wav.getnframes()),dtype="<i2").astype(float)/32768
            start=round((s["start"]+.25)*sr)
            soundtrack[start:start+len(data)]+=data
    # No music, sonic branding or extra effects: only the tutorial narration.
    path=temp/"narration.wav"
    with wave.open(str(path),"wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sr)
        wav.writeframes((np.clip(soundtrack,-.98,.98)*32767).astype("<i2").tobytes())
    return path


def verify():
    data=json.loads(run("ffprobe","-v","error","-show_format","-show_streams","-show_chapters","-of","json",FILM,stdout=subprocess.PIPE,encoding="utf-8").stdout)
    vid=next(s for s in data["streams"] if s["codec_type"]=="video")
    assert (vid["width"],vid["height"])==(W,H)
    assert vid["codec_name"]=="h264" and vid["pix_fmt"]=="yuv420p"
    assert 71.99<=float(data["format"]["duration"])<=72.1
    assert len(data["chapters"])==len(STEPS)
    assert sum(s["codec_type"]=="audio" for s in data["streams"])==1
    assert sum(s["codec_type"]=="subtitle" for s in data["streams"])==2
    print(json.dumps({"seconds":data["format"]["duration"],"bytes":FILM.stat().st_size,
                      "operational_ui_fraction":round((VIEW[2]-VIEW[0])*(VIEW[3]-VIEW[1])/(W*H),4),
                      "chapters":len(STEPS),"source_sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest()},indent=2))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--preview-only",action="store_true")
    p.add_argument("--verify-only",action="store_true")
    p.add_argument("--no-voice",action="store_true")
    args=p.parse_args()
    if args.verify_only:
        verify(); return
    with tempfile.TemporaryDirectory(prefix=".walkthrough-",dir=ROOT) as name:
        temp=Path(name)
        assert temp.resolve().is_relative_to(ROOT.resolve())
        clips=extract(temp)
        if args.preview_only:
            contact=Image.new("RGB",(1920,2700),WHITE)
            for i,s in enumerate(STEPS):
                frame=frame_at(s["start"]+min(4,(s["end"]-s["start"])/2),clips)
                contact.paste(frame.resize((960,540),Image.Resampling.LANCZOS),((i%2)*960,(i//2)*540))
            path=ROOT.parent/"dsh-walkthrough-preview.jpg"
            contact.save(path,quality=92)
            print(path); return
        metadata=metadata_and_subtitles(temp)
        voice=narration(temp,args.no_voice)
        visual=temp/"visual.mp4"
        proc=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p",str(visual)],stdin=subprocess.PIPE)
        try:
            for n in range(72*FPS):
                proc.stdin.write(frame_at(n/FPS,clips).tobytes())
                if n%(8*FPS)==0:
                    print(f"Rendered {n/FPS:.0f}/72 seconds",flush=True)
        finally:
            proc.stdin.close()
        if proc.wait():
            raise RuntimeError("Encoder failed")
        run("ffmpeg","-v","error","-y","-i",visual,"-i",voice,"-f","ffmetadata","-i",metadata,"-i",OUT/"walkthrough.zh-CN.vtt","-i",OUT/"walkthrough.en.vtt",
            "-map","0:v","-map","1:a","-map","3:s","-map","4:s","-map_metadata","2","-map_chapters","2","-c:v","copy","-c:a","aac","-b:a","160k","-c:s","mov_text",
            "-metadata:s:a:0","language=zho","-metadata:s:a:0","title=Offline synthetic Chinese tutorial narration","-metadata:s:s:0","language=zho","-metadata:s:s:1","language=eng",
            "-movflags","+faststart",FILM)
    verify()


if __name__=="__main__":
    main()
