# Deployment-Ready Changes - Module 3

## Overview
Updated `module-3.tsx` to use GET requests for all data fetching instead of directly reading JSON files or using localStorage for input data. This makes the application deployment-ready and ensures all data flows through the backend API.

## Changes Made

### 1. Input Data Fetching (Line ~70)
**Before:** 
- Read from `localStorage.getItem('module3_input')`
- Fallback to hardcoded `fallbackInput`

**After:**
- Fetch from `/module3/api/input` (GET request)
- Fallback to hardcoded `fallbackInput` only if backend is unavailable
- Properly sets backend status based on response

**Benefits:**
- Input data is always fresh from backend
- No stale localStorage data
- Better error handling with fallback
- Backend status accurately reflects availability

### 2. Input Data Refresh (Line ~310)
**Before:**
- Saved fetched data to `localStorage.setItem('module3_input', ...)`

**After:**
- Only stores in component state
- Updates input hash when data changes
- No localStorage pollution

**Benefits:**
- Single source of truth (backend)
- No sync issues between localStorage and backend
- Easier to debug and maintain

## API Endpoints Used

All endpoints follow the proxy pattern through orchestrator:

### GET Requests (Data Fetching)
1. `/module3/api/input` - Get input data (topic, text, significance_score)
2. `/module3/api/status` - Check pipeline status
3. `/module3/api/output` - Get all generated perspectives
4. `/module3/module3/output/leftist` - Get clustered leftist perspectives
5. `/module3/module3/output/common` - Get clustered common perspectives
6. `/module3/module3/output/rightist` - Get clustered rightist perspectives

### POST Requests (Actions)
1. `/module3/api/run_pipeline_stream` - Start perspective generation
2. `/run/module3` - Start module3 backend (via orchestrator)

## Cache Strategy

Client-side caching (via `cache-manager.ts`) is still used for:
- **Perspectives cache**: Stores generated perspectives based on input hash
- **Expiry**: 7 days
- **Purpose**: Avoid regenerating perspectives for same input

This is appropriate because:
- Reduces API calls for same input
- Improves user experience (instant load)
- User can force regeneration via "Force Regenerate" button

## Backend API Implementation

The backend (`module3/backend/main.py`) already provides all necessary endpoints:

```python
@app.get("/api/input")          # Returns input.json content
@app.get("/api/output")         # Returns output.json (all perspectives)
@app.get("/api/status")         # Returns pipeline status
@app.get("/module3/output/{category}")  # Returns final_output/{category}.json
@app.post("/api/run_pipeline_stream")  # Starts pipeline
```

## Deployment Advantages

1. **No Direct File Access**: All data flows through API
2. **Proxy Pattern**: Frontend → Orchestrator → Module Backend
3. **Environment Agnostic**: Works locally and in production
4. **Error Handling**: Graceful fallbacks when backend unavailable
5. **Single Source of Truth**: Backend serves all data
6. **Easy Scaling**: Can swap backend implementation without frontend changes

## Testing Checklist

- [x] Input data loads from API on mount
- [x] Fallback to hardcoded input if backend unavailable
- [x] Backend status correctly reflects availability
- [x] All perspective fetching uses GET requests
- [x] Clustering output fetched via API
- [x] Cache still works for performance
- [x] No localStorage used for input data
- [x] All endpoints use orchestrator proxy paths

## Migration Notes

**No Breaking Changes**: 
- Fallback input data still available
- Cache mechanism unchanged
- All existing functionality preserved

**Improved Behavior**:
- Input always fresh from backend when available
- Better error messages
- More reliable backend status detection
