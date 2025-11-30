import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

// --- Configuration ---
const CONFIG = {
  domain: "https://qyun.org",
  
  // 🔥 အစ်ကိုပေးတဲ့ Cookie ကို ထည့်ထားပြီးပါပြီ
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=NTRhZTc4N2QtN2UwNS00YWJjLTk4MTUtMDZjNjE4N2FhMmlw", 
  
  // Channel 2 (ID: 1)
  bucketId: "1", 
};

// Headers (Android Browser)
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
      <title>Qyun Final</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-purple-400">Qyun Uploader (Ready)</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <div class="mb-4 text-xs text-blue-300">Target Channel ID: ${CONFIG.bucketId}</div>

        <button onclick="startUpload()" id="btn" class="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-purple-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-4 p-2 bg-gray-900 rounded text-xs font-mono text-gray-300 break-words hidden"></div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const btn = document.getElementById('btn');
          const statusDiv = document.getElementById('status');
          const bar = document.getElementById('progressBar');

          if(!url) return alert("Link လိုပါတယ်");

          btn.disabled = true;
          statusDiv.classList.remove('hidden');
          statusDiv.innerText = "Connecting...";
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, name})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                statusDiv.innerText = "Uploading to Storage...";
                
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                       bar.style.width = pct + '%';
                       statusDiv.innerText = \`Uploading: \${pct}%\`;
                    } else if(pData.status === 'completed') {
                       clearInterval(interval);
                       bar.style.width = '100%';
                       statusDiv.innerText = "✅ Upload Success!";
                       statusDiv.className = "mt-4 p-2 bg-green-900 text-green-200 rounded text-xs break-words";
                       btn.disabled = false;
                    } else if(pData.status === 'failed') {
                       clearInterval(interval);
                       statusDiv.innerText = "❌ Error: " + pData.error;
                       statusDiv.className = "mt-4 p-2 bg-red-900 text-red-200 rounded text-xs break-words";
                       btn.disabled = false;
                    }
                }, 2000);
            } else {
                throw new Error(res.error || JSON.stringify(res));
            }

          } catch(e) {
            statusDiv.innerText = "Failed: " + e.message;
            statusDiv.className = "mt-4 p-2 bg-red-900 text-red-200 rounded text-xs break-words";
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

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

async function processUpload(jobId, sourceUrl, filename) {
    try {
        // 1. Get File Size
        const headRes = await fetch(sourceUrl, { method: 'HEAD' });
        const totalSize = Number(headRes.headers.get('content-length')) || 0;
        if(totalSize === 0) throw new Error("Source file size error");

        // 2. Generate Key
        const date = new Date().toISOString().slice(0,10).replace(/-/g,'/'); 
        const uuid = crypto.randomUUID();
        const key = `upload/${date}/${uuid}_${filename}`;

        // 3. Request Signature (Using files.html endpoint)
        const formData = new FormData();
        formData.append("name", filename);
        formData.append("size", totalSize.toString());
        formData.append("type", "video/mp4");
        formData.append("key", key);
        formData.append("bucketId", CONFIG.bucketId);
        formData.append("folderId", "");

        const initRes = await fetch(`${CONFIG.domain}/files.html?folderId=`, {
            method: "POST",
            headers: { 
                "Cookie": CONFIG.cookie, 
                ...HEADERS 
            },
            body: formData
        });

        const initText = await initRes.text();
        let initData;
        
        try {
            initData = JSON.parse(initText);
        } catch(e) {
            throw new Error(`Server returned HTML (Login Issue): ${initText.substring(0,100)}`);
        }

        // Check Policy
        if (!initData.policy) {
             throw new Error("Init Failed (No Policy): " + JSON.stringify(initData));
        }

        // 4. Upload to Storage
        const uploadUrl = initData.action || initData.host || "https://upload.qyun.org"; 
        const uploadForm = new FormData();
        
        // Add fields
        for (const k in initData) {
            if(k !== 'action' && k !== 'host') {
                uploadForm.append(k, initData[k]);
            }
        }
        if(!uploadForm.has("key")) uploadForm.append("key", key);

        // Fetch File Stream
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
             throw new Error(`Storage Upload Failed: ${uploadRes.status} ${errTxt.substring(0,100)}`);
        }

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

Deno.serve(app.fetch);
