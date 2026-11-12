import json, uuid

CONFIG_JS = r"""
// ===== EDIT THESE =====
const cfg = {
  niche: 'short moral stories for kids',
  language: 'Hindi',                       // Hindi or English
  voice: 'hi-IN-SwaraNeural',              // en-US-AriaNeural for English
  style: 'colorful 2D cartoon animation style, cute characters, vibrant, clean background',
  privacy: 'private',                      // change to public after you trust the output
  font: 'Noto Sans Devanagari',            // 'DejaVu Sans' for English
};
// ======================
const sd = $getWorkflowStaticData('global');
const past = (sd.titles || []).slice(-40).join('; ');
const prompt = `You write scripts for YouTube Shorts animation videos. Niche: ${cfg.niche}. Language: ${cfg.language}.
Invent a fresh, original topic. Do NOT repeat these: ${past || 'none yet'}.
Make a 25-40 second story: 6-8 scenes, strong hook in scene 1, satisfying ending.
Return JSON: {"title": str (max 80 chars, catchy, in ${cfg.language}), "description": str, "tags": [str],
"scenes": [{"narration": str (1-2 short sentences in ${cfg.language}),
"image_prompt": str (ENGLISH, one visual scene; repeat the same character description in every scene)}]}`;
return [{ json: { cfg, body: { contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseMimeType: 'application/json', temperature: 1.0 } } } }];
"""

PARSE_JS = r"""
const cfg = $('Config & Prompt').first().json.cfg;
const raw = $input.first().json.candidates[0].content.parts[0].text;
const script = JSON.parse(raw);
const sd = $getWorkflowStaticData('global');
sd.titles = (sd.titles || []).concat(script.title);

const job = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + Math.floor(Math.random() * 1000);
const dir = `/data/shorts/${job}`;
const W = 1080, H = 1920, FPS = 30;

return script.scenes.map((sc, i) => {
  const b64 = Buffer.from(sc.narration, 'utf8').toString('base64');
  const imgUrl = 'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(sc.image_prompt + ', ' + cfg.style) +
    `?width=${W}&height=${H}&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  const zoom = i % 2 === 0 ? 'min(zoom+0.0015,1.3)' : 'if(eq(on,0),1.3,max(zoom-0.0015,1.0))';
  const vf = `scale=${W*2}:${H*2}:force_original_aspect_ratio=increase,crop=${W*2}:${H*2},` +
    `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$F:s=${W}x${H}:fps=${FPS},format=yuv420p`;
  const cmd = `set -e
mkdir -p ${dir}; cd ${dir}
echo '${b64}' | base64 -d > n${i}.txt
edge-tts --voice ${cfg.voice} --file n${i}.txt --write-media a${i}.mp3
for t in 1 2 3 4 5; do curl -sfL -o i${i}.jpg "${imgUrl}" && break; sleep $((t*5)); done
test -s i${i}.jpg
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 a${i}.mp3)
T=$(awk "BEGIN{print $DUR+0.25}")
F=$(awk "BEGIN{print int(($DUR+0.25)*${FPS})+1}")
ffmpeg -y -loglevel error -loop 1 -i i${i}.jpg -i a${i}.mp3 -vf "${vf}" -t $T -c:v libx264 -preset veryfast -c:a aac -ar 44100 -shortest c${i}.mp4
echo $T`;
  return { json: { i, job, dir, cmd, narration: sc.narration, total: script.scenes.length,
    title: script.title, description: script.description, tags: script.tags || [] } };
});
"""

