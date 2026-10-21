const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

const memoryCache = new Map();

function isAllowedFacebookHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
}

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.get('/live', async (req, res) => {
  const targetUrlStr = req.query.url;
  if (!targetUrlStr) return res.status(400).send("Missing url parameter");

  try {
    const targetUrl = new URL(targetUrlStr);
    if (!isAllowedFacebookHost(targetUrl.hostname)) {
      return res.status(403).send("Host not allowed");
    }

    const fbRes = await fetch(targetUrl.href, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!fbRes.ok) return res.status(502).send("Facebook Error");

    let mpd = await fbRes.text();
    const serverBase = `${req.protocol}://${req.get('host')}`;

    mpd = mpd.replace(/(initialization|media)="([^"]+)"/gi, (match, attr, val) => {
      try {
        val = val.replace(/&amp;/g, "&");
        const absolute = new URL(val, targetUrl).href;
        let encoded = encodeURIComponent(absolute);
        encoded = encoded.replace(/%24Time%24/gi, "$Time$");
        return `${attr}="${serverBase}/proxy?url=${encoded}"`;
      } catch (e) {
        return match;
      }
    });

    res.setHeader("Content-Type", "application/dash+xml; charset=utf-8");
    res.send(mpd);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url parameter");

  try {
    const targetUrl = new URL(target);
    if (!isAllowedFacebookHost(targetUrl.hostname)) {
      return res.status(403).send("Host not allowed");
    }

    targetUrl.searchParams.delete("_nc_cat");
    targetUrl.searchParams.delete("oh");
    targetUrl.searchParams.delete("oe");
    targetUrl.searchParams.delete("_nc_sid");

    const cacheKey = targetUrl.origin + targetUrl.pathname;

    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey);
      res.setHeader("Content-Type", cached.contentType);
      return res.send(cached.buffer);
    }

    const fbRes = await fetch(targetUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Range": req.headers.range || ""
      }
    });

    const buffer = await fbRes.buffer();
    const contentType = fbRes.headers.get("Content-Type") || "video/mp4";

    if (fbRes.ok) {
      memoryCache.set(cacheKey, { buffer, contentType });
      setTimeout(() => memoryCache.delete(cacheKey), 600000);
    }

    res.setHeader("Content-Type", contentType);
    res.status(fbRes.status).send(buffer);
  } catch (err) {
    res.status(500).send("Proxy Error: " + err.message);
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
