const igDirect = require('instagram-url-direct');

async function testMethods() {
  const url = 'https://www.instagram.com/reel/DHk3K64yYx9/';
  console.log('Testing IG methods for:', url);

  // 1. instagram-url-direct
  try {
    const t0 = Date.now();
    const result = await igDirect(url);
    console.log(`[instagram-url-direct] took ${Date.now() - t0}ms:`, result);
  } catch (e) {
    console.log('[instagram-url-direct] error:', e.message);
  }

  // 2. Cobalt instances (Cobalt.tools API)
  const cobaltInstances = [
    'https://cobalt-api.kwiatekm.pl',
    'https://api.cobalt.tools',
    'https://cobalt.canine.tools',
    'https://co.wuk.sh'
  ];

  for (const inst of cobaltInstances) {
    try {
      const t0 = Date.now();
      const res = await fetch(`${inst}/api/json`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      console.log(`[Cobalt ${inst}] took ${Date.now() - t0}ms:`, data);
    } catch (e) {
      console.log(`[Cobalt ${inst}] error:`, e.message);
    }
  }

  // 3. IG GraphQL API with mobile app ID
  try {
    const t0 = Date.now();
    const shortcode = 'DHk3K64yYx9';
    const igRes = await fetch(`https://www.instagram.com/graphql/query/?query_hash=b3055c2e470550402123d994e1079296&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-IG-WWW-Claim': '0',
        'Origin': 'https://www.instagram.com',
        'Referer': `https://www.instagram.com/reel/${shortcode}/`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      }
    });
    const igData = await igRes.json();
    console.log(`[IG Mobile GraphQL] took ${Date.now() - t0}ms, status:`, igRes.status, 'hasData:', !!igData?.data?.shortcode_media);
    if (igData?.data?.shortcode_media) {
      console.log('IG Mobile GraphQL Media:', {
        is_video: igData.data.shortcode_media.is_video,
        video_url: igData.data.shortcode_media.video_url?.substring(0, 50),
        title: igData.data.shortcode_media.edge_media_to_caption?.edges?.[0]?.node?.text?.substring(0, 50)
      });
    }
  } catch (e) {
    console.log('[IG Mobile GraphQL] error:', e.message);
  }

  // 4. IG Direct Info Endpoint (X-IG-App-ID query)
  try {
    const t0 = Date.now();
    const shortcode = 'DHk3K64yYx9';
    const igRes2 = await fetch(`https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${shortcode}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-IG-App-ID': '936619743392459'
      }
    });
    const igData2 = await igRes2.json();
    console.log(`[IG oEmbed API] took ${Date.now() - t0}ms:`, igData2.title?.substring(0, 50), igData2.thumbnail_url?.substring(0, 50));
  } catch (e) {
    console.log('[IG oEmbed API] error:', e.message);
  }
}

testMethods();
