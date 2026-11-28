// Test sign-in (sign in as anyone, no password) is for a laptop only. It needs MB_DEV_LOGIN=1 and
// is refused whenever the server looks live (RENDER or NODE_ENV=production), even if the flag was
// left on by mistake. Same rule as the demo seed guard in sample.js.
export const devLoginRequested = (env = process.env) => env.MB_DEV_LOGIN === '1';
export const devLoginAllowed = (env = process.env) => devLoginRequested(env) && !env.RENDER && env.NODE_ENV !== 'production';
