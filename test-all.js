const testUrls = {
  tiktok: 'https://www.tiktok.com/@0_01page/video/7594159584734874898',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  instagram: 'https://www.instagram.com/reel/DHk3K64yYx9/',
  facebook: 'https://www.facebook.com/watch?v=10153231379946729'
};

async function testAll() {
  console.log('--- Testing Current Platform Extractors ---');
  for (const [platform, url] of Object.entries(testUrls)) {
    const t0 = Date.now();
    try {
      const res = await fetch('http://localhost:3000/api/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      const dur = Date.now() - t0;
      console.log(`[${platform.toUpperCase()}] ${dur}ms - Success: ${!!data.success || !!data.title || !!data.qualities?.hd} - Title: ${data.title || data.error || 'N/A'}`);
      if (data.qualities) {
        console.log(`  -> HD link available: ${!!(data.qualities.hd || data.qualities.no_watermark)}`);
      }
    } catch(err) {
      console.log(`[${platform.toUpperCase()}] Failed: ${err.message}`);
    }
  }
}

testAll();
