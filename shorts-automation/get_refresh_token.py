"""One-time: run on your own PC to get a YouTube refresh token.
1. Google Cloud Console -> new project -> enable "YouTube Data API v3"
2. OAuth consent screen (External, add yourself as test user) -> Credentials -> OAuth client ID -> Desktop app
3. Download JSON as client_secret.json next to this file, then: python get_refresh_token.py
"""
from google_auth_oauthlib.flow import InstalledAppFlow

flow = InstalledAppFlow.from_client_secrets_file(
    "client_secret.json", ["https://www.googleapis.com/auth/youtube.upload"])
creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
print("\nYT_CLIENT_ID     =", creds.client_id)
print("YT_CLIENT_SECRET =", creds.client_secret)
print("YT_REFRESH_TOKEN =", creds.refresh_token)
