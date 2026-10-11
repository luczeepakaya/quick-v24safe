// Cloudflare Worker for LUKZI VS SOCIAL MEDIA (100% Native on Cloudflare)
// Handles API routes (/api/*) and serves static assets from /public

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-qs-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

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
  return 'token_' + Date.now();
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

async function handleApiRequest(request, pathname, url) {
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // /api/token
  if (pathname === '/api/token' && method === 'POST') {
    const token = await getUpstreamToken();
    return new Response(JSON.stringify({ token }), { status: 200, headers: CORS_HEADERS });
  }

  // /api/details
  if (pathname === '/api/details' && method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const mediaUrl = (body.url || '').trim();
      if (!mediaUrl) {
        return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400, headers: CORS_HEADERS });
      }

      const lower = mediaUrl.toLowerCase();
      let platform = null;
      if (lower.includes('youtu.be') || lower.includes('youtube.com')) platform = 'youtube';
      else if (lower.includes('tiktok.com')) platform = 'tiktok';
      else if (lower.includes('instagram.com')) platform = 'instagram';
      else if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) platform = 'facebook';

      if (!platform) {
        return new Response(JSON.stringify({ error: 'Please enter a valid link from YouTube, TikTok, Instagram, or Facebook.' }), { status: 400, headers: CORS_HEADERS });
      }

      if (platform === 'youtube') {
        const fastInfo = await getYouTubeMetadataFast(mediaUrl);
        if (fastInfo) {
          return new Response(JSON.stringify(fastInfo), { status: 200, headers: CORS_HEADERS });
        }
        const upData = await proxyUpstream('/api/yts', { url: mediaUrl });
        if (upData && (upData.data || upData.title)) {
          const dataObj = upData.data || upData;
          return new Response(JSON.stringify({
            success: true,
            platform: 'youtube',
            title: dataObj.title || 'YouTube Video',
            thumbnail: dataObj.thumbnail || '',
            meta: dataObj.meta || {},
            duration: dataObj.meta?.duration || dataObj.duration || 'HD',
            views: dataObj.meta?.views || dataObj.views || 'Direct Stream',
            qualities: {}
          }), { status: 200, headers: CORS_HEADERS });
        }
      }

      const ep = `/api/${platform}`;
      const upData = await proxyUpstream(ep, { url: mediaUrl });
      if (upData && (upData.success || upData.data)) {
        const resData = upData.data || upData;
        return new Response(JSON.stringify(resData), { status: 200, headers: CORS_HEADERS });
      }

      return new Response(JSON.stringify({ error: 'Could not fetch media info. Please ensure link is public and valid.' }), { status: 400, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // /api/youtube
  if (pathname === '/api/youtube' && method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const mediaUrl = (body.url || '').trim();
      const type = body.type || 'mp4';
      const quality = body.quality || '720p';

      const upData = await proxyUpstream('/api/ytdl', { url: mediaUrl, type, quality });
      if (upData && upData.data) {
        const download_url = type === 'mp3' ? upData.data.qualities?.audio : (upData.data.qualities?.hd || upData.data.qualities?.sd);
        if (download_url) {
          return new Response(JSON.stringify({
            success: true,
            download_url,
            title: upData.data.title,
            thumbnail: upData.data.thumbnail
          }), { status: 200, headers: CORS_HEADERS });
        }
      }

      return new Response(JSON.stringify({ error: 'Could not generate YouTube download link. Please try again.' }), { status: 500, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // /api/download (Streamer with zero JSON error bug)
  if (pathname === '/api/download') {
    const fileUrl = url.searchParams.get('url');
    let filename = url.searchParams.get('filename') || 'lukzi-media.mp4';

    if (!fileUrl) {
      return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400, headers: CORS_HEADERS });
    }

    try {
      const mediaRes = await fetch(fileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!mediaRes.ok) {
        return new Response(JSON.stringify({ error: `Remote server responded with ${mediaRes.status}` }), {
          status: mediaRes.status,
          headers: CORS_HEADERS
        });
      }

      const contentType = mediaRes.headers.get('content-type') || 'video/mp4';
      if (contentType.includes('application/json')) {
        return new Response(JSON.stringify({ error: 'Remote URL returned JSON instead of media stream' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      const headers = new Headers();
      headers.set('Content-Disposition', `attachment; filename="${filename}"`);
      headers.set('Content-Type', contentType);
      headers.set('Access-Control-Allow-Origin', '*');

      const contentLength = mediaRes.headers.get('content-length');
      if (contentLength) headers.set('Content-Length', contentLength);

      return new Response(mediaRes.body, { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to download media stream' }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // /api/presence
  if (pathname === '/api/presence') {
    return new Response(JSON.stringify({ success: true, online: 18 }), { status: 200, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'Endpoint not found' }), { status: 404, headers: CORS_HEADERS });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle all API routes
    if (pathname.startsWith('/api/')) {
      return handleApiRequest(request, pathname, url);
    }

    // Serve static files from /public
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
