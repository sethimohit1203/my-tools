#!/usr/bin/env bash
# Horror Shorts renderer: scene clips + Gemini voice (PCM) + SRT captions (+ optional music) -> final.mp4 (1080x1920).
# Usage: render.sh <job-id>      (job-id must be [A-Za-z0-9_-])
# Layout under $SHORTS_DIR (default /data/shorts):
#   incoming/scene-01.mp4 ...   clips you made in Google Flow (picked up and moved into the job)
#   music.mp3                   optional background drone (royalty-free)
#   jobs/<id>/voice.pcm         written by n8n (24 kHz, 16-bit, mono)
#   jobs/<id>/captions.srt      written by n8n
set -euo pipefail

ID="${1:?job id required}"
[[ "$ID" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "bad job id" >&2; exit 1; }
BASE="${SHORTS_DIR:-/data/shorts}"
JOB="$BASE/jobs/$ID"
cd "$JOB"

shopt -s nullglob
clips=("$BASE"/incoming/scene-*.mp4)
((${#clips[@]})) || { echo "No clips in $BASE/incoming (expected scene-01.mp4, scene-02.mp4 ...)" >&2; exit 1; }
mkdir -p clips && mv "${clips[@]}" clips/

# 1) Normalise every clip to 1080x1920 / 30fps, no audio, then concatenate.
: > list.txt
for f in $(ls clips/scene-*.mp4 | sort); do
  n="norm_$(basename "$f")"
  ffmpeg -y -loglevel error -i "$f" -an \
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1" \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p "$n"
  echo "file '$n'" >> list.txt
done
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy video.mp4

# 2) Voice: PCM -> WAV, then gently fit it to the video length (pitch-safe, only within 0.85x-1.25x).
ffmpeg -y -loglevel error -f s16le -ar 24000 -ac 1 -i voice.pcm voice.wav
V=$(ffprobe -v error -show_entries format=duration -of csv=p=0 video.mp4)
A=$(ffprobe -v error -show_entries format=duration -of csv=p=0 voice.wav)
T=$(awk -v a="$A" -v v="$V" 'BEGIN{t=a/v; if(t<0.85)t=0.85; if(t>1.25)t=1.25; printf "%.4f", t}')

# 3) Mix voice (+ optional low music), burn captions, cut to video length.
SUB="subtitles=captions.srt:force_style='Alignment=2,FontSize=13,Bold=1,Outline=2,Shadow=1,MarginV=140'"
if [[ -f "$BASE/music.mp3" ]]; then
  ffmpeg -y -loglevel error -i video.mp4 -i voice.wav -stream_loop -1 -i "$BASE/music.mp3" \
    -filter_complex "[1:a]atempo=$T,volume=1.0[v];[2:a]volume=0.18[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0[a];[0:v]$SUB[o]" \
    -map "[o]" -map "[a]" -t "$V" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart final.mp4
else
  ffmpeg -y -loglevel error -i video.mp4 -i voice.wav \
    -filter_complex "[1:a]atempo=$T[a];[0:v]$SUB[o]" \
    -map "[o]" -map "[a]" -t "$V" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart final.mp4
fi
echo "OK $JOB/final.mp4"
