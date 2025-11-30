import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Final Upload</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun 100% Uploader</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">1. Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">2. Paste Token JSON Here</label>
        <textarea id="tokenInput" placeholder='{"success":true, "data": {...}}' class="w-full h-40 p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600 text-xs font-mono"></textarea>

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <!-- Progress Bar -->
        <div class="mt-4 bg-gray-900 rounded-full h-4 overflow-hidden border border-gray-700">
             <div id="progressBar" class="bg-green-500 h-full transition-all duration-200" style="width: 0%"></div>
        </div>
        <div id="percentText" class="text-center text-xs mt-1 text-gray-400">0%</div>
        
        <div id="status" class="mt-2 text-center text-xs text-yellow-400 break-words">Waiting...</div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const tokenStr = document.getElementById('tokenInput').value;
          const btn = document.getElementById('btn');
          const statusDiv = document.getElementById('status');
          const bar = document.getElementById('progressBar');
          const pctText = document.getElementById('percentText');

          if(!url) return alert("Link လိုပါတယ်");
          if(!tokenStr) return alert("JSON Token ထည့်ပါ");

          let token;
          try {
             token = JSON.parse(tokenStr);
          } catch(e) {
             return alert("JSON ပုံစံမှားနေပါတယ်");
          }

          if (!token.data || !token.data.OSSAccessKeyId) {
             return alert("JSON မှားနေပါတယ် (OSSAccessKeyId မပါပါ)");
          }

          btn.disabled = true;
          statusDiv.innerText = "Starting...";
          bar.style.width = '0%';
          pctText.innerText = '0%';
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, token})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                statusDiv.innerText = "Downloading & Uploading...";
                
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       // Progress Calculation
                       const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                       
                       // UI Update
                       bar.style.width = pct + '%';
                       pctText.innerText = pct + '%';
                       
                       // Detail Text
                       const mbLoaded = (pData.uploaded / (1024 * 1024)).toFixed(1);
                       const mbTotal = (pData.total / (1024 * 1024)).toFixed(1);
                       statusDiv.innerText = \`Processing: \${mbLoaded} MB / \${mbTotal} MB\`;

                    } else if(pData.status === 'completed') {
                       clearInterval(interval);
                       bar.style.width = '100%';
                       pctText.innerText = '100%';
                       statusDiv.innerText = "✅ Upload Success!";
                       statusDiv.className = "mt-2 text-center text-xs text-green-400";
                       btn.disabled = false;
                    } else if(pData.status === 'failed') {
                       clearInterval(interval);
                       bar.style.backgroundColor = 'red';
                       statusDiv.innerText = "❌ Error: " + pData.error;
                       statusDiv.className = "mt-2 text-center text-xs text-red-400";
                       btn.disabled = false;
                    }
                }, 1000); // Check every 1 second
            } else {
                throw new Error(res.msg || JSON.stringify(res));
            }

          } catch(e) {
            statusDiv.innerText = "Error: " + e.message;
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
  const { url, token } = await c.req.json();
  const jobId = crypto.randomUUID();

  jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });
  
  processManualUpload(jobId, url, token).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ status: "uploading", jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

async function processManualUpload(jobId, sourceUrl, token) {
    try {
        const ossData = token.data;
        if(!ossData) throw new Error("Invalid Token Data");

        const uploadUrl = ossData.hosts[1] || ossData.hosts[0];
        
        // Prepare Form Data (Fields only first)
        const form = new FormData();
        form.append("OSSAccessKeyId", ossData.OSSAccessKeyId);
        form.append("policy", ossData.policy);
        form.append("Signature", ossData.signature);
        form.append("key", ossData.key);
        form.append("success_action_status", "200");

        // 1. Start Downloading Stream
        const fileRes = await fetch(sourceUrl);
        if(!fileRes.ok) throw new Error("Cannot fetch source video");
        
        const totalSize = Number(fileRes.headers.get('content-length')) || 0;
        
        // 2. Read stream manually to track progress
        const reader = fileRes.body.getReader();
        const chunks = []; // Store chunks in memory (Limit: Deno Deploy memory)
        let loaded = 0;

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            
            chunks.push(value);
            loaded += value.length;
            
            // 🔥 Update Progress here
            // (Only update map every 1MB to save resources)
            if (loaded % (1024 * 1024) < value.length || loaded === totalSize) {
                jobs.set(jobId, { status: 'uploading', uploaded: loaded, total: totalSize });
            }
        }

        // 3. Create Blob from chunks
        const blob = new Blob(chunks);
        
        // 4. Append File to Form
        form.append("file", blob, "video.mp4");

        // 5. Upload to OSS
        // (Note: This part happens after download finishes, so progress stays at 100% for a bit)
        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            body: form
        });

        if (uploadRes.ok || uploadRes.status === 200 || uploadRes.status === 204) {
             jobs.set(jobId, { status: 'completed', uploaded: totalSize, total: totalSize });
        } else {
             const errTxt = await uploadRes.text();
             throw new Error(`OSS Rejected: ${uploadRes.status} - ${errTxt.substring(0, 100)}`);
        }

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

Deno.serve(app.fetch);
