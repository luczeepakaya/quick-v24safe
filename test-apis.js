const igUrl = 'https://www.instagram.com/reel/DHk3K64yYx9/';

async function testAPIs() {
  const apis = [
    // Rapid APIs / Public worker APIs
    {
      name: 'SocMed Downloader Worker',
      fn: async () => {
        const res = await fetch('https://social-downloader.onrender.com/api/instagram?url=' + encodeURIComponent(igUrl), { signal: AbortSignal.timeout(5000) });
        return await res.json();
      }
    },
    {
      name: 'AIO Video Downloader API',
      fn: async () => {
        const res = await fetch('https://aio-downloader.vercel.app/api/video?url=' + encodeURIComponent(igUrl), { signal: AbortSignal.timeout(5000) });
        return await res.json();
      }
    },
    {
      name: 'Y2Mate IG / Insta API',
      fn: async () => {
        const res = await fetch('https://www.y2mate.com/mates/analyzeV2/ajax', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: 'k_query=' + encodeURIComponent(igUrl) + '&k_page=home&hl=en&q_auto=0',
          signal: AbortSignal.timeout(5000)
        });
        return await res.json();
      }
    },
    {
      name: 'FDownloader API',
      fn: async () => {
        const res = await fetch('https://fdown.co.in/ajax', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
          },
          body: JSON.stringify({ url: igUrl }),
          signal: AbortSignal.timeout(5000)
        });
        return await res.json();
      }
    }
  ];

  for (const api of apis) {
    const t0 = Date.now();
    try {
      const data = await api.fn();
      console.log(`[${api.name}] SUCCESS in ${Date.now() - t0}ms:`, JSON.stringify(data).substring(0, 200));
    } catch (e) {
      console.log(`[${api.name}] FAILED in ${Date.now() - t0}ms:`, e.message);
    }
  }
}

testAPIs();
