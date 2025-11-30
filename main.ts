import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Super Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-green-400">Qyun Super Uploader</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">1. Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">2. Paste Token (From Console)</label>
        <textarea id="tokenInput" placeholder='Paste the JSON from console here...' class="w-full h-32 p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600 text-xs font-mono"></textarea>

        <button onclick="startUpload()" id="btn" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <!-- Progress UI -->
        <div class="mt-4 bg-gray-900 rounded-full h-5 overflow-hidden border border-gray-700 relative">
             <div id="progressBar" class="bg-green-600 h-full transition-all duration-200" style="width: 0%"></div>
             <div id="percentText" class="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow-md">0%</div>
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
          const pctText = document.getElementById('percentText');

          if(!url) return alert("Link လိုပါတယ်");
          if(!tokenStr) return alert("Token JSON ထည့်ပါ");

          // Basic Validation
          try { JSON.parse(tokenStr); } 
          catch(e) { return alert("JSON ပုံစံမှားနေပါတယ် (ကူးတာမစုံလို့ ဖြစ်နိုင်တယ်)"); }

          btn.disabled = true;
          statusDiv.innerText = "Initializing Stream...";
          bar.style.width = '0%';
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, tokenStr})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                statusDiv.innerText = "Streaming Active...";
                
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                       
                       bar.style.width = pct + '%';
                       pctText.innerText = pct + '%';
                       
                       const mbLoaded = (pData.uploaded / (1024 * 1024)).toFixed(1);
                       const mbTotal = (pData.total / (1024 * 1024)).toFixed(1);
                       statusDiv.innerText = \`Sent: \${mbLoaded} MB / \${mbTotal} MB\`;

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
                throw new Error(res.msg || "Unknown Start Error");
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
  const { url, tokenStr } = await c.req.json();
  const jobId = crypto.randomUUID();

  jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });
  
  processStreamUpload(jobId, url, tokenStr).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ status: "uploading", jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

async function processStreamUpload(jobId, sourceUrl, tokenStr) {
    try {
        const rawToken = JSON.parse(tokenStr);
        
        // 🔥 Smart Detection: Handle both wrapped data and flat data
        let ossData = rawToken;
        if (rawToken.data && rawToken.data.OSSAccessKeyId) {
            ossData = rawToken.data;
        }

        if (!ossData.OSSAccessKeyId || !ossData.signature) {
            throw new Error("Invalid Token: Missing Keys (OSSAccessKeyId/Signature)");
        }

        // Use Hosts (Aliyun usually 2nd)
        const uploadUrl = (ossData.hosts && ossData.hosts[1]) ? ossData.hosts[1] : (ossData.host || ossData.action);
        
        // 1. Fetch Source
        const sourceRes = await fetch(sourceUrl);
        if(!sourceRes.ok) throw new Error("Source fetch failed");
        
        const totalSize = Number(sourceRes.headers.get('content-length')) || 0;
        
        // 2. Prepare Manual Multipart (Streaming)
        // This avoids loading the whole file into RAM
        const boundary = "----DenoStreamingBoundary" + crypto.randomUUID();
        const crlf = "\r\n";
        const encoder = new TextEncoder();

        function createPart(name, value) {
            return encoder.encode(
                `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`
            );
        }

        let loaded = 0;
        const multipartStream = new ReadableStream({
            async start(controller) {
                // Add OSS Fields
                const fields = ["OSSAccessKeyId", "policy", "Signature", "key", "success_action_status", "x-oss-security-token", "callback"];
                
                for(const f of fields) {
                    // Check strict match or lowercase match
                    const val = ossData[f] || ossData[f.toLowerCase()];
                    if(val) controller.enqueue(createPart(f, val));
                }

                // Add File Header
                const fileHeader = `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="video.mp4"${crlf}Content-Type: video/mp4${crlf}${crlf}`;
                controller.enqueue(encoder.encode(fileHeader));

                // Pipe Source Body
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

        // 3. Send to OSS
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
