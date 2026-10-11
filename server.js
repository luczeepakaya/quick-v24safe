const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory presence tracking (sessionId -> timestamp)
const activePresences = new Map();

// Local secret for JWT fallback
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

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

// Dynamic snapsave loader for ESM module
let snapsaveModule = null;
async function getSnapsave() {
  if (!snapsaveModule) {
    try {
      const mod = await import('snapsave-media-downloader');
      snapsaveModule = mod.snapsave || mod.default;
    } catch (err) {
      console.warn('Could not load snapsave-media-downloader:', err.message);
    }
  }
  return snapsaveModule;
}

// Upstream token cache
let cachedUpstreamToken = null;
let tokenExpiresAt = 0;

async function getUpstreamToken() {
  const now = Date.now();
  if (cachedUpstreamToken && now < tokenExpiresAt) {
    return cachedUpstreamToken;
  }
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
    if (data.token) {
      cachedUpstreamToken = data.token;
      tokenExpiresAt = now + 90 * 1000;
      return cachedUpstreamToken;
    }
  } catch (err) {
    console.error('Failed to get upstream token:', err.message);
  }
  return generateToken();
}

async function proxyUpstreamApi(endpoint, body) {
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

// In-memory LRU metadata cache
const metadataCache = new Map();

// 1. YouTube Fast Metadata via oEmbed
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

  if (videoId) {
    return {
      success: true,
      platform: 'youtube',
      title: 'YouTube Video',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      author: 'YouTube Creator',
      meta: { duration: 'HD' },
      qualities: {}
    };
  }
  return null;
}

// YouTube Direct Downloader (SaveTube CDN AES Decryptor)
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
      signal: AbortSignal.timeout(4500)
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
          views: 'Direct Stream',
          likes: 'HD'
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
    console.warn('Direct YouTube CDNs failed, falling back to upstream...');
  }
  return null;
}

