import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

const CONFIG = {
  domain: "https://qyun.org",
  
  // 🔥 Cookie ထည့်ပါ
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=ZDJhMTI0ZWYtMmU5NC00ZWNjLTg4YTctZWlyNDUzMzYwMGZj", 
  
  // WebDAV အတွက် Email & Password (Login ဝင်ဖို့လိုသည်)
  email: "sswe0014@gmail.com", 
  password: "Soekyawwin@93",

  // Target Policy ID (Channel 2 = "1" or "2")
  // ပုံထဲမှာ bucketId: 1 မို့လို့ "1" ကို အရင်စမ်းပါမယ်
  targetPolicyId: "1", 
};

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Switch & Upload</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun Switch & Upload</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename</label>
        <input type="text" id="nameInput" placeholder="video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <div class="p-3 mb-4 bg-blue-900 text-blue-200 text-xs rounded">
           Step 1: Change Default to Channel 2<br>
           Step 2: Upload via WebDAV (Unlimited)
        </div>

        <button onclick="startUpload()" id="btn" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition">Start Process</button>
        
        <div id="status" class="mt-4 p-3 bg-gray-900 rounded text-xs font-mono text-gray-300 break-words hidden border border-gray-700"></div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const statusDiv = document.getElementById('status');
          const btn = document.getElementById('btn');

          if(!url) return alert("Link လိုပါတယ်");

          btn.disabled = true;
          statusDiv.classList.remove('hidden');
          statusDiv.innerText = "Attempting to switch Channel...";
          
          try {
            const startRes = await fetch('/api/process', {
                method: 'POST', 
                body: JSON.stringify({url, name})
            });
            const res = await startRes.json();
            
            // Show Log
            statusDiv.innerHTML = res.logs.join('<br>');
            
            if(res.status === 'success') {
                statusDiv.className = "mt-4 p-3 bg-green-900 text-green-200 rounded text-xs font-mono break-words border border-green-700";
            } else {
                statusDiv.className = "mt-4 p-3 bg-red-900 text-red-200 rounded text-xs font-mono break-words border border-red-700";
            }

          } catch(e) {
            statusDiv.innerText = "Error: " + e.message;
            statusDiv.className = "mt-4 p-3 bg-red-900 text-red-200 rounded text-xs font-mono break-words border border-red-700";
          }
          btn.disabled = false;
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.post("/api/process", async (c) => {
  const { url, name } = await c.req.json();
  let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
  if (!filename.includes('.')) filename += '.mp4';
  
  const logs = [];
  
  try {
    // STEP 1: Change Default Policy via API (Using Cookie)
    logs.push("🔹 Switching Default Channel to ID: " + CONFIG.targetPolicyId + "...");
    
    const switchRes = await fetch(`${CONFIG.domain}/api/v1/user/setting/policy`, {
        method: 'PUT', // or PATCH
        headers: {
            "Cookie": CONFIG.cookie,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
            "Referer": "https://qyun.org/home",
            "Origin": "https://qyun.org",
            "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
            policy_id: CONFIG.targetPolicyId
        })
    });
    
    // Check if switch worked (even if it fails, we try upload)
    try {
        const switchData = await switchRes.json();
        logs.push("🔸 Switch Response: " + JSON.stringify(switchData));
    } catch(e) {
        logs.push("⚠️ Switch API might have failed (HTML returned), but trying upload anyway...");
    }

    // STEP 2: WebDAV Upload (Now it should go to Channel 2)
    logs.push("🔹 Starting WebDAV Upload...");
    
    const sourceRes = await fetch(url);
    if (!sourceRes.ok) throw new Error("Source Link Error");

    const encodedFilename = encodeURIComponent(filename);
    const webdavUrl = `${CONFIG.domain}/dav/uploads/${encodedFilename}`;
    const auth = btoa(`${CONFIG.email}:${CONFIG.password}`);

    const uploadRes = await fetch(webdavUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/octet-stream",
      },
      body: sourceRes.body, 
    });

    if (uploadRes.ok || uploadRes.status === 201) {
      logs.push("✅ Upload Success! (201 Created)");
      return c.json({ status: "success", logs });
    } else {
      const txt = await uploadRes.text();
      logs.push("❌ Upload Failed: " + uploadRes.status + " - " + txt);
      return c.json({ status: "failed", logs });
    }

  } catch (e) {
    logs.push("🔥 Critical Error: " + e.message);
    return c.json({ status: "failed", logs });
  }
});

Deno.serve(app.fetch);
