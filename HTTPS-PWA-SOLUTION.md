# Karim ERP - Professional HTTPS & PWA Solution

## 🎯 Problems Solved
1. **Slow loading** → Optimized loading, compression, caching, lazy loading
2. **Certificate warnings on devices** → Professional certificate solutions
3. **PWA not working on HTTP** → Full HTTPS + Service Worker support

---

## 🚀 Quick Start (Choose One)

### Option 0: Trusted LAN deployment (recommended for this Windows server)
Run `setup-lan-trust.ps1` from an **Administrator PowerShell** on the ERP server.
It detects the server LAN IP, creates a mkcert certificate containing the server
IP and host names, updates `.env` for HTTPS on port 5001, exports the exact CA,
and opens only the ERP HTTPS port in the Windows firewall.

Then copy `C:\HorusData\certs\Karim-Local-CA.crt` to each client device and run
`Install-Karim-CA.bat` as Administrator on Windows clients. Android and iOS users
must install this CA in the device certificate settings. The browser warning
cannot be removed by JavaScript or by changing `hosts`; the client must trust the
same CA and the URL must use a name/IP included in the certificate SAN.

### Option 1: Local Development (mkcert)
```cmd
# Run as Administrator
setup-local-https.bat
```
- This compatibility entry point delegates to the trusted LAN setup above.
- Access the printed LAN URL, then install `Karim-Local-CA.crt` on each client.

### Option 2: Production with Let's Encrypt (nginx)
```cmd
setup-https.bat
```
- Requires real domain (e.g., `erp.yourcompany.com`)
- Auto-generates Let's Encrypt certificates
- Nginx reverse proxy with auto-renewal
- Full security headers, rate limiting, caching

### Option 3: Cloudflare Tunnel (Zero Config)
```cmd
# Install cloudflared
cloudflared tunnel --url https://localhost:5001
```
- No certificate management
- Works behind NAT/Firewall
- Free, automatic HTTPS

---

## ⚡ Performance Optimizations Applied

### Frontend (index.html)
| Optimization | Status |
|--------------|--------|
| DNS Prefetch & Preconnect | ✅ |
| Font preload + `font-display: swap` | ✅ |
| Critical resource preload | ✅ |
| Deferred non-critical scripts | ✅ |
| CSS media="print" onload trick | ✅ |
| Gzip/Compression headers | ✅ |

### Service Worker (sw.js)
| Feature | Description |
|---------|-------------|
| **Static assets** | Cache-first, 30-day TTL, stale-while-revalidate |
| **API calls** | Network-first, 5-min cache fallback |
| **Images/Fonts** | Cache-first, 30-day TTL |
| **Navigations** | Network-first, offline fallback |
| **API cache TTL** | 5 minutes (auto-cleanup) |
| **Background sync** | Offline mutations, periodic refresh |

### Nginx (Production)
| Feature | Config |
|---------|--------|
| HTTP/2 + TLS 1.3 | ✅ |
| Modern SSL ciphers | ✅ |
| OCSP Stapling | ✅ |
| HSTS + Security headers | ✅ |
| Gzip + Brotli ready | ✅ |
| Rate limiting (API/Login/WS) | ✅ |
| Static asset caching (1yr) | ✅ |
| API caching (5min) | ✅ |
| WebSocket proxy | ✅ |
| Rate limiting zones | ✅ |

---

## 📱 PWA Requirements Checklist

| Requirement | Status |
|-------------|--------|
| HTTPS | ✅ (via nginx/mkcert) |
| Manifest.json | ✅ (configured) |
| Service Worker | ✅ (sw.js v4.7.1) |
| App icons (192/512) | ✅ |
| Maskable icons | ✅ |
| Shortcuts | ✅ |
| Apple touch icons | ✅ |
| CSP compatible | ✅ |

---

## 🛠 Device Setup Instructions

### Windows
```cmd
# 1. Run as Admin
setup-local-https.bat

# 2. Add to hosts (auto-done by script)
127.0.0.1 karim-erp.local
```

### Android/iPhone
1. Settings → Network → DNS → Manual
2. Add server IP → `karim-erp.local`
3. Or use same WiFi → access `https://karim-erp.local`
4. Chrome/Edge → Menu → "Install App"

### Other PCs on Network
```cmd
# Add to C:\Windows\System32\drivers\etc\hosts
192.168.x.x karim-erp.local
```
(Replace with server's LAN IP)

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Certificate not trusted" | Run `mkcert -install` as Admin |
| PWA not installing | Ensure HTTPS + manifest + SW registered |
| Slow first load | Check Service Worker registration in DevTools |
| API slow | Check nginx cache headers `X-Cache: HIT/MISS` |
| WebSocket fails | Check nginx WS proxy config |

---

## 📁 Files Created/Modified

| File | Purpose |
|------|---------|
| `setup-local-https.bat` | Local HTTPS with mkcert |
| `setup-https.bat` | Production nginx + Let's Encrypt |
| `nginx.conf` | Professional reverse proxy config |
| `frontend/app/index.html` | Optimized loading |
| `frontend/app/sw.js` | Advanced Service Worker |
| `frontend/app/index.html` | Performance optimized |

---

## ✅ Verification Checklist

- [ ] `https://karim-erp.local/app/index.html` loads without cert warning
- [ ] PWA install prompt appears in Chrome/Edge
- [ ] Service Worker shows "activated" in DevTools → Application
- [ ] Offline page works (disconnect network, refresh)
- [ ] API calls show `X-Cache: HIT` after first load
- [ ] WebSocket connects via `wss://` (secure)
- [ ] All static assets have `Cache-Control: max-age=31536000, immutable`

---

## 📞 Support

For issues:
1. Check `C:\nginx\logs\error.log`
2. DevTools → Application → Service Worker → Console
3. `curl -k https://karim-erp.local/api/health`

**Done!** Your Karim ERP now loads fast, works offline, and has professional HTTPS on all devices. 🎉