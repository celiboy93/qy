
import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

// --- Configuration ---
const CONFIG = {
  domain: "https://qyun.org",
  email: "sswe0014@gmail.com",      
  password: "Soekyawwin@93",
  
  // 🔥 Channel 2 ID (Qyun မှာပုံမှန်အားဖြင့် "2" ဖြစ်သည်)
  policyId: "2", 
  
  chunkSize: 9 * 1024 * 1024,
};

// Browser လို ဟန်ဆောင်မည့် Headers များ
const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": "https://qyun.org/",
  "Origin": "https://qyun.org",
  "Accept-Language": "en-US,en;q=0.9",
};

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Channel 2 Fixed</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun Uploader (Fix Login)</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <div class="mb-4">
             <span class="bg-blue-900 text-blue-200 text-xs px-2 py-1 rounded">Channel 2 (ID: ${CONFIG.policyId})</span>
        </div>

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-green-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-2 text-center text-sm text-yellow-400">Ready</div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const status = document.getElementById('status');
          const btn = document.getElementById('btn');
          const bar = document.getElementById('progressBar');

          if(!url) return alert("Link လိုပါတယ်");
          btn.disabled = true;

          try {
            status.innerText = "Authenticating...";
            const startRes = await fetch('/api/init', {
                method: 'POST', 
                body: JSON.stringify({url, name})
            });
            const startData = await startRes.json();
            
            if(startData.error) throw new Error(startData.error);
            
            const jobId = startData.jobId;
            
            const interval = setInterval(async () => {
                const poll = await fetch('/api/status/' + jobId);
                const pData = await poll.json();
                
                if(pData.status === 'uploading') {
                    const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                    bar.style.width = pct + '%';
                    status.innerText = \`Uploading: \${pct}% (\${(pData.uploaded/1024/1024).toFixed(1)} MB)\`;
                } else if(pData.status === 'completed') {
                    clearInterval(interval);
                    bar.style.width = '100%';
                    status.innerText = "✅ Upload Complete!";
                    status.classList.replace('text-yellow-400', 'text-green-400');
                    btn.disabled = false;
                } else if(pData.status === 'failed') {
                    clearInterval(interval);
                    status.innerText = "❌ Error: " + pData.error;
                    status.classList.replace('text-yellow-400', 'text-red-400');
                    btn.disabled = false;
                }
            }, 2000);

          } catch(e) {
            status.innerText = "Error: " + e.message;
            btn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

const jobs = new Map();

app.post("/api/init", async (c) => {
  const { url, name } = await c.req.json();
  const jobId = crypto.randomUUID();
  let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
  if (!filename.includes('.')) filename += '.mp4';

  jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });

  processChunkUpload(jobId, url, filename).catch(err => {
      console.error(err);
      jobs.set(jobId, { status: 'failed', error: err.message });
  });

  return c.json({ jobId });
});

app.get("/api/status/:id", (c) => {
    const id = c.req.param('id');
    return c.json(jobs.get(id) || { status: 'unknown' });
});

// Helper function to handle JSON parsing safely
async function parseJsonOrError(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        // If it's HTML (Cloudflare challenge), show first 100 chars
        throw new Error(`Server returned HTML instead of JSON. (Possibly Cloudflare Block or Login Page). Response: ${text.substring(0, 100)}...`);
    }
}

async function processChunkUpload(jobId, sourceUrl, filename) {
    try {
        // Step 1: Login with Fake Headers
        const loginRes = await fetch(`${CONFIG.domain}/api/v1/user/session`, {
            method: 'POST',
            headers: { 
                ...COMMON_HEADERS,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ userName: CONFIG.email, Password: CONFIG.password })
        });

        const loginData = await parseJsonOrError(loginRes);
        
        if(loginData.code !== 0) throw new Error("Login Failed: " + loginData.msg);
        
        let cookies = loginRes.headers.get("set-cookie");
        if(cookies) cookies = cookies.split(',').map(c => c.split(';')[0]).join('; ');

        // Step 2: Get Size
        const headRes = await fetch(sourceUrl, { method: 'HEAD' });
        const totalSize = Number(headRes.headers.get('content-length'));
        if(!totalSize) throw new Error("Source file size unknown");

        jobs.set(jobId, { status: 'uploading', uploaded: 0, total: totalSize });

        // Step 3: Init Upload with POLICY ID
        const initRes = await fetch(`${CONFIG.domain}/api/v1/file/create`, {
            method: 'PUT',
            headers: { 
                ...COMMON_HEADERS,
                "Cookie": cookies, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                path: "/",
                size: totalSize,
                name: filename,
                policy_id: CONFIG.policyId,
                type: "file"
            })
        });

        const initData = await parseJsonOrError(initRes);
        if(initData.code !== 0) throw new Error("Init Failed: " + initData.msg);
        
        const sessionID = initData.data;

        // Step 4: Chunked Streaming
        const sourceRes = await fetch(sourceUrl);
        const reader = sourceRes.body.getReader();
        let chunkBuffer = new Uint8Array(0);
        let uploadedSize = 0;
        let chunkIndex = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (chunkBuffer.length > 0) {
                    await uploadSingleChunk(sessionID, chunkIndex, chunkBuffer, cookies);
                    uploadedSize += chunkBuffer.length;
                    jobs.set(jobId, { status: 'uploading', uploaded: uploadedSize, total: totalSize });
                }
                break;
            }
            const newBuffer = new Uint8Array(chunkBuffer.length + value.length);
            newBuffer.set(chunkBuffer);
            newBuffer.set(value, chunkBuffer.length);
            chunkBuffer = newBuffer;

            while (chunkBuffer.length >= CONFIG.chunkSize) {
                const chunkToSend = chunkBuffer.slice(0, CONFIG.chunkSize);
                chunkBuffer = chunkBuffer.slice(CONFIG.chunkSize);
                await uploadSingleChunk(sessionID, chunkIndex, chunkToSend, cookies);
                chunkIndex++;
                uploadedSize += chunkToSend.length;
                jobs.set(jobId, { status: 'uploading', uploaded: uploadedSize, total: totalSize });
            }
        }
        jobs.set(jobId, { status: 'completed', uploaded: totalSize, total: totalSize });
    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

async function uploadSingleChunk(sessionID, index, data, cookies) {
    const uploadRes = await fetch(`${CONFIG.domain}/api/v1/file/upload/${sessionID}/${index}`, {
        method: 'POST',
        headers: { 
            ...COMMON_HEADERS,
            "Cookie": cookies, 
            "Content-Type": "application/octet-stream" 
        },
        body: data
    });
    if(!uploadRes.ok) {
         // Error response text ကို ဖတ်မယ်
         const txt = await uploadRes.text();
         throw new Error(`Chunk ${index} failed: ${txt.substring(0, 50)}`);
    }
}

Deno.serve(app.fetch);
