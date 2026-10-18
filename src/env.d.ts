/// <reference types="vite/client" />
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    admin?: boolean
    /** Needs a Google account; guests are sent to sign in. */
    member?: boolean
    /** Public, but part of the app: a signed-in user who hasn't seen the tutorial sees it first. */
    app?: boolean
  }
}
