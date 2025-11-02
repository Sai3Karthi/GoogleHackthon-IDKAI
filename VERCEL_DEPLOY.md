# Vercel Deployment Instructions

## Quick Deploy to Vercel

### Step 1: Deploy Frontend
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Set root directory to `frontend`
5. Framework preset will auto-detect as **Next.js**
6. Click **Deploy**

### Step 2: Configure Environment Variables (After Backend is Ready)

Once your backend is deployed, update these settings in Vercel:

1. Go to your project settings in Vercel
2. Navigate to **Environment Variables**
3. Add the following:

```
NEXT_PUBLIC_API_URL=https://your-backend-url.com
```

### Step 3: Update Rewrites in vercel.json

Replace `YOUR_BACKEND_URL` in `frontend/vercel.json` with your actual backend URL:

```json
"rewrites": [
  {
    "source": "/module1/:path*",
    "destination": "https://your-backend-url.com/module1/:path*"
  },
  ...
]
```

Then redeploy from Vercel dashboard.

### Step 4: Update next.config.js for Production

The current `next.config.js` uses local config. For production with external backend:

1. Set environment variable `NEXT_PUBLIC_API_URL` in Vercel
2. The rewrites will automatically proxy to your backend

## Current Deployment Status

- ✅ Frontend is configured for Vercel
- ✅ Next.js build optimized
- ✅ All dependencies listed in package.json
- ⚠️ Backend URLs need to be updated after backend deployment

## Backend Deployment Options (For Later)

You can deploy your backend to:
- **Google Cloud Platform (GCP)**: Cloud Run or App Engine
- **Railway.app**: Easy Python deployment
- **Render.com**: Free tier with Python support
- **Fly.io**: Supports FastAPI/Python

## Important Notes

1. **CORS Configuration**: Make sure your backend allows requests from your Vercel domain
2. **API Keys**: Set environment variables in Vercel for `GEMINI_API_KEY`
3. **Port Configuration**: Backend should run on standard ports (80/443) or configure in rewrites
4. **Session Storage**: Will work fine as it uses localStorage on client side

## Testing After Deployment

1. Test Module 1 analysis (text and image)
2. Verify Module 2 classification
3. Check Module 3 perspective generation
4. Test "New Session" functionality
5. Verify navigation and state persistence

## Quick Backend Update Commands (Later)

When you have backend URL:
```bash
cd frontend
# Edit vercel.json - replace YOUR_BACKEND_URL
# Push to GitHub
# Vercel will auto-redeploy
```

Or use Vercel CLI:
```bash
vercel env add NEXT_PUBLIC_API_URL
# Enter your backend URL
vercel --prod
```

## Fallback Mode

If backend is not ready, the frontend will:
- Show loading states
- Display "Backend not available" messages
- Allow testing of UI/UX
- Maintain session storage functionality
