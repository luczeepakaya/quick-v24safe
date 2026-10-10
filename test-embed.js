const shortcode = 'DHk3K64yYx9';

async function analyzeEmbedHtml() {
  const res = await fetch(`https://www.instagram.com/reel/${shortcode}/embed/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await res.text();
  console.log('HTML Total Length:', html.length);

  // Search for any .mp4 strings
  const mp4Indices = [];
  let idx = 0;
  while ((idx = html.indexOf('.mp4', idx)) !== -1) {
    mp4Indices.push(idx);
    idx += 4;
  }
  console.log('MP4 occurrences:', mp4Indices.length);
  mp4Indices.forEach((pos, i) => {
    const start = Math.max(0, pos - 150);
    const end = Math.min(html.length, pos + 150);
    console.log(`[MP4 match ${i}]:`, html.substring(start, end).replace(/\n/g, ' '));
  });

  // Search for any video tag or JSON containing "video"
  const videoMatches = [...html.matchAll(/"(https:[^"]+cdninstagram[^"]+)"/g)].map(m => m[1]);
  console.log('CDN Instagram URLs found:', videoMatches.length);
  videoMatches.forEach((u, i) => {
    console.log(`[URL ${i}]:`, u.substring(0, 100));
  });
}

analyzeEmbedHtml();
