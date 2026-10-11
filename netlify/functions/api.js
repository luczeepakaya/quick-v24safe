const crypto = require('crypto');

// In-memory real-time presence tracking (sessionId -> timestamp)
const activePresences = new Map();

// Secret for local fallback
const JWT_SECRET = 'lukzi_secret_' + Math.random().toString(36);

function generateToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    scope: 'download',
    jti: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function getUpstreamToken() {
  try {
    const res = await fetch('https://www.quicksave.click/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.quicksave.click',
        'Referer': 'https://www.quicksave.click/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const data = await res.json();
    if (data.token) return data.token;
  } catch (err) {
    console.error('Upstream token error:', err);
  }
  return generateToken();
}

async function proxyUpstream(endpoint, body) {
  const token = await getUpstreamToken();
  const res = await fetch(`https://www.quicksave.click${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.quicksave.click',
      'Referer': 'https://www.quicksave.click/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'x-qs-token': token
    },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function downloadYouTubeDirect(videoUrl, type = 'mp4', quality = '720p') {
  if (!videoUrl) return null;
  const cdns = [
    'https://cdn405.savetube.vip',
    'https://cdn.savetube.vip'
  ];

  let targetUrl = videoUrl.trim();
  try {
    const u = new URL(targetUrl);
    if (u.hostname.includes('youtu.be')) {
      const vid = u.pathname.slice(1);
      targetUrl = `https://www.youtube.com/watch?v=${vid}`;
    } else if (u.pathname.includes('/shorts/')) {
      const vid = u.pathname.split('/shorts/')[1].split('/')[0];
      targetUrl = `https://www.youtube.com/watch?v=${vid}`;
    }
  } catch (e) {}

  const cleanQuality = (quality || '720').toString().replace(/p$/i, '');
  const downloadType = type === 'mp3' ? 'audio' : 'video';
  const reqQuality = downloadType === 'audio' ? '128' : cleanQuality;

  for (const cdn of cdns) {
    try {
      const infoRes = await fetch(`${cdn}/v2/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://ytshorts.savetube.me',
          'Referer': 'https://ytshorts.savetube.me/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({ url: targetUrl })
      });

      if (!infoRes.ok) continue;
      const json = await infoRes.json();
      if (!json.data) continue;

      const rawBuffer = Buffer.from(json.data, 'base64');
      const iv = rawBuffer.subarray(0, 16);
      const encryptedData = rawBuffer.subarray(16);
      const key = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');

      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      let decrypted = decipher.update(encryptedData, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      const parsed = JSON.parse(decrypted);

      const dlRes = await fetch(`${cdn}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://ytshorts.savetube.me',
          'Referer': 'https://ytshorts.savetube.me/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          id: parsed.id,
          key: parsed.key,
          downloadType,
          quality: reqQuality
        })
      });

      if (!dlRes.ok) continue;
      const dlJson = await dlRes.json();
      const downloadUrl = dlJson.data?.downloadUrl;
      if (downloadUrl) {
        return {
          success: true,
          data: {
            platform: 'youtube',
            type,
            title: parsed.title || 'YouTube Video',
            thumbnail: parsed.thumbnail || `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`,
            videoId: parsed.id,
            meta: {
              duration: parsed.durationLabel || `${Math.floor((parsed.duration || 0) / 60)} min`,
              views: '0',
              likes: '0'
            },
            qualities: {
              hd: downloadType === 'video' ? downloadUrl : null,
              sd: downloadType === 'video' ? downloadUrl : null,
              audio: downloadType === 'audio' ? downloadUrl : null
            }
          }
        };
      }
    } catch (e) {
      console.warn(`YouTube direct CDN ${cdn} error:`, e.message);
    }
  }
  return null;
}

