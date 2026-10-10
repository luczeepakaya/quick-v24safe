const url = 'https://www.instagram.com/reel/DHk3K64yYx9/';

const gateways = [
  {
    name: 'igram.world',
    url: 'https://igram.world/api/ig/allByUrl',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ url })
    }
  },
  {
    name: 'fastdl.app',
    url: 'https://fastdl.app/c/',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: 'url=' + encodeURIComponent(url)
    }
  },
  {
    name: 'savefrom',
    url: 'https://worker.savefrom.net/savefrom.php',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: 'sf_url=' + encodeURIComponent(url) + '&sf_submit='
    }
  },
  {
    name: 'fdownloader.net',
    url: 'https://v3.fdownloader.net/api/ajaxSearch',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: 'k_exp=' + Date.now() + '&k_token=&q=' + encodeURIComponent(url) + '&lang=en&web=fdownloader.net&v=v2'
    }
  },
  {
    name: 'yt1s.com.co',
    url: 'https://api.yt1s.com.co/api/ajaxSearch/index',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: 'q=' + encodeURIComponent(url) + '&vt=instagram'
    }
  }
];

async function runTests() {
  for (const gw of gateways) {
    const t0 = Date.now();
    try {
      const res = await fetch(gw.url, { ...gw.options, signal: AbortSignal.timeout(5000) });
      const txt = await res.text();
      console.log(`[${gw.name}] status: ${res.status}, took ${Date.now() - t0}ms, len: ${txt.length}`);
      try {
        const json = JSON.parse(txt);
        console.log(`  JSON keys:`, Object.keys(json));
        if (json.data) console.log(`  Sample data:`, typeof json.data === 'string' ? json.data.substring(0, 150) : JSON.stringify(json.data).substring(0, 150));
      } catch {
        console.log(`  HTML/Text snippet:`, txt.substring(0, 150));
      }
    } catch (e) {
      console.log(`[${gw.name}] error in ${Date.now() - t0}ms:`, e.message);
    }
  }
}

runTests();
