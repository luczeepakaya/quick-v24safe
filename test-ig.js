const shortcode = 'DHk3K64yYx9';
const reelUrl = `https://www.instagram.com/reel/${shortcode}/`;

async function testAllEngines() {
  console.log('Testing Instagram extraction for:', reelUrl);

  // Engine 1: Instagram Embed scraping
  try {
    const t0 = Date.now();
    const res = await fetch(`https://www.instagram.com/reel/${shortcode}/embed/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
      }
    });
    const html = await res.text();
    console.log(`[Embed] took ${Date.now() - t0}ms, html length: ${html.length}`);
    
    // Search for video url or JSON in HTML
    const videoMatches = html.match(/video_url/g);
    console.log(`[Embed] 'video_url' occurrences:`, videoMatches ? videoMatches.length : 0);
  } catch(e) {
    console.log('[Embed] error:', e.message);
  }

  // Engine 2: Upstream proxy with fresh token
  try {
    const t0 = Date.now();
    const tokenRes = await fetch('https://www.quicksave.click/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.quicksave.click',
        'Referer': 'https://www.quicksave.click/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const tokenData = await tokenRes.json();
    console.log(`[Upstream Token] took ${Date.now() - t0}ms, token:`, tokenData.token ? 'YES' : 'NO');
    
    if (tokenData.token) {
      const t1 = Date.now();
      const apiRes = await fetch('https://www.quicksave.click/api/instagram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.quicksave.click',
          'Referer': 'https://www.quicksave.click/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-qs-token': tokenData.token
        },
        body: JSON.stringify({ url: reelUrl })
      });
      const apiJson = await apiRes.json();
      console.log(`[Upstream API] took ${Date.now() - t1}ms, success:`, apiJson.success, 'title:', apiJson.data?.title || apiJson.error);
    }
  } catch(e) {
    console.log('[Upstream] error:', e.message);
  }

  // Engine 3: Alternative Public Insta Downloader APIs
  const apis = [
    {
      name: 'InstaVideoSave',
      fn: async () => {
        const res = await fetch('https://api.vkrdownloader.com/server?v=' + encodeURIComponent(reelUrl));
        return await res.json();
      }
    },
    {
      name: 'SaveClip API',
      fn: async () => {
        const res = await fetch('https://saveclip.app/api/ajaxSearch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: 'q=' + encodeURIComponent(reelUrl) + '&t=media&lang=en'
        });
        return await res.json();
      }
    },
    {
      name: 'Publer / InstaFetch',
      fn: async () => {
        const res = await fetch('https://publer.io/api/v1/job_status/instagram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: reelUrl })
        });
        return await res.json();
      }
    }
  ];

  for (const api of apis) {
    const t0 = Date.now();
    try {
      const data = await api.fn();
      console.log(`[${api.name}] took ${Date.now() - t0}ms, result:`, typeof data === 'object' ? Object.keys(data) : 'string');
    } catch(e) {
      console.log(`[${api.name}] error:`, e.message);
    }
  }
}

testAllEngines();
