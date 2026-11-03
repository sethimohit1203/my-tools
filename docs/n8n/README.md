# Horror Shorts: n8n render + upload

`horror-shorts.workflow.json` + `render.sh` take the package sent by **Horror Shorts Studio** (`/shorts` → "Render webhook"), make a Hindi voice-over with Gemini TTS, join your Google Flow clips, burn captions, and upload to YouTube (as **private** first).

## One-time setup (self-hosted n8n, Docker)
1. Mount a folder: `-v ~/shorts-data:/data/shorts` and install FFmpeg in the n8n image (`apk add ffmpeg` on the Alpine image).
2. Copy `render.sh` to `~/shorts-data/render.sh`. Optional: put a royalty-free `music.mp3` there.
3. Env vars for n8n: `NODE_FUNCTION_ALLOW_BUILTIN=fs` and make sure `n8n-nodes-base.executeCommand` is **not** in `NODES_EXCLUDE` (newer n8n disables it by default).
4. Import `horror-shorts.workflow.json` (Workflows → Import from file).
5. Credentials:
   - **Gemini**: Header Auth, name `x-goog-api-key`, value = your free AI Studio key.
   - **YouTube**: OAuth2. Create a Google Cloud project, enable *YouTube Data API v3*, make OAuth client, add the n8n callback URL.
6. Webhook node: change the path to a long random string (it is the only protection). Put the full **production** URL in the app's ⚙ Settings → "Shorts render webhook", then activate the workflow.

## Every short
1. In `/shorts` Studio copy the image prompts, make clips in Google Flow (9:16), and save them as `scene-01.mp4`, `scene-02.mp4` ... into `~/shorts-data/incoming/` (in scene order).
2. Click **🚀 Render webhook**. n8n renders and uploads a private video; review it in YouTube Studio and publish or schedule it.

Notes: clips in `incoming/` are moved into the job folder on each run. Caption timing follows scene seconds, and the voice is gently stretched (0.85x-1.25x) to match the video length. Tune `FontSize`/`MarginV` in `render.sh` if captions look off. The YouTube node's field names can differ slightly between n8n versions, so open the node once after import and re-select the credential.