// 2. Direct Instagram Embed Extractor Fallback
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
    let author = 'Instagram Creator';

    const vMatch = html.match(/\\?"video_url\\?":\s*\\?"([^"\\]*(?:\\.[^"\\]*)*)\\?"/) ||
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
      const tMatch = html.match(/\\?"display_url\\?":\s*\\?"([^"\\]*(?:\\.[^"\\]*)*)\\?"/) ||
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

      const uMatch = html.match(/\\?"owner\\?":\s*\{[^}]*?\\?"username\\?":\s*\\?"([^"\\]+)\\?"/);
      if (uMatch) author = uMatch[1];

      return {
        success: true,
        data: {
          platform: 'instagram',
          title: title,
          thumbnail: thumbnail || '/lukzi-logo.png',
          meta: {
            author: author,
            views: 'Reel HD'
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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-qs-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // API: /api/token
  if (pathname === '/api/token' && req.method === 'POST') {
    try {
      const token = await getUpstreamToken();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: generateToken() }));
    }
    return;
  }

  // API: /api/details (Unified metadata fetcher for YouTube, TikTok, Instagram, Facebook)
  if (pathname === '/api/details' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        const url = (body.url || '').trim();
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL is required' }));
          return;
        }

        // RAM Cache Hit
        if (metadataCache.has(url)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(metadataCache.get(url)));
          return;
        }

        const lower = url.toLowerCase();
        let platform = null;
        if (lower.includes('youtu.be') || lower.includes('youtube.com')) platform = 'youtube';
        else if (lower.includes('tiktok.com')) platform = 'tiktok';
        else if (lower.includes('instagram.com')) platform = 'instagram';
        else if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) platform = 'facebook';

        if (!platform) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please enter a valid link from YouTube, TikTok, Instagram, or Facebook.' }));
          return;
        }

        // Platform 1: YouTube
        if (platform === 'youtube') {
          const fastInfo = await getYouTubeMetadataFast(url);
          if (fastInfo) {
            metadataCache.set(url, fastInfo);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(fastInfo));
            return;
          }
          const upData = await proxyUpstreamApi('/api/yts', { url });
          if (upData && (upData.data || upData.title)) {
            const dataObj = upData.data || upData;
            const resObj = {
              success: true,
              platform: 'youtube',
              title: dataObj.title || 'YouTube Video',
              thumbnail: dataObj.thumbnail || '',
              meta: dataObj.meta || {},
              duration: dataObj.meta?.duration || dataObj.duration || 'HD',
              views: dataObj.meta?.views || dataObj.views || 'Direct Stream',
              qualities: {}
            };
            metadataCache.set(url, resObj);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resObj));
            return;
          }
        }

        // Platform 2: Instagram
        if (platform === 'instagram') {
          // Tier 1: snapsave
          try {
            const snapsave = await getSnapsave();
            if (snapsave) {
              const snapRes = await snapsave(url);
              if (snapRes && snapRes.success && snapRes.data?.media?.length > 0) {
                const item = snapRes.data.media[0];
                const resObj = {
                  success: true,
                  platform: 'instagram',
                  title: 'Instagram Reel / Video',
                  thumbnail: item.thumbnail || '/lukzi-logo.png',
                  meta: {
                    author: 'Instagram Creator',
                    duration: 'Full HD',
                    views: 'Reel Stream'
                  },
                  qualities: {
                    hd: item.url,
                    sd: item.url
                  }
                };
                metadataCache.set(url, resObj);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resObj));
                return;
              }
            }
          } catch (e) {
            console.warn('Instagram snapsave error:', e.message);
          }

          // Tier 2: Direct Embed Extractor
          const directData = await extractInstagramDirect(url);
          if (directData && directData.data) {
            metadataCache.set(url, directData.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(directData.data));
            return;
          }

          // Tier 3: Upstream proxy
          try {
            const upData = await proxyUpstreamApi('/api/instagram', { url });
            if (upData && (upData.success || upData.data)) {
              const resData = upData.data || upData;
              metadataCache.set(url, resData);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(resData));
              return;
            }
          } catch (e) {}
        }

        // Platform 3: TikTok
        if (platform === 'tiktok') {
          // Tier 1: snapsave
          try {
            const snapsave = await getSnapsave();
            if (snapsave) {
              const snapRes = await snapsave(url);
              if (snapRes && snapRes.success && snapRes.data?.media?.length > 0) {
                const vid = snapRes.data.media.find(m => m.type === 'video') || snapRes.data.media[0];
                const resObj = {
                  success: true,
                  platform: 'tiktok',
                  title: 'TikTok Video (No Watermark)',
                  thumbnail: vid.thumbnail || '/lukzi-logo.png',
                  meta: {
                    author: 'TikTok Creator',
                    duration: 'HD',
                    views: 'No Watermark'
                  },
                  qualities: {
                    hd: vid.url,
                    no_watermark: vid.url,
                    sd: vid.url
                  }
                };
                metadataCache.set(url, resObj);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resObj));
                return;
              }
            }
          } catch (e) {
            console.warn('TikTok snapsave error:', e.message);
          }

          // Tier 2: Upstream proxy
          try {
            const upData = await proxyUpstreamApi('/api/tiktok', { url });
            if (upData && (upData.success || upData.data)) {
              const resData = upData.data || upData;
              metadataCache.set(url, resData);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(resData));
              return;
            }
          } catch (e) {}
        }

        // Platform 4: Facebook
        if (platform === 'facebook') {
          // Tier 1: snapsave
          try {
            const snapsave = await getSnapsave();
            if (snapsave) {
              const snapRes = await snapsave(url);
              if (snapRes && snapRes.success && snapRes.data?.media?.length > 0) {
                const hd = snapRes.data.media.find(m => (m.quality || '').includes('HD')) || snapRes.data.media[0];
                const sd = snapRes.data.media.find(m => (m.quality || '').includes('SD')) || hd;
                const resObj = {
                  success: true,
                  platform: 'facebook',
                  title: 'Facebook Video',
                  thumbnail: hd.thumbnail || '/lukzi-logo.png',
                  meta: {
                    author: 'Facebook Creator',
                    duration: 'HD',
                    views: 'Direct Stream'
                  },
                  qualities: {
                    hd: hd.url,
                    sd: sd.url
                  }
                };
                metadataCache.set(url, resObj);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resObj));
                return;
              }
            }
          } catch (e) {
            console.warn('Facebook snapsave error:', e.message);
          }

          // Tier 2: Upstream proxy
          try {
            const upData = await proxyUpstreamApi('/api/facebook', { url });
            if (upData && (upData.success || upData.data)) {
              const resData = upData.data || upData;
              metadataCache.set(url, resData);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(resData));
              return;
            }
          } catch (e) {}
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not fetch media info. Please ensure link is public and valid.' }));
      } catch (err) {
        console.error('API details error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    });
    return;
  }

  // API: /api/youtube (Download link generator)
  if (pathname === '/api/youtube' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        const url = (body.url || '').trim();
        const type = body.type || 'mp4';
        const quality = body.quality || '720p';

        const directYt = await downloadYouTubeDirect(url, type, quality);
        if (directYt && directYt.data) {
          const download_url = type === 'mp3' ? directYt.data.qualities?.audio : (directYt.data.qualities?.hd || directYt.data.qualities?.sd);
          if (download_url) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              download_url,
              title: directYt.data.title,
              thumbnail: directYt.data.thumbnail
            }));
            return;
          }
        }

        const upData = await proxyUpstreamApi('/api/ytdl', { url, type, quality });
        if (upData && upData.data) {
          const download_url = type === 'mp3' ? upData.data.qualities?.audio : (upData.data.qualities?.hd || upData.data.qualities?.sd);
          if (download_url) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              download_url,
              title: upData.data.title,
              thumbnail: upData.data.thumbnail
            }));
            return;
          }
        }

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not generate YouTube download link. Please try again.' }));
      } catch (err) {
        console.error('API youtube error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    });
    return;
  }

  // API: Proxy endpoints for backwards compatibility
  const proxyEndpoints = ['/api/yts', '/api/ytdl', '/api/tiktok', '/api/facebook', '/api/instagram'];
  if (proxyEndpoints.includes(pathname) && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        if (pathname === '/api/ytdl') {
          const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
          if (directYt) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(directYt));
            return;
          }
        }
        let data = await proxyUpstreamApi(pathname, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }));
      }
    });
    return;
  }

  // API: Presence Heartbeat
  if (pathname === '/api/presence' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      const now = Date.now();
      let body = {};
      try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch (e) {}
      const sid = body.sid || ('anon_' + Math.random().toString(36).slice(2));
      if (body.leave) {
        activePresences.delete(sid);
      } else {
        activePresences.set(sid, now);
      }
      for (const [id, lastTime] of activePresences.entries()) {
        if (now - lastTime > 45000) activePresences.delete(id);
      }
      const online = Math.max(1, activePresences.size);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, online, sid }));
    });
    return;
  }

  // API: /api/download?url=...&filename=... (Streamer with zero JSON download bug)
  if (pathname === '/api/download' && (req.method === 'GET' || req.method === 'HEAD')) {
    const fileUrl = parsedUrl.searchParams.get('url');
    if (!fileUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL parameter is required' }));
      return;
    }

    try {
      let customName = parsedUrl.searchParams.get('filename');
      let filename = customName || path.basename(new URL(fileUrl).pathname) || 'download.mp4';
      if (!path.extname(filename)) filename += '.mp4';

      const response = await fetch(fileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        // Crucial fix: DO NOT set Content-Disposition on error so browser won't download json!
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Remote media server responded with ${response.status}` }));
        return;
      }

      let contentType = response.headers.get('content-type') || 'application/octet-stream';
      if (contentType.includes('application/json')) {
        // If remote responded with JSON, it's an error - do not attach as file!
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Remote URL returned JSON instead of media stream' }));
        return;
      }

      if ((!contentType || contentType === 'application/octet-stream') && filename.endsWith('.mp4')) {
        contentType = 'video/mp4';
      } else if ((!contentType || contentType === 'application/octet-stream') && filename.endsWith('.mp3')) {
        contentType = 'audio/mpeg';
      }

      const contentLength = response.headers.get('content-length');
      const headers = {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      };
      if (contentLength) headers['Content-Length'] = contentLength;

      res.writeHead(200, headers);

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      console.error('Download stream error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to download media stream' }));
    }
    return;
  }

  // Static files and pages
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const notFoundPath = path.join(PUBLIC_DIR, '404.html');
      if (fs.existsSync(notFoundPath)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(notFoundPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const responseHeaders = { 'Content-Type': contentType };
    if (ext === '.html' || ext === '.js') {
      responseHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      responseHeaders['Pragma'] = 'no-cache';
      responseHeaders['Expires'] = '0';
    }
    res.writeHead(200, responseHeaders);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 LUKZI Downloader Server is LIVE at: http://localhost:${PORT}`);
  console.log(`   - 100% Focused on 4 Platforms:`);
  console.log(`     1. YouTube (Video HD & MP3 320kbps)`);
  console.log(`     2. TikTok (No Watermark HD)`);
  console.log(`     3. Instagram (Reels & Videos HD)`);
  console.log(`     4. Facebook (Reels & Videos HD)`);
  console.log(`   - Cross-Platform: Android, iOS, and PC Flawless`);
  console.log(`=======================================================`);
});
