# Frontend Setup Guide

## Prerequisites

- Node.js 18+ and npm/yarn
- Module 3 backend running on `http://localhost:8001`

## Installation

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Install the dot-shader-background component:
```bash
npx shadcn@latest add https://21st.dev/r/66hex/dot-shader-background
```

If the above command doesn't work, the component is already included in `components/ui/dot-shader-background.tsx`.

## Running the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features

- **Landing Page**: Animated background with navigation to modules
- **Module Pages**: 4 separate pages for each module
  - Modules 1, 2, 4: Under development status
  - Module 3: Full workflow demonstration with backend integration
- **Slide Navigation**: 
  - Use arrow keys (← →) to navigate between modules
  - Click navigation buttons in header/footer
  - Smooth scrolling between pages

## Module 3 Integration

Module 3 page connects to the backend API and displays:
- Input data from Module 2
- Perspective generation workflow
- Clustering results (leftist, rightist, common)
- Final output files

Make sure the Module 3 backend server is running:
```bash
cd module3/backend
python main.py
```

## Build for Production

```bash
npm run build
npm start
```

