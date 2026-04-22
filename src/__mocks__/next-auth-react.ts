const useSession = () => ({ data: null, status: 'unauthenticated' as const })
const signIn = () => Promise.resolve(undefined)
const signOut = () => Promise.resolve(undefined)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SessionProvider = ({ children }: { children: any }) => children

export { useSession, signIn, signOut, SessionProvider }
