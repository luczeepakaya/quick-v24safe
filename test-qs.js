async function testQuicksaveDetailed() {
  const urls = [
    'https://www.instagram.com/reel/DHk3K64yYx9/',
    'https://www.instagram.com/p/C_q8oGPyw5R/',
    'https://www.instagram.com/reel/C8P4N0vR7d4/'
  ];

  const tokenRes = await fetch('https://www.quicksave.click/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.quicksave.click',
      'Referer': 'https://www.quicksave.click/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  const { token } = await tokenRes.json();
  console.log('Got token:', token ? 'YES' : 'NO');

  for (const u of urls) {
    try {
      const res = await fetch('https://www.quicksave.click/api/instagram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.quicksave.click',
          'Referer': 'https://www.quicksave.click/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-qs-token': token
        },
        body: JSON.stringify({ url: u })
      });
      const json = await res.json();
      console.log(`URL [${u}] result:`, JSON.stringify(json, null, 2));
    } catch(e) {
      console.log(`URL [${u}] err:`, e.message);
    }
  }
}

testQuicksaveDetailed();
