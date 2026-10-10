const { execSync } = require('child_process');

const testCases = {
  tiktok: 'https://www.tiktok.com/@0_01page/video/7594159584734874898',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  facebook: 'https://www.facebook.com/watch?v=10153231379946729',
  twitter: 'https://twitter.com/Twitter/status/1785018784831631557',
  pinterest: 'https://www.pinterest.com/pin/111886372000574241/'
};

for (const [name, url] of Object.entries(testCases)) {
  const t0 = Date.now();
  try {
    const cmd = `python -m yt_dlp --skip-download --dump-json --no-warnings --no-playlist "${url}"`;
    const out = execSync(cmd, { timeout: 12000, encoding: 'utf8' });
    const json = JSON.parse(out);
    console.log(`[yt-dlp ${name.toUpperCase()}] ${Date.now() - t0}ms SUCCESS!`);
    console.log(`  Title: ${json.title || json.description?.substring(0, 40)}`);
    console.log(`  Duration: ${json.duration_string || json.duration}`);
    console.log(`  Thumbnail: ${!!json.thumbnail}`);
    console.log(`  Direct Video URL: ${!!(json.url || json.formats?.[0]?.url)}`);
  } catch (err) {
    console.log(`[yt-dlp ${name.toUpperCase()}] FAILED in ${Date.now() - t0}ms:`, err.message.split('\n')[0]);
  }
}
