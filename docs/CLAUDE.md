# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run setup-db` - Setup PostgreSQL database and schema
- `npm run ingest` - Ingest CSV files from data/to_process/ into database
- `npm run reprocess` - Clear database and re-ingest all files from data/processed/ (use when ingestion logic changes)
- `npm run db:schema` - Re-run database schema setup
- Dont ever call `npm run build`, `npm run lint` is enough to troubleshoot any errors you may find.

## Project Architecture

This is a Next.js 15 application using the App Router with a dashboard-style interface built on modern React patterns.

### Key Dependencies & Stack
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS v4 with CSS variables
- **Icons**: Tabler Icons and Lucide React
- **Data Visualization**: Apache ECharts (via echarts-for-react) for interactive charts
- **Tables**: TanStack Table for data tables
- **Theming**: next-themes for dark/light mode
- **Drag & Drop**: @dnd-kit suite
- **Validation**: Zod for schema validation

### Project Structure
- Uses TypeScript with strict mode
- Path alias `@/*` maps to `./src/*`
- Components follow shadcn/ui patterns in `src/components/ui/`
- Main application components in `src/components/`
- Data files stored as JSON in app directories

### Component Architecture
- Main layout uses a sidebar pattern (AppSidebar) with collapsible navigation
- Dashboard-style interface with charts, data tables, and cards
- Uses Geist font family (sans and mono variants)
- Component composition follows compound component patterns

### Data Patterns
- JSON data files co-located with pages
- Data table implementation uses TanStack Table
- Chart components built with Apache ECharts
- Form validation with Zod schemas

### UI Patterns
- Uses CSS variables for theming
- Responsive design with container queries (@container)
- Consistent spacing with gap utilities
- Component variants using class-variance-authority

## Authentication System

### Overview
The application uses **NextAuth.js v5** (Auth.js) with **Microsoft Entra ID (Azure AD) OAuth** to secure all routes and API endpoints. Only users with **@sparqsys.com** email addresses can access the application.

### Architecture

**Authentication Stack:**
- **NextAuth.js v5** - Modern authentication for Next.js 15
- **Microsoft Entra ID** - OAuth provider (Azure AD)
- **JWT Strategy** - Session tokens stored in encrypted cookies (no database required)
- **Middleware Protection** - Route-level access control

**Key Files:**
- `src/lib/auth.ts` - NextAuth configuration and Azure AD provider setup
- `src/lib/auth-check.ts` - Helper function for API route authentication
- `src/middleware.ts` - Route protection middleware
- `src/app/api/auth/[...nextauth]/route.ts` - NextAuth API handlers
- `src/components/providers/session-provider.tsx` - Client-side session provider
- `src/app/auth/signin/page.tsx` - Custom sign-in page
- `src/app/auth/error/page.tsx` - Authentication error page

### Environment Variables

Required environment variables in `.env.local`:

```env
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here-generate-with-openssl-rand-base64-32

# Azure AD OAuth
AZURE_AD_CLIENT_ID=your-azure-client-id-here
AZURE_AD_CLIENT_SECRET=your-azure-client-secret-here
AZURE_AD_TENANT_ID=your-azure-tenant-id-here

# Access Control
ALLOWED_EMAIL_DOMAIN=@sparqsys.com
```

**Generate NEXTAUTH_SECRET:**
```bash
openssl rand -base64 32
```

See `.env.example` for complete setup instructions.

### Protected Routes

**All routes are protected** except:
- `/api/auth/*` - NextAuth authentication endpoints
- `/auth/signin` - Sign-in page
- `/auth/error` - Error page
- Static assets (`_next/static`, `_next/image`, `favicon.ico`)

**Protected UI Routes:**
- `/` - Dashboard
- `/test/[id]` - Test detail pages

**Protected API Routes:**
All API endpoints require authentication:
- `/api/annotation-groups` (GET, POST)
- `/api/annotation-quick-options` (GET, POST)
- `/api/annotations/[id]` (PUT, DELETE)
- `/api/test/[id]` (GET)
- `/api/test/[id]/annotations` (GET, POST)
- `/api/test-status` (PATCH)
- `/api/test-report` (GET)
- `/api/failed-test-data` (GET)
- `/api/test-stats` (GET)
- `/api/room-temp` (POST)

