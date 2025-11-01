# 🔄 RESTART REQUIRED

The backend port has been changed from 8001 to 8002.

## Steps to Apply Changes:

### 1. Stop the Next.js dev server
In your terminal where `npm run dev` is running:
- Press **Ctrl+C** to stop it

### 2. Start it again
```bash
npm run dev
```

### 3. Go to the frontend and click "Start Backend"
- The backend will now start on port **8002** ✅
- Perspectives will display dynamically as they generate! 🎨

---

## Why restart?

The `next.config.js` file changed (API proxy from 8001→8002), which requires a full Next.js restart to take effect.

---

**After restarting, it should work!** 🚀

