const { exec } = require('child_process');

const url = 'https://www.instagram.com/reel/DHk3K64yYx9/';
console.log('Testing yt-dlp on:', url);
const t0 = Date.now();

exec(`python -m yt_dlp --skip-download --dump-json --no-warnings --no-playlist "${url}"`, { timeout: 20000 }, (err, stdout, stderr) => {
  if (err) {
    console.log(`yt-dlp failed in ${Date.now() - t0}ms:`, err.message);
    if (stderr) console.log('stderr:', stderr);
    return;
  }
  try {
    const json = JSON.parse(stdout);
    console.log(`yt-dlp succeeded in ${Date.now() - t0}ms!`);
    console.log('Title:', json.title || json.description);
    console.log('Thumbnail:', json.thumbnail);
    console.log('Formats count:', json.formats?.length);
    console.log('Direct URL:', json.url || json.formats?.[0]?.url);
  } catch (e) {
    console.log('Parse error:', e.message);
  }
});
