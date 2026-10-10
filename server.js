const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-memory real-time presence tracking (sessionId -> timestamp)
const activePresences = new Map();

// Secret for local JWT token fallback
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

function generateToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    scope: 'download',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
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
      tokenExpiresAt = now + 90 * 1000; // Cache for 90 seconds
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
  // Enable CORS
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

  // API: Proxy endpoints
  const proxyEndpoints = [
    '/api/yts',
    '/api/ytdl',
    '/api/tiktok',
    '/api/facebook',
    '/api/instagram',
    '/api/twitter',
    '/api/pinterest',
    '/api/spotify'
  ];

// In-memory LRU metadata cache for instant responses
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
    console.warn('All fast direct CDNs failed, falling back to upstream...');
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
    console.error('Direct Instagram extraction error:', err.message);
  }
  return null;
}

  // API: /api/details (Unified metadata fetcher - Ultra Fast)
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

        // Instant RAM Cache Hit (0ms)
        if (metadataCache.has(url)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(metadataCache.get(url)));
          return;
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
              duration: dataObj.meta?.duration || dataObj.duration || '',
              views: dataObj.meta?.views || dataObj.views || '',
              qualities: {}
            };
            metadataCache.set(url, resObj);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resObj));
            return;
          }
        } else if (platform === 'instagram') {
          let upData = null;
          try {
            upData = await proxyUpstreamApi('/api/instagram', { url });
          } catch (e) {}
          if (upData && upData.success && upData.data) {
            metadataCache.set(url, upData.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(upData.data));
            return;
          }
          const directData = await extractInstagramDirect(url);
          if (directData && directData.data) {
            metadataCache.set(url, directData.data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(directData.data));
            return;
          }
        } else {
          // General platforms: tiktok, facebook, twitter, spotify, pinterest
          const ep = `/api/${platform}`;
          const upData = await proxyUpstreamApi(ep, { url });
          if (upData && (upData.data || upData.success)) {
            const resData = upData.data || upData;
            metadataCache.set(url, resData);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resData));
            return;
          }
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not fetch media info. Ensure link is public and valid.' }));
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

        // Try direct first
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

        // Upstream fallback
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

  if (proxyEndpoints.includes(pathname) && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        console.log(`[API Request] ${pathname} with URL:`, body.url);

        // Priority direct YouTube download (solves 502/720p upstream failures)
        if (pathname === '/api/ytdl') {
          const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
          if (directYt) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(directYt));
            return;
          }
        }

        let data = await proxyUpstreamApi(pathname, body);

        if (pathname === '/api/ytdl' && (!data || !data.success || !data.data?.qualities?.hd)) {
          const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
          if (directYt) data = directYt;
        }

        if (pathname === '/api/yts' && (!data || !data.success)) {
          const directInfo = await getYouTubeInfoDirect(body.url || '');
          if (directInfo) data = directInfo;
        }

        if (pathname === '/api/instagram' && (!data || !data.success || !data.data?.qualities?.hd)) {
          console.log('Upstream Instagram failed, attempting direct embed extractor...');
          const directData = await extractInstagramDirect(body.url || '');
          if (directData) data = directData;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        if (pathname === '/api/ytdl') {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
            if (directYt) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(directYt));
              return;
            }
          } catch (e) {}
        }
        if (pathname === '/api/instagram') {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            const directData = await extractInstagramDirect(body.url || '');
            if (directData) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(directData));
              return;
            }
          } catch (e) {}
        }
        console.error(`Error processing ${pathname}:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }));
      }
    });
    return;
  }

  // API: Real-time presence heartbeat
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

  // API: /api/download?url=...
  if (pathname === '/api/download' && (req.method === 'GET' || req.method === 'HEAD')) {
    const fileUrl = parsedUrl.searchParams.get('url');
    if (!fileUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL parameter is required' }));
      return;
    }

    try {
      let filename = path.basename(new URL(fileUrl).pathname) || 'download.mp4';
      if (!path.extname(filename)) filename += '.mp4';

      const response = await fetch(fileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Remote server responded with ${response.status}` }));
        return;
      }

      let contentType = response.headers.get('content-type') || 'application/octet-stream';
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
      res.end(JSON.stringify({ error: 'Failed to download file' }));
    }
    return;
  }


  // Static files and pages
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // If path doesn't have an extension, try appending .html
  if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 404 fallback
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
  console.log(`🚀 QuickSave Clone Server is LIVE at: http://localhost:${PORT}`);
  console.log(`   - 100% Real-Time Video Downloader`);
  console.log(`   - All Platforms (YouTube, TikTok, Insta, FB, etc.)`);
  console.log(`   - Subpages: /about, /guaid, /contact, /apis`);
  console.log(`=======================================================`);
});
