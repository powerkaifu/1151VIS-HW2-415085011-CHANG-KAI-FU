import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/1151VIS-HW2-415085011-CHANG-KAI-FU/',
  plugins: [vue()],
  build: {
    emptyOutDir: false,
  },
})
