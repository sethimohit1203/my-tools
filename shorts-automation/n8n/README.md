# n8n workflow: free YouTube Shorts automation

Import `shorts-workflow.json` (n8n -> Workflows -> Import from file). Regenerate it with `python build_workflow.py`.

```
Schedule -> Config & Prompt -> Gemini Script -> Parse Script (1 item per scene)
 -> Make Scene (edge-tts voice + Pollinations image + ffmpeg zoom clip, per scene)
 -> Build Subtitles -> Merge + Burn Captions (ffmpeg) -> Read final.mp4 -> Upload to YouTube
```

## Setup (all free)
1. Install Docker, then in this folder: `GEMINI_API_KEY=your_key docker compose up -d --build`
   (free key: https://aistudio.google.com/apikey). Open http://localhost:5678.
   n8n needs ffmpeg + edge-tts, so the custom Dockerfile is required; n8n Cloud will not work.
2. Import the workflow.
3. Open **Upload to YouTube** -> create the YouTube OAuth2 credential (Google Cloud: enable YouTube Data API v3,
   OAuth client "Web application", redirect URL shown by n8n, add yourself as test user).
4. Edit niche / language / voice / privacy in the **Config & Prompt** node.
5. Click **Execute workflow** once manually and check the result, then activate the workflow.

The script avoids repeating topics through workflow static data (works only when the workflow is active, not in manual tests).
Keep `privacy: 'private'` until you have reviewed a few videos.
