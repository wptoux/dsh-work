import { clientBundle } from './shared/tsdown.client.ts'

export default clientBundle('dsh-ui-tweaks', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
})