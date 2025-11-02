# Automated Pipeline Flow

## Overview

The system now automatically chains Module 1 → Module 2 → Module 3 OR Module 1 → Module 5 based on confidence levels.

## Flow Diagram

```
User Input (Frontend)
    ↓
Module 1: Analysis
    ↓
Decision Point (95% confidence threshold)
    ↓                              ↓
[< 95% Confidence]          [≥ 95% Confidence]
    ↓                              ↓
Module 2: Classification      Module 5: Final Output
    ↓                         (Skip debate)
Module 3: Perspectives
    ↓
Module 4: Debate
    ↓
Module 5: Final Output
```

## Automatic Triggers

### Module 1 → Module 2/3 or Module 5

After Module 1 completes analysis:

1. **High Confidence (≥95%)**: Skip directly to Module 5
   - Obvious scams/threats detected
   - No debate needed
   - User sees final verdict immediately

2. **Lower Confidence (<95%)**: Continue pipeline
   - Module 2 triggered automatically
   - Module 3 triggered automatically
   - Full debate process runs

### Implementation

**Module 1** (`module1/backend/main.py`):
```python
# After analysis completes
if skip_to_final:
    logger.info("Skipping to Module 5 - high confidence")
else:
    await trigger_module2_processing()
    await trigger_module3_processing()
```

**Endpoints:**
- Module 2: `POST http://127.0.0.1:8002/api/process`
- Module 3: `POST http://127.0.0.1:8003/api/run_pipeline_stream`

## API Flow

### Text/URL Analysis
```
POST /module1/api/analyze
    → Module 1 saves input.json + output.json
    → If confidence ≥ 95%:
        ✓ Frontend redirects to /modules/5
    → If confidence < 95%:
        ✓ POST /module2/api/process (automatic)
            → Module 2 saves output.json + module3/input.json
        ✓ POST /module3/api/run_pipeline_stream (automatic)
            → Module 3 generates perspectives
        ✓ Frontend shows Module 2 or proceeds to Module 3
```

### Image Analysis
```
POST /module1/api/analyze-image
    → Module 1 saves input.json + output.json
    → If fake_confidence ≥ 90% AND dangerous:
        ✓ Frontend redirects to /modules/5
    → Else:
        ✓ POST /module2/api/process (automatic)
        ✓ POST /module3/api/run_pipeline_stream (automatic)
```

## Data Format Flow

### Module 1 → Module 2
**Input:** `module1/backend/output.json`
```json
{
  "input_type": "text",
  "risk_level": "dangerous",
  "confidence": 0.85,
  "threats": ["financial_scam"],
  "recommendation": "...",
  "ai_powered": true
}
```

### Module 2 → Module 3
**Input:** `module3/backend/input.json`
```json
{
  "topic": "Summary of the content...",
  "text": "Original text from user",
  "significance_score": 0.65
}
```

**Note:** Significance score is **inverse** of confidence:
- High confidence (95%) → Low significance (0.15) → Skip debate
- Low confidence (50%) → High significance (0.85) → Full debate

### Module 3 → Module 4 → Module 5
Module 3 generates perspectives, Module 4 debates them, Module 5 shows final verdict.

## Frontend Integration

### Next.js Proxy Routes
```javascript
// frontend/next.config.js
rewrites: [
  '/module1/:path*' → 'http://127.0.0.1:8000/module1/:path*',
  '/module2/:path*' → 'http://127.0.0.1:8000/module2/:path*',
  '/module3/:path*' → 'http://127.0.0.1:8000/module3/:path*'
]
```

### Frontend Flow
```javascript
// 1. User submits in Module 1
const result = await fetch('/module1/api/analyze', {...})

// 2. Check skip flag
if (result.skip_to_final) {
  // Show notification
  setTimeout(() => router.push('/modules/5'), 2000)
} else {
  // Modules 2 & 3 already triggered automatically
  // Frontend can poll or wait
  router.push('/modules/2') // Optional: show classification
}
```

## Orchestrator Configuration

The orchestrator now includes Module 2 routing:

```python
MODULES = {
    "module1": {"host": "127.0.0.1", "port": 8001},
    "module2": {"host": "127.0.0.1", "port": 8002},
    "module3": {"host": "127.0.0.1", "port": 8003}
}
```

## Port Assignments

- **Orchestrator**: 8000
- **Module 1**: 8001
- **Module 2**: 8002
- **Module 3**: 8003
- **Frontend**: 3001

## Starting the System

```bash
# Terminal 1: Orchestrator
python orchestrator.py

# Terminal 2: Module 1
./start-module1.bat

# Terminal 3: Module 2
./start-module2.bat

# Terminal 4: Module 3
./start-module3.bat

# Terminal 5: Frontend
cd frontend
npm run dev
```

## Testing the Flow

### Test 1: High Confidence (Skip to Module 5)
```bash
curl -X POST http://localhost:8001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Send $1000 NOW to claim your prize!"}'
```
**Expected:**
- Module 1 returns `skip_to_final: true`
- No Module 2/3 triggered
- Frontend redirects to Module 5

### Test 2: Low Confidence (Full Pipeline)
```bash
curl -X POST http://localhost:8001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"input": "Investment opportunity with great returns"}'
```
**Expected:**
- Module 1 returns `skip_to_final: false`
- Module 2 automatically triggered → creates classification
- Module 3 automatically triggered → generates perspectives
- Frontend can navigate through modules 2, 3, 4, 5

## Monitoring

Check logs to see automatic triggers:
```
[Module1] INFO: Triggering Module 2 for classification
[Module1] INFO: Triggering Module 3 for perspective generation
[Module2] INFO: Module 2 processing complete. Significance score: 65/100
[Module3] INFO: Pipeline started in background
```

## Error Handling

If a module is not running:
- Module 1 logs warning but still returns result
- Frontend works normally
- User can manually trigger modules if needed

## Benefits

1. ✅ **Seamless UX**: User submits once, everything processes automatically
2. ✅ **Intelligent Routing**: Obvious scams skip debate, save time
3. ✅ **Efficient Pipeline**: Only debates ambiguous content
4. ✅ **Graceful Degradation**: Works even if Module 2/3 offline
5. ✅ **Developer Friendly**: Clear logs, easy debugging
