import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";

const app = new Hono();

const CONFIG = {
  domain: "https://qyun.org",
  // 🔥 Cookie ထည့်ပါ
  cookie: "remember-me=c3N3ZTAwMTQINDBnbWFpbC5jb206MTc2NTA2MTAwMTQ2OTpTSEEYNTY60DFmOGMYYTFIYTAWNWIyNjJhOWNKZTdhZGVmOWFkNDE2ZjVIODEXYmVIZGIwNDYOYzYONDFIOTZjYTNkMjE5Ng; SESSION=ZDJhMTI0ZWYtMmU5NC00ZWNjLTg4YTctZWlyNDUzMzYwMGZj", 
};

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="my">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Qyun Offline Download</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-6 bg-gray-900 text-white max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-4 text-blue-400">Qyun Offline Download Task</h1>
      
      <div class="bg-gray-800 p-4 rounded-lg shadow-lg">
        <label class="block mb-2 text-sm text-gray-400">Source Video URL</label>
        <input type="text" id="urlInput" placeholder="https://..." class="w-full p-2 mb-4 rounded bg-gray-700 text-white border border-gray-600">
        
        <button onclick="startTask()" id="btn" class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition">Send Task to Qyun</button>
        
        <div id="status" class="mt-4 p-3 bg-gray-900 rounded text-xs font-mono text-gray-300 break-words hidden border border-gray-700"></div>
      </div>

      <script>
        async function startTask() {
          const url = document.getElementById('urlInput').value;
          if(!url) return alert("Link လိုပါတယ်");

          const btn = document.getElementById('btn');
          const statusDiv = document.getElementById('status');

          btn.disabled = true;
          statusDiv.classList.remove('hidden');
          statusDiv.innerText = "Sending Offline Download Task...";
          
          try {
            const res = await fetch('/api/offline', {
                method: 'POST', 
                body: JSON.stringify({url})
            });
            const data = await res.json();
            
            // Show result
            statusDiv.innerText = JSON.stringify(data, null, 2);
            
            if(data.code === 0) {
                statusDiv.className = "mt-4 p-3 bg-green-900 text-green-200 rounded text-xs font-mono break-words border border-green-700";
            } else {
                statusDiv.className = "mt-4 p-3 bg-red-900 text-red-200 rounded text-xs font-mono break-words border border-red-700";
            }

          } catch(e) {
            statusDiv.innerText = "Error: " + e.message;
          }
          btn.disabled = false;
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.post("/api/offline", async (c) => {
  const { url } = await c.req.json();

  try {
    // Offline Download API (aria2)
    const taskRes = await fetch(`${CONFIG.domain}/api/v1/aria2/url`, {
        method: 'POST',
        headers: { 
            "Cookie": CONFIG.cookie, 
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
            "Referer": "https://qyun.org/files",
            "Origin": "https://qyun.org",
            "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
            url: url,
            dst: "/" // Root folder
        })
    });

    const text = await taskRes.text();
    try {
        return c.json(JSON.parse(text));
    } catch {
        return c.json({ error: "Server returned HTML (Login Blocked)", raw: text.substring(0, 200) });
    }

  } catch (e) {
    return c.json({ error: e.message });
  }
});

Deno.serve(app.fetch);
