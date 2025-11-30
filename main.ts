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
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun Manual Uploader</h1>
      
      <!-- Step 1 -->
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg mb-4">
        <h2 class="text-lg font-bold text-yellow-400 mb-2">အဆင့် (၁) - ဖိုင်အချက်အလက်ယူရန်</h2>
        <input type="text" id="urlInput" placeholder="Source Video URL..." class="w-full p-2 mb-2 rounded bg-gray-700 border border-gray-600">
        <input type="text" id="nameInput" placeholder="Filename.mp4" class="w-full p-2 mb-2 rounded bg-gray-700 border border-gray-600">
        <button onclick="step1()" id="btn1" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold">Get JS Code</button>
      </div>

      <!-- Step 2 -->
      <div id="step2" class="bg-gray-800 p-4 rounded-lg shadow-lg mb-4 hidden">
        <h2 class="text-lg font-bold text-yellow-400 mb-2">အဆင့် (၂) - လက်မှတ်တောင်းရန်</h2>
        <p class="text-xs text-gray-300 mb-2">၁။ အောက်က Code ကို Copy ကူးပါ။<br>၂။ Qyun.org (Kiwi Browser) > Console မှာ Paste လုပ်ပြီး Enter ခေါက်ပါ။<br>၃။ ထွက်လာတဲ့ စာအရှည်ကြီးကို ကူးခဲ့ပါ။</p>
        <textarea id="jsCode" readonly class="w-full h-24 p-2 text-xs bg-black text-green-400 rounded font-mono mb-2" onclick="this.select()"></textarea>
        <button onclick="copyCode()" class="bg-gray-600 px-3 py-1 rounded text-xs">Copy Code</button>
      </div>

      <!-- Step 3 -->
      <div id="step3" class="bg-gray-800 p-4 rounded-lg shadow-lg mb-4 hidden">
        <h2 class="text-lg font-bold text-yellow-400 mb-2">အဆင့် (၃) - Upload တင်ရန်</h2>
        <textarea id="tokenInput" placeholder="Console မှရလာသော JSON ကို ဒီမှာထည့်ပါ..." class="w-full h-24 p-2 text-xs bg-gray-700 border border-gray-600 rounded mb-2"></textarea>
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

          const res = await fetch('/api/check-size', {
             method: 'POST', body: JSON.stringify({url, name})
          });
          const data = await res.json();
          
          if(data.error) {
             alert(data.error);
             document.getElementById('btn1').disabled = false;
             return;
          }

          fileData = data; // Save for later
          
          // Generate JS Code for user
          const js = \`
var formData = new FormData();
formData.append("name", "\${data.filename}");
formData.append("size", "\${data.size}");
formData.append("type", "video/mp4");
formData.append("key", "\${data.key}");
formData.append("bucketId", "1"); // Channel 2
formData.append("folderId", "");

fetch("https://qyun.org/files.html?folderId=", {
  method: "POST",
  body: formData
}).then(r => r.text()).then(t => console.log(t));
\`;
          document.getElementById('jsCode').value = js;
          document.getElementById('step2').classList.remove('hidden');
          document.getElementById('step3').classList.remove('hidden');
          document.getElementById('btn1').innerText = "Done";
        }

        function copyCode() {
           const copyText = document.getElementById("jsCode");
           copyText.select();
           document.execCommand("copy");
           alert("Code Copied! Go to Kiwi Browser > Console");
        }

        async function step3() {
           const tokenJson = document.getElementById('tokenInput').value;
           if(!tokenJson) return alert("JSON ထည့်ပါ");
           
           try {
               JSON.parse(tokenJson); // Validation
           } catch(e) { return alert("Invalid JSON format"); }

           document.getElementById('btn3').disabled = true;
           document.getElementById('status').innerText = "Uploading...";

           const startRes = await fetch('/api/upload', {
               method: 'POST',
               body: JSON.stringify({
                   url: document.getElementById('urlInput').value,
                   token: tokenJson,
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
                    document.getElementById('status').innerText = \`Uploading: \${pct}%\`;
                } else if(pData.status === 'completed') {
                    clearInterval(interval);
                    document.getElementById('progressBar').style.width = '100%';
                    document.getElementById('status').innerText = "✅ Upload Success!";
                } else if(pData.status === 'failed') {
                    clearInterval(interval);
                    document.getElementById('status').innerText = "❌ Error: " + pData.error;
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

app.post("/api/check-size", async (c) => {
    const { url, name } = await c.req.json();
    try {
        const head = await fetch(url, {method: 'HEAD'});
        const size = Number(head.headers.get('content-length'));
        if(!size) throw new Error("Size unknown");
        
        let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
        const date = new Date().toISOString().slice(0,10).replace(/-/g,'/'); 
        const key = `upload/${date}/${crypto.randomUUID()}_${filename}`;
        
        return c.json({ size, key, filename });
    } catch(e) { return c.json({ error: e.message }); }
});

app.post("/api/upload", async (c) => {
    const { url, token, key, filename } = await c.req.json();
    const jobId = crypto.randomUUID();
    const initData = JSON.parse(token); // User provided JSON

    jobs.set(jobId, { status: 'starting', uploaded: 0, total: 0 });

    // Background Upload
    (async () => {
        try {
            const uploadUrl = initData.action || initData.host || "https://upload.qyun.org";
            const uploadForm = new FormData();
            
            for (const k in initData) {
                if(k !== 'action' && k !== 'host') uploadForm.append(k, initData[k]);
            }
            if(!uploadForm.has("key")) uploadForm.append("key", key);

            const fileRes = await fetch(url);
            const blob = await fileRes.blob();
            uploadForm.append("file", blob, filename);
            
            jobs.set(jobId, { status: 'uploading', uploaded: 0, total: blob.size }); // Fake progress init

            const upRes = await fetch(uploadUrl, { method: "POST", body: uploadForm });
            
            if(upRes.ok) jobs.set(jobId, { status: 'completed', uploaded: blob.size, total: blob.size });
            else throw new Error(await upRes.text());

        } catch(e) {
            jobs.set(jobId, { status: 'failed', error: e.message });
        }
    })();

    return c.json({ jobId });
});

app.get("/api/status/:id", (c) => c.json(jobs.get(c.req.param('id')) || {}));

Deno.serve(app.fetch);
