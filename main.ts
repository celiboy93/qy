import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Debug Streamer</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun Debug Streamer</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">1. Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">2. Paste Token JSON</label>
        <textarea id="tokenInput" placeholder='Paste JSON from console...' class="w-full h-32 p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600 text-xs font-mono"></textarea>

        <button onclick="startUpload()" id="btn" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition">Start Upload</button>
        
        <!-- Logs Area -->
        <div id="logs" class="mt-4 p-3 bg-black rounded text-xs font-mono text-green-300 h-40 overflow-y-auto border border-gray-700">
            Waiting for input...
        </div>
      </div>

      <script>
        function log(msg, type='info') {
            const logs = document.getElementById('logs');
            const color = type === 'error' ? 'text-red-400' : (type === 'success' ? 'text-green-400' : 'text-gray-300');
            logs.innerHTML += \`<div class="\${color}">[\${new Date().toLocaleTimeString()}] \${msg}</div>\`;
            logs.scrollTop = logs.scrollHeight;
        }

        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const tokenStr = document.getElementById('tokenInput').value;
          const btn = document.getElementById('btn');

          if(!url || !tokenStr) return alert("Data ဖြည့်ပါ");

          btn.disabled = true;
          document.getElementById('logs').innerHTML = ''; // Clear logs
          log("🚀 Starting process...");
          
          try {
            const startRes = await fetch('/api/upload', {
                method: 'POST', 
                body: JSON.stringify({url, tokenStr})
            });
            const res = await startRes.json();
            
            if(res.status === 'uploading') {
                log("📡 Stream connected! Monitoring...", "success");
                
                const interval = setInterval(async () => {
                    const poll = await fetch('/api/status/' + res.jobId);
                    const pData = await poll.json();
                    
                    if(pData.status === 'uploading') {
                       const mbLoaded = (pData.uploaded / (1024 * 1024)).toFixed(1);
                       const mbTotal = (pData.total / (1024 * 1024)).toFixed(1);
                       const pct = Math.round((pData.uploaded / pData.total) * 100);
                       // Update only last line to avoid spam
                       // log(\`Uploading: \${pct}% (\${mbLoaded}/\${mbTotal} MB)\`); 
                       document.title = \`Uploading \${pct}%\`;
                    } else if(pData.status === 'completed') {
                       clearInterval(interval);
                       log("✅ Upload SUCCESS! File is on Qyun.", "success");
                       btn.disabled = false;
                    } else if(pData.status === 'failed') {
                       clearInterval(interval);
                       log("❌ FAILED: " + pData.error, "error");
                       btn.disabled = false;
                    }
                }, 2000);
            } else {
                log("❌ Init Error: " + (res.error || JSON.stringify(res)), "error");
                btn.disabled = false;
            }

          } catch(e) {
            log("❌ Client Error: " + e.message, "error");
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
  
  processDebugUpload(jobId, url, tokenStr).catch(e => {
      jobs.set(jobId, { status: 'failed', error: e.message });
  });

  return c.json({ status: "uploading", jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

async function processDebugUpload(jobId, sourceUrl, tokenStr) {
    try {
        // 1. Parse Token
        let ossData;
        try {
            const parsed = JSON.parse(tokenStr);
            ossData = parsed.data || parsed; // Handle {data: ...} or direct {...}
        } catch { throw new Error("Invalid JSON Token"); }

        if(!ossData.OSSAccessKeyId) throw new Error("Token missing OSSAccessKeyId");

        // Try using the FIRST host (usually safer) or fallback to second
        const uploadUrl = (ossData.hosts && ossData.hosts[0]) ? ossData.hosts[0] : ossData.host;
        
        // 2. Test Source URL Connection
        const headCheck = await fetch(sourceUrl, { method: 'HEAD' });
        const totalSize = Number(headCheck.headers.get('content-length')) || 0;
        
        if (!headCheck.ok) {
             throw new Error(`Source Link Error: ${headCheck.status} ${headCheck.statusText} (Deno cannot download this link)`);
        }
        if (totalSize === 0) {
             throw new Error("Source file has 0 size or hidden Content-Length");
        }

        // 3. Prepare Multipart Stream
        const boundary = "----DenoDebugBoundary" + crypto.randomUUID();
        const crlf = "\r\n";
        const encoder = new TextEncoder();

        function createPart(name, value) {
            return encoder.encode(`--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`);
        }

        // 4. Start Real Stream
        const sourceRes = await fetch(sourceUrl);
        if(!sourceRes.body) throw new Error("Source has no body");

        let loaded = 0;
        const multipartStream = new ReadableStream({
            async start(controller) {
                // OSS Fields
                controller.enqueue(createPart("OSSAccessKeyId", ossData.OSSAccessKeyId));
                controller.enqueue(createPart("policy", ossData.policy));
                controller.enqueue(createPart("Signature", ossData.signature));
                controller.enqueue(createPart("key", ossData.key));
                controller.enqueue(createPart("success_action_status", "200"));

                // File Header
                controller.enqueue(encoder.encode(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="video.mp4"${crlf}Content-Type: video/mp4${crlf}${crlf}`));

                // Pipe Data
                const reader = sourceRes.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    loaded += value.length;
                    
                    // Update Job Status
                    if (loaded % (5 * 1024 * 1024) < value.length || loaded === totalSize) {
                        jobs.set(jobId, { status: 'uploading', uploaded: loaded, total: totalSize });
                    }
                    controller.enqueue(value);
                }

                // Footer
                controller.enqueue(encoder.encode(`${crlf}--${boundary}--${crlf}`));
                controller.close();
            }
        });

        // 5. Send to OSS with Explicit Content-Length
        // Important: Some OSS requires Content-Length to be set if known
        // We calculate rough size: FileSize + ~1KB overhead for headers
        const estimatedSize = totalSize + 2048; 

        const uploadRes = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                // "Content-Length": estimatedSize.toString() // Deno manages this usually, but good to know
            },
            body: multipartStream
        });

        const respText = await uploadRes.text();

        if (uploadRes.ok || uploadRes.status === 200 || uploadRes.status === 204) {
             jobs.set(jobId, { status: 'completed', uploaded: totalSize, total: totalSize });
        } else {
             throw new Error(`OSS Rejected (${uploadRes.status}): ${respText.substring(0, 150)}`);
        }

    } catch (e) {
        jobs.set(jobId, { status: 'failed', error: e.message });
    }
}

Deno.serve(app.fetch);
