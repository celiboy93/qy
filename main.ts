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
        <!-- Step 1 -->
        <label class="block mb-2 text-sm text-gray-400">1. Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <!-- Step 2 -->
        <label class="block mb-2 text-sm text-gray-400">2. Paste Token JSON Here</label>
        <p class="text-xs text-gray-500 mb-2">(Console မှာပေါ်တဲ့ {"success":true...} အကုန်ကူးထည့်ပါ)</p>
        <textarea id="tokenInput" placeholder='{"success":true, "data": {...}}' class="w-full h-40 p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600 text-xs font-mono"></textarea>

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-green-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-2 text-center text-xs text-yellow-400 break-words">Waiting for Token...</div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const tokenStr = document.getElementById('tokenInput').value;
          const btn = document.getElementById('btn');
          const statusDiv = document.getElementById('status');
          const bar = document.getElementById('progressBar');

          if(!url) return alert("Link လိုပါတယ်");
          if(!tokenStr) return alert("JSON Token ထည့်ပါ");

          let token;
          try {
             token = JSON.parse(tokenStr);
          } catch(e) {
             return alert("JSON ပုံစံမှားနေပါတယ် (ကူးတာမစုံလို့ ဖြစ်နိုင်တယ်)");
          }

          // Validate Token Structure
          if (!token.data || !token.data.OSSAccessKeyId) {
             return alert("JSON မှားနေပါတယ် (OSSAccessKeyId မပါပါ)");
          }

          btn.disabled = true;
          statusDiv.innerText = "Processing...";
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, token})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                statusDiv.innerText = "Deno is uploading to OSS...";
                
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                       bar.style.width = pct + '%';
                       statusDiv.innerText = \`Uploading: \${pct}% (\${(pData.uploaded/1024/1024).toFixed(1)} MB)\`;
                    } else if(pData.status === 'completed') {
                       clearInterval(interval);
                       bar.style.width = '100%';
                       statusDiv.innerText = "✅ Upload Success!";
                       statusDiv.className = "mt-2 text-center text-xs text-green-400";
                       btn.disabled = false;
                    } else if(pData.status === 'failed') {
                       clearInterval(interval);
                       statusDiv.innerText = "❌ Error: " + pData.error;
                       statusDiv.className = "mt-2 text-center text-xs text-red-400";
                       btn.disabled = false;
                    }
                }, 2000);
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
        // Parse the special OSS Token Structure
        const ossData = token.data;
        if(!ossData) throw new Error("Invalid Token Data");

        // Use the second host (usually aliyuncs.com is more stable for API)
        const uploadUrl = ossData.hosts[1] || ossData.hosts[0];
        
        // Prepare Form
        const form = new FormData();
        form.append("OSSAccessKeyId", ossData.OSSAccessKeyId);
        form.append("policy", ossData.policy);
        form.append("Signature", ossData.signature);
        form.append("key", ossData.key);
        form.append("success_action_status", "200"); // Important for OSS

        // Get File Stream
        const fileRes = await fetch(sourceUrl);
        if(!fileRes.ok) throw new Error("Cannot fetch source video");
        
        const totalSize = Number(fileRes.headers.get('content-length')) || 0;
        const blob = await fileRes.blob();
        
        // Append file last
        form.append("file", blob, "video.mp4");

        jobs.set(jobId, { status: 'uploading', uploaded: 0, total: totalSize || blob.size });

        // Upload to OSS
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
