import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Manual Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-4 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun 100% Working Uploader</h1>
      
      <!-- Step 1 -->
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg mb-4">
        <h2 class="text-lg font-bold text-yellow-400 mb-2">အဆင့် (၁) - ဖိုင်အချက်အလက်ယူရန်</h2>
        <input type="text" id="urlInput" placeholder="Source Video URL..." class="w-full p-2 mb-2 rounded bg-gray-700 border border-gray-600 text-white">
        <input type="text" id="nameInput" placeholder="Filename.mp4" class="w-full p-2 mb-2 rounded bg-gray-700 border border-gray-600 text-white">
        <button onclick="step1()" id="btn1" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold">Get JS Code</button>
      </div>

      <!-- Step 2 -->
      <div id="step2" class="bg-gray-800 p-4 rounded-lg shadow-lg mb-4 hidden">
        <h2 class="text-lg font-bold text-yellow-400 mb-2">အဆင့် (၂) - လက်မှတ်တောင်းရန်</h2>
        <p class="text-xs text-gray-300 mb-2">
           ၁။ အောက်က Code ကို Copy ကူးပါ။<br>
           ၂။ Qyun.org (Login ဝင်ထားသော Tab) > <b>Console</b> မှာ Paste လုပ်ပြီး Enter ခေါက်ပါ။<br>
           ၃။ ထွက်လာတဲ့ စာအရှည်ကြီး (JSON) ကို Copy ကူးခဲ့ပါ။
        </p>
        <textarea id="jsCode" readonly class="w-full h-32 p-2 text-xs bg-black text-green-400 rounded font-mono mb-2" onclick="this.select()"></textarea>
        <button onclick="copyCode()" class="bg-gray-600 px-3 py-1 rounded text-xs">Copy Code</button>
      </div>

      <!-- Step 3 -->
      <div id="step3" class="bg-gray-800 p-4 rounded-lg shadow-lg mb-4 hidden">
        <h2 class="text-lg font-bold text-yellow-400 mb-2">အဆင့် (၃) - Upload တင်ရန်</h2>
        <textarea id="tokenInput" placeholder='Paste JSON here (e.g. {"policy": "...", "signature": "..."})' class="w-full h-32 p-2 text-xs bg-gray-700 border border-gray-600 rounded mb-2 text-white"></textarea>
        <button onclick="step3()" id="btn3" class="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold">Start Upload Now</button>
        
        <div class="mt-4 bg-gray-900 rounded-full h-2.5 overflow-hidden">
             <div id="progressBar" class="bg-green-500 h-2.5 rounded-full" style="width: 0%"></div>
        </div>
        <div id="status" class="mt-2 text-center text-xs text-yellow-400">Waiting...</div>
      </div>

      <script>
        let fileData = {};

        async function step1() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          if(!url) return alert("Link လိုပါတယ်");
          
          document.getElementById('btn1').disabled = true;
          document.getElementById('btn1').innerText = "Checking File Size...";

          try {
              const res = await fetch('/api/check-size', {
                 method: 'POST', body: JSON.stringify({url, name})
              });
              const data = await res.json();
              
              if(data.error) {
                 alert("Error: " + data.error);
                 document.getElementById('btn1').disabled = false;
                 return;
              }

              fileData = data; // Save for later
              
              // Generate JS Code for user
              // Channel 2 (ID: 1) ကို အသေထည့်ပေးထားပါတယ်
              const js = \`
var f = new FormData();
f.append("name", "\${data.filename}");
f.append("size", "\${data.size}");
f.append("type", "video/mp4");
f.append("key", "\${data.key}");
f.append("bucketId", "1"); 
f.append("folderId", "");

fetch("/files.html?folderId=", { method: "POST", body: f })
.then(r => r.text())
.then(t => console.log(t))
.catch(e => console.error(e));
\`;
              document.getElementById('jsCode').value = js.trim();
              document.getElementById('step2').classList.remove('hidden');
              document.getElementById('step3').classList.remove('hidden');
              document.getElementById('btn1').innerText = "Done";
          } catch(e) {
              alert(e.message);
              document.getElementById('btn1').disabled = false;
          }
        }

        function copyCode() {
           const copyText = document.getElementById("jsCode");
           copyText.select();
           navigator.clipboard.writeText(copyText.value);
           alert("Code Copied!");
        }

        async function step3() {
           const tokenJson = document.getElementById('tokenInput').value;
           if(!tokenJson) return alert("JSON ထည့်ပါ");
           
           let parsedToken;
           try {
               parsedToken = JSON.parse(tokenJson);
           } catch(e) { return alert("Invalid JSON format (Copy သေချာမကူးခဲ့ပါ)"); }

           if(!parsedToken.policy) return alert("JSON မှားနေသည် (Policy မပါပါ)");

           document.getElementById('btn3').disabled = true;
           document.getElementById('status').innerText = "Uploading to OSS...";

           const startRes = await fetch('/api/upload', {
               method: 'POST',
               body: JSON.stringify({
                   url: document.getElementById('urlInput').value,
                   token: parsedToken,
                   key: fileData.key,
                   filename: fileData.filename
               })
           });
           
           const res = await startRes.json();
           const jobId = res.jobId;
           
           const interval = setInterval(async () => {
                const poll = await fetch('/api/status/' + jobId);
                const pData = await poll.json();
                
                if(pData.status === 'uploading') {
                    const pct = Math.round((pData.uploaded / pData.total) * 100) || 0;
                    document.getElementById('progressBar').style.width = pct + '%';
                    document.getElementById('status').innerText = \`Uploading: \${pct}% (\${(pData.uploaded/1024/1024).toFixed(1)} MB)\`;
                } else if(pData.status === 'completed') {
                    clearInterval(interval);
                    document.getElementById('progressBar').style.width = '100%';
                    document.getElementById('status').innerText = "✅ Upload Success!";
                    document.getElementById('btn3').disabled = false;
                } else if(pData.status === 'failed') {
                    clearInterval(interval);
                    document.getElementById('status').innerText = "❌ Error: " + pData.error;
                    document.getElementById('btn3').disabled = false;
                }
            }, 2000);
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

const jobs = new Map();

// Step 1 API
app.post("/api/check-size", async (c) => {
    const { url, name } = await c.req.json();
    try {
        const head = await fetch(url, {method: 'HEAD'});
        const size = Number(head.headers.get('content-length'));
        if(!size) throw new Error("File Size မရပါ (Link စစ်ပါ)");
        
        let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
        if (!filename.includes('.')) filename += '.mp4';

        const date = new Date().toISOString().slice(0,10).replace(/-/g,'/'); 
        const key = `upload/${date}/${crypto.randomUUID()}_${filename}`;
        
        return c.json({ size, key, filename });
    } catch(e) { return c.json({ error: e.message }); }
});

// Step 3 API
app.post("/api/upload", async (c) => {
    const { url, token, key, filename } = await c.req.json();
    const jobId = crypto.randomUUID();
    
    // Background Upload
    jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });

    (async () => {
        try {
            // OSS Upload URL (Aliyun Hong Kong)
            const uploadUrl = token.action || token.host || "https://lark-cloud.oss-cn-hongkong.aliyuncs.com";
            
            const uploadForm = new FormData();
            
            // Token Fields
            for (const k in token) {
                if(k !== 'action' && k !== 'host') uploadForm.append(k, token[k]);
            }
            if(!uploadForm.has("key")) uploadForm.append("key", key);

            // Stream File
            const fileRes = await fetch(url);
            const blob = await fileRes.blob();
            
            // OSS needs 'file' as last parameter
            uploadForm.append("file", blob, filename);
            
            jobs.set(jobId, { status: 'uploading', uploaded: 0, total: blob.size }); 

            const upRes = await fetch(uploadUrl, { method: "POST", body: uploadForm });
            
            if(upRes.ok || upRes.status === 204 || upRes.status === 200) {
                jobs.set(jobId, { status: 'completed', uploaded: blob.size, total: blob.size });
            } else {
                const txt = await upRes.text();
                throw new Error(`OSS Error: ${upRes.status} ${txt.substring(0,100)}`);
            }

        } catch(e) {
            jobs.set(jobId, { status: 'failed', error: e.message });
        }
    })();

    return c.json({ jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

Deno.serve(app.fetch);
