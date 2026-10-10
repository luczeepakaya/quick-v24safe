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

const metadataCache = new Map();

async function getYouTubeMetadataFast(videoUrl) {
  let targetUrl = (videoUrl || '').trim();
  let videoId = '';
  try {
    const u = new URL(targetUrl);
    if (u.hostname.includes('youtu.be')) {
      videoId = u.pathname.slice(1).split('?')[0];
    } else if (u.pathname.includes('/shorts/')) {
      videoId = u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
    } else if (u.searchParams.get('v')) {
      videoId = u.searchParams.get('v');
    }
  } catch (e) {}

  // 1. YouTube official oEmbed (Instant: ~200-400ms)
  try {
    const cleanYtUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : targetUrl;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanYtUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        platform: 'youtube',
        title: data.title || 'YouTube Video',
        thumbnail: data.thumbnail_url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '/lukzi-logo.png'),
        author: data.author_name || 'YouTube Creator',
        meta: {
          author: data.author_name,
          duration: 'Ultra HD',
          views: 'Direct Stream'
        },
        qualities: {}
      };
    }
  } catch (err) {}

  // 2. Fallback to quick video ID thumbnail
  if (videoId) {
    return {
      success: true,
      platform: 'youtube',
      title: 'YouTube Video',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      author: 'YouTube',
      meta: { duration: 'HD' },
      qualities: {}
    };
  }
  return null;
}

