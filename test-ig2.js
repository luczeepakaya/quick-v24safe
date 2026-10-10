function shortcodeToMediaId(shortcode) {
  let id = BigInt(0);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < shortcode.length; i++) {
    const char = shortcode[i];
    const val = BigInt(alphabet.indexOf(char));
    id = id * BigInt(64) + val;
  }
  return id.toString();
}

const shortcode = 'DHk3K64yYx9';
const mediaId = shortcodeToMediaId(shortcode);
console.log('Shortcode:', shortcode, 'MediaId:', mediaId);

async function testMobileInfo() {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
      headers: {
        'User-Agent': 'Instagram 278.0.0.19.115 Android (33/13; 420dpi; 1080x2400; samsung; SM-G998B; o1s; exynos2100; en_US; 458425164)',
        'X-IG-App-ID': '936619743392459',
        'Accept-Language': 'en-US',
        'Accept-Encoding': 'gzip, deflate'
      }
    });
    console.log(`[Mobile Info] status: ${res.status}, took ${Date.now() - t0}ms`);
    if (res.ok) {
      const json = await res.json();
      console.log('Items found:', json.items?.length);
      if (json.items?.[0]) {
        const item = json.items[0];
        console.log('Title/Caption:', item.caption?.text);
        console.log('Video versions:', item.video_versions?.length);
        console.log('Video URL:', item.video_versions?.[0]?.url?.substring(0, 100));
        console.log('Image URL:', item.image_versions2?.candidates?.[0]?.url?.substring(0, 100));
      }
    } else {
      const txt = await res.text();
      console.log('Error text:', txt.substring(0, 300));
    }
  } catch(e) {
    console.log('[Mobile Info] err:', e.message);
  }
}

async function testWebGraphQLDocId() {
  const t0 = Date.now();
  const docIds = [
    '8845758582119845',
    '7333069903487053',
    '7475143305886361',
    '17991233869408992'
  ];

  for (const docId of docIds) {
    try {
      const variables = JSON.stringify({ shortcode });
      const res = await fetch(`https://www.instagram.com/graphql/query/?doc_id=${docId}&variables=${encodeURIComponent(variables)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      console.log(`[DocId ${docId}] status: ${res.status}`);
      if (res.ok) {
        const json = await res.json();
        const m = json.data?.xdt_shortcode_media || json.data?.shortcode_media;
        if (m) {
          console.log(`[DocId ${docId}] SUCCESS! video_url:`, !!m.video_url, 'caption:', m.edge_media_to_caption?.edges?.[0]?.node?.text?.substring(0, 50));
        }
      }
    } catch(e) {}
  }
}

async function run() {
  await testMobileInfo();
  await testWebGraphQLDocId();
}

run();