### How Authentication Works

1. **User visits protected route** → Middleware redirects to `/auth/signin`
2. **User clicks "Sign in with Microsoft"** → Redirects to Microsoft login
3. **Microsoft authenticates user** → Returns to callback URL
4. **NextAuth validates email domain** → Must end with `@sparqsys.com`
5. **Session created** → JWT token stored in encrypted cookie
6. **User accesses application** → Middleware validates session on each request

**Session Details:**
- **Strategy:** JWT (no database required)
- **Duration:** 30 days
- **Storage:** Encrypted httpOnly cookie
- **Contains:** User ID, name, email

### Adding Authentication to New API Routes

When creating new API routes, always add authentication:

```typescript
import { requireAuth } from '@/lib/auth-check';

export async function GET() {
  // Check authentication
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  // Your API logic here
}
```

For routes with dynamic params:
```typescript
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;

  // Check authentication
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  // Your API logic here
}
```

### Azure App Registration Setup

**Required for OAuth to work:**

1. **Go to Azure Portal:** https://portal.azure.com
2. **Navigate to:** Microsoft Entra ID → App registrations → New registration
3. **Configure Application:**
   - **Name:** Burnin Test Dashboard
   - **Supported account types:** Accounts in this organizational directory only (Sparq Systems)
   - **Redirect URI:** Web - `http://localhost:3000/api/auth/callback/azure-ad`
4. **After creation, note:**
   - Application (client) ID → `AZURE_AD_CLIENT_ID`
   - Directory (tenant) ID → `AZURE_AD_TENANT_ID`
5. **Create Client Secret:**
   - Go to: Certificates & secrets → New client secret
   - Copy the secret value → `AZURE_AD_CLIENT_SECRET` (only shown once!)
6. **API Permissions:**
   - Should already have "User.Read" permission
   - Grant admin consent

**For Production Deployment:**
- Add production redirect URI: `https://your-domain.com/api/auth/callback/azure-ad`
- Update `NEXTAUTH_URL` in production environment variables

### Security Considerations

**Implemented Security Measures:**
1. **Domain Restriction** - Only `@sparqsys.com` emails can sign in (enforced in signIn callback)
2. **JWT Encryption** - Session tokens encrypted with `NEXTAUTH_SECRET`
3. **Secure Cookies** - httpOnly, SameSite=Lax, Secure in production
4. **Route Protection** - Middleware blocks all unauthenticated requests
5. **API Protection** - Server-side session validation on every API call
6. **No Credentials in Code** - All secrets in environment variables (gitignored)

**Best Practices:**
- Never commit `.env.local` to git
- Use a strong `NEXTAUTH_SECRET` (32+ characters)
- Rotate Azure client secret periodically
- Always use HTTPS in production
- Monitor Azure AD sign-in logs for suspicious activity

### Session Management

**Get session in Server Components:**
```typescript
import { auth } from '@/lib/auth';

export default async function MyPage() {
  const session = await auth();

  if (session?.user) {
    console.log('User:', session.user.email);
  }
}
```

**Get session in Client Components:**
```typescript
'use client';

import { useSession } from 'next-auth/react';

export function MyComponent() {
  const { data: session, status } = useSession();

  if (status === 'loading') return <div>Loading...</div>;
  if (status === 'unauthenticated') return <div>Not signed in</div>;

  return <div>Welcome {session?.user?.name}</div>;
}
```

**Sign out:**
```typescript
import { signOut } from 'next-auth/react';

<button onClick={() => signOut({ callbackUrl: '/auth/signin' })}>
  Sign Out
</button>
```

### Troubleshooting

**"NEXTAUTH_SECRET environment variable is not set"**
- Create `.env.local` file
- Generate secret: `openssl rand -base64 32`
- Add to `.env.local`: `NEXTAUTH_SECRET=your-generated-secret`

**"Access Denied" error on sign-in**
- Verify email ends with `@sparqsys.com`
- Check `ALLOWED_EMAIL_DOMAIN` in `.env.local`

**Redirect loop / continuous sign-in**
- Verify `NEXTAUTH_URL` matches your dev/production URL
- Check Azure redirect URI matches exactly
- Clear browser cookies and try again