async function getYouTubeInfoDirect(videoUrl) {
  if (!videoUrl) return null;
  const cdns = [
    'https://cdn405.savetube.vip',
    'https://cdn.savetube.vip'
  ];

  let targetUrl = videoUrl.trim();
  try {
    const u = new URL(targetUrl);
    if (u.hostname.includes('youtu.be')) {
      const vid = u.pathname.slice(1);
      targetUrl = `https://www.youtube.com/watch?v=${vid}`;
    } else if (u.pathname.includes('/shorts/')) {
      const vid = u.pathname.split('/shorts/')[1].split('/')[0];
      targetUrl = `https://www.youtube.com/watch?v=${vid}`;
    }
  } catch (e) {}

  for (const cdn of cdns) {
    try {
      const infoRes = await fetch(`${cdn}/v2/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://ytshorts.savetube.me',
          'Referer': 'https://ytshorts.savetube.me/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({ url: targetUrl })
      });

      if (!infoRes.ok) continue;
      const json = await infoRes.json();
      if (!json.data) continue;

      const rawBuffer = Buffer.from(json.data, 'base64');
      const iv = rawBuffer.subarray(0, 16);
      const encryptedData = rawBuffer.subarray(16);
      const key = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');

      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      let decrypted = decipher.update(encryptedData, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      const parsed = JSON.parse(decrypted);

      return {
        success: true,
        data: {
          platform: 'youtube',
          title: parsed.title || 'YouTube Video',
          thumbnail: parsed.thumbnail || `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`,
          videoId: parsed.id,
          meta: {
            duration: parsed.durationLabel || `${Math.floor((parsed.duration || 0) / 60)} min`,
            views: '0'
          },
          video_formats: parsed.video_formats || []
        }
      };
    } catch (e) {
      console.warn(`YouTube info direct error on ${cdn}:`, e.message);
    }
  }
  return null;
}

async function extractInstagramDirect(url) {
  try {
    const match = url.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
    if (!match) return null;
    const shortcode = match[1];
    const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/`;

    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    const vMatch = html.match(/\\"video_url\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/);
    if (vMatch) {
      const videoUrl = vMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');

      // Caption / Title
      let title = 'Instagram Reel';
      const capMatch = html.match(/\\"edge_media_to_caption\\":\{\\"edges\\":\[\{\\"node\\":\{\\"text\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/);
      if (capMatch) {
        try {
          title = JSON.parse(`"${capMatch[1]}"`);
        } catch (e) {
          title = capMatch[1];
        }
      }

      // Username / Owner
      let author = 'Instagram User';
      const userMatch = html.match(/\\"owner\\":\{[^}]*?\\"username\\":\\"([^"\\]*)\\"/);
      if (userMatch) author = userMatch[1];

      // Views
      let views = null;
      const viewMatch = html.match(/\\"video_view_count\\":(\d+)/);
      // Thumbnail
      let thumbnail = null;
      const tMatch = html.match(/\\"display_url\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/);
      if (tMatch) {
        thumbnail = tMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }

      return {
        success: true,
        data: {
          platform: 'instagram',
          title: title,
          thumbnail: thumbnail,
          meta: {
            author: author,
            views: views
          },
          qualities: {
            hd: videoUrl,
            sd: videoUrl
          }
        }
      };
    }
  } catch (err) {
    console.error('Direct Instagram extraction error:', err.message);
  }
  return null;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-qs-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Normalize path
  let path = event.path || '';
  path = path.replace(/^\/\.netlify\/functions\/api/, '');
  if (!path.startsWith('/api')) {
    path = '/api' + (path.startsWith('/') ? path : '/' + path);
  }
  // Trim trailing slash
  if (path.length > 4 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  if (path === '/api/token' && event.httpMethod === 'POST') {
    const token = await getUpstreamToken();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ token })
    };
  }

  // Special handling for Instagram with automatic direct fallback
  if (path === '/api/instagram' && event.httpMethod === 'POST') {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      let data = await proxyUpstream('/api/instagram', body);

      // If upstream failed or returned an error, try direct extraction
      if (!data || !data.success || !data.data?.qualities?.hd) {
        console.log('Upstream Instagram returned error, falling back to direct embed extractor...');
        const directData = await extractInstagramDirect(body.url || '');
        if (directData) {
          data = directData;
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    } catch (err) {
      try {
        const body = event.body ? JSON.parse(event.body) : {};
        const directData = await extractInstagramDirect(body.url || '');
        if (directData) {
          return { statusCode: 200, headers, body: JSON.stringify(directData) };
        }
      } catch (e) {}
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: err.message })
      };
    }
  }

  const proxyEndpoints = [
    '/api/yts',
    '/api/ytdl',
    '/api/tiktok',
    '/api/facebook',
    '/api/twitter',
    '/api/pinterest',
    '/api/spotify'
  ];

  if (proxyEndpoints.includes(path) && event.httpMethod === 'POST') {
    try {
      const body = event.body ? JSON.parse(event.body) : {};

      // Direct YouTube Download priority (fixes 502/720p upstream failures)
      if (path === '/api/ytdl') {
        const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
        if (directYt) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(directYt)
          };
        }
      }

      let data = await proxyUpstream(path, body);

      if (path === '/api/ytdl' && (!data || !data.success || !data.data?.qualities?.hd)) {
        const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
        if (directYt) data = directYt;
      }
      if (path === '/api/yts' && (!data || !data.success)) {
        const directInfo = await getYouTubeInfoDirect(body.url);
        if (directInfo) data = directInfo;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    } catch (err) {
      if (path === '/api/ytdl') {
        try {
          const body = event.body ? JSON.parse(event.body) : {};
          const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
          if (directYt) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify(directYt)
            };
          }
        } catch (e) {}
      }
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: err.message })
      };
    }
  }

  if (path === '/api/download' && (event.httpMethod === 'GET' || event.httpMethod === 'HEAD')) {
    const fileUrl = event.queryStringParameters?.url;
    if (!fileUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL required' }) };
    }
    return {
      statusCode: 302,
      headers: {
        'Location': fileUrl,
        'Access-Control-Allow-Origin': '*'
      },
      body: ''
    };
  }

  if (path === '/api/presence' && event.httpMethod === 'POST') {
    const now = Date.now();
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (e) {}

    const sid = body.sid || ('anon_' + Math.random().toString(36).slice(2));
    if (body.leave) {
      activePresences.delete(sid);
    } else {
      activePresences.set(sid, now);
    }

    // Purge sessions older than 45 seconds
    for (const [id, lastTime] of activePresences.entries()) {
      if (now - lastTime > 45000) {
        activePresences.delete(id);
      }
    }

    const online = Math.max(1, activePresences.size);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, online, sid })
    };
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: `Not found: ${path}` })
  };
};
