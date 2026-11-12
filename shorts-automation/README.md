# Free YouTube Shorts Automation

Gemini (free API key) -> edge-tts -> Pollinations images -> FFmpeg -> YouTube upload. Scheduled free via GitHub Actions.

## Setup
1. **Gemini key (free):** https://aistudio.google.com/apikey (a Gemini Pro subscription is separate; the AI Studio key is free).
2. **YouTube OAuth:** follow the steps in `get_refresh_token.py`, run it once on your PC.
3. **Test locally:** `pip install -r requirements.txt`, install ffmpeg, then
   `GEMINI_API_KEY=... python pipeline.py --no-upload`
4. **GitHub -> Settings -> Secrets:** `GEMINI_API_KEY`, `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.
   **Variables (optional):** `NICHE`, `LANGUAGE` (Hindi/English), `PRIVACY` (private/public).
5. Workflow `.github/workflows/shorts.yml` runs daily; trigger manually from the Actions tab first.

Optional: put a royalty-free `music.mp3` in this folder for background music.
Keep `PRIVACY=private` until you have reviewed a few outputs. Disclose AI content (already set in upload).
