import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

// --- Configuration ---
const CONFIG = {
  domain: "https://qyun.org",
  // 🔥 Cookie
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=ZDJhMTI0ZWYtMmU5NC00ZWNjLTg4YTctZWlyNDUzMzYwMGZj", 
  
  // Channel ID
  policyId: "1", 
  chunkSize: 9 * 1024 * 1024,
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
  "Referer": "https://qyun.org/files",
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
      <title>Qyun Fixed</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun Uploader (Fixed)</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-blue-400">Target Channel ID</label>
        <input type="text" id="bucketInput" value="1" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div id="status" class="mt-4 p-3 bg-gray-900 rounded text-xs font-mono text-gray-300 break-words hidden border border-gray-700"></div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const bucketId = document.getElementById('bucketInput').value;
          
          if(!url) return alert("Link လိုပါတယ်");

          const btn = document.getElementById('btn');
          const statusDiv = document.getElementById('status');

          btn.disabled = true;
          statusDiv.classList.remove('hidden');
          statusDiv.innerText = "Sending Request...";
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, name, bucketId})
            });
            const res = await startRes.json();
            
            // Show result
            statusDiv.innerText = JSON.stringify(res, null, 2);
            
            if(res.status === 'debug' || res.status === 'success') {
                statusDiv.className = "mt-4 p-3 bg-green-900 text-green-200 rounded text-xs font-mono break-words border border-green-700";
            } else {
                statusDiv.className = "mt-4 p-3 bg-red-900 text-red-200 rounded text-xs font-mono break-words border border-red-700";
            }

          } catch(e) {
            statusDiv.innerText = "Error: " + e.message;
            statusDiv.className = "mt-4 p-3 bg-red-900 text-red-200 rounded text-xs font-mono break-words border border-red-700";
          }
          btn.disabled = false;
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.post("/api/upload", async (c) => {
  const { url, name, bucketId } = await c.req.json();
  let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
  if (!filename.includes('.')) filename += '.mp4';

  try {
    // 🔥 FIX: "url" variable ကိုပဲ သုံးမယ်
    const headRes = await fetch(url, { method: 'HEAD' });
    const totalSize = Number(headRes.headers.get('content-length')) || 1024*1024*10; 

    // Init Upload
    const initRes = await fetch(`${CONFIG.domain}/api/v1/file/create`, {
        method: 'PUT',
        headers: { 
            "Cookie": CONFIG.cookie, 
            "Content-Type": "application/json",
            ...HEADERS
        },
        body: JSON.stringify({
            path: "/",
            size: totalSize,
            name: filename,
            policy_id: bucketId,
            type: "file"
        })
    });

    const text = await initRes.text();
    try {
        const json = JSON.parse(text);
        return c.json({ 
            status: "debug", 
            server_response: json,
            request_info: {
                filename: filename,
                size: totalSize,
                policy: bucketId
            }
        });
    } catch(e) {
        return c.json({ 
            status: "failed", 
            error: "Not JSON", 
            raw_response: text.substring(0, 200) 
        });
    }

  } catch (e) {
    return c.json({ status: "failed", error: e.message });
  }
});

Deno.serve(app.fetch);
