import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

// --- Configuration ---
const CONFIG = {
  domain: "https://qyun.org",
  
  // 🔥 အစ်ကိုပေးထားတဲ့ Cookie ကို ထည့်ပေးထားပါတယ်
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=ZDJhMTI0ZWYtMmU5NC00ZWNjLTg4YTctZWlyNDUzMzYwMGZj", 
  
  // Channel 2 ID (ပုံထဲကအတိုင်း 1 ကိုသုံးပါမယ်)
  bucketId: "1", 
};

// Android Header (Cookie နဲ့ကိုက်ညီအောင်)
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
      <title>Qyun Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun Uploader (Ready)</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <div class="mb-4">
             <span class="bg-blue-900 text-blue-200 text-xs px-2 py-1 rounded">Channel 2 (Bucket ID: ${CONFIG.bucketId})</span>
        </div>

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-blue-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-2 text-center text-xs text-yellow-400 break-words">Ready</div>
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
            status.innerText = "Requesting Signature...";
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, name})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                status.innerText = "Uploading... (Please wait)";
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                       bar.style.width = pct + '%';
                       status.innerText = \`Uploading: \${pct}%\`;
                    } else if(pData.status === 'completed') {
                       clearInterval(interval);
                       bar.style.width = '100%';
                       status.innerText = "✅ Success! File Uploaded to Channel 2.";
                       status.className = "mt-2 text-center text-xs text-green-400";
                       btn.disabled = false;
                    } else if(pData.status === 'failed') {
                       clearInterval(interval);
                       status.innerText = "❌ Error: " + pData.error;
                       status.className = "mt-2 text-center text-xs text-red-400";
                       btn.disabled = false;
                    }
                }, 2000);
            } else {
                throw new Error(res.msg || "Unknown error");
            }

          } catch(e) {
            status.innerText = "Failed: " + e.message;
            status.className = "mt-2 text-center text-xs text-red-400";
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

app.post("/api/upload", async (c) => {
  const { url, name } = await c.req.json();
  const jobId = crypto.randomUUID();
  
  let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
  if (!filename.includes('.')) filename += '.mp4';

  jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });
  processUpload(jobId, url, filename).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ status: "uploading", jobId });
});

app.get("/api/status/:id", (c) => {
    return c.json(jobs.get(c.req.param('id')) || {});
});

async function processUpload(jobId, sourceUrl, filename) {
    try {
        // 1. Get File Size
        const headRes = await fetch(sourceUrl, { method: 'HEAD' });
        const totalSize = Number(headRes.headers.get('content-length')) || 0;
        if(totalSize === 0) throw new Error("Cannot get file size");

        // 2. Generate Key
        const date = new Date().toISOString().slice(0,10).replace(/-/g,'/'); 
        const uuid = crypto.randomUUID();
        const key = `upload/${date}/${uuid}_${filename}`;

        // 3. Request Signature from Qyun
        const formData = new FormData();
        formData.append("name", filename);
        formData.append("size", totalSize.toString());
        formData.append("type", "video/mp4");
        formData.append("key", key);
        formData.append("bucketId", CONFIG.bucketId); // Channel 2
        formData.append("folderId", "");

        const initRes = await fetch(`${CONFIG.domain}/files.html?folderId=`, {
            method: "POST",
            headers: { "Cookie": CONFIG.cookie, ...HEADERS },
            body: formData
        });

        const initText = await initRes.text();
        let initData;
        try {
            initData = JSON.parse(initText);
        } catch(e) {
            throw new Error(`Init response error: ${initText.substring(0,100)}`);
        }

        if (!initData.policy) throw new Error("Invalid Signature Response");

        // 4. Upload to Storage
        const uploadUrl = initData.action || initData.host || "https://upload.qyun.org"; 
        const uploadForm = new FormData();
        
        for (const k in initData) {
            if(k !== 'action' && k !== 'host') uploadForm.append(k, initData[k]);
        }
        if(!uploadForm.has("key")) uploadForm.append("key", key);

        // Download & Upload Stream
        const fileRes = await fetch(sourceUrl);
        const blob = await fileRes.blob(); 
        
        uploadForm.append("file", blob, filename);

        jobs.set(jobId, { status: 'uploading', uploaded: 0, total: totalSize });

        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            body: uploadForm
        });

        if (uploadRes.ok || uploadRes.status === 204 || uploadRes.status === 200) {
             jobs.set(jobId, { status: 'completed', uploaded: totalSize, total: totalSize });
        } else {
             const errTxt = await uploadRes.text();
             throw new Error(`Upload Failed: ${uploadRes.status} ${errTxt.substring(0,100)}`);
        }

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

Deno.serve(app.fetch);
