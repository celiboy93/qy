import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Pro Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-purple-400">Qyun OSS Fixer (Timer Info)</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        
        <div class="mb-4">
            <label class="block mb-2 text-sm text-gray-400">1. Source Video URL</label>
            <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 rounded bg-gray-700 text-white border border-gray-600">
        </div>

        <div class="mb-4">
            <label class="block mb-2 text-sm text-gray-400">2. Paste Token JSON</label>
            <textarea id="jsonInput" rows="4" class="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 text-xs font-mono" placeholder='{"policy": "...", "signature": "..."}'></textarea>
        </div>

        <div class="mb-4">
            <label class="block mb-2 text-sm text-green-400">3. Filename</label>
            <input type="text" id="nameInput" placeholder="my_movie.mp4" class="w-full p-2 rounded bg-gray-700 text-white border border-green-700">
        </div>

        <button onclick="startUpload()" id="btn" class="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-purple-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-4 p-2 bg-black rounded text-xs font-mono text-green-300 break-words hidden"></div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const jsonStr = document.getElementById('jsonInput').value;
          const customName = document.getElementById('nameInput').value;
          
          const status = document.getElementById('status');
          const btn = document.getElementById('btn');
          const bar = document.getElementById('progressBar');

          if(!url || !jsonStr) return alert("Link နှင့် Token ထည့်ပါ");

          let tokenData;
          try {
             tokenData = JSON.parse(jsonStr);
          } catch(e) {
             return alert("JSON Format မှားနေပါတယ်");
          }

          btn.disabled = true;
          status.classList.remove('hidden');
          status.innerText = "Downloading Source File (Please Wait)...";
          bar.style.width = '10%';
          
          try {
            const startRes = await fetch('/api/proxy-upload', {
                method: 'POST', 
                body: JSON.stringify({ url, token: tokenData, name: customName })
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                
                let seconds = 0;
                const interval = setInterval(async () => {
                    seconds++;
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'downloading') {
                       bar.style.width = '30%';
                       status.innerText = \`Downloading to Deno Server... (\${seconds}s)\`;
                    } 
                    else if(pData.status === 'uploading_oss') {
                       bar.style.width = '70%'; 
                       // Show Size and Time
                       status.innerText = \`Uploading \${pData.size} MB to OSS... Time: \${seconds}s (Don't Close)\`;
                       status.className = "mt-4 p-2 bg-blue-900 text-blue-100 rounded text-xs break-words";
                    } 
                    else if(pData.status === 'completed') {
                       clearInterval(interval);
                       bar.style.width = '100%';
                       status.innerText = "✅ Upload Success! File: " + pData.filename;
                       status.className = "mt-4 p-2 bg-green-900 text-green-100 rounded text-xs break-words";
                       btn.disabled = false;
                    } 
                    else if(pData.status === 'failed') {
                       clearInterval(interval);
                       status.innerText = "❌ Failed: " + pData.error;
                       status.className = "mt-4 p-2 bg-red-900 text-red-100 rounded text-xs break-words";
                       btn.disabled = false;
                    }
                }, 1000);
            } else {
                throw new Error(res.error || "Unknown Error");
            }

          } catch(e) {
            status.innerText = "Client Error: " + e.message;
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

app.post("/api/proxy-upload", async (c) => {
  const { url, token, name } = await c.req.json();
  const jobId = crypto.randomUUID();

  let filename = name && name.trim() ? name.trim() : "";
  if (filename && !filename.includes('.')) filename += '.mp4';

  jobs.set(jobId, { status: 'starting' });
  
  // Background Process
  runUpload(jobId, url, token, filename).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ status: "uploading", jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

async function runUpload(jobId, sourceUrl, token, customName) {
    try {
        jobs.set(jobId, { status: 'downloading' });

        // 1. Determine Upload URL
        let uploadUrl = "https://upload.qyun.org";
        if (token.hosts && token.hosts.length > 0) {
            uploadUrl = token.hosts[0]; 
        } else if (token.host) {
            uploadUrl = token.host;
        }

        // 2. Download File
        const fileRes = await fetch(sourceUrl);
        if (!fileRes.ok) throw new Error("Source Download Failed");
        const blob = await fileRes.blob(); 
        
        // Calculate Size for UI
        const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
        
        // Update Status to Uploading Phase
        jobs.set(jobId, { status: 'uploading_oss', size: sizeMB });

        // 3. Prepare FormData
        const formData = new FormData();
        for (const key in token) {
            if (key !== 'hosts' && key !== 'id') {
                formData.append(key, token[key]);
            }
        }

        if (!formData.has("key")) throw new Error("Token JSON missing 'key'");

        let finalFilename = "video.mp4";
        if (customName) {
            finalFilename = customName;
        } else {
            const keyVal = formData.get("key")?.toString();
            if(keyVal) finalFilename = keyVal.split('/').pop();
        }

        formData.append("file", blob, finalFilename);

        // 4. Upload to OSS
        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            body: formData
        });

        if (uploadRes.ok || uploadRes.status === 204 || uploadRes.status === 200) {
             jobs.set(jobId, { status: 'completed', filename: finalFilename });
        } else {
             const txt = await uploadRes.text();
             throw new Error(`OSS Error ${uploadRes.status}: ${txt}`);
        }

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

Deno.serve(app.fetch);
