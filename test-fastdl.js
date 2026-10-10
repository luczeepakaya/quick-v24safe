const testUrls = [
  'https://www.instagram.com/reel/C8q_8NmvQ7_/',
  'https://www.instagram.com/reel/C8I1v_fP_8Y/',
  'https://www.instagram.com/p/C-0zLgcvS9L/',
  'https://www.instagram.com/reel/DHk3K64yYx9/'
];

async function testFastDL() {
  for (const url of testUrls) {
    const t0 = Date.now();
    try {
      const res = await fetch('https://fastdl.to/api/ajaxSearch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://fastdl.to',
          'Referer': 'https://fastdl.to/en'
        },
        body: 'q=' + encodeURIComponent(url) + '&t=media&lang=en',
        signal: AbortSignal.timeout(6000)
      });
      const data = await res.json();
      console.log(`[FastDL ${url}] took ${Date.now() - t0}ms:`, {
        status: data.status,
        mess: data.mess,
        hasData: !!data.data,
        dataLength: data.data ? data.data.length : 0
      });
      if (data.data) {
        console.log('Sample data HTML:', data.data.substring(0, 300));
      }
    } catch (e) {
      console.log(`[FastDL ${url}] error in ${Date.now() - t0}ms:`, e.message);
    }
  }
}

testFastDL();
