const http = require('http');

async function testUpstream() {
  try {
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
    console.log('Upstream Token:', tokenData.token ? 'SUCCESS' : tokenData);

    if (tokenData.token) {
      // Test TikTok
      const tiktokRes = await fetch('https://www.quicksave.click/api/tiktok', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.quicksave.click',
          'Referer': 'https://www.quicksave.click/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-qs-token': tokenData.token
        },
        body: JSON.stringify({ url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' })
      });
      const tiktokData = await tiktokRes.json();
      console.log('TikTok result platform:', tiktokData.data?.platform, 'title:', tiktokData.data?.title);
      console.log('Download URL exists:', Boolean(tiktokData.data?.qualities?.no_watermark));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

testUpstream();