async function downloadYouTubeDirect(videoUrl, type = 'mp4', quality = '720p') {
  if (!videoUrl) return null;
  const cdns = [
    'https://cdn406.savetube.vip',
    'https://cdn405.savetube.vip'
  ];

  let targetUrl = videoUrl.trim();
  try {
    const u = new URL(targetUrl);
    if (u.hostname.includes('youtu.be')) {
      const vid = u.pathname.slice(1).split('?')[0];
      targetUrl = `https://www.youtube.com/watch?v=${vid}`;
    } else if (u.pathname.includes('/shorts/')) {
      const vid = u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
      targetUrl = `https://www.youtube.com/watch?v=${vid}`;
    }
  } catch (e) {}

  const cleanQuality = (quality || '720').toString().replace(/p$/i, '');
  const downloadType = type === 'mp3' ? 'audio' : 'video';
  const reqQuality = downloadType === 'audio' ? '128' : cleanQuality;

  const downloadFromCdn = async (cdn) => {
    const infoRes = await fetch(`${cdn}/v2/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://ytshorts.savetube.me',
        'Referer': 'https://ytshorts.savetube.me/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ url: targetUrl }),
      signal: AbortSignal.timeout(3500)
    });

    if (!infoRes.ok) throw new Error(`Info failed on ${cdn}`);
    const json = await infoRes.json();
    if (!json.data) throw new Error(`No data on ${cdn}`);

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
      }),
      signal: AbortSignal.timeout(4000)
    });

    if (!dlRes.ok) throw new Error(`Download failed on ${cdn}`);
    const dlJson = await dlRes.json();
    const downloadUrl = dlJson.data?.downloadUrl;
    if (!downloadUrl) throw new Error(`No download url on ${cdn}`);

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
  };

  try {
    return await Promise.any(cdns.map(cdn => downloadFromCdn(cdn)));
  } catch (err) {
    console.warn('All fast direct CDNs failed in netlify function, falling back to upstream...');
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();

    let videoUrl = null;
    let title = 'Instagram Reel';
    let thumbnail = null;
    let author = 'Instagram User';

    // 1. Clean video URL extraction
    const vMatch = html.match(/\\\\?"video_url\\\\?":\s*\\\\?"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)\\\\?"/) ||
                   html.match(/"video_url":\s*"([^"]+)"/) ||
                   html.match(/\\"video_url\\":\s*\\"(.*?)(?=\\"[,}])/);
    if (vMatch) {
      let raw = vMatch[1];
      const cutIdx = raw.indexOf('\\"');
      if (cutIdx !== -1) raw = raw.substring(0, cutIdx);
      const cutIdx2 = raw.indexOf('"');
      if (cutIdx2 !== -1) raw = raw.substring(0, cutIdx2);
      videoUrl = raw.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
    }

    if (videoUrl) {
      // 2. Clean thumbnail extraction
      const tMatch = html.match(/\\\\?"display_url\\\\?":\s*\\\\?"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)\\\\?"/) ||
                     html.match(/"display_url":\s*"([^"]+)"/) ||
                     html.match(/\\"display_url\\":\s*\\"(.*?)(?=\\"[,}])/);
      if (tMatch) {
        let raw = tMatch[1];
        const cutIdx = raw.indexOf('\\"');
        if (cutIdx !== -1) raw = raw.substring(0, cutIdx);
        const cutIdx2 = raw.indexOf('"');
        if (cutIdx2 !== -1) raw = raw.substring(0, cutIdx2);
        thumbnail = raw.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
      }

      // 3. Clean caption/title extraction
      const cMatch = html.match(/\\\\?"edge_media_to_caption\\\\?":\s*\{[^}]*?\\\\?"text\\\\?":\s*\\\\?"([\s\S]*?)(?=\\\\?"\s*\}\s*\])/) ||
                     html.match(/"text":\s*"([^"]+)"/) ||
                     html.match(/\\"text\\":\s*\\"(.*?)(?=\\"[,}])/);
      if (cMatch) {
        let rawText = cMatch[1];
        const noisePatterns = ['\\"}}]', '"}]]', '"}]}', '\\"}', '"}'];
        for (const p of noisePatterns) {
          const idx = rawText.indexOf(p);
          if (idx !== -1) rawText = rawText.substring(0, idx);
        }
        rawText = rawText.replace(/\\n/g, ' ')
                         .replace(/\\"/g, '"')
                         .replace(/\\\\/g, '')
                         .replace(/\s+/g, ' ')
                         .trim();
        if (rawText && rawText.length > 0) {
          title = rawText;
        }
      }

      // 4. Clean author username extraction
      const uMatch = html.match(/\\\\?"owner\\\\?":\s*\{[^}]*?\\\\?"username\\\\?":\s*\\\\?"([^"\\\\]+)\\\\?"/);
      if (uMatch) {
        author = uMatch[1];
      }

      return {
        success: true,
        data: {
          platform: 'instagram',
          title: title,
          thumbnail: thumbnail,
          meta: {
            author: author,
            views: 'Reel Stream'
          },
          qualities: {
            hd: videoUrl,
            sd: videoUrl
          }
        }
      };
    }
  } catch (err) {
    console.error('Direct Instagram extraction error in netlify function:', err.message);
  }
  return null;
}

async function extractTikTokDirect(url) {
  try {
    const res = await fetch('https://www.tikwm.com/api/?url=' + encodeURIComponent(url), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(3500)
    });
    const json = await res.json();
    if (json && json.code === 0 && json.data) {
      const d = json.data;
      const playUrl = d.play.startsWith('http') ? d.play : ('https://www.tikwm.com' + d.play);
      const hdUrl = d.hdplay ? (d.hdplay.startsWith('http') ? d.hdplay : ('https://www.tikwm.com' + d.hdplay)) : playUrl;
      const musicUrl = d.music ? (d.music.startsWith('http') ? d.music : ('https://www.tikwm.com' + d.music)) : null;
      const coverUrl = d.cover ? (d.cover.startsWith('http') ? d.cover : ('https://www.tikwm.com' + d.cover)) : null;

      return {
        success: true,
        data: {
          platform: 'tiktok',
          title: d.title || 'TikTok Video',
          thumbnail: coverUrl,
          author: d.author?.nickname || d.author?.unique_id || 'TikTok Creator',
          meta: {
            author: d.author?.nickname || d.author?.unique_id,
            duration: d.duration ? `${d.duration}s` : 'HD',
            views: d.play_count ? String(d.play_count) : 'Direct Stream',
            likes: d.digg_count ? String(d.digg_count) : '0'
          },
          qualities: {
            hd: hdUrl,
            sd: playUrl,
            no_watermark: playUrl,
            audio: musicUrl
          }
        }
      };
    }
  } catch (err) {
    console.warn('Direct TikTok extraction error in netlify function:', err.message);
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

  // API: /api/details (Unified media inspector - Ultra Fast)
  if (path === '/api/details' && event.httpMethod === 'POST') {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const url = (body.url || '').trim();
      if (!url) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL is required' }) };
      }

      // Fast RAM Cache (0ms)
      if (metadataCache.has(url)) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(metadataCache.get(url))
        };
      }

      const lower = url.toLowerCase();
      let platform = 'video';
      if (lower.includes('youtu.be') || lower.includes('youtube.com')) platform = 'youtube';
      else if (lower.includes('tiktok.com')) platform = 'tiktok';
      else if (lower.includes('instagram.com')) platform = 'instagram';
      else if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) platform = 'facebook';
      else if (lower.includes('twitter.com') || lower.includes('x.com')) platform = 'twitter';
      else if (lower.includes('spotify.com') || lower.includes('open.spotify.com')) platform = 'spotify';
      else if (lower.includes('pinterest.com') || lower.includes('pin.it')) platform = 'pinterest';

      if (platform === 'youtube') {
        const fastInfo = await getYouTubeMetadataFast(url);
        if (fastInfo) {
          metadataCache.set(url, fastInfo);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(fastInfo)
          };
        }
        const upData = await proxyUpstream('/api/yts', { url });
        if (upData && (upData.data || upData.title)) {
          const dataObj = upData.data || upData;
          const resObj = {
            success: true,
            platform: 'youtube',
            title: dataObj.title || 'YouTube Video',
            thumbnail: dataObj.thumbnail || '',
            meta: dataObj.meta || {},
            duration: dataObj.meta?.duration || dataObj.duration || '',
            views: dataObj.meta?.views || dataObj.views || '',
            qualities: {}
          };
          metadataCache.set(url, resObj);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(resObj)
          };
        }
      } else if (platform === 'tiktok') {
        const directData = await extractTikTokDirect(url);
        if (directData && directData.data) {
          metadataCache.set(url, directData.data);
          return { statusCode: 200, headers, body: JSON.stringify(directData.data) };
        }
        const upData = await proxyUpstream('/api/tiktok', { url });
        if (upData && (upData.data || upData.success)) {
          const resData = upData.data || upData;
          metadataCache.set(url, resData);
          return { statusCode: 200, headers, body: JSON.stringify(resData) };
        }
      } else if (platform === 'instagram') {
        const directData = await extractInstagramDirect(url);
        if (directData && directData.data) {
          metadataCache.set(url, directData.data);
          return { statusCode: 200, headers, body: JSON.stringify(directData.data) };
        }
        let upData = null;
        try {
          upData = await proxyUpstream('/api/instagram', { url });
        } catch (e) {}
        if (upData && upData.success && upData.data) {
          metadataCache.set(url, upData.data);
          return { statusCode: 200, headers, body: JSON.stringify(upData.data) };
        }
      } else {
        const ep = `/api/${platform}`;
        const upData = await proxyUpstream(ep, { url });
        if (upData && (upData.data || upData.success)) {
          const resData = upData.data || upData;
          metadataCache.set(url, resData);
          return { statusCode: 200, headers, body: JSON.stringify(resData) };
        }
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not fetch media info. Ensure link is public and valid.' }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal server error' }) };
    }
  }

  // API: /api/youtube (Download generator)
  if (path === '/api/youtube' && event.httpMethod === 'POST') {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const url = (body.url || '').trim();
      const type = body.type || 'mp4';
      const quality = body.quality || '720p';

      const directYt = await downloadYouTubeDirect(url, type, quality);
      if (directYt && directYt.data) {
        const download_url = type === 'mp3' ? directYt.data.qualities?.audio : (directYt.data.qualities?.hd || directYt.data.qualities?.sd);
        if (download_url) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              download_url,
              title: directYt.data.title,
              thumbnail: directYt.data.thumbnail
            })
          };
        }
      }

      const upData = await proxyUpstream('/api/ytdl', { url, type, quality });
      if (upData && upData.data) {
        const download_url = type === 'mp3' ? upData.data.qualities?.audio : (upData.data.qualities?.hd || upData.data.qualities?.sd);
        if (download_url) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              download_url,
              title: upData.data.title,
              thumbnail: upData.data.thumbnail
            })
          };
        }
      }

      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not generate YouTube download link. Please try again.' }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal server error' }) };
    }
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
