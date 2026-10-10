const testUrls = [
  'https://www.instagram.com/reel/DHk3K64yYx9/',
  'https://www.instagram.com/p/C8q_8NmvQ7_/',
  'https://www.instagram.com/reel/C8q_8NmvQ7_/'
];

const igEndpoints = [
  {
    name: 'VKR Downloader',
    getUrl: (u) => `https://api.vkrdownloader.com/server?v=${encodeURIComponent(u)}`,
    method: 'GET'
  },
  {
    name: 'AIO Downloader Rapid',
    getUrl: (u) => `https://social-downloader.onrender.com/api/instagram?url=${encodeURIComponent(u)}`,
    method: 'GET'
  },
  {
    name: 'Snapinsta proxy',
    getUrl: () => `https://snapinsta.app/action.php`,
    method: 'POST',
    body: (u) => new URLSearchParams({ url: u, action: 'post' }).toString()
  },
  {
    name: 'SssInstagram API',
    getUrl: () => `https://sssinstagram.com/request`,
    method: 'POST',
    body: (u) => new URLSearchParams({ link: u }).toString()
  },
  {
    name: 'TikMate IG / InstaSaver',
    getUrl: (u) => `https://api.tikmate.app/api/lookup?url=${encodeURIComponent(u)}`,
    method: 'GET'
  },
  {
    name: 'SaveVideo.me',
    getUrl: () => 'https://savevideo.me/get',
    method: 'POST',
    body: (u) => new URLSearchParams({ url: u }).toString()
  }
];

async function run() {
  const target = testUrls[0];
  console.log('Testing IG APIs with:', target);

  for (const ep of igEndpoints) {
    const t0 = Date.now();
    try {
      const opts = {
        method: ep.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(ep.body ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {})
        },
        signal: AbortSignal.timeout(6000)
      };
      if (ep.body) opts.body = ep.body(target);

      const res = await fetch(ep.getUrl(target), opts);
      const txt = await res.text();
      console.log(`[${ep.name}] HTTP ${res.status} in ${Date.now() - t0}ms, len: ${txt.length}`);
      try {
        const json = JSON.parse(txt);
        console.log(`  JSON response:`, JSON.stringify(json).substring(0, 200));
      } catch {
        console.log(`  Text response snippet:`, txt.substring(0, 150));
      }
    } catch (e) {
      console.log(`[${ep.name}] Error in ${Date.now() - t0}ms:`, e.message);
    }
  }
}

run();
