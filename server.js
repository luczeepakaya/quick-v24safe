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
  try {
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
  } catch (err) {
    console.warn(`Proxy upstream error on ${endpoint}:`, err.message);
    return null;
  }
}

// Direct TikTok Extractor (tikwm.com API - fast, no watermark)
async function extractTikTok(url) {
  try {
    const res = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url.trim())}`);
    const json = await res.json();
    if (json && json.code === 0 && json.data) {
      const d = json.data;
      return {
        success: true,
        platform: 'tiktok',
        title: d.title || 'TikTok Video',
        thumbnail: d.cover || d.origin_cover || '/tiktok.png',
        author: d.author?.nickname || d.author?.unique_id || 'TikTok User',
        duration: d.duration ? `${d.duration}s` : '',
        views: d.play_count ? String(d.play_count) : '',
        qualities: {
          hd: d.play || d.wmplay,
          no_watermark: d.play || d.wmplay,
          sd: d.wmplay || d.play,
          audio: d.music || null
        },
        download_url: d.play || d.wmplay
      };
    }
  } catch (e) {
    console.warn('TikWM extractor failed:', e.message);
  }
  return null;
}

// Direct YouTube Downloader & Info
async function downloadYouTubeDirect(videoUrl, type = 'mp4', quality = '720p') {
  if (!videoUrl) return null;
  const cdns = ['https://cdn405.savetube.vip', 'https://cdn.savetube.vip'];

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
  const cdns = ['https://cdn405.savetube.vip', 'https://cdn.savetube.vip'];

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

// Direct Instagram Reel / Post Extractor
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
      let title = 'Instagram Reel';
      const capMatch = html.match(/\\"edge_media_to_caption\\":\{\\"edges\\":\[\{\\"node\\":\{\\"text\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/);
      if (capMatch) {
        try {
          title = JSON.parse(`"${capMatch[1]}"`);
        } catch (e) {
          title = capMatch[1];
        }
      }
      let author = 'Instagram User';
      const userMatch = html.match(/\\"owner\\":\{[^}]*?\\"username\\":\\"([^"\\]*)\\"/);
      if (userMatch) author = userMatch[1];
      
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
            views: ''
          },
          qualities: {
            hd: videoUrl,
            sd: videoUrl
          }
        }
      };
    }
  } catch (err) {
    console.warn('Direct Instagram extraction error:', err.message);
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

  // API: /api/details (Unified Details Extractor)
  if (pathname === '/api/details' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        const url = (body.url || '').trim();
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please enter a valid video or audio URL' }));
          return;
        }

        const lower = url.toLowerCase();

        // 1. TikTok
        if (lower.includes('tiktok.com')) {
          const tikData = await extractTikTok(url);
          if (tikData) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tikData));
            return;
          }
          const upstream = await proxyUpstreamApi('/api/tiktok', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'tiktok',
              title: upstream.data?.title || 'TikTok Video',
              thumbnail: upstream.data?.thumbnail || '/tiktok.png',
              author: upstream.data?.meta?.author || 'TikTok User',
              duration: upstream.data?.meta?.duration || '',
              views: upstream.data?.meta?.views || '',
              qualities: upstream.data?.qualities || {},
              download_url: upstream.data?.qualities?.hd || upstream.data?.qualities?.no_watermark || ''
            }));
            return;
          }
        }

        // 2. YouTube
        if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
          const ytDirect = await getYouTubeInfoDirect(url);
          if (ytDirect && ytDirect.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'youtube',
              title: ytDirect.data.title,
              thumbnail: ytDirect.data.thumbnail,
              author: 'YouTube Creator',
              duration: ytDirect.data.meta?.duration || '',
              views: '',
              qualities: {
                hd: '',
                sd: '',
                audio: ''
              },
              download_url: ''
            }));
            return;
          }
          const upstream = await proxyUpstreamApi('/api/yts', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'youtube',
              title: upstream.data?.title || 'YouTube Video',
              thumbnail: upstream.data?.thumbnail || '/yt.png',
              author: upstream.data?.meta?.author || 'YouTube Creator',
              duration: upstream.data?.meta?.duration || '',
              views: upstream.data?.meta?.views || '',
              qualities: upstream.data?.qualities || {},
              download_url: upstream.data?.qualities?.hd || ''
            }));
            return;
          }
        }

        // 3. Instagram
        if (lower.includes('instagram.com')) {
          const instaDirect = await extractInstagramDirect(url);
          if (instaDirect && instaDirect.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'instagram',
              title: instaDirect.data.title,
              thumbnail: instaDirect.data.thumbnail,
              author: instaDirect.data.meta?.author || '',
              duration: '',
              views: '',
              qualities: instaDirect.data.qualities,
              download_url: instaDirect.data.qualities.hd
            }));
            return;
          }
          const upstream = await proxyUpstreamApi('/api/instagram', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'instagram',
              title: upstream.data?.title || 'Instagram Post / Reel',
              thumbnail: upstream.data?.thumbnail || '/insta.png',
              author: upstream.data?.meta?.author || '',
              duration: upstream.data?.meta?.duration || '',
              views: upstream.data?.meta?.views || '',
              qualities: upstream.data?.qualities || {},
              download_url: upstream.data?.qualities?.hd || ''
            }));
            return;
          }
        }

        // 4. Facebook
        if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) {
          const upstream = await proxyUpstreamApi('/api/facebook', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'facebook',
              title: upstream.data?.title || 'Facebook Video',
              thumbnail: upstream.data?.thumbnail || '/fb.png',
              author: upstream.data?.meta?.author || '',
              duration: upstream.data?.meta?.duration || '',
              views: upstream.data?.meta?.views || '',
              qualities: upstream.data?.qualities || {},
              download_url: upstream.data?.qualities?.hd || upstream.data?.qualities?.sd || ''
            }));
            return;
          }
        }

        // 5. Twitter / X
        if (lower.includes('twitter.com') || lower.includes('x.com')) {
          const upstream = await proxyUpstreamApi('/api/twitter', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'twitter',
              title: upstream.data?.title || 'Twitter / X Video',
              thumbnail: upstream.data?.thumbnail || '/twitter.png',
              author: upstream.data?.meta?.author || '',
              duration: upstream.data?.meta?.duration || '',
              views: upstream.data?.meta?.views || '',
              qualities: upstream.data?.qualities || {},
              download_url: upstream.data?.qualities?.hd || ''
            }));
            return;
          }
        }

        // 6. Spotify
        if (lower.includes('spotify.com')) {
          const upstream = await proxyUpstreamApi('/api/spotify', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'spotify',
              title: upstream.data?.title || 'Spotify Track',
              thumbnail: upstream.data?.thumbnail || '/spotify.png',
              author: upstream.data?.meta?.artist || upstream.data?.meta?.author || '',
              duration: upstream.data?.meta?.duration || '',
              views: '',
              qualities: { audio: upstream.data?.download_url || upstream.data?.qualities?.audio || '' },
              download_url: upstream.data?.download_url || upstream.data?.qualities?.audio || ''
            }));
            return;
          }
        }

        // 7. Pinterest
        if (lower.includes('pinterest.com') || lower.includes('pin.it')) {
          const upstream = await proxyUpstreamApi('/api/pinterest', { url });
          if (upstream && upstream.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              platform: 'pinterest',
              title: upstream.data?.title || 'Pinterest Media',
              thumbnail: upstream.data?.thumbnail || '/Pintarest.png',
              author: upstream.data?.meta?.author || '',
              duration: '',
              views: '',
              qualities: upstream.data?.qualities || {},
              download_url: upstream.data?.qualities?.hd || ''
            }));
            return;
          }
        }

        // Fallback to /api/yts
        const genUpstream = await proxyUpstreamApi('/api/yts', { url });
        if (genUpstream && genUpstream.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(genUpstream.data || genUpstream));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not fetch media for this URL. Please verify the link is public and accessible.' }));
      } catch (err) {
        console.error('Error in /api/details:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal error processing link' }));
      }
    });
    return;
  }

  // API: /api/youtube (YouTube Link Generator)
  if (pathname === '/api/youtube' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
        if (directYt && directYt.success && directYt.data) {
          const dlUrl = directYt.data.qualities?.hd || directYt.data.qualities?.audio || '';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, download_url: dlUrl }));
          return;
        }
        const upstream = await proxyUpstreamApi('/api/ytdl', body);
        if (upstream && upstream.success) {
          const dlUrl = upstream.data?.qualities?.hd || upstream.data?.qualities?.audio || upstream.data?.download_url || '';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, download_url: dlUrl }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not generate YouTube download link. Please try a different quality or format.' }));
      } catch (err) {
        console.error('Error in /api/youtube:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Server busy' }));
      }
    });
    return;
  }

  // API: Legacy Proxy Endpoints
  const legacyProxyEndpoints = [
    '/api/yts',
    '/api/ytdl',
    '/api/tiktok',
    '/api/facebook',
    '/api/instagram',
    '/api/twitter',
    '/api/pinterest',
    '/api/spotify'
  ];

  if (legacyProxyEndpoints.includes(pathname) && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      try {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        if (pathname === '/api/tiktok') {
          const tik = await extractTikTok(body.url || '');
          if (tik) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tik));
            return;
          }
        }
        if (pathname === '/api/ytdl') {
          const directYt = await downloadYouTubeDirect(body.url, body.type, body.quality);
          if (directYt) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(directYt));
            return;
          }
        }
        const data = await proxyUpstreamApi(pathname, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data || { success: false, error: 'Upstream unavailable' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
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
  console.log(`🚀 LUKZI VS SOCIAL MEDIA Server is LIVE at: http://localhost:${PORT}`);
  console.log(`   - 100% Real-Time Video Downloader`);
  console.log(`   - Unified /api/details & /api/youtube`);
  console.log(`   - All Platforms (TikTok, YouTube, Insta, FB, etc.)`);
  console.log(`=======================================================`);
});
