import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/auth'

export async function middleware(request: NextRequest) {
  const session = await auth()
  const isAdmin = session?.user?.role === 'admin'
  if (!session || !isAdmin) {
    const signInUrl = new URL('/api/auth/signin', request.url)
    signInUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
