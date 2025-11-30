import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Stream Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun Unlimited Streamer</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">1. Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">2. Paste Token JSON</label>
        <textarea id="tokenInput" placeholder='{"success":true...}' class="w-full h-32 p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600 text-xs font-mono"></textarea>

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Streaming</button>
        
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

          if(!url || !tokenStr) return alert("Data ဖြည့်ပါ");

          let token;
          try { token = JSON.parse(tokenStr); } catch(e) { return alert("JSON မှားနေသည်"); }

          if (!token.data?.OSSAccessKeyId) return alert("Token တွင် OSS Key မပါပါ");

          btn.disabled = true;
          statusDiv.innerText = "Initializing Stream...";
          bar.style.width = '0%';
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, token})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                statusDiv.innerText = "Streaming in progress...";
                
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                       bar.style.width = pct + '%';
                       pctText.innerText = pct + '%';
                       
                       const mbLoaded = (pData.uploaded / (1024 * 1024)).toFixed(1);
                       const mbTotal = (pData.total / (1024 * 1024)).toFixed(1);
                       statusDiv.innerText = \`Streaming: \${mbLoaded} MB / \${mbTotal} MB\`;

                    } else if(pData.status === 'completed') {
                       clearInterval(interval);
                       bar.style.width = '100%';
                       pctText.innerText = '100%';
                       statusDiv.innerText = "✅ Upload Success!";
                       btn.disabled = false;
                    } else if(pData.status === 'failed') {
                       clearInterval(interval);
                       bar.style.backgroundColor = 'red';
                       statusDiv.innerText = "❌ Error: " + pData.error;
                       btn.disabled = false;
                    }
                }, 1500);
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
  
  processStreamUpload(jobId, url, token).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ status: "uploading", jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

async function processStreamUpload(jobId, sourceUrl, token) {
    try {
        const ossData = token.data;
        // Use Host 2 (Aliyun) often better for direct stream
        const uploadUrl = ossData.hosts[1] || ossData.hosts[0]; 
        
        // 1. Fetch Source Stream
        const sourceRes = await fetch(sourceUrl);
        if(!sourceRes.ok) throw new Error("Source fetch failed");
        
        const totalSize = Number(sourceRes.headers.get('content-length')) || 0;
        
        // 2. Prepare Multipart Boundary
        const boundary = "----DenoUploadBoundary" + crypto.randomUUID();
        const crlf = "\r\n";
        const encoder = new TextEncoder();

        // 3. Helper to create part headers
        function createPart(name, value) {
            return encoder.encode(
                `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`
            );
        }

        // 4. Create the Stream
        let loaded = 0;
        const multipartStream = new ReadableStream({
            async start(controller) {
                // Add Fields
                controller.enqueue(createPart("OSSAccessKeyId", ossData.OSSAccessKeyId));
                controller.enqueue(createPart("policy", ossData.policy));
                controller.enqueue(createPart("Signature", ossData.signature));
                controller.enqueue(createPart("key", ossData.key));
                controller.enqueue(createPart("success_action_status", "200"));

                // Add File Header
                const fileHeader = `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="video.mp4"${crlf}Content-Type: video/mp4${crlf}${crlf}`;
                controller.enqueue(encoder.encode(fileHeader));

                // Pipe Source File Stream
                const reader = sourceRes.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    loaded += value.length;
                    // Update Status (Every ~2MB)
                    if (loaded % (2 * 1024 * 1024) < value.length || loaded === totalSize) {
                        jobs.set(jobId, { status: 'uploading', uploaded: loaded, total: totalSize });
                    }
                    
                    controller.enqueue(value);
                }

                // Add Footer
                controller.enqueue(encoder.encode(`${crlf}--${boundary}--${crlf}`));
                controller.close();
            }
        });

        // 5. Send to OSS (Using Manual Multipart Body)
        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
            },
            body: multipartStream
        });

        const respText = await uploadRes.text();

        if (uploadRes.ok || uploadRes.status === 200 || uploadRes.status === 204) {
             jobs.set(jobId, { status: 'completed', uploaded: totalSize, total: totalSize });
        } else {
             throw new Error(`OSS Error ${uploadRes.status}: ${respText.substring(0, 200)}`);
        }

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

Deno.serve(app.fetch);
