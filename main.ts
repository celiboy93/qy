import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

// --- Configuration ---
const CONFIG = {
  domain: "https://qyun.org",
  // 🔥 Cookie ကို ဒီမှာ ထည့်ပါ
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=ZDJhMTI0ZWYtMmU5NC00ZWNjLTg4YTctZWlyNDUzMzYwMGZj", 
  
  // 🔥 ပုံထဲမှာ bucketId: 1 လို့ပြထားလို့ "1" ကို သုံးပါမယ်
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
      <title>Qyun Final Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun Uploader (Fixed)</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <!-- ID ပြောင်းချင်ရင် ဒီမှာရိုက်ထည့်လို့ရအောင် လုပ်ပေးထားပါတယ် -->
        <label class="block mb-2 text-sm text-blue-400">Channel ID (Default: 1)</label>
        <input type="text" id="policyInput" value="1" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-green-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-2 text-center text-xs text-yellow-400 break-words">Ready</div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const policyId = document.getElementById('policyInput').value; // Get ID from box
          
          if(!url) return alert("Link လိုပါတယ်");

          document.getElementById('btn').disabled = true;
          document.getElementById('status').innerText = "Connecting...";

          try {
            const startRes = await fetch('/api/init', {
                method: 'POST', 
                body: JSON.stringify({url, name, policyId})
            });
            const res = await startRes.json();
            
            if(res.error) throw new Error(res.error);
            
            const jobId = res.jobId;
            const bar = document.getElementById('progressBar');
            const status = document.getElementById('status');
            
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
                    status.innerText = "✅ Upload Complete! Check Qyun.";
                    status.className = "mt-2 text-center text-xs text-green-400";
                    document.getElementById('btn').disabled = false;
                } else if(pData.status === 'failed') {
                    clearInterval(interval);
                    status.innerText = "❌ Error: " + pData.error;
                    status.className = "mt-2 text-center text-xs text-red-400";
                    document.getElementById('btn').disabled = false;
                }
            }, 2000);

          } catch(e) {
            document.getElementById('status').innerText = "Failed: " + e.message;
            document.getElementById('btn').disabled = false;
          }
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

const jobs = new Map();

// Init Upload
app.post("/api/init", async (c) => {
  const { url, name, policyId } = await c.req.json();
  const jobId = crypto.randomUUID();
  let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
  if (!filename.includes('.')) filename += '.mp4';

  jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });
  
  // Use the ID from user input (default "1")
  processChunkUpload(jobId, url, filename, policyId || CONFIG.policyId).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

// Cloudreve v3 Chunked Upload
async function processChunkUpload(jobId, sourceUrl, filename, policyId) {
    try {
        // 1. Get File Size
        const headRes = await fetch(sourceUrl, { method: 'HEAD' });
        const totalSize = Number(headRes.headers.get('content-length'));
        if(!totalSize) throw new Error("Source file size unknown (Check Link)");

        jobs.set(jobId, { status: 'uploading', uploaded: 0, total: totalSize });

        // 2. Init Upload Session (Using Manual ID)
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
                policy_id: policyId, // "1"
                type: "file"
            })
        });

        // Check if HTML returned (Cloudflare Block)
        const initText = await initRes.text();
        let initData;
        try { initData = JSON.parse(initText); } 
        catch(e) { throw new Error(`Server returned HTML (Blocked): ${initText.substring(0, 50)}`); }

        if(initData.code !== 0) throw new Error("Init Failed: " + initData.msg);
        
        const sessionID = initData.data;

        // 3. Chunked Streaming
        const sourceRes = await fetch(sourceUrl);
        const reader = sourceRes.body.getReader();
        let chunkBuffer = new Uint8Array(0);
        let chunkIndex = 0;
        let uploadedSize = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (chunkBuffer.length > 0) {
                    await uploadChunk(sessionID, chunkIndex, chunkBuffer);
                    uploadedSize += chunkBuffer.length;
                    jobs.set(jobId, { status: 'uploading', uploaded: uploadedSize, total: totalSize });
                }
                break;
            }
            
            const temp = new Uint8Array(chunkBuffer.length + value.length);
            temp.set(chunkBuffer);
            temp.set(value, chunkBuffer.length);
            chunkBuffer = temp;

            while (chunkBuffer.length >= CONFIG.chunkSize) {
                const chunk = chunkBuffer.slice(0, CONFIG.chunkSize);
                chunkBuffer = chunkBuffer.slice(CONFIG.chunkSize);
                await uploadChunk(sessionID, chunkIndex, chunk);
                chunkIndex++;
                uploadedSize += chunk.length;
                jobs.set(jobId, { status: 'uploading', uploaded: uploadedSize, total: totalSize });
            }
        }
        jobs.set(jobId, { status: 'completed', uploaded: totalSize, total: totalSize });

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

async function uploadChunk(sessionID, index, data) {
    const res = await fetch(`${CONFIG.domain}/api/v1/file/upload/${sessionID}/${index}`, {
        method: 'POST',
        headers: { 
            "Cookie": CONFIG.cookie, 
            "Content-Type": "application/octet-stream",
            ...HEADERS
        },
        body: data
    });
    if(!res.ok) throw new Error(`Chunk ${index} failed`);
}

Deno.serve(app.fetch);
