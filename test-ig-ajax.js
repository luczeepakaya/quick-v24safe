const testUrl = 'https://www.instagram.com/reel/DHk3K64yYx9/';

const endpoints = [
  {
    name: 'saveig.me',
    url: 'https://saveig.me/api/ajaxSearch',
    body: 'q=' + encodeURIComponent(testUrl) + '&t=media&lang=en'
  },
  {
    name: 'snapinsta.to',
    url: 'https://snapinsta.to/api/ajaxSearch',
    body: 'q=' + encodeURIComponent(testUrl) + '&t=media&lang=en'
  },
  {
    name: 'fastdl.to',
    url: 'https://fastdl.to/api/ajaxSearch',
    body: 'q=' + encodeURIComponent(testUrl) + '&t=media&lang=en'
  },
  {
    name: 'igsaver.net',
    url: 'https://igsaver.net/api/ajaxSearch',
    body: 'q=' + encodeURIComponent(testUrl) + '&t=media&lang=en'
  },
  {
    name: 'instavideosave.net',
    url: 'https://instavideosave.net/api/video',
    body: 'url=' + encodeURIComponent(testUrl)
  },
  {
    name: 'indown.io',
    url: 'https://indown.io/download',
    body: 'link=' + encodeURIComponent(testUrl) + '&referer=https://indown.io/'
  }
];

async function testAll() {
  for (const ep of endpoints) {
    const t0 = Date.now();
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: ep.body,
        signal: AbortSignal.timeout(5000)
      });
      const txt = await res.text();
      console.log(`[${ep.name}] status: ${res.status} in ${Date.now() - t0}ms, len: ${txt.length}`);
      if (txt.length < 500) console.log('  snippet:', txt);
      else console.log('  snippet (500):', txt.substring(0, 300));
    } catch (e) {
      console.log(`[${ep.name}] error in ${Date.now() - t0}ms:`, e.message);
    }
  }
}

testAll();
