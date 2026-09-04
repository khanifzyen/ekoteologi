import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'id.ekoteologi.app',
  appName: 'Ekoteologi AR',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
