const axios = require('axios');
const qs = require('qs');

async function testIGDirectHeaders() {
  const shortcode = 'DHk3K64yYx9';
  console.log('Testing Instagram GraphQL with App-ID & cookies...');
  
  try {
    const t0 = Date.now();
    // Step 1: get cookies / csrftoken
    const homeRes = await axios.get('https://www.instagram.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    const setCookies = homeRes.headers['set-cookie'] || [];
    const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
    const csrfMatch = cookieHeader.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    console.log(`Got cookies in ${Date.now() - t0}ms, csrf:`, csrfToken ? 'YES' : 'NO');

    // Step 2: request doc_id graphql
    const t1 = Date.now();
    const docIds = ["9510064595728286", "8845758582119845", "10017861645000455"];
    
    for (const doc_id of docIds) {
      try {
        const body = qs.stringify({
          variables: JSON.stringify({
            shortcode: shortcode,
            fetch_tagged_user_count: null,
            hoisted_comment_id: null,
            hoisted_reply_id: null
          }),
          doc_id: doc_id
        });

        const gqlRes = await axios.post('https://www.instagram.com/graphql/query', body, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'X-CSRFToken': csrfToken,
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '129477',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieHeader,
            'Origin': 'https://www.instagram.com',
            'Referer': `https://www.instagram.com/reel/${shortcode}/`
          },
          timeout: 8000
        });

        console.log(`doc_id ${doc_id} response in ${Date.now() - t1}ms:`, gqlRes.status, gqlRes.data?.data?.xdt_shortcode_media ? 'SUCCESS!' : gqlRes.data);
        if (gqlRes.data?.data?.xdt_shortcode_media) {
          const media = gqlRes.data.data.xdt_shortcode_media;
          console.log('Video URL:', media.video_url?.substring(0, 60));
          console.log('Title/Caption:', media.edge_media_to_caption?.edges?.[0]?.node?.text?.substring(0, 40));
          break;
        }
      } catch (err) {
        console.log(`doc_id ${doc_id} error in ${Date.now() - t1}ms:`, err.response?.status, err.response?.data || err.message);
      }
    }
  } catch (e) {
    console.log('Setup error:', e.message);
  }
}

testIGDirectHeaders();
