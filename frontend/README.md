# Misinformation Tracking System - Frontend

A modern, minimalistic Next.js frontend for the Misinformation Tracking System.

## Features

- **Landing Page** with animated dot-shader background
- **4 Module Pages** with slide navigation
- **Module 3 Integration** with live workflow demonstration
- Smooth scrolling and keyboard navigation

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Add the dot-shader-background component:
```bash
npx shadcn@latest add https://21st.dev/r/66hex/dot-shader-background
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
frontend/
├── app/
│   ├── modules/
│   │   ├── 1/          # Module 1 (Under Progress)
│   │   ├── 2/          # Module 2 (Under Progress)
│   │   ├── 3/          # Module 3 (Working Demo)
│   │   └── 4/          # Module 4 (Under Progress)
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Landing page
│   └── globals.css     # Global styles
├── components/
│   ├── modules/
│   │   └── module-layout.tsx  # Shared module layout
│   └── ui/
│       └── dot-shader-background.tsx  # Background animation
└── lib/
    └── utils.ts        # Utility functions
```

## Navigation

- Use arrow keys (← →) or navigation buttons to move between modules
- Press Space or ↓ on landing page to go to Module 1
- Each module page shows its status and description

## Module 3 Integration

Module 3 connects to the backend API at `http://localhost:8001` to:
- Display input data from Module 2
- Show perspective generation workflow
- Display clustering results
- Present final output files (leftist.json, rightist.json, common.json)

Make sure the Module 3 backend is running before accessing Module 3 page.

## Technologies

- Next.js 14
- React 18
- Tailwind CSS
- TypeScript
- Framer Motion (for animations)

