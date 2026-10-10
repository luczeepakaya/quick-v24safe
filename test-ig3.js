const testUrl = 'https://www.instagram.com/reel/DHk3K64yYx9/';

async function testSaveIG() {
  const t0 = Date.now();
  try {
    const params = new URLSearchParams();
    params.append('q', testUrl);
    params.append('t', 'media');
    params.append('lang', 'en');
    const res = await fetch('https://saveig.app/api/ajaxSearch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString()
    });
    console.log(`[SaveIG] status: ${res.status}, took ${Date.now() - t0}ms`);
    const json = await res.json();
    console.log('[SaveIG] data type:', typeof json.data, 'len:', json.data ? json.data.length : 0);
    if (json.data) {
      console.log('[SaveIG] sample snippet:', json.data.substring(0, 300));
    }
  } catch(e) {
    console.log('[SaveIG] err:', e.message);
  }
}

async function testSnapSave() {
  const t0 = Date.now();
  try {
    const params = new URLSearchParams();
    params.append('url', testUrl);
    const res = await fetch('https://snapsave.app/action.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: params.toString()
    });
    console.log(`[SnapSave] status: ${res.status}, took ${Date.now() - t0}ms`);
    const txt = await res.text();
    console.log('[SnapSave] text len:', txt.length, 'sample:', txt.substring(0, 200));
  } catch(e) {
    console.log('[SnapSave] err:', e.message);
  }
}

async function testPubler() {
  const t0 = Date.now();
  try {
    const res = await fetch('https://publer.io/api/v1/job_status/instagram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ url: testUrl })
    });
    console.log(`[Publer] status: ${res.status}, took ${Date.now() - t0}ms`);
  } catch(e) {
    console.log('[Publer] err:', e.message);
  }
}

async function testIndownloader() {
  const t0 = Date.now();
  try {
    const params = new URLSearchParams();
    params.append('link', testUrl);
    const res = await fetch('https://indownloader.app/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: params.toString()
    });
    const json = await res.json();
    console.log(`[Indownloader] took ${Date.now() - t0}ms, keys:`, Object.keys(json));
    if (json.html) {
      console.log('[Indownloader] HTML preview:', json.html.substring(0, 300));
    }
  } catch(e) {
    console.log('[Indownloader] err:', e.message);
  }
}

async function main() {
  await Promise.allSettled([testSaveIG(), testSnapSave(), testPubler(), testIndownloader()]);
}

main();
