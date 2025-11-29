import { Hono } from "hono";
const app = new Hono();

// --- ဒီနေရာမှာ အစ်ကို့အကောင့် အချက်အလက်တွေ ဖြည့်ပါ ---
const CONFIG = {
  domain: "https://qyun.org", 
  email: "sswe0014@gmail.com",       // ဥပမာ: soethu@gmail.com
  password: "Soekyawwin@93", // ဥပမာ: password123
};

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Uploader</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun.org Uploader</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://example.com/video.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <label class="block mb-2 text-sm text-gray-400">Filename (Optional)</label>
        <input type="text" id="nameInput" placeholder="my_movie.mp4" class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <button onclick="startUpload()" id="btn" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition">Upload to Qyun</button>
        
        <div id="status" class="mt-4 text-center text-sm text-yellow-400"></div>
      </div>

      <script>
        async function startUpload() {
          const url = document.getElementById('urlInput').value;
          const name = document.getElementById('nameInput').value;
          const status = document.getElementById('status');
          const btn = document.getElementById('btn');

          if(!url) return alert("Link ထည့်ပါ");

          btn.disabled = true;
          btn.innerText = "Uploading... (Please Wait)";
          status.innerText = "Deno is downloading & uploading to Qyun...";

          try {
            const res = await fetch('/upload', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ url, name })
            });
            const data = await res.json();

            if(data.status === 'Success') {
              status.innerText = "✅ Upload Success! Check your Qyun account.";
              status.className = "mt-4 text-center text-sm text-green-400";
            } else {
              status.innerText = "❌ Error: " + data.msg;
              status.className = "mt-4 text-center text-sm text-red-400";
            }
          } catch(e) {
            status.innerText = "Error: " + e.message;
          }
          btn.disabled = false;
          btn.innerText = "Upload to Qyun";
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.post("/upload", async (c) => {
  const { url, name } = await c.req.json();
  if (!url) return c.json({ status: "Failed", msg: "No URL" });

  try {
    // ၁။ Filename သတ်မှတ်ခြင်း
    let filename = name && name.trim() ? name.trim() : url.split('/').pop().split('?')[0];
    if (!filename.endsWith('.mp4') && !filename.endsWith('.mkv')) filename += '.mp4';

    // ၂။ Source Video ကို Deno က လှမ်းဆွဲခြင်း
    const sourceRes = await fetch(url);
    if (!sourceRes.ok) return c.json({ status: "Failed", msg: "Source Link error" });

    // ၃။ WebDAV သုံးပြီး Qyun ကို တင်ခြင်း
    // Qyun (Cloudreve) ရဲ့ WebDAV လမ်းကြောင်းက များသောအားဖြင့် /dav/uploads/ ဖြစ်ပါတယ်
    const webdavUrl = `${CONFIG.domain}/dav/uploads/${filename}`;
    
    // Email နဲ့ Password ကို ကုဒ်ဝှက်ခြင်း (Basic Auth)
    const auth = btoa(`${CONFIG.email}:${CONFIG.password}`);

    const uploadRes = await fetch(webdavUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/octet-stream", // Binary stream အနေနဲ့ ပို့မယ်
      },
      body: sourceRes.body, // Source ကလာတဲ့ Stream ကို Qyun ဆီ တိုက်ရိုက်လွှဲပေးမယ် (Memory မစားအောင်)
    });

    if (uploadRes.ok || uploadRes.status === 201) {
      return c.json({ status: "Success", path: filename });
    } else {
      return c.json({ status: "Failed", msg: `Qyun Error: ${uploadRes.status} ${uploadRes.statusText}` });
    }

  } catch (e) {
    return c.json({ status: "Failed", msg: e.message });
  }
});

Deno.serve(app.fetch);
