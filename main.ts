import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

const CONFIG = {
  domain: "https://qyun.org",
  // Cookie (အစ်ကို့ Cookie အမှန်)
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=ZDJhMTI0ZWYtMmU5NC00ZWNjLTg4YTctZWlyNDUzMzYwMGZj", 
  bucketId: "1", 
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
  "Referer": "https://qyun.org/files.html",
  "Origin": "https://qyun.org",
  "X-Requested-With": "XMLHttpRequest",
};

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Deep Debug</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun Deep Debugger</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <button onclick="startUpload()" id="btn" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition">Get Server Response</button>
        
        <!-- Result Box -->
        <label class="block mt-4 mb-2 text-sm text-yellow-400">Server Response (Screenshot This):</label>
        <pre id="status" class="p-3 bg-black rounded text-xs font-mono text-green-300 break-words whitespace-pre-wrap border border-gray-600 min-h-[100px]">Waiting...</pre>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const statusDiv = document.getElementById('status');
          const btn = document.getElementById('btn');

          if(!url) return alert("Link လိုပါတယ်");

          btn.disabled = true;
          statusDiv.innerText = "Sending Request...";
          
          try {
            const startRes = await fetch('/api/debug', {
                method: 'POST', 
                body: JSON.stringify({url, name})
            });
            const res = await startRes.json();
            
            // Show EVERYTHING
            statusDiv.innerText = JSON.stringify(res, null, 2);

          } catch(e) {
            statusDiv.innerText = "Client Error: " + e.message;
          }
          btn.disabled = false;
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.post("/api/debug", async (c) => {
  const { url, name } = await c.req.json();
  let filename = name && name.trim() ? name.trim() : "video.mp4";

  try {
    // 1. Fake Size (To test init)
    const totalSize = 10 * 1024 * 1024; // 10MB request

    // 2. Generate Key
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'/'); 
    const uuid = crypto.randomUUID();
    const key = `upload/${date}/${uuid}_${filename}`;

    // 3. Request Signature
    const formData = new FormData();
    formData.append("name", filename);
    formData.append("size", totalSize.toString());
    formData.append("type", "video/mp4");
    formData.append("key", key);
    formData.append("bucketId", CONFIG.bucketId); // "1"
    formData.append("folderId", "");

    const initRes = await fetch(`${CONFIG.domain}/files.html?folderId=`, {
        method: "POST",
        headers: { 
            "Cookie": CONFIG.cookie, 
            ...HEADERS 
        },
        body: formData
    });

    const rawText = await initRes.text();
    let json;
    try {
        json = JSON.parse(rawText);
    } catch {
        json = "NOT_JSON";
    }

    return c.json({
        step: "Init Request to files.html",
        status_code: initRes.status,
        is_html: rawText.trim().startsWith("<"),
        raw_response_text: rawText.substring(0, 500), // First 500 chars
        parsed_json: json,
        request_headers: HEADERS
    });

  } catch (e) {
    return c.json({ error: e.message, stack: e.stack });
  }
});

Deno.serve(app.fetch);
