# API Key Setup Guide

## Your API Key Was Leaked and Disabled

Google has detected that your API key was exposed and has disabled it for security. Follow these steps to fix it:

## Step 1: Delete the Old Key (Already Done by Google)

The leaked key has been automatically disabled. You cannot reuse it.

## Step 2: Get a New API Key

1. Go to **Google AI Studio**: https://aistudio.google.com/apikey
2. Sign in with your Google account
3. Click **"Create API Key"** or **"Get API Key"**
4. Copy the new API key (it starts with `AIza...`)

## Step 3: Update Your .env File

1. Open the `.env` file in the root directory
2. Replace the placeholder with your new key:
   ```bash
   GEMINI_API_KEY=AIzaYourNewKeyHere
   GENAI_API_KEY=AIzaYourNewKeyHere
   ```
3. Save the file

## Step 4: NEVER Commit API Keys

**CRITICAL**: Never commit `.env` files to git!

The `.env` file is already in `.gitignore`, but be extra careful:

- ❌ Don't share `.env` files
- ❌ Don't paste API keys in public forums/Discord/Slack
- ❌ Don't commit them to GitHub
- ❌ Don't hardcode them in source code
- ✅ Use `.env` for local development only
- ✅ Use environment variables in production (Vercel, GCP, etc.)

## Step 5: Restart All Services

After updating the API key:

```bash
# Stop all services (Ctrl+C in terminals)
# Then restart:
./start-all.bat
```

## Step 6: Verify It Works

1. Go to Module 1 in the frontend
2. Submit a test analysis
3. You should no longer see the "403 Permission Denied" error

## Production Deployment

For production, use environment variables instead of `.env`:

### Vercel (Frontend)
1. Go to Project Settings > Environment Variables
2. Add `GEMINI_API_KEY` with your key
3. Redeploy

### Google Cloud Run (Backend)
```bash
gcloud run deploy module1 \
  --set-env-vars GEMINI_API_KEY=your_key_here
```

## Security Best Practices

1. **Rotate keys regularly** (every 90 days)
2. **Restrict API key usage** in Google Cloud Console:
   - Set IP restrictions
   - Set API restrictions (only allow Gemini API)
3. **Monitor usage** in Google Cloud Console
4. **Set spending limits** to avoid unexpected charges

## If You See This Error Again

```
google.api_core.exceptions.PermissionDenied: 403 Your API key was reported as leaked
```

It means your API key was exposed somewhere. Repeat these steps with a fresh key.

## Need Help?

- Google AI Studio: https://aistudio.google.com
- Google Cloud Console: https://console.cloud.google.com
- API Key Management: https://console.cloud.google.com/apis/credentials
