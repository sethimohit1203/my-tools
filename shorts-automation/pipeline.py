"""Free YouTube Shorts animation pipeline.

Gemini (free tier)  -> script + image prompts
edge-tts (free)     -> voiceover
Pollinations (free) -> images (no API key)
FFmpeg (free)       -> zoom/pan animation, captions, merge
YouTube Data API    -> upload (free quota)

Usage: python pipeline.py [--no-upload] [--topic "..."]
"""
import argparse, asyncio, json, os, random, subprocess, sys, time, urllib.parse
from pathlib import Path

import edge_tts
import requests

ROOT = Path(__file__).parent
OUT = ROOT / "output"
HISTORY = ROOT / "history.json"

NICHE = os.getenv("NICHE", "short moral stories for kids")
LANGUAGE = os.getenv("LANGUAGE", "Hindi")  # Hindi or English
VOICE = os.getenv("VOICE", "hi-IN-SwaraNeural" if LANGUAGE == "Hindi" else "en-US-AriaNeural")
STYLE = os.getenv("IMAGE_STYLE", "colorful 2D cartoon animation style, cute characters, vibrant, clean background")
PRIVACY = os.getenv("PRIVACY", "private")  # switch to public once you trust the output
FONT = "Noto Sans Devanagari" if LANGUAGE == "Hindi" else "DejaVu Sans"
W, H, FPS = 1080, 1920, 30
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def load_history():
    return json.loads(HISTORY.read_text()) if HISTORY.exists() else []


# 1. Script ---------------------------------------------------------------
def gemini_script(topic, past_titles):
    prompt = f"""You write scripts for YouTube Shorts animation videos. Niche: {NICHE}. Language: {LANGUAGE}.
{"Topic: " + topic if topic else "Invent a fresh, original topic. Do NOT repeat these: " + "; ".join(past_titles[-40:])}
Make a 25-40 second story: 6-8 scenes, strong hook in scene 1, satisfying ending.
Return JSON: {{"title": str (max 80 chars, catchy, in {LANGUAGE}),
"description": str, "tags": [str],
"scenes": [{{"narration": str (1-2 short sentences in {LANGUAGE}),
"image_prompt": str (ENGLISH, describe one visual scene; keep the same character description in every scene)}}]}}"""
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        params={"key": os.environ["GEMINI_API_KEY"]},
        json={"contents": [{"parts": [{"text": prompt}]}],
              "generationConfig": {"responseMimeType": "application/json", "temperature": 1.0}},
        timeout=120)
    r.raise_for_status()
    return json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])


# 2. Voice ----------------------------------------------------------------
async def tts(text, path):
    await edge_tts.Communicate(text, VOICE, rate="+5%").save(str(path))


# 3. Images ---------------------------------------------------------------
def make_image(prompt, path, seed):
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(f"{prompt}, {STYLE}")
           + f"?width={W}&height={H}&nologo=true&seed={seed}")
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=180)
            if r.ok and r.headers.get("content-type", "").startswith("image"):
                path.write_bytes(r.content)
                return
        except requests.RequestException:
            pass
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"image generation failed: {prompt[:60]}")


# 4. Video ----------------------------------------------------------------
def scene_clip(img, audio, dur, out, idx):
    frames = int(dur * FPS) + 1
    # alternate zoom-in / zoom-out for a bit of motion
    z = "min(zoom+0.0015,1.3)" if idx % 2 == 0 else "if(eq(on,0),1.3,max(zoom-0.0015,1.0))"
    vf = (f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},"
          f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p")
    run(["ffmpeg", "-y", "-loop", "1", "-i", str(img), "-i", str(audio), "-vf", vf,
         "-t", f"{dur:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
         "-ar", "44100", "-shortest", str(out)])


def ts(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def build_ass(scenes, durs, path):
    lines = [f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,{FONT},78,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,60,60,520,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"""]
    t = 0.0
    for sc, d in zip(scenes, durs):
        words = sc["narration"].split()
        chunks = [" ".join(words[i:i + 4]) for i in range(0, len(words), 4)] or [""]
        total = sum(len(c) for c in chunks) or 1
        cs = t
        for c in chunks:
            ce = cs + d * len(c) / total
            lines.append(f"Dialogue: 0,{ts(cs)},{ts(ce)},Default,,0,0,0,,{c}")
            cs = ce
        t += d
    path.write_text("\n".join(lines), encoding="utf-8")


def build_video(script, work):
    scenes = script["scenes"]
    clips, durs = [], []
    for i, sc in enumerate(scenes):
        audio, img, clip = work / f"a{i}.mp3", work / f"i{i}.jpg", work / f"c{i}.mp4"
        asyncio.run(tts(sc["narration"], audio))
        d = duration(audio) + 0.25
        make_image(sc["image_prompt"], img, seed=random.randint(1, 10**6))
        scene_clip(img, audio, d, clip, i)
        clips.append(clip); durs.append(d)
        print(f"  scene {i+1}/{len(scenes)} done ({d:.1f}s)")
    lst = work / "list.txt"
    lst.write_text("".join(f"file '{c.name}'\n" for c in clips))
    joined = work / "joined.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])
    ass = work / "subs.ass"
    build_ass(scenes, durs, ass)
    final = work / "final.mp4"
    cmd = ["ffmpeg", "-y", "-i", "joined.mp4"]
    music = ROOT / "music.mp3"  # optional: drop a royalty-free track here
    if music.exists():
        cmd += ["-stream_loop", "-1", "-i", str(music.resolve()),
                "-filter_complex", "[0:v]ass=subs.ass[v];[1:a]volume=0.08[m];[0:a][m]amix=inputs=2:duration=first[a]",
                "-map", "[v]", "-map", "[a]"]
    else:
        cmd += ["-vf", "ass=subs.ass"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", "final.mp4"]
    subprocess.run(cmd, check=True, cwd=work, capture_output=True)  # cwd so 'ass=' path is simple
    return final


# 5. Upload ---------------------------------------------------------------
def upload(video, script):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    creds = Credentials(None, refresh_token=os.environ["YT_REFRESH_TOKEN"],
                        client_id=os.environ["YT_CLIENT_ID"], client_secret=os.environ["YT_CLIENT_SECRET"],
                        token_uri="https://oauth2.googleapis.com/token")
    yt = build("youtube", "v3", credentials=creds)
    body = {
        "snippet": {"title": script["title"][:95],
                    "description": script["description"] + "\n\n#Shorts #animation",
                    "tags": script.get("tags", []) + ["shorts"], "categoryId": "24"},
        "status": {"privacyStatus": PRIVACY, "selfDeclaredMadeForKids": "kids" in NICHE.lower(),
                   "containsSyntheticMedia": True},
    }
    req = yt.videos().insert(part="snippet,status", body=body,
                             media_body=MediaFileUpload(str(video), chunksize=-1, resumable=True))
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    print("Uploaded: https://youtube.com/shorts/" + resp["id"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--topic")
    args = ap.parse_args()
    history = load_history()
    print("Writing script...")
    script = gemini_script(args.topic, [h["title"] for h in history])
    print("Title:", script["title"])
    work = OUT / time.strftime("%Y%m%d-%H%M%S")
    work.mkdir(parents=True, exist_ok=True)
    (work / "script.json").write_text(json.dumps(script, ensure_ascii=False, indent=2))
    video = build_video(script, work)
    print("Video ready:", video)
    if not args.no_upload:
        upload(video, script)
    history.append({"title": script["title"], "date": time.strftime("%Y-%m-%d")})
    HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.exit(main())