**"Invalid token" or session expires immediately**
- Verify `NEXTAUTH_SECRET` is set and consistent
- Check system time is correct
- Ensure cookies are enabled in browser

**Azure OAuth errors**
- Verify all three Azure credentials (client ID, secret, tenant ID)
- Check client secret hasn't expired in Azure Portal
- Confirm redirect URI is registered in Azure

**API returns 401 Unauthorized**
- Session expired (30 days) - sign in again
- Cookie not being sent (check HTTPS in production)
- Session token invalid - clear cookies and sign in again

### Deployment Notes

**Production Environment:**
1. Update Azure app registration with production URL
2. Set all environment variables in hosting environment
3. Update `NEXTAUTH_URL` to production domain
4. **HTTPS is required** for secure cookies
5. Test OAuth flow thoroughly

**EC2 Deployment Checklist:**
- [ ] Azure redirect URI updated with production URL
- [ ] Environment variables set on EC2 instance
- [ ] HTTPS configured (nginx/Apache with SSL certificate)
- [ ] `NEXTAUTH_URL` points to production domain
- [ ] Test sign-in flow from external network
- [ ] Verify API protection with direct curl requests

## Full-Screen Chart Feature

### Implemented Features (Completed)
- **Full-screen modal system** - Portal-based overlay with dark background
- **State inheritance** - Transfers selected columns, zoom level, and decimation settings from source chart
- **Adaptive decimation** - Intelligently decimates zoomed data slices to maintain ~1000 points at any zoom level
- **Decimation toggle** - Button to enable/disable decimation with cookie persistence
- **Enhanced column grouping** - 6 logical groups in ultra-compact single-row layout:
  - Power Generation (VPV, PPV)
  - Energy & Efficiency (EPV, active/reactive energy)
  - Grid Connection (grid voltages, power, frequency)
  - Current Latch (instantaneous current latch readings)
  - Voltage Latch (instantaneous voltage latch readings)
  - System Status (temperature, status flags, diagnostics)
- **Quick presets** - One-click selections for common column combinations
- **Keyboard shortcuts** - ESC to close fullscreen
- **All zoom/pan functionality** - Inherited from original charts

### Future Enhancements (To Be Implemented)

#### 1. Enhanced Responsive Design
**Priority:** Medium | **Effort:** Medium

**Why:** Current fullscreen is desktop-optimized, mobile experience could be improved

**Implementation Strategy:**
- Responsive breakpoints with adaptive layouts
- Touch-friendly interactions (larger buttons, gesture support)
- Mobile-specific column selector (bottom sheet UI)
- Adaptive modal sizing based on screen size

**Technical Details:**
```typescript
// Dynamic sizing based on screen
const getModalSize = (screenSize: string) => {
  switch (screenSize) {
    case 'mobile': return 'fixed inset-2'
    case 'tablet': return 'w-[90vw] h-[90vh] max-w-4xl'
    case 'desktop': return 'w-[95vw] h-[95vh] max-w-7xl'
  }
}
```

#### 2. Export Functionality
**Priority:** High | **Effort:** High

**Why:** Users need to export visible data and screenshots for analysis/reporting

**Implementation Strategy:**
- Multi-format export (PNG, SVG, CSV, JSON, Excel, PDF)
- Smart data export (only visible/selected columns)
- High-quality screenshots with html2canvas
- Metadata inclusion (chart title, zoom level, timestamp)

**Technical Details:**
```typescript
const exportOptions = {
  screenshot: { formats: ["png", "jpeg", "svg"] },
  data: { formats: ["csv", "json", "xlsx"] },
  report: { formats: ["pdf"] }
}
```

**UI Integration:**
- Export dropdown in fullscreen header
- Custom naming with templates
- Quality/resolution options
- Batch export (all 3 charts at once)

#### 3. Advanced Chart Interactions
**Priority:** Low | **Effort:** Medium

**Why:** Enhanced user experience for data exploration

**Implementation Strategy:**
- Mouse wheel zoom support
- Drag-to-pan on chart area
- Crosshair cursor with value display
- Chart annotation tools
- Data point selection and highlighting

**Technical Details:**
- Integrate with ECharts event handlers
- Custom zoom/pan logic beyond current button controls
- Overlay components for annotations