FINAL_JS = r"""
const scenes = $('Parse Script').all().map(x => x.json);
const durs = $input.all().map(x => parseFloat(String(x.json.stdout).trim().split('\n').pop()));
const { dir, title, description, tags } = scenes[0];
const cfg = $('Config & Prompt').first().json.cfg;
const W = 1080, H = 1920;
const ts = t => { const h = Math.floor(t/3600), m = Math.floor(t%3600/60), s = t%60;
  return `${h}:${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}`; };

let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,${cfg.font},78,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,60,60,520,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
let t = 0;
scenes.forEach((sc, i) => {
  const words = sc.narration.split(/\s+/);
  const chunks = [];
  for (let k = 0; k < words.length; k += 4) chunks.push(words.slice(k, k + 4).join(' '));
  const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
  let cs = t;
  chunks.forEach(c => { const ce = cs + durs[i] * c.length / total;
    ass += `Dialogue: 0,${ts(cs)},${ts(ce)},Default,,0,0,0,,${c}\n`; cs = ce; });
  t += durs[i];
});
const list = scenes.map((_, i) => `file 'c${i}.mp4'`).join('\n') + '\n';
const b = s => Buffer.from(s, 'utf8').toString('base64');
const cmd = `set -e
cd ${dir}
echo '${b(list)}' | base64 -d > list.txt
echo '${b(ass)}' | base64 -d > subs.ass
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy joined.mp4
ffmpeg -y -loglevel error -i joined.mp4 -vf ass=subs.ass -c:v libx264 -preset veryfast -c:a aac final.mp4
echo done`;
return [{ json: { cmd, path: `${dir}/final.mp4`, title, description, tags: tags.join(','), privacy: cfg.privacy } }];
"""

def node(name, type_, ver, pos, params, **extra):
    n = {"parameters": params, "id": str(uuid.uuid4()), "name": name, "type": type_,
         "typeVersion": ver, "position": pos}
    n.update(extra); return n

nodes = [
 node("Every day 10AM", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
      {"rule": {"interval": [{"field": "days", "triggerAtHour": 10}]}}),
 node("Config & Prompt", "n8n-nodes-base.code", 2, [220, 0], {"jsCode": CONFIG_JS.strip()}),
 node("Gemini Script", "n8n-nodes-base.httpRequest", 4.2, [440, 0], {
    "method": "POST",
    "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    "sendQuery": True,
    "queryParameters": {"parameters": [{"name": "key", "value": "={{ $env.GEMINI_API_KEY }}"}]},
    "sendBody": True, "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json.body) }}",
    "options": {"timeout": 120000}},
    retryOnFail=True, maxTries=3, waitBetweenTries=5000),
 node("Parse Script", "n8n-nodes-base.code", 2, [660, 0], {"jsCode": PARSE_JS.strip()}),
 node("Make Scene (voice+image+clip)", "n8n-nodes-base.executeCommand", 1, [880, 0],
      {"command": "={{ $json.cmd }}"}, retryOnFail=True, maxTries=2, waitBetweenTries=5000),
 node("Build Subtitles & Command", "n8n-nodes-base.code", 2, [1100, 0], {"jsCode": FINAL_JS.strip()}),
 node("Merge + Burn Captions", "n8n-nodes-base.executeCommand", 1, [1320, 0],
      {"command": "={{ $json.cmd }}"}),
 node("Read final.mp4", "n8n-nodes-base.readWriteFile", 1, [1540, 0], {
      "operation": "read",
      "fileSelector": "={{ $('Build Subtitles & Command').first().json.path }}",
      "options": {}}),
 node("Upload to YouTube", "n8n-nodes-base.youTube", 1, [1760, 0], {
      "resource": "video", "operation": "upload",
      "title": "={{ $('Build Subtitles & Command').first().json.title }}",
      "regionCode": "IN", "categoryId": "24", "binaryProperty": "data",
      "options": {
        "description": "={{ $('Build Subtitles & Command').first().json.description + '\\n\\n#Shorts #animation' }}",
        "tags": "={{ $('Build Subtitles & Command').first().json.tags }}",
        "privacyStatus": "={{ $('Build Subtitles & Command').first().json.privacy }}"}}),
]
names = [n["name"] for n in nodes]
conns = {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}
wf = {"name": "Free YouTube Shorts Animation Automation", "nodes": nodes, "connections": conns,
      "settings": {"executionOrder": "v1"}, "active": False}
json.dump(wf, open("shorts-workflow.json", "w"), ensure_ascii=False, indent=2)
print("ok", len(nodes), "nodes")
