// Horror-suspense animated Shorts: types, prompt builders and export helpers.
// Everything here is isomorphic so the UI (and later a cron/webhook) can reuse it.

export type Scene = {
  n: number;
  narration: string;   // Hindi/Hinglish voice-over line
  caption: string;     // short on-screen text (max ~6 words)
  imagePrompt: string; // animation-style image/video prompt (English)
  motion: string;      // camera move, e.g. "slow zoom in"
  sfx: string;         // sound-design cue
  seconds: number;
  imageUrl: string;    // optional: paste the generated image/clip URL
};

export type Short = {
  id: string;
  idea: string;
  title: string;
  hook: string;
  styleBible: string;  // art style + recurring characters, prepended to every prompt
  musicMood: string;
  scenes: Scene[];
  description: string;
  hashtags: string;
  thumbnailText: string;
  status: "Draft" | "Ready" | "Sent" | "Failed";
  result?: string;
  createdAt: string;
};

export type Idea = { id: string; title: string; hook: string; angle: string; whyViral: string };

export type Series = {
  channel: string;
  subgenre: string;
  art: string;
  seconds: number;
  voice: string;
};

export const SUBGENRES = [
  "Indian village folklore (chudail, bhoot, purani haveli)",
  "Haunted house / abandoned place",
  "Urban legend (lift, hostel, highway, night shift)",
  "Psychological suspense with a twist ending",
  "Late-night phone / CCTV / found-footage horror",
  "Mystery + paranormal true-story style",
];

export const ART_STYLES = [
  "Dark 2D anime horror, heavy shadows, limited palette of deep blue, black and sickly green, grainy film texture",
  "Creepy 3D animated (Pixar-meets-Tim-Burton), moody volumetric fog, moonlight rim lighting",
  "Cel-shaded graphic-novel noir, high contrast ink, blood-red accents on black",
  "Stop-motion paper-cut horror, flickering candlelight, muted earthy tones",
];

export const DEFAULT_SERIES: Series = {
  channel: "",
  subgenre: SUBGENRES[0],
  art: ART_STYLES[0],
  seconds: 45,
  voice: "deep calm male storyteller",
};

export const SHORTS_SYSTEM = `You are a veteran YouTube Shorts / Instagram Reels scriptwriter for Hindi-speaking horror-suspense animation channels with millions of views. You know retention: a hook in the first 2 seconds, a new visual or reveal every 3-5 seconds, an escalating dread and a twist or unsettling last line that makes people replay or comment. Content must stay YouTube-safe: suspense and implication, no graphic gore, no real people, no hate, no self-harm.`;

export function ideasPrompt(s: Series, count: number, avoid: string[]): string {
  return `Channel: ${s.channel || "(new horror channel)"}
Sub-genre: ${s.subgenre}
Audience: Indian viewers, Hindi/Hinglish (Roman script), mobile, watching late at night.
Give ${count} DIFFERENT viral Shorts ideas that are proven formats (e.g. "Raat 3 baje ye call mat uthana", "Lift me ek extra button", "Hostel ke room 13 ka raaz", "CCTV me wo cheez jo kisi ne notice nahi ki").
${avoid.length ? `Do not repeat these titles: ${avoid.slice(0, 40).join(" | ")}` : ""}
Return JSON: {"ideas":[{"title":"clickable Hinglish title","hook":"the exact first spoken line (max 12 words)","angle":"one-line premise incl. the twist","whyViral":"why people will watch till the end / comment"}]}`;
}

export function scriptPrompt(s: Series, idea: { title: string; hook: string; angle: string }): string {
  const nScenes = Math.max(6, Math.round(s.seconds / 5));
  return `Write a complete ${s.seconds}-second vertical (9:16) horror-suspense animated Short.
Idea: ${idea.title}
Opening hook (keep or improve): ${idea.hook}
Premise: ${idea.angle}
Sub-genre: ${s.subgenre}
Art style (must stay consistent in every scene): ${s.art}
Narrator voice: ${s.voice}. Language: natural spoken Hinglish in Roman script (Hindi words, simple English where natural). Short punchy sentences. Total narration about ${Math.round(s.seconds * 2.3)} words.
Rules: exactly ${nScenes} scenes, scene seconds must add up to about ${s.seconds}. Scene 1 = the hook. Escalate tension. Last scene = twist or chilling cliffhanger that invites a comment/replay (the last line should loop back into the first). Each imagePrompt is in English, describes ONE strong frame (subject, setting, lighting, camera angle), mentions recurring characters by the same description and does NOT repeat the art style (it is added separately).
Return JSON: {"title":"","hook":"","styleBible":"art style + a fixed visual description of every recurring character/location so images stay consistent","musicMood":"e.g. low drone, heartbeat, sudden silence","scenes":[{"narration":"","caption":"max 6 words","imagePrompt":"","motion":"slow zoom in | pan left | shake | push through door ...","sfx":"","seconds":5}],"description":"YouTube description, 2-3 lines + a comment question","hashtags":"#horror #shorts ... (10-12 tags, Hindi + English)","thumbnailText":"max 4 words"}`;
}

/** Build the full text prompt for a scene as sent to an image/video model. */
export function fullPrompt(short: Pick<Short, "styleBible">, scene: Scene): string {
  return `${scene.imagePrompt}. Style: ${short.styleBible}. Vertical 9:16, cinematic, no text, no watermark.`;
}

function ts(t: number): string {
  const ms = Math.round((t % 1) * 1000);
  const total = Math.floor(t);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)},${p(ms, 3)}`;
}

/** SRT captions: each scene's narration is split into short chunks timed across the scene. */
export function toSRT(short: Short): string {
  let t = 0, idx = 1;
  const out: string[] = [];
  for (const sc of short.scenes) {
    const words = sc.narration.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += 4) chunks.push(words.slice(i, i + 4).join(" "));
    const dur = Math.max(1, Number(sc.seconds) || 5);
    chunks.forEach((c, i) => {
      const a = t + (dur * i) / chunks.length;
      const b = t + (dur * (i + 1)) / chunks.length;
      out.push(`${idx++}\n${ts(a)} --> ${ts(b)}\n${c}\n`);
    });
    t += dur;
  }
  return out.join("\n");
}

export function totalSeconds(short: Short): number {
  return short.scenes.reduce((a, s) => a + (Number(s.seconds) || 0), 0);
}

export function voiceoverText(short: Short): string {
  return short.scenes.map((s) => s.narration).join(" ");
}

/** Payload sent to the render webhook (n8n / Make / your own renderer). */
export function webhookPayload(short: Short) {
  return {
    id: short.id,
    title: short.title,
    format: "9:16",
    durationSeconds: totalSeconds(short),
    voiceover: voiceoverText(short),
    musicMood: short.musicMood,
    description: short.description,
    hashtags: short.hashtags,
    thumbnailText: short.thumbnailText,
    captionsSrt: toSRT(short),
    scenes: short.scenes.map((s) => ({ ...s, fullPrompt: fullPrompt(short, s) })),
  };
}
