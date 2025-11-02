# Quick Vercel Deployment Guide

## 🚀 Deploy Now (3 Minutes)

### Option 1: Vercel Dashboard (Recommended)
1. Go to https://vercel.com/new
2. Import your GitHub repository
3. **Set Root Directory:** `frontend`
4. **Framework Preset:** Next.js (auto-detected)
5. Click **Deploy** 
6. ✅ Done! Your frontend is live

### Option 2: Vercel CLI
```bash
cd frontend
npx vercel
# Follow prompts
npx vercel --prod
```

## ⚙️ After Backend Deployment (Later)

### Update Environment Variable in Vercel:
1. Go to your project → Settings → Environment Variables
2. Add: `NEXT_PUBLIC_API_URL` = `https://your-backend-url.com`
3. Redeploy

### Or Use CLI:
```bash
vercel env add NEXT_PUBLIC_API_URL production
# Enter your backend URL when prompted
vercel --prod
```

## 📝 What's Already Configured

✅ Next.js configuration with environment variable support  
✅ Production/Development mode detection  
✅ API route rewrites ready  
✅ All dependencies in package.json  
✅ TypeScript configuration  
✅ Tailwind CSS setup  

## 🔧 Current Configuration

- **Local Dev:** Uses `config.ini` and `config-loader.js`
- **Production:** Uses `NEXT_PUBLIC_API_URL` environment variable
- **Fallback:** `http://localhost:8000` if not set

## ⚠️ Important Notes

1. **Backend URL Placeholder:** Currently set to `YOUR_BACKEND_URL` - update after backend deployment
2. **CORS:** Your backend must allow requests from your Vercel domain
3. **API Keys:** Backend needs `GEMINI_API_KEY` environment variable
4. **Session Storage:** Works client-side, no backend changes needed

## 📱 Test After Deployment

1. Visit your Vercel URL
2. Test Module 1 (may show "backend not available" - expected)
3. Verify UI/UX works
4. Check console for errors
5. Test navigation between modules

## 🌐 Vercel Domain

After deployment, Vercel gives you:
- Production: `https://your-project.vercel.app`
- Custom domain: Add in Vercel settings

## 🔄 Auto-Deploy

Vercel automatically redeploys when you push to main branch!

## 💡 Pro Tips

- **Preview Deployments:** Every PR gets its own preview URL
- **Analytics:** Enable in Vercel dashboard for free
- **Logs:** Check Vercel logs for debugging
- **Speed Insights:** Enable Web Analytics in settings

## 🆘 Troubleshooting

**Build fails?**
```bash
cd frontend
npm install
npm run build
# Fix any errors locally first
```

**API calls fail?**
- Check Vercel function logs
- Verify `NEXT_PUBLIC_API_URL` is set
- Check CORS on backend
- Verify backend is running

**Images not loading?**
- Check `next.config.js` image domains
- Verify image URLs are absolute

## 📞 Support

- Vercel Docs: https://vercel.com/docs
- Next.js Docs: https://nextjs.org/docs
- Your logs: Vercel Dashboard → Project → Deployments → Logs